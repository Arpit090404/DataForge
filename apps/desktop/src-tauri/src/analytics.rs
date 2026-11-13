use std::{collections::HashSet, fs::{self, File}, io::Write, path::Path, sync::{atomic::{AtomicBool, Ordering}, mpsc, Arc, Mutex}, time::{Duration, Instant}};

use duckdb::{appender_params_from_iter, params_from_iter, types::Value, Config, Connection as DuckConnection, InterruptHandle};
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};

use crate::{db, error, list_datasets_inner, now, source_info, AppError, Result};

const MATERIALIZER_VERSION: &str = "csv-text-v1";
const MAX_SOURCE_BYTES: u64 = 64 * 1024 * 1024;
const MAX_SOURCE_ROWS: usize = 250_000;
const MAX_COLUMNS: usize = 128;
const MAX_RESULT_BYTES: usize = 1024 * 1024;
const MAX_FILTER_NODES: usize = 24;
const QUERY_DEADLINE: Duration = Duration::from_secs(30);

#[derive(Clone, Default)]
pub(super) struct AnalyticsControl { running: Arc<Mutex<Option<Running>>> }
struct Running { id: String, cancelled: Arc<AtomicBool>, interrupt: Option<Arc<InterruptHandle>> }
struct RunGuard { control: AnalyticsControl, id: String, stop_timer: Option<mpsc::Sender<()>> }
impl Drop for RunGuard {
    fn drop(&mut self) {
        if let Some(stop) = self.stop_timer.take() { let _ = stop.send(()); }
        if let Ok(mut running) = self.control.running.lock() {
            if running.as_ref().is_some_and(|current| current.id == self.id) { *running = None; }
        }
    }
}
impl AnalyticsControl {
    pub(super) fn is_running(&self) -> bool { self.running.lock().map_or(true,|running|running.is_some()) }
    pub(super) fn running_id(&self) -> Option<String> { self.running.lock().ok()?.as_ref().map(|r|r.id.clone()) }
    fn start(&self, id: &str) -> Result<(RunGuard, Arc<AtomicBool>, Arc<AtomicBool>)> {
        let mut running = self.running.lock().map_err(|_| analytics_error())?;
        if running.is_some() { return Err(error("analytics_busy", "Another analytical operation is already running.")); }
        let cancelled = Arc::new(AtomicBool::new(false));
        let timed_out = Arc::new(AtomicBool::new(false));
        *running = Some(Running { id: id.into(), cancelled: cancelled.clone(), interrupt: None });
        Ok((RunGuard { control: self.clone(), id: id.into(), stop_timer: None }, cancelled, timed_out))
    }
    fn attach(&self, id: &str, interrupt: Arc<InterruptHandle>) -> Result<()> {
        let mut running = self.running.lock().map_err(|_| analytics_error())?;
        if let Some(current) = running.as_mut().filter(|r| r.id == id) { current.interrupt = Some(interrupt); Ok(()) }
        else { Err(error("cancelled", "The operation was interrupted.")) }
    }
}
pub(super) fn cancel_execution_inner(control: &AnalyticsControl, execution_id: &str) -> Result<()> {
    let running = control.running.lock().map_err(|_| analytics_error())?;
    let Some(current) = running.as_ref().filter(|r| r.id == execution_id) else {
        return Err(error("execution_missing", "This execution is not running."));
    };
    current.cancelled.store(true, Ordering::Relaxed);
    if let Some(handle) = &current.interrupt { handle.interrupt(); }
    Ok(())
}
fn check(cancelled: &AtomicBool, timed_out: &AtomicBool, deadline: Instant) -> Result<()> {
    if timed_out.load(Ordering::Relaxed) || Instant::now() >= deadline {
        return Err(error("timeout", "The analytical operation exceeded the 30-second limit."));
    }
    if cancelled.load(Ordering::Relaxed) { return Err(error("cancelled", "The analytical operation was cancelled.")); }
    Ok(())
}
fn analytics_error() -> AppError { error("analytics_error", "The analytical operation could not be completed.") }

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "snake_case", deny_unknown_fields)]
pub(super) enum FilterExpr {
    And { conditions: Vec<FilterExpr> }, Or { conditions: Vec<FilterExpr> },
    Eq { column: String, value: String }, Ne { column: String, value: String },
    Gt { column: String, value: String }, Lt { column: String, value: String },
    Ge { column: String, value: String }, Le { column: String, value: String },
    Contains { column: String, value: String }, IsNull { column: String }, IsNotNull { column: String },
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct SortSpec { column: String, direction: String, nulls: String }
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Aggregation { op: String, column: Option<String>, alias: String }
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct AnalyticsRequest {
    kind: String,
    #[serde(default)] filters: Option<FilterExpr>,
    #[serde(default)] sort: Vec<SortSpec>,
    #[serde(default)] group_by: Vec<String>,
    #[serde(default)] aggregations: Vec<Aggregation>,
    limit: Option<usize>, offset: Option<usize>,
}
#[derive(Clone, Debug, Serialize)]
pub(super) struct Execution {
    id: String, dataset_id: String, operation_type: String, parameters: String,
    started_at: String, completed_at: Option<String>, status: String,
    result_row_count: Option<u64>, error_summary: Option<String>, duckdb_version: Option<String>, source_fingerprint: String,
}
#[derive(Debug, Serialize)]
pub(super) struct ResultColumn { name: String, data_type: String }
#[derive(Debug, Serialize)]
pub(super) struct AnalyticsResult { execution: Execution, columns: Vec<ResultColumn>, rows: Vec<Vec<Option<String>>>, total_rows: Option<u64>, has_more: bool }
#[derive(Clone, Debug, Serialize, Deserialize)]
struct ColumnDef { name: String, data_type: String, physical: String }

fn validate_request(request: &AnalyticsRequest) -> Result<()> {
    if request.kind != "rows" && request.kind != "group" { return Err(error("unsupported_operation", "Choose a supported analytical operation.")); }
    if !(1..=200).contains(&request.limit.unwrap_or(100)) || request.offset.unwrap_or(0) > 100_000 {
        return Err(error("invalid_limit", "Use 1–200 rows and an offset no greater than 100,000."));
    }
    if request.sort.len() > 3 || request.group_by.len() > 3 || request.aggregations.len() > 6 {
        return Err(error("invalid_operation", "Too many sort, group, or aggregation fields."));
    }
    if request.kind == "rows" && (!request.group_by.is_empty() || !request.aggregations.is_empty()) {
        return Err(error("invalid_operation", "Row view cannot include grouping or aggregations."));
    }
    if request.kind == "group" && request.aggregations.is_empty() {
        return Err(error("invalid_operation", "Add at least one aggregation."));
    }
    let mut aliases = HashSet::new();
    for agg in &request.aggregations {
        if !matches!(agg.op.as_str(), "count" | "sum" | "average" | "min" | "max" | "distinct_count") ||
            agg.alias.is_empty() || agg.alias.len() > 40 || !agg.alias.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') ||
            request.group_by.iter().any(|name| name.eq_ignore_ascii_case(&agg.alias)) ||
            !aliases.insert(agg.alias.to_ascii_lowercase()) {
            return Err(error("invalid_operation", "Aggregation names and functions must be unique and supported."));
        }
    }
    Ok(())
}
fn column<'a>(columns: &'a [ColumnDef], name: &str) -> Result<&'a ColumnDef> {
    columns.iter().find(|c| c.name == name).ok_or_else(|| error("unknown_column", "The selected column is not in this dataset."))
}
fn validate_representation(table: &str, columns: &[ColumnDef]) -> Result<()> {
    if table.len() != 34 || !table.starts_with("r_") || !table[2..].bytes().all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase()) ||
        columns.is_empty() || columns.len() > MAX_COLUMNS {
        return Err(error("invalid_representation", "The saved analytical representation is damaged."));
    }
    let mut names = HashSet::new();
    for (index,col) in columns.iter().enumerate() {
        if col.physical != format!("c{index}") || col.name.trim().is_empty() ||
            !names.insert(col.name.to_ascii_lowercase()) ||
            !matches!(col.data_type.as_str(),"text"|"integer"|"decimal"|"boolean") {
            return Err(error("invalid_representation", "The saved analytical representation is damaged."));
        }
    }
    Ok(())
}
fn compile_filter(expr: &FilterExpr, columns: &[ColumnDef], values: &mut Vec<Value>, depth: usize, count: &mut usize) -> Result<String> {
    *count += 1;
    if depth > 4 || *count > MAX_FILTER_NODES { return Err(error("invalid_filter", "The filter has too many nested conditions.")); }
    match expr {
        FilterExpr::And { conditions } | FilterExpr::Or { conditions } => {
            if conditions.is_empty() || conditions.len() > 8 { return Err(error("invalid_filter", "Each filter group needs 1–8 conditions.")); }
            let joiner = if matches!(expr, FilterExpr::And { .. }) { " AND " } else { " OR " };
            Ok(format!("({})", conditions.iter().map(|c| compile_filter(c, columns, values, depth+1, count))
                .collect::<Result<Vec<_>>>()?.join(joiner)))
        }
        FilterExpr::IsNull { column: name } => Ok(format!("{} IS NULL", column(columns, name)?.physical)),
        FilterExpr::IsNotNull { column: name } => Ok(format!("{} IS NOT NULL", column(columns, name)?.physical)),
        FilterExpr::Eq { column: name, value } | FilterExpr::Ne { column: name, value } |
        FilterExpr::Gt { column: name, value } | FilterExpr::Lt { column: name, value } |
        FilterExpr::Ge { column: name, value } | FilterExpr::Le { column: name, value } |
        FilterExpr::Contains { column: name, value } => {
            if value.len() > 4096 { return Err(error("invalid_filter", "Filter values must be at most 4 KB.")); }
            let col = column(columns, name)?;
            let op = match expr { FilterExpr::Eq { .. } => "=", FilterExpr::Ne { .. } => "<>",
                FilterExpr::Gt { .. } => ">", FilterExpr::Lt { .. } => "<", FilterExpr::Ge { .. } => ">=", FilterExpr::Le { .. } => "<=", _ => "contains" };
            if op == "contains" {
                if col.data_type != "text" { return Err(error("invalid_filter", "Contains requires a text column.")); }
                values.push(Value::Text(value.clone()));
                return Ok(format!("STRPOS(LOWER({}), LOWER(?)) > 0", col.physical));
            }
            if !matches!(expr, FilterExpr::Eq { .. } | FilterExpr::Ne { .. }) &&
                col.data_type != "integer" && col.data_type != "decimal" {
                return Err(error("invalid_filter", "Greater/less comparisons require a numeric column."));
            }
            let lhs = if col.data_type == "integer" || col.data_type == "decimal" {
                let number = value.parse::<f64>().map_err(|_| error("invalid_filter", "Enter a numeric filter value for this column."))?;
                if !number.is_finite() { return Err(error("invalid_filter", "Enter a finite numeric filter value.")); }
                values.push(Value::Double(number));
                format!("TRY_CAST({} AS DOUBLE)", col.physical)
            } else if col.data_type == "boolean" {
                if !value.eq_ignore_ascii_case("true") && !value.eq_ignore_ascii_case("false") {
                    return Err(error("invalid_filter", "Use true or false for a boolean column."));
                }
                values.push(Value::Text(value.to_ascii_lowercase()));
                format!("LOWER({})",col.physical)
            } else { values.push(Value::Text(value.clone())); col.physical.clone() };
            Ok(format!("{lhs} {op} ?"))
        }
    }
}
fn infer_schema(path: &Path, cancelled: &AtomicBool, timed_out: &AtomicBool, deadline: Instant) -> Result<Vec<ColumnDef>> {
    let mut reader = csv::ReaderBuilder::new().flexible(false).from_path(path)
        .map_err(|_| error("malformed_csv", "Could not open the CSV for materialization."))?;
    let headers = reader.headers().map_err(|_| error("malformed_csv", "CSV headers are malformed."))?.clone();
    if headers.is_empty() || headers.len() > MAX_COLUMNS { return Err(error("invalid_csv", "Analytical operations require 1–128 columns.")); }
    let mut seen = HashSet::new();
    for header in headers.iter() {
        if header.trim().is_empty() || !seen.insert(header.to_ascii_lowercase()) {
            return Err(error("invalid_csv", "Analytical operations require nonempty, unique column names."));
        }
    }
    let mut all_int = vec![true; headers.len()]; let mut all_num = vec![true; headers.len()];
    let mut all_bool = vec![true; headers.len()]; let mut nonnull = vec![false; headers.len()];
    for (index, record) in reader.records().enumerate() {
        if index % 100 == 0 { check(cancelled, timed_out, deadline)?; }
        if index >= MAX_SOURCE_ROWS { return Err(error("dataset_limit", "This CSV exceeds the 250,000-row analytical limit. Its preview remains available.")); }
        let record = record.map_err(|_| error("malformed_csv", "A CSV row is malformed or has a different column count."))?;
        for (i, value) in record.iter().enumerate() {
            if value.trim().is_empty() { continue; }
            nonnull[i] = true;
            all_int[i] &= value.parse::<i64>().is_ok();
            all_num[i] &= value.parse::<f64>().is_ok_and(f64::is_finite);
            all_bool[i] &= value.eq_ignore_ascii_case("true") || value.eq_ignore_ascii_case("false");
        }
    }
    Ok(headers.iter().enumerate().map(|(i,name)| ColumnDef { name:name.into(), physical:format!("c{i}"),
        data_type: if !nonnull[i] { "text" } else if all_bool[i] { "boolean" }
            else if all_int[i] { "integer" } else if all_num[i] { "decimal" } else { "text" }.into() }).collect())
}
fn materialize(conn: &DuckConnection, path: &Path, table: &str, columns: &[ColumnDef], cancelled: &AtomicBool, timed_out: &AtomicBool, deadline: Instant) -> Result<()> {
    let definitions = columns.iter().map(|c| format!("{} VARCHAR", c.physical)).collect::<Vec<_>>().join(",");
    conn.execute_batch("BEGIN TRANSACTION").map_err(|_| analytics_error())?;
    let result = (|| {
        conn.execute_batch(&format!("CREATE TABLE {table} ({definitions})")).map_err(|_| analytics_error())?;
        let mut reader = csv::ReaderBuilder::new().flexible(false).from_path(path).map_err(|_| analytics_error())?;
        let _ = reader.headers().map_err(|_| analytics_error())?;
        let mut appender = conn.appender(table).map_err(|_| analytics_error())?;
        for (index, record) in reader.records().enumerate() {
            if index % 100 == 0 { check(cancelled, timed_out, deadline)?; }
            let record = record.map_err(|_| error("malformed_csv", "A CSV row is malformed during materialization."))?;
            let values = record.iter().map(|v| if v.trim().is_empty() { Value::Null } else { Value::Text(v.into()) });
            appender.append_row(appender_params_from_iter(values)).map_err(|_| analytics_error())?;
        }
        appender.flush().map_err(|_| analytics_error())?;
        drop(appender);
        check(cancelled, timed_out, deadline)?;
        conn.execute_batch("COMMIT").map_err(|_| analytics_error())?;
        Ok(())
    })();
    if result.is_err() { let _ = conn.execute_batch("ROLLBACK"); }
    result
}
fn compile_query(request: &AnalyticsRequest, columns: &[ColumnDef], table: &str) -> Result<(String, Vec<Value>, Vec<ResultColumn>)> {
    let mut values = Vec::new(); let mut count = 0;
    let where_sql = request.filters.as_ref().map(|f| compile_filter(f, columns, &mut values, 0, &mut count))
        .transpose()?.map(|s| format!(" WHERE {s}")).unwrap_or_default();
    let (select, group, output, sortable): (String,String,Vec<ResultColumn>,Vec<(String,String)>) = if request.kind == "rows" {
        (columns.iter().map(|c| c.physical.clone()).collect::<Vec<_>>().join(","), String::new(),
         columns.iter().map(|c| ResultColumn { name:c.name.clone(), data_type:c.data_type.clone() }).collect(),
         columns.iter().map(|c| (c.name.clone(), if c.data_type == "integer" || c.data_type == "decimal" {
             format!("TRY_CAST({} AS DOUBLE)",c.physical) } else { c.physical.clone() })).collect())
    } else {
        let mut parts = Vec::new(); let mut output = Vec::new(); let mut sortable = Vec::new(); let mut groups = Vec::new();
        for (i, name) in request.group_by.iter().enumerate() {
            let c = column(columns, name)?;
            if groups.contains(&c.physical) { return Err(error("invalid_operation", "Choose each group column once.")); }
            groups.push(c.physical.clone()); parts.push(format!("{} AS g{i}", c.physical));
            output.push(ResultColumn { name:name.clone(), data_type:c.data_type.clone() });
            sortable.push((name.clone(),if c.data_type == "integer" || c.data_type == "decimal" {
                format!("TRY_CAST(g{i} AS DOUBLE)") } else { format!("g{i}") }));
        }
        for (i, agg) in request.aggregations.iter().enumerate() {
            let mut output_type = "integer";
            let expression = if agg.op == "count" { "COUNT(*)".into() } else {
                let name = agg.column.as_ref().ok_or_else(|| error("invalid_operation", "Choose a column for this aggregation."))?;
                let col = column(columns, name)?;
                match agg.op.as_str() {
                    "sum" | "average" => {
                        if col.data_type != "integer" && col.data_type != "decimal" { return Err(error("invalid_operation", "Sum and average require a numeric column.")); }
                        output_type = "decimal";
                        format!("{}(TRY_CAST({} AS DOUBLE))", if agg.op == "sum" {"SUM"} else {"AVG"}, col.physical)
                    }
                    "min" | "max" => { output_type = col.data_type.as_str();
                        format!("{}({})", if agg.op == "min" {"MIN"} else {"MAX"},
                            if col.data_type == "integer" || col.data_type == "decimal" { format!("TRY_CAST({} AS DOUBLE)",col.physical) }
                            else { col.physical.clone() }) },
                    "distinct_count" => format!("COUNT(DISTINCT {})", col.physical),
                    _ => return Err(error("invalid_operation", "Unsupported aggregation."))
                }
            };
            parts.push(format!("CAST({expression} AS VARCHAR) AS a{i}"));
            output.push(ResultColumn { name:agg.alias.clone(), data_type: output_type.into() });
            sortable.push((agg.alias.clone(),if output_type == "integer" || output_type == "decimal" {format!("TRY_CAST(a{i} AS DOUBLE)")} else {format!("a{i}")}));
        }
        (parts.join(","), if groups.is_empty() {String::new()} else {format!(" GROUP BY {}", groups.join(","))}, output, sortable)
    };
    let mut orders = Vec::new();
    for sort in &request.sort {
        let physical = sortable.iter().find(|(name,_)| name == &sort.column).map(|(_,p)|p)
            .ok_or_else(|| error("unknown_column", "Sort column is not in the result."))?;
        let direction = match sort.direction.as_str() {"asc"=>"ASC","desc"=>"DESC",_=>return Err(error("invalid_sort","Choose ascending or descending sort."))};
        let nulls = match sort.nulls.as_str() {"first"=>"FIRST","last"=>"LAST",_=>return Err(error("invalid_sort","Choose first or last null placement."))};
        orders.push(format!("{physical} {direction} NULLS {nulls}"));
    }
    let order = if orders.is_empty() {String::new()} else {format!(" ORDER BY {}",orders.join(","))};
    let sql = format!("SELECT {select} FROM {table}{where_sql}{group}{order} LIMIT ? OFFSET ?");
    values.push(Value::BigInt((request.limit.unwrap_or(100)+1) as i64));
    values.push(Value::BigInt(request.offset.unwrap_or(0) as i64));
    Ok((sql, values, output))
}
fn read_result(conn: &DuckConnection, request: &AnalyticsRequest, columns: &[ColumnDef], table: &str, cancelled: &AtomicBool, timed_out: &AtomicBool, deadline: Instant) -> Result<(Vec<ResultColumn>,Vec<Vec<Option<String>>>,bool)> {
    let (sql, values, output) = compile_query(request, columns, table)?;
    check(cancelled, timed_out, deadline)?;
    let mut stmt = conn.prepare(&sql).map_err(|_| analytics_error())?;
    let mut cursor = stmt.query(params_from_iter(values.iter())).map_err(|_| analytics_error())?;
    let mut rows = Vec::new(); let mut bytes = 0usize;
    while let Some(row) = cursor.next().map_err(|_| analytics_error())? {
        check(cancelled, timed_out, deadline)?;
        let mut cells = Vec::with_capacity(output.len());
        for i in 0..output.len() {
            let value: Option<String> = row.get(i).map_err(|_| analytics_error())?;
            bytes += value.as_ref().map_or(0,String::len);
            if bytes > MAX_RESULT_BYTES { return Err(error("result_limit", "The result exceeds 1 MB. Use fewer rows or a narrower operation.")); }
            cells.push(value);
        }
        rows.push(cells);
    }
    let has_more = rows.len() > request.limit.unwrap_or(100);
    rows.truncate(request.limit.unwrap_or(100));
    Ok((output,rows,has_more))
}

pub(super) fn run_analytics_inner(project: &Path, dataset_id: &str, request: AnalyticsRequest, control: &AnalyticsControl) -> Result<AnalyticsResult> {
    validate_request(&request)?;
    let metadata = db(project)?;
    let dataset = list_datasets_inner(&metadata)?.into_iter().find(|d| d.id == dataset_id)
        .ok_or_else(|| error("dataset_missing", "This dataset is not registered in the active project."))?;
    if dataset.status != "ready" { return Err(error("file_changed", "The source is missing or changed. Review it before running analytics.")); }
    if dataset.size_bytes > MAX_SOURCE_BYTES { return Err(error("dataset_limit", "This CSV exceeds the 64 MB analytical limit. Its preview remains available.")); }
    let execution_id = uuid::Uuid::new_v4().to_string();
    let (mut guard, cancelled, timed_out) = control.start(&execution_id)?;
    let deadline = Instant::now() + QUERY_DEADLINE;
    let project_id: String = metadata.query_row("SELECT id FROM project LIMIT 1", [], |r| r.get(0)).map_err(|_| analytics_error())?;
    let parameters = serde_json::to_string(&request).map_err(|_| analytics_error())?;
    let started_at = now();
    metadata.execute("INSERT INTO executions (id,project_id,dataset_id,source_fingerprint,operation_type,parameters,started_at,status,schema_version)
        VALUES (?1,?2,?3,?4,?5,?6,?7,'running',1)", params![execution_id,project_id,dataset_id,dataset.fingerprint,request.kind,parameters,started_at])
        .map_err(|_| analytics_error())?;
    let work = (|| {
        let config = Config::default().enable_external_access(false).and_then(|c|c.enable_autoload_extension(false))
            .and_then(|c|c.max_memory("256MB")).and_then(|c|c.threads(2))
            .and_then(|c|c.with("max_temp_directory_size","256MB")).map_err(|_| analytics_error())?;
        let conn = DuckConnection::open_with_flags(project.join("analytics.duckdb"),config).map_err(|_| analytics_error())?;
        let interrupt = conn.interrupt_handle();
        control.attach(&execution_id, interrupt.clone())?;
        let (stop, wake) = mpsc::channel();
        let timeout_flag = timed_out.clone();
        let cancel_flag = cancelled.clone();
        std::thread::spawn(move || if wake.recv_timeout(QUERY_DEADLINE).is_err() {
            timeout_flag.store(true, Ordering::Relaxed); cancel_flag.store(true, Ordering::Relaxed); interrupt.interrupt();
        });
        guard.stop_timer = Some(stop);
        let version = conn.version().map_err(|_| analytics_error())?;
        let existing: Option<(String,String,String)> = metadata.query_row(
            "SELECT id,table_name,schema_json FROM representations WHERE dataset_id=?1 AND source_fingerprint=?2 AND materializer_version=?3 AND duckdb_version=?4 AND status='ready'",
            params![dataset_id,dataset.fingerprint,MATERIALIZER_VERSION,version], |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?)))
            .optional().map_err(|_| analytics_error())?;
        let (representation_id, table, columns) = if let Some((id,table,schema)) = existing {
            let columns = serde_json::from_str::<Vec<ColumnDef>>(&schema).map_err(|_| analytics_error())?;
            validate_representation(&table,&columns)?;
            (id,table,columns)
        } else {
            let (size,_,hash) = source_info(Path::new(&dataset.path))?;
            if size != dataset.size_bytes || hash != dataset.fingerprint { return Err(error("file_changed", "The CSV changed before materialization.")); }
            let columns = infer_schema(Path::new(&dataset.path), &cancelled, &timed_out, deadline)?;
            let id = uuid::Uuid::new_v4().to_string();
            let table = format!("r_{}", uuid::Uuid::new_v4().simple());
            validate_representation(&table,&columns)?;
            materialize(&conn,Path::new(&dataset.path),&table,&columns,&cancelled,&timed_out,deadline)?;
            let (size_after,_,hash_after) = source_info(Path::new(&dataset.path))?;
            if size_after != size || hash_after != hash { let _ = conn.execute_batch(&format!("DROP TABLE {table}")); return Err(error("file_changed", "The CSV changed during materialization.")); }
            metadata.execute("INSERT INTO representations (id,dataset_id,source_fingerprint,table_name,duckdb_version,materializer_version,schema_json,created_at,status)
                VALUES (?1,?2,?3,?4,?5,?6,?7,?8,'ready')", params![id,dataset_id,hash,table,version,MATERIALIZER_VERSION,
                serde_json::to_string(&columns).map_err(|_| analytics_error())?,now()]).map_err(|_| analytics_error())?;
            (id,table,columns)
        };
        check(&cancelled,&timed_out,deadline)?;
        let (output,rows,has_more) = read_result(&conn,&request,&columns,&table,&cancelled,&timed_out,deadline)?;
        check(&cancelled,&timed_out,deadline)?;
        let completed_at = now();
        metadata.execute("UPDATE executions SET representation_id=?1,completed_at=?2,status='succeeded',result_row_count=?3,duckdb_version=?4 WHERE id=?5",
            params![representation_id,completed_at,rows.len() as i64,version,execution_id]).map_err(|_| analytics_error())?;
        Ok(AnalyticsResult { execution: Execution { id:execution_id.clone(),dataset_id:dataset_id.into(),operation_type:request.kind.clone(),
            parameters:parameters.clone(),started_at:started_at.clone(),completed_at:Some(completed_at),status:"succeeded".into(),
            result_row_count:Some(rows.len() as u64),error_summary:None,duckdb_version:Some(version),source_fingerprint:dataset.fingerprint.clone() },
            columns:output,rows,total_rows:None,has_more })
    })().or_else(|failure| {
        if timed_out.load(Ordering::Relaxed) { Err(error("timeout", "The analytical operation exceeded the 30-second limit.")) }
        else if cancelled.load(Ordering::Relaxed) { Err(error("cancelled", "The analytical operation was cancelled.")) }
        else { Err(failure) }
    });
    if let Err(ref failure) = work {
        let status = if failure.code == "cancelled" {"cancelled"} else if failure.code == "timeout" {"interrupted"} else {"failed"};
        let _ = metadata.execute("UPDATE executions SET completed_at=?1,status=?2,error_summary=?3 WHERE id=?4",
            params![now(),status,failure.message,execution_id]);
    }
    work
}
pub(super) fn list_executions_inner(project: &Path) -> Result<Vec<Execution>> {
    let metadata = db(project)?;
    let mut stmt = metadata.prepare("SELECT id,dataset_id,operation_type,parameters,started_at,completed_at,status,result_row_count,error_summary,duckdb_version,source_fingerprint FROM executions ORDER BY started_at DESC,id DESC LIMIT 200")
        .map_err(|_| analytics_error())?;
    let entries = stmt.query_map([], |r| Ok(Execution { id:r.get(0)?,dataset_id:r.get(1)?,operation_type:r.get(2)?,parameters:r.get(3)?,started_at:r.get(4)?,
        completed_at:r.get(5)?,status:r.get(6)?,result_row_count:r.get::<_,Option<i64>>(7)?.map(|n|n as u64),error_summary:r.get(8)?,
        duckdb_version:r.get(9)?,source_fingerprint:r.get(10)? })).map_err(|_| analytics_error())?;
    entries.collect::<std::result::Result<Vec<_>,_>>().map_err(|_| analytics_error())
}
pub(super) fn get_execution_result_inner(project: &Path, id: &str, control: &AnalyticsControl) -> Result<AnalyticsResult> {
    let unavailable = || error("result_unavailable", "The saved result is unavailable because its execution or pinned representation cannot be replayed.");
    let metadata = db(project)?;
    let (execution, table, schema, representation_version): (Execution, String, String, String) = metadata.query_row(
        "SELECT e.id,e.dataset_id,e.operation_type,e.parameters,e.started_at,e.completed_at,e.status,e.result_row_count,e.error_summary,e.duckdb_version,e.source_fingerprint,r.table_name,r.schema_json,r.duckdb_version
         FROM executions e JOIN representations r ON r.id=e.representation_id AND r.dataset_id=e.dataset_id AND r.source_fingerprint=e.source_fingerprint
         WHERE e.id=?1 AND e.project_id=(SELECT id FROM project LIMIT 1) AND e.status='succeeded' AND e.schema_version=1 AND r.status='ready' AND r.materializer_version=?2",
        params![id, MATERIALIZER_VERSION], |r| Ok((Execution { id:r.get(0)?,dataset_id:r.get(1)?,operation_type:r.get(2)?,parameters:r.get(3)?,started_at:r.get(4)?,
            completed_at:r.get(5)?,status:r.get(6)?,result_row_count:r.get::<_,Option<i64>>(7)?.map(|n|n as u64),error_summary:r.get(8)?,
            duckdb_version:r.get(9)?,source_fingerprint:r.get(10)? },r.get(11)?,r.get(12)?,r.get(13)?)))
        .map_err(|_| unavailable())?;
    let request: AnalyticsRequest = serde_json::from_str(&execution.parameters).map_err(|_| unavailable())?;
    let columns: Vec<ColumnDef> = serde_json::from_str(&schema).map_err(|_| unavailable())?;
    validate_request(&request).map_err(|_| unavailable())?;
    validate_representation(&table, &columns).map_err(|_| unavailable())?;
    if request.kind != execution.operation_type || execution.duckdb_version.as_deref() != Some(&representation_version) {
        return Err(unavailable());
    }
    let path = project.join("analytics.duckdb");
    if !path.is_file() { return Err(unavailable()); }
    let (mut guard, cancelled, timed_out) = control.start(id)?;
    let deadline = Instant::now() + QUERY_DEADLINE;
    let config = Config::default().access_mode(duckdb::AccessMode::ReadOnly)
        .and_then(|c|c.enable_external_access(false)).and_then(|c|c.enable_autoload_extension(false))
        .and_then(|c|c.max_memory("256MB")).and_then(|c|c.threads(2))
        .and_then(|c|c.with("max_temp_directory_size","256MB")).map_err(|_| unavailable())?;
    let conn = DuckConnection::open_with_flags(path, config).map_err(|_| unavailable())?;
    if conn.version().map_err(|_| unavailable())? != representation_version { return Err(unavailable()); }
    let interrupt = conn.interrupt_handle();
    control.attach(id, interrupt.clone())?;
    let (stop, wake) = mpsc::channel();
    let timeout_flag = timed_out.clone();
    let cancel_flag = cancelled.clone();
    std::thread::spawn(move || if wake.recv_timeout(QUERY_DEADLINE).is_err() {
        timeout_flag.store(true, Ordering::Relaxed); cancel_flag.store(true, Ordering::Relaxed); interrupt.interrupt();
    });
    guard.stop_timer = Some(stop);
    let (output, rows, has_more) = read_result(&conn, &request, &columns, &table, &cancelled, &timed_out, deadline)
        .map_err(|failure| if timed_out.load(Ordering::Relaxed) { error("timeout", "The analytical operation exceeded the 30-second limit.") }
            else if cancelled.load(Ordering::Relaxed) { error("cancelled", "The analytical operation was cancelled.") }
            else { let _ = failure; unavailable() })?;
    check(&cancelled, &timed_out, deadline)?;
    Ok(AnalyticsResult { execution, columns:output, rows, total_rows:None, has_more })
}
pub(super) fn export_result_inner(path: &str, columns: &[String], rows: &[Vec<Option<String>>]) -> Result<()> {
    if columns.is_empty() || columns.len() > MAX_COLUMNS || rows.len() > 200 || rows.iter().any(|r|r.len()!=columns.len()) ||
        columns.iter().map(String::len).sum::<usize>() + rows.iter().flatten().flatten().map(String::len).sum::<usize>() > MAX_RESULT_BYTES {
        return Err(error("invalid_export", "Only a bounded result page can be exported."));
    }
    let target = Path::new(path);
    if !target.extension().is_some_and(|e|e.to_string_lossy().eq_ignore_ascii_case("csv")) {
        return Err(error("invalid_export", "Choose a .csv destination."));
    }
    let parent = target.parent().ok_or_else(||error("invalid_export","Choose a destination folder."))?;
    if !parent.is_dir() { return Err(error("invalid_export","The destination folder does not exist.")); }
    if target.exists() { return Err(error("export_exists","A file already exists at this location. Choose a new name.")); }
    let temp = parent.join(format!(".dataforge-export-{}.tmp",uuid::Uuid::new_v4()));
    let result = (|| {
        let file = File::create_new(&temp).map_err(|_|error("export_error","Could not create the export file."))?;
        let mut writer = csv::Writer::from_writer(file);
        writer.write_record(columns).map_err(|_|error("export_error","Could not write the export."))?;
        for row in rows { writer.write_record(row.iter().map(|v|v.as_deref().unwrap_or(""))).map_err(|_|error("export_error","Could not write the export."))?; }
        writer.flush().map_err(|_|error("export_error","Could not finish the export."))?;
        let mut file = writer.into_inner().map_err(|_|error("export_error","Could not finish the export."))?;
        file.flush().map_err(|_|error("export_error","Could not finish the export."))?;
        file.sync_all().map_err(|_|error("export_error","Could not save the export."))?;
        fs::hard_link(&temp,target).map_err(|_|error("export_error","Could not publish the export without replacing an existing file."))?;
        fs::remove_file(&temp).map_err(|_|error("export_error","The export was saved, but its temporary file could not be removed."))?;
        Ok(())
    })();
    if result.is_err() { let _ = fs::remove_file(&temp); }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{create_project_inner, register_csv_inner};
    #[test]
    fn rejects_unknown_sql_surface() {
        let req = AnalyticsRequest {kind:"rows".into(),filters:Some(FilterExpr::Eq{column:"x; DROP TABLE t".into(),value:"1".into()}),
            sort:vec![],group_by:vec![],aggregations:vec![],limit:Some(10),offset:Some(0)};
        let cols=vec![ColumnDef{name:"x".into(),data_type:"text".into(),physical:"c0".into()}];
        assert_eq!(compile_query(&req,&cols,"r_123").unwrap_err().code,"unknown_column");
    }
    #[test]
    fn limits_filter_and_result_shapes() {
        let req=AnalyticsRequest{kind:"rows".into(),filters:None,sort:vec![],group_by:vec![],aggregations:vec![],limit:Some(201),offset:None};
        assert_eq!(validate_request(&req).unwrap_err().code,"invalid_limit");
        assert_eq!(validate_representation("r_123;DROP TABLE x",&[ColumnDef{name:"x".into(),data_type:"text".into(),physical:"c0".into()}])
            .unwrap_err().code,"invalid_representation");
        assert_eq!(validate_representation("r_0123456789abcdef0123456789abcdef",&[ColumnDef{name:"x".into(),data_type:"text".into(),physical:"c0;DROP TABLE x".into()}])
            .unwrap_err().code,"invalid_representation");
        let cols=vec![ColumnDef{name:"x".into(),data_type:"text".into(),physical:"c0".into()}];
        let mut params=vec![]; let mut count=0;
        assert_eq!(compile_filter(&FilterExpr::Contains{column:"x".into(),value:"a".into()},&cols,&mut params,0,&mut count).unwrap(),
            "STRPOS(LOWER(c0), LOWER(?)) > 0");
        assert_eq!(compile_filter(&FilterExpr::Gt{column:"x".into(),value:"3".into()},&cols,&mut params,0,&mut count)
            .unwrap_err().code,"invalid_filter");
    }
    #[test]
    fn materializes_and_runs_fixed_operations() {
        let root=std::env::temp_dir().join(format!("dataforge-analytics-test-{}",uuid::Uuid::new_v4()));
        fs::create_dir(&root).unwrap();
        let project=create_project_inner("Study",root.to_str().unwrap()).unwrap();
        let project_path=Path::new(&project.project.path);
        let source=root.join("sample.csv");
        fs::write(&source,"Person,Value\nAda,10\nBob,20\nAda,30\n").unwrap();
        let dataset=register_csv_inner(project_path,source.to_str().unwrap()).unwrap();
        let original=fs::read(&source).unwrap();
        let control=AnalyticsControl::default();
        let rows=run_analytics_inner(project_path,&dataset.id,AnalyticsRequest{
            kind:"rows".into(),filters:Some(FilterExpr::Eq{column:"Person".into(),value:"Ada".into()}),
            sort:vec![SortSpec{column:"Value".into(),direction:"desc".into(),nulls:"last".into()}],
            group_by:vec![],aggregations:vec![],limit:Some(2),offset:Some(0)},&control).unwrap();
        assert_eq!(rows.rows,vec![vec![Some("Ada".into()),Some("30".into())],vec![Some("Ada".into()),Some("10".into())]]);
        assert!(!rows.has_more);
        let grouped=run_analytics_inner(project_path,&dataset.id,AnalyticsRequest{
            kind:"group".into(),filters:None,sort:vec![],group_by:vec!["Person".into()],
            aggregations:vec![Aggregation{op:"count".into(),column:None,alias:"n".into()}],
            limit:Some(10),offset:None},&control).unwrap();
        assert_eq!(grouped.rows.len(),2);
        assert_eq!(list_executions_inner(project_path).unwrap().len(),2);
        assert_eq!(fs::read(&source).unwrap(),original);
        let page=run_analytics_inner(project_path,&dataset.id,AnalyticsRequest{
            kind:"rows".into(),filters:Some(FilterExpr::And{conditions:vec![
                FilterExpr::Or{conditions:vec![FilterExpr::Eq{column:"Person".into(),value:"Ada".into()},
                    FilterExpr::Eq{column:"Person".into(),value:"Bob".into()}]},
                FilterExpr::Gt{column:"Value".into(),value:"10".into()}]}),
            sort:vec![],group_by:vec![],aggregations:vec![],limit:Some(1),offset:Some(1)},&control).unwrap();
        assert_eq!(page.rows.len(),1);
        assert!(!page.has_more);
        assert_eq!(list_executions_inner(project_path).unwrap().len(),3);
        fs::write(&source,"Person,Value\nChanged,99\n").unwrap();
        assert_eq!(run_analytics_inner(project_path,&dataset.id,AnalyticsRequest{kind:"rows".into(),filters:None,
            sort:vec![],group_by:vec![],aggregations:vec![],limit:None,offset:None},&control).unwrap_err().code,"file_changed");
        fs::remove_file(&source).unwrap();
        let replay = get_execution_result_inner(project_path, &rows.execution.id, &control).unwrap();
        assert_eq!(replay.rows, rows.rows);
        assert_eq!(list_executions_inner(project_path).unwrap().len(), 3);
        assert_eq!(get_execution_result_inner(project_path, "unknown", &control).unwrap_err().code, "result_unavailable");
        let metadata = db(project_path).unwrap();
        metadata.execute("UPDATE representations SET duckdb_version='obsolete' WHERE id=(SELECT representation_id FROM executions WHERE id=?1)", [&rows.execution.id]).unwrap();
        drop(metadata);
        assert_eq!(get_execution_result_inner(project_path, &rows.execution.id, &control).unwrap_err().code, "result_unavailable");
        assert!(run_analytics_inner(project_path,&dataset.id,AnalyticsRequest{kind:"rows".into(),filters:None,
            sort:vec![],group_by:vec![],aggregations:vec![],limit:None,offset:None},&control).is_err());
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn numeric_group_sort_empty_csv_and_export_escaping() {
        let root=std::env::temp_dir().join(format!("dataforge-analytics-test-{}",uuid::Uuid::new_v4())); fs::create_dir(&root).unwrap();
        let project=create_project_inner("Study",root.to_str().unwrap()).unwrap(); let p=Path::new(&project.project.path);
        let source=root.join("sample.csv"); fs::write(&source,"Group,Value\nA,1\nA,1\nB,10\n").unwrap();
        let d=register_csv_inner(p,source.to_str().unwrap()).unwrap(); let control=AnalyticsControl::default();
        let result=run_analytics_inner(p,&d.id,AnalyticsRequest{kind:"group".into(),filters:None,
            sort:vec![SortSpec{column:"total".into(),direction:"asc".into(),nulls:"last".into()}],
            group_by:vec!["Group".into()],aggregations:vec![Aggregation{op:"sum".into(),column:Some("Value".into()),alias:"total".into()}],
            limit:Some(10),offset:None},&control).unwrap();
        assert_eq!(result.rows[0][0].as_deref(),Some("A"));
        let export=root.join("result.csv");
        export_result_inner(export.to_str().unwrap(),&["Name".into(),"Text".into()],&[vec![Some("A, B".into()),Some("line\n\"quote\"".into())]]).unwrap();
        let mut reader=csv::Reader::from_path(export).unwrap(); let record=reader.records().next().unwrap().unwrap();
        assert_eq!(record.get(0),Some("A, B")); assert_eq!(record.get(1),Some("line\n\"quote\""));
        let before=fs::read(&source).unwrap();
        assert_eq!(export_result_inner(source.to_str().unwrap(),&["x".into()],&[vec![Some("new".into())]]).unwrap_err().code,"export_exists");
        assert_eq!(fs::read(&source).unwrap(),before);
        let empty=root.join("empty.csv");fs::write(&empty,"A,B\n").unwrap();
        let empty_d=register_csv_inner(p,empty.to_str().unwrap()).unwrap();
        let empty_result=run_analytics_inner(p,&empty_d.id,AnalyticsRequest{kind:"rows".into(),filters:None,sort:vec![],group_by:vec![],aggregations:vec![],limit:None,offset:None},&control).unwrap();
        assert!(empty_result.rows.is_empty());
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn cancellation_flag_reaches_running_operation() {
        let control=AnalyticsControl::default();
        let (_guard,cancelled,timed_out)=control.start("one").unwrap();
        cancel_execution_inner(&control,"one").unwrap();
        assert_eq!(check(&cancelled,&timed_out,Instant::now()+Duration::from_secs(1)).unwrap_err().code,"cancelled");
    }
    #[test]
    fn engine_version_change_creates_new_representation() {
        let root=std::env::temp_dir().join(format!("dataforge-analytics-test-{}",uuid::Uuid::new_v4())); fs::create_dir(&root).unwrap();
        let project=create_project_inner("Versioned",root.to_str().unwrap()).unwrap(); let p=Path::new(&project.project.path);
        let source=root.join("sample.csv"); fs::write(&source,"value\n1\n").unwrap();
        let dataset=register_csv_inner(p,source.to_str().unwrap()).unwrap(); let control=AnalyticsControl::default();
        let request=|| AnalyticsRequest{kind:"rows".into(),filters:None,sort:vec![],group_by:vec![],aggregations:vec![],limit:None,offset:None};
        run_analytics_inner(p,&dataset.id,request(),&control).unwrap();
        let metadata=db(p).unwrap();
        metadata.execute("UPDATE representations SET duckdb_version='older-engine'",[]).unwrap();
        drop(metadata);
        run_analytics_inner(p,&dataset.id,request(),&control).unwrap();
        let metadata=db(p).unwrap();
        let count:i64=metadata.query_row("SELECT COUNT(*) FROM representations",[],|r|r.get(0)).unwrap();
        assert_eq!(count,2);
        drop(metadata); fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn null_filters_and_history_survive_reopen() {
        let root=std::env::temp_dir().join(format!("dataforge-analytics-test-{}",uuid::Uuid::new_v4())); fs::create_dir(&root).unwrap();
        let project=create_project_inner("Nulls",root.to_str().unwrap()).unwrap(); let p=Path::new(&project.project.path);
        let source=root.join("sample.csv"); fs::write(&source,"name,value\nA,\nB,2\n").unwrap();
        let dataset=register_csv_inner(p,source.to_str().unwrap()).unwrap(); let control=AnalyticsControl::default();
        let run=|filter| run_analytics_inner(p,&dataset.id,AnalyticsRequest{kind:"rows".into(),filters:Some(filter),
            sort:vec![],group_by:vec![],aggregations:vec![],limit:Some(1),offset:None},&control);
        let empty=run(FilterExpr::IsNull{column:"value".into()}).unwrap();
        assert_eq!(empty.rows,vec![vec![Some("A".into()),None]]);
        assert!(!empty.has_more);
        let present=run(FilterExpr::IsNotNull{column:"value".into()}).unwrap();
        assert_eq!(present.rows,vec![vec![Some("B".into()),Some("2".into())]]);
        assert_eq!(run(FilterExpr::Gt{column:"name".into(),value:"3".into()}).unwrap_err().code,"invalid_filter");
        assert_eq!(run(FilterExpr::Eq{column:"absent".into(),value:"x".into()}).unwrap_err().code,"unknown_column");
        crate::open_project_inner(&project.project.path).unwrap();
        let history=list_executions_inner(p).unwrap();
        assert_eq!(history.len(),4);
        assert_eq!(history.iter().filter(|e|e.status=="succeeded").count(),2);
        assert_eq!(history.iter().filter(|e|e.status=="failed").count(),2);
        fs::remove_dir_all(root).unwrap();
    }
}
