use std::{collections::{HashMap, HashSet}, fs::{self, File}, io::{Read, Write}, path::{Path, PathBuf}, process::{Child, Command, Stdio}, sync::{atomic::{AtomicBool, Ordering}, mpsc, Arc, Mutex}, time::{Duration, Instant}};

use duckdb::{appender_params_from_iter, params_from_iter, types::{Value, ValueRef}, Config, Connection as DuckConnection, InterruptHandle};
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};

use crate::{db, error, list_datasets_inner, now, source_info, AppError, Result};

const MATERIALIZER_VERSION: &str = "csv-text-v1";
const MAX_SOURCE_BYTES: u64 = 64 * 1024 * 1024;
const MAX_SQL_SOURCE_BYTES: u64 = 256 * 1024 * 1024;
const MAX_SOURCE_ROWS: usize = 250_000;
const MAX_COLUMNS: usize = 128;
const MAX_RESULT_BYTES: usize = 1024 * 1024;
const MAX_FILTER_NODES: usize = 24;
const QUERY_DEADLINE: Duration = Duration::from_secs(30);

#[derive(Clone, Default)]
pub(super) struct AnalyticsControl { running: Arc<Mutex<Option<Running>>> }
struct Running { id: String, cancelled: Arc<AtomicBool>, interrupt: Option<Arc<InterruptHandle>>, child: Option<Arc<Mutex<Child>>> }
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
        *running = Some(Running { id: id.into(), cancelled: cancelled.clone(), interrupt: None, child: None });
        Ok((RunGuard { control: self.clone(), id: id.into(), stop_timer: None }, cancelled, timed_out))
    }
    fn attach(&self, id: &str, interrupt: Arc<InterruptHandle>) -> Result<()> {
        let mut running = self.running.lock().map_err(|_| analytics_error())?;
        if let Some(current) = running.as_mut().filter(|r| r.id == id) { current.interrupt = Some(interrupt); Ok(()) }
        else { Err(error("cancelled", "The operation was interrupted.")) }
    }
    fn attach_child(&self, id: &str, child: Arc<Mutex<Child>>) -> Result<()> {
        let mut running = self.running.lock().map_err(|_| analytics_error())?;
        if let Some(current) = running.as_mut().filter(|r| r.id == id) { current.child = Some(child); Ok(()) }
        else { Err(error("cancelled", "The operation was interrupted.")) }
    }
    fn clear_interrupt(&self, id: &str) -> Result<()> {
        let mut running = self.running.lock().map_err(|_| analytics_error())?;
        if let Some(current) = running.as_mut().filter(|r| r.id == id) { current.interrupt = None; Ok(()) }
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
    let child = current.child.clone();
    drop(running);
    if let Some(child) = child { if let Ok(mut process) = child.lock() { let _ = process.kill(); } }
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
#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct ResultPage { offset: usize, limit: usize }
#[derive(Clone, Debug, Serialize)]
pub(super) struct Execution {
    id: String, dataset_id: String, operation_type: String, parameters: String,
    started_at: String, completed_at: Option<String>, status: String,
    result_row_count: Option<u64>, error_summary: Option<String>, duckdb_version: Option<String>, source_fingerprint: String,
}
#[derive(Debug, Serialize, Deserialize)]
pub(super) struct ResultColumn { pub(super) name: String, pub(super) data_type: String }
#[derive(Debug, Serialize)]
pub(super) struct AnalyticsResult { execution: Execution, columns: Vec<ResultColumn>, rows: Vec<Vec<Option<String>>>, total_rows: Option<u64>, has_more: bool }
#[derive(Debug, Serialize, Deserialize)]
pub(super) struct PythonTable {
    pub(super) kind: String, pub(super) id: String, pub(super) name: Option<String>, pub(super) columns: Vec<ResultColumn>,
    pub(super) rows: Vec<Vec<Option<String>>>, pub(super) has_more: bool,
    pub(super) source_fingerprint: String, pub(super) representation_id: String,
    pub(super) duckdb_version: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
struct ColumnDef { name: String, data_type: String, physical: String }

fn dataset_handle(id: &str) -> String { format!("dataset_{}", id.replace('-', "")) }
fn dataset_names(datasets: &[crate::Dataset]) -> HashMap<String, Vec<String>> {
    let mut counts = HashMap::new();
    for dataset in datasets { *counts.entry(dataset.name.to_lowercase()).or_insert(0usize) += 1; }
    datasets.iter().map(|dataset| {
        let mut names = vec![dataset_handle(&dataset.id)];
        if !dataset.name.eq_ignore_ascii_case("source") && !dataset.name.to_lowercase().starts_with("dataset_")
            && counts[&dataset.name.to_lowercase()] == 1 { names.push(dataset.name.clone()); }
        (dataset.id.clone(), names)
    }).collect()
}
fn resolve_dataset<'a>(datasets: &'a [crate::Dataset], name: &str) -> Result<&'a crate::Dataset> {
    if let Some(dataset) = datasets.iter().find(|item| item.id.eq_ignore_ascii_case(name) || dataset_handle(&item.id).eq_ignore_ascii_case(name)) { return Ok(dataset); }
    let matches: Vec<_> = datasets.iter().filter(|item| item.name.eq_ignore_ascii_case(name)).collect();
    match matches.as_slice() {
        [dataset] => Ok(dataset),
        [] => Err(error("dataset_missing", "No registered dataset has that name or ID.")),
        _ => Err(error("dataset_ambiguous", "Several datasets have that name. Use the stable dataset_<id> name.")),
    }
}
fn sql_mentions_name(sql: &str, name: &str) -> bool {
    let query = sql.to_lowercase();
    let quoted = format!("\"{}\"", name.replace('"', "\"\"")).to_lowercase();
    query.contains(&quoted) || (name.starts_with("dataset_") && query.split(|ch: char| !ch.is_alphanumeric() && ch != '_')
        .any(|word| word == name.to_lowercase()))
}

fn validate_page(offset: usize, limit: usize) -> Result<()> {
    if !(1..=200).contains(&limit) || offset > 100_000 {
        return Err(error("invalid_limit", "Use 1–200 rows and an offset no greater than 100,000."));
    }
    Ok(())
}
fn validate_request(request: &AnalyticsRequest) -> Result<()> {
    if request.kind != "rows" && request.kind != "group" { return Err(error("unsupported_operation", "Choose a supported analytical operation.")); }
    validate_page(request.offset.unwrap_or(0), request.limit.unwrap_or(100))?;
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
fn representation_for(metadata: &rusqlite::Connection, conn: &DuckConnection, dataset: &crate::Dataset,
    cancelled: &AtomicBool, timed_out: &AtomicBool, deadline: Instant) -> Result<(String, String, Vec<ColumnDef>, String)> {
    let version = conn.version().map_err(|_| analytics_error())?;
    let existing: Option<(String,String,String)> = metadata.query_row(
        "SELECT id,table_name,schema_json FROM representations WHERE dataset_id=?1 AND source_fingerprint=?2 AND materializer_version=?3 AND duckdb_version=?4 AND status='ready'",
        params![dataset.id,dataset.fingerprint,MATERIALIZER_VERSION,version], |r| Ok((r.get(0)?,r.get(1)?,r.get(2)?)))
        .optional().map_err(|_| analytics_error())?;
    let (id, table, columns) = if let Some((id,table,schema)) = existing {
        let columns = serde_json::from_str::<Vec<ColumnDef>>(&schema).map_err(|_| analytics_error())?;
        validate_representation(&table,&columns)?;
        (id,table,columns)
    } else {
        let (size,_,hash) = source_info(Path::new(&dataset.path))?;
        if size != dataset.size_bytes || hash != dataset.fingerprint { return Err(error("file_changed", "The CSV changed before materialization.")); }
        let columns = infer_schema(Path::new(&dataset.path), cancelled, timed_out, deadline)?;
        let id = uuid::Uuid::new_v4().to_string();
        let table = format!("r_{}", uuid::Uuid::new_v4().simple());
        validate_representation(&table,&columns)?;
        materialize(conn,Path::new(&dataset.path),&table,&columns,cancelled,timed_out,deadline)?;
        let (size_after,_,hash_after) = source_info(Path::new(&dataset.path))?;
        if size_after != size || hash_after != hash { let _ = conn.execute_batch(&format!("DROP TABLE {table}")); return Err(error("file_changed", "The CSV changed during materialization.")); }
        metadata.execute("INSERT INTO representations (id,dataset_id,source_fingerprint,table_name,duckdb_version,materializer_version,schema_json,created_at,status)
            VALUES (?1,?2,?3,?4,?5,?6,?7,?8,'ready')", params![id,dataset.id,hash,table,version,MATERIALIZER_VERSION,
            serde_json::to_string(&columns).map_err(|_| analytics_error())?,now()]).map_err(|_| analytics_error())?;
        (id,table,columns)
    };
    Ok((id, table, columns, version))
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
fn sql_value(value: ValueRef<'_>) -> Option<String> {
    match value {
        ValueRef::Null => None,
        ValueRef::Text(bytes) => Some(String::from_utf8_lossy(bytes).into_owned()),
        ValueRef::Blob(bytes) => Some(format!("<binary: {} bytes>", bytes.len())),
        ValueRef::Boolean(value) => Some(value.to_string()),
        ValueRef::TinyInt(value) => Some(value.to_string()), ValueRef::SmallInt(value) => Some(value.to_string()),
        ValueRef::Int(value) => Some(value.to_string()), ValueRef::BigInt(value) => Some(value.to_string()),
        ValueRef::HugeInt(value) => Some(value.to_string()), ValueRef::UTinyInt(value) => Some(value.to_string()),
        ValueRef::USmallInt(value) => Some(value.to_string()), ValueRef::UInt(value) => Some(value.to_string()),
        ValueRef::UBigInt(value) => Some(value.to_string()), ValueRef::Float(value) => Some(value.to_string()),
        ValueRef::Double(value) => Some(value.to_string()), ValueRef::Decimal(value) => Some(value.to_string()),
        other => Some(format!("{other:?}")),
    }
}
fn read_sql_result(conn: &DuckConnection, sql: &str,
    cancelled: &AtomicBool, timed_out: &AtomicBool, deadline: Instant) -> Result<(Vec<ResultColumn>,Vec<Vec<Option<String>>>,bool)> {
    let query = sql.trim().trim_end_matches(';');
    check(cancelled, timed_out, deadline)?;
    let mut statement = conn.prepare(query).map_err(|e| error("sql_error", e.to_string().chars().take(500).collect::<String>()))?;
    let mut cursor = statement.query([]).map_err(|e| error("sql_error", e.to_string().chars().take(500).collect::<String>()))?;
    let mut rows = Vec::new(); let mut bytes = 0usize;
    while let Some(row) = cursor.next().map_err(|e| error("sql_error", e.to_string().chars().take(500).collect::<String>()))? {
        check(cancelled, timed_out, deadline)?;
        if row.as_ref().column_count() > MAX_COLUMNS { return Err(error("result_limit", "The SQL result has more than 128 columns.")); }
        let mut cells = Vec::with_capacity(row.as_ref().column_count());
        for index in 0..row.as_ref().column_count() {
            let value = sql_value(row.get_ref(index).map_err(|_| analytics_error())?);
            bytes += value.as_ref().map_or(0, String::len);
            if bytes > MAX_RESULT_BYTES { return Err(error("result_limit", "The SQL result exceeds 1 MB. Select fewer or narrower values.")); }
            cells.push(value);
        }
        rows.push(cells);
        if rows.len() > 200 { break; }
    }
    drop(cursor);
    let names = statement.column_names();
    if names.len() > MAX_COLUMNS { return Err(error("result_limit", "The SQL result has more than 128 columns.")); }
    let output = names.into_iter().enumerate().map(|(index, name)| {
        let data_type = format!("{:?}", statement.column_type(index));
        ResultColumn { name, data_type: if data_type.starts_with("Int") || data_type.starts_with("UInt") || data_type.starts_with("HugeInt") { "integer" }
            else if data_type.starts_with("Float") || data_type.starts_with("Decimal") { "decimal" }
            else if data_type.starts_with("Boolean") { "boolean" } else { "text" }.into() }
    }).collect();
    let has_more = rows.len() > 200;
    rows.truncate(200);
    Ok((output,rows,has_more))
}

#[derive(Serialize, Deserialize)]
struct SqlRelation { name: String, table: String, columns: Vec<ColumnDef> }
#[derive(Serialize, Deserialize)]
struct SqlWorkerRequest { protocol_version: u32, database: PathBuf, relations: Vec<SqlRelation>, version: String, sql: String }
#[derive(Serialize, Deserialize)]
struct SqlWorkerResponse {
    protocol_version: u32,
    columns: Vec<ResultColumn>, rows: Vec<Vec<Option<String>>>, has_more: bool,
    error_code: Option<String>, error_message: Option<String>,
}
const WORKER_MARKER: &str = "DATAFORGE_SQL_WORKER:";

pub fn sql_worker_main() -> i32 {
    let response = (|| -> Result<SqlWorkerResponse> {
        let mut input = String::new();
        std::io::stdin().take(32 * 1024).read_to_string(&mut input).map_err(|_| analytics_error())?;
        let request: SqlWorkerRequest = serde_json::from_str(&input).map_err(|_| analytics_error())?;
        if request.protocol_version != 2 { return Err(analytics_error()); }
        let config = Config::default().access_mode(duckdb::AccessMode::ReadOnly)
            .and_then(|c|c.enable_external_access(false)).and_then(|c|c.enable_autoload_extension(false))
            .and_then(|c|c.max_memory("256MB")).and_then(|c|c.threads(2))
            .and_then(|c|c.with("max_temp_directory_size","256MB")).and_then(|c|c.with("lock_configuration","true"))
            .map_err(|_| analytics_error())?;
        let conn = DuckConnection::open_with_flags(&request.database, config).map_err(|_| analytics_error())?;
        if conn.version().map_err(|_| analytics_error())? != request.version {
            return Err(error("result_unavailable", "The analytical representation uses another DuckDB version."));
        }
        let cancelled = AtomicBool::new(false);
        let timed_out = AtomicBool::new(false);
        if request.relations.len() > 65 { return Err(error("dataset_limit", "SQL can access at most 32 registered datasets in this phase.")); }
        let mut seen = HashSet::new();
        for relation in &request.relations {
            validate_representation(&relation.table, &relation.columns)?;
            if relation.name.is_empty() || relation.name.len() > 255 || !seen.insert(relation.name.to_lowercase()) { return Err(analytics_error()); }
            let projection = relation.columns.iter().map(|column| {
                let expression = match column.data_type.as_str() {
                    "integer" => format!("TRY_CAST({} AS BIGINT)", column.physical),
                    "decimal" => format!("TRY_CAST({} AS DOUBLE)", column.physical),
                    "boolean" => format!("TRY_CAST({} AS BOOLEAN)", column.physical),
                    _ => column.physical.clone(),
                };
                format!("{expression} AS \"{}\"", column.name.replace('"', "\"\""))
            }).collect::<Vec<_>>().join(",");
            conn.execute_batch(&format!("CREATE TEMP VIEW \"{}\" AS SELECT {projection} FROM {}", relation.name.replace('"', "\"\""), relation.table))
                .map_err(|_| error("sql_worker_error", "Could not expose the registered dataset to SQL."))?;
        }
        let (columns, rows, has_more) = read_sql_result(&conn, &request.sql,
            &cancelled, &timed_out, Instant::now() + QUERY_DEADLINE)?;
        Ok(SqlWorkerResponse { protocol_version: 2, columns, rows, has_more, error_code: None, error_message: None })
    })().unwrap_or_else(|failure| SqlWorkerResponse {
        protocol_version: 2, columns: vec![], rows: vec![], has_more: false,
        error_code: Some(failure.code.into()), error_message: Some(failure.message),
    });
    let Ok(json) = serde_json::to_string(&response) else { return 1 };
    if writeln!(std::io::stdout(), "{WORKER_MARKER}{json}").is_err() { return 1 }
    0
}

fn sql_worker_command() -> Result<Command> {
    let executable = std::env::current_exe().map_err(|_| analytics_error())?;
    let mut command = Command::new(executable);
    #[cfg(test)] {
        command.args(["--exact", "analytics::tests::sql_worker_child_entry", "--nocapture"]);
        command.env("DATAFORGE_SQL_WORKER_TEST", "1");
    }
    #[cfg(not(test))] { command.arg("--dataforge-sql-worker"); }
    #[cfg(windows)] {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    Ok(command)
}

fn execute_sql_worker(request: &SqlWorkerRequest, control: &AnalyticsControl, execution_id: &str,
    cancelled: &AtomicBool, timed_out: &AtomicBool, deadline: Instant) -> Result<SqlWorkerResponse> {
    let payload = serde_json::to_vec(request).map_err(|_| analytics_error())?;
    if payload.len() > 32 * 1024 { return Err(error("invalid_sql", "The SQL request is too large.")); }
    let mut child = sql_worker_command()?.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null())
        .spawn().map_err(|_| error("sql_worker_error", "The SQL worker could not start."))?;
    let stdout = child.stdout.take().ok_or_else(analytics_error)?;
    let mut stdin = child.stdin.take().ok_or_else(analytics_error)?;
    let child = Arc::new(Mutex::new(child));
    control.attach_child(execution_id, child.clone())?;
    stdin.write_all(&payload).map_err(|_| error("sql_worker_error", "The SQL worker stopped before reading the query."))?;
    drop(stdin);
    let reader = std::thread::spawn(move || { let mut output = Vec::new();
        stdout.take((MAX_RESULT_BYTES * 8) as u64).read_to_end(&mut output).map(|_| output) });
    let status = loop {
        if let Err(failure) = check(cancelled, timed_out, deadline) {
            if let Ok(mut process) = child.lock() { let _ = process.kill(); let _ = process.wait(); }
            let _ = reader.join();
            return Err(failure);
        }
        if let Ok(mut process) = child.lock() {
            if let Some(status) = process.try_wait().map_err(|_| analytics_error())? { break status; }
        }
        std::thread::sleep(Duration::from_millis(20));
    };
    let output = reader.join().map_err(|_| analytics_error())?.map_err(|_| analytics_error())?;
    if !status.success() { return Err(error("sql_worker_error", "DuckDB could not execute this SQL query.")); }
    let text = std::str::from_utf8(&output).map_err(|_| analytics_error())?;
    let json = text.lines().find_map(|line| line.strip_prefix(WORKER_MARKER))
        .ok_or_else(|| error("sql_worker_error", "The SQL worker returned no result."))?;
    let response: SqlWorkerResponse = serde_json::from_str(json).map_err(|_| analytics_error())?;
    if response.protocol_version != 2 || response.rows.len() > 200 || response.columns.len() > MAX_COLUMNS ||
        response.rows.iter().any(|row| row.len() != response.columns.len()) ||
        response.rows.iter().flatten().flatten().map(String::len).sum::<usize>() > MAX_RESULT_BYTES {
        return Err(error("sql_worker_error", "The SQL worker returned an invalid result."));
    }
    if let Some(code) = &response.error_code {
        let allowed = match code.as_str() { "sql_error" => "sql_error", "result_limit" => "result_limit",
            "timeout" => "timeout", "result_unavailable" => "result_unavailable", _ => "sql_worker_error" };
        return Err(error(allowed, response.error_message.unwrap_or_else(|| "SQL execution failed.".into())));
    }
    Ok(response)
}

pub(super) fn run_notebook_sql_inner(project: &Path, dataset_id: &str, block_id: &str, sql: &str,
    control: &AnalyticsControl, execution_id: String) -> Result<AnalyticsResult> {
    if sql.len() > 8192 || sql.contains('\0') {
        return Err(error("invalid_sql", "Enter one SELECT query of at most 8 KB."));
    }
    let metadata = db(project)?;
    let (saved_sql, language): (String,String) = metadata.query_row(
        "SELECT content,language FROM notebook_blocks WHERE id=?1 AND kind='code'", [block_id], |r| Ok((r.get(0)?,r.get(1)?)))
        .map_err(|_| error("invalid_block", "Choose a saved SQL Code cell."))?;
    if language != "sql" || saved_sql != sql { return Err(error("invalid_block", "Save the SQL Code cell before running it.")); }
    let available = list_datasets_inner(&metadata)?;
    let names = dataset_names(&available);
    let legacy_source_allowed = !dataset_id.is_empty() || available.iter().filter(|item|item.status=="ready").count()==1;
    let source_alias = dataset_id.is_empty() && legacy_source_allowed
        && sql.to_lowercase().split(|ch: char| !ch.is_alphanumeric() && ch != '_').any(|word|word=="source");
    let ambiguous = available.iter().any(|item| available.iter().filter(|other|other.name.eq_ignore_ascii_case(&item.name)).count()>1
        && sql_mentions_name(sql,&item.name));
    let datasets: Vec<_> = if dataset_id.is_empty() { available.into_iter().filter(|item|
        names[&item.id].iter().any(|name|sql_mentions_name(sql,name)) || source_alias && item.status=="ready").collect() }
        else { available.into_iter().filter(|item| item.id == dataset_id).collect() };
    if ambiguous && dataset_id.is_empty() { return Err(error("dataset_ambiguous", "Several datasets have that name. Use a stable dataset_<id> handle.")); }
    if datasets.is_empty() { return Err(error("dataset_missing", "Reference a registered dataset by quoted name or stable dataset_<id> handle. Duplicate names require the stable handle.")); }
    if datasets.len() > 32 { return Err(error("dataset_limit", "SQL can access at most 32 registered datasets in this phase.")); }
    if datasets.iter().any(|item| item.status != "ready") {
        return Err(error("dataset_unavailable", "A registered dataset is missing or changed. Review it before running SQL."));
    }
    if datasets.iter().any(|item| item.size_bytes > MAX_SOURCE_BYTES) {
        return Err(error("dataset_limit", "A registered CSV exceeds the 64 MB analytical limit."));
    }
    if datasets.iter().map(|item|item.size_bytes).sum::<u64>() > MAX_SQL_SOURCE_BYTES {
        return Err(error("dataset_limit", "The referenced SQL datasets exceed the 256 MB combined source limit."));
    }
    let (_guard, cancelled, timed_out) = control.start(&execution_id)?;
    let deadline = Instant::now() + QUERY_DEADLINE;
    let project_id: String = metadata.query_row("SELECT id FROM project LIMIT 1", [], |r| r.get(0)).map_err(|_| analytics_error())?;
    let input_ids: Vec<_> = datasets.iter().map(|item| serde_json::json!({"dataset_id":item.id,"source_fingerprint":item.fingerprint,"names":names[&item.id]})).collect();
    let mut parameters = serde_json::json!({"version":2,"sql":sql,"code_block_id":block_id,"inputs":input_ids,"limit":200}).to_string();
    let started_at = now();
    metadata.execute("INSERT INTO executions (id,project_id,dataset_id,source_fingerprint,operation_type,parameters,started_at,status,schema_version)
        VALUES (?1,?2,?3,?4,'sql',?5,?6,'running',2)", params![execution_id,project_id,datasets[0].id,datasets[0].fingerprint,parameters,started_at])
        .map_err(|_| analytics_error())?;
    let work = (|| {
        let statement = sql.trim().trim_end_matches(';');
        if statement.contains(';') || statement.split_whitespace().next().is_none_or(|first| !first.eq_ignore_ascii_case("select")) {
            return Err(error("invalid_sql", "Enter one SELECT query of at most 8 KB."));
        }
        let config = Config::default().enable_external_access(false).and_then(|c|c.enable_autoload_extension(false))
            .and_then(|c|c.max_memory("256MB")).and_then(|c|c.threads(2))
            .and_then(|c|c.with("max_temp_directory_size","256MB")).map_err(|_| analytics_error())?;
        let conn = DuckConnection::open_with_flags(project.join("analytics.duckdb"),config).map_err(|_| analytics_error())?;
        let interrupt = conn.interrupt_handle();
        control.attach(&execution_id, interrupt.clone())?;
        let (stop, wake) = mpsc::channel();
        let timeout_flag = timed_out.clone();
        let timer = std::thread::spawn(move || if wake.recv_timeout(QUERY_DEADLINE).is_err() {
            timeout_flag.store(true, Ordering::Relaxed); interrupt.interrupt();
        });
        let materialized = datasets.iter().map(|dataset| {
            representation_for(&metadata, &conn, dataset, &cancelled, &timed_out, deadline)
        }).collect::<Result<Vec<_>>>();
        let _ = stop.send(());
        let _ = timer.join();
        let materialized = materialized?;
        let (representation_id, _, _, version) = &materialized[0];
        let pinned: Vec<_> = datasets.iter().zip(&materialized).map(|(item,(id,_,_,engine))|
            serde_json::json!({"dataset_id":item.id,"source_fingerprint":item.fingerprint,"representation_id":id,"duckdb_version":engine,"names":names[&item.id]})).collect();
        parameters = serde_json::json!({"version":2,"sql":sql,"code_block_id":block_id,"inputs":pinned,"limit":200}).to_string();
        let mut relations = Vec::new();
        for (dataset, (_, table, columns, _)) in datasets.iter().zip(&materialized) {
            for name in &names[&dataset.id] { relations.push(SqlRelation { name:name.clone(),table:table.clone(),columns:columns.clone() }); }
        }
        if datasets.len() == 1 && legacy_source_allowed { relations.push(SqlRelation { name:"source".into(),table:materialized[0].1.clone(),columns:materialized[0].2.clone() }); }
        control.clear_interrupt(&execution_id)?;
        drop(conn);
        check(&cancelled,&timed_out,deadline)?;
        metadata.execute("UPDATE executions SET representation_id=?1,duckdb_version=?2,parameters=?3 WHERE id=?4",
            params![representation_id,version,parameters,execution_id]).map_err(|_| analytics_error())?;
        let response = execute_sql_worker(&SqlWorkerRequest { protocol_version: 2, database: project.join("analytics.duckdb"), relations,
            version: version.clone(), sql: sql.into() }, control, &execution_id, &cancelled, &timed_out, deadline)?;
        check(&cancelled,&timed_out,deadline)?;
        crate::code_outputs::store(&metadata,block_id,&execution_id,"sql",&serde_json::json!({
            "columns":response.columns,"rows":response.rows,"total_rows":null,"has_more":response.has_more
        }))?;
        let completed_at = now();
        metadata.execute("UPDATE executions SET representation_id=?1,completed_at=?2,status='succeeded',result_row_count=?3,duckdb_version=?4 WHERE id=?5",
            params![representation_id,completed_at,response.rows.len() as i64,version,execution_id]).map_err(|_| analytics_error())?;
        Ok(AnalyticsResult { execution:Execution { id:execution_id.clone(),dataset_id:datasets[0].id.clone(),operation_type:"sql".into(),
            parameters:parameters.clone(),started_at:started_at.clone(),completed_at:Some(completed_at),status:"succeeded".into(),
            result_row_count:Some(response.rows.len() as u64),error_summary:None,duckdb_version:Some(version.clone()),source_fingerprint:datasets[0].fingerprint.clone() },
            columns:response.columns,rows:response.rows,total_rows:None,has_more:response.has_more })
    })().or_else(|failure| {
        if timed_out.load(Ordering::Relaxed) { Err(error("timeout", "The SQL query exceeded the 30-second limit.")) }
        else if cancelled.load(Ordering::Relaxed) { Err(error("cancelled", "The SQL query was cancelled.")) }
        else { Err(failure) }
    });
    if let Err(ref failure) = work {
        let _ = crate::code_outputs::store(&metadata,block_id,&execution_id,"sql",&serde_json::json!({"error":failure.message}));
        let status = if failure.code == "cancelled" {"cancelled"} else if failure.code == "timeout" {"interrupted"} else {"failed"};
        let _ = metadata.execute("UPDATE executions SET completed_at=?1,status=?2,error_summary=?3 WHERE id=?4",
            params![now(),status,failure.message,execution_id]);
    }
    work
}

#[cfg(test)]
pub(super) fn run_analytics_inner(project: &Path, dataset_id: &str, request: AnalyticsRequest, control: &AnalyticsControl) -> Result<AnalyticsResult> {
    run_analytics_with_id(project, dataset_id, request, control, uuid::Uuid::new_v4().to_string())
}

pub(super) fn run_analytics_with_id(project: &Path, dataset_id: &str, request: AnalyticsRequest, control: &AnalyticsControl, execution_id: String) -> Result<AnalyticsResult> {
    validate_request(&request)?;
    let metadata = db(project)?;
    let dataset = list_datasets_inner(&metadata)?.into_iter().find(|d| d.id == dataset_id)
        .ok_or_else(|| error("dataset_missing", "This dataset is not registered in the active project."))?;
    if dataset.status != "ready" { return Err(error("file_changed", "The source is missing or changed. Review it before running analytics.")); }
    if dataset.size_bytes > MAX_SOURCE_BYTES { return Err(error("dataset_limit", "This CSV exceeds the 64 MB analytical limit. Its preview remains available.")); }
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
        let (representation_id, table, columns, version) = representation_for(&metadata, &conn, &dataset, &cancelled, &timed_out, deadline)?;
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
pub(super) fn dataset_for_python(project: &Path, name: &str, control: &AnalyticsControl) -> Result<PythonTable> {
    let metadata = db(project)?;
    let datasets = list_datasets_inner(&metadata)?;
    let dataset = resolve_dataset(&datasets, name)?;
    if dataset.status != "ready" || dataset.size_bytes > MAX_SOURCE_BYTES {
        return Err(error("dataset_unavailable", "The selected dataset is changed, missing, or exceeds the analytical limit."));
    }
    let id = uuid::Uuid::new_v4().to_string();
    let (mut guard,cancelled,timed_out) = control.start(&id)?;
    let deadline = Instant::now() + QUERY_DEADLINE;
    let config = Config::default().enable_external_access(false).and_then(|c|c.enable_autoload_extension(false))
        .and_then(|c|c.max_memory("256MB")).and_then(|c|c.threads(2))
        .and_then(|c|c.with("max_temp_directory_size","256MB")).map_err(|_| analytics_error())?;
    let conn = DuckConnection::open_with_flags(project.join("analytics.duckdb"),config).map_err(|_| analytics_error())?;
    let interrupt = conn.interrupt_handle();
    control.attach(&id,interrupt.clone())?;
    let (stop,wake) = mpsc::channel();
    let timeout_flag=timed_out.clone();
    std::thread::spawn(move || if wake.recv_timeout(QUERY_DEADLINE).is_err() { timeout_flag.store(true,Ordering::Relaxed); interrupt.interrupt(); });
    guard.stop_timer=Some(stop);
    let (representation_id,table,columns,duckdb_version) = representation_for(&metadata,&conn,&dataset,&cancelled,&timed_out,deadline)?;
    let request=AnalyticsRequest { kind:"rows".into(),filters:None,sort:Vec::new(),group_by:Vec::new(),aggregations:Vec::new(),limit:Some(200),offset:Some(0) };
    let (output,rows,has_more)=read_result(&conn,&request,&columns,&table,&cancelled,&timed_out,deadline)?;
    check(&cancelled,&timed_out,deadline)?;
    if has_more { return Err(error("input_limit", "This dataset exceeds the 200-row Python transfer limit. Use SQL to filter or aggregate it before transfer; no rows were silently omitted.")); }
    Ok(PythonTable { kind:"dataset".into(),id:dataset.id.clone(),name:Some(name.into()),columns:output,rows,has_more:false,
        source_fingerprint:dataset.fingerprint.clone(),representation_id,duckdb_version })
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
pub(super) fn get_execution_result_inner(project: &Path, id: &str, page: Option<ResultPage>, control: &AnalyticsControl) -> Result<AnalyticsResult> {
    if let Some(page) = page { validate_page(page.offset, page.limit)?; }
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
    let mut request: AnalyticsRequest = serde_json::from_str(&execution.parameters).map_err(|_| unavailable())?;
    let columns: Vec<ColumnDef> = serde_json::from_str(&schema).map_err(|_| unavailable())?;
    validate_request(&request).map_err(|_| unavailable())?;
    validate_representation(&table, &columns).map_err(|_| unavailable())?;
    if request.kind != execution.operation_type || execution.duckdb_version.as_deref() != Some(&representation_version) {
        return Err(unavailable());
    }
    if let Some(page) = page {
        request.offset = Some(page.offset);
        request.limit = Some(page.limit);
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
    fn sql_worker_child_entry() {
        if std::env::var("DATAFORGE_SQL_WORKER_TEST").ok().as_deref() == Some("1") {
            std::process::exit(sql_worker_main());
        }
    }
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
    fn replay_page_rejects_invalid_bounds_before_opening_project() {
        let control = AnalyticsControl::default();
        for page in [ResultPage { offset: 0, limit: 0 }, ResultPage { offset: 0, limit: 201 },
            ResultPage { offset: 100_001, limit: 1 }, ResultPage { offset: usize::MAX, limit: usize::MAX }] {
            assert_eq!(get_execution_result_inner(Path::new("missing-project"), "missing", Some(page), &control)
                .unwrap_err().code, "invalid_limit");
        }
        assert!(validate_page(100_000, 200).is_ok());
        for json in [r#"{"offset":-1,"limit":1}"#, r#"{"offset":0,"limit":-1}"#,
            r#"{"offset":0}"#, r#"{"offset":0,"limit":1,"sql":"SELECT 1"}"#] {
            assert!(serde_json::from_str::<ResultPage>(json).is_err());
        }
        assert!(!control.is_running());
    }
    #[test]
    fn replay_pages_preserve_pinned_operations_and_history() {
        let root = std::env::temp_dir().join(format!("dataforge-analytics-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&root).unwrap();
        let project = create_project_inner("Pages", root.to_str().unwrap()).unwrap();
        let p = Path::new(&project.project.path);
        let source = root.join("sample.csv");
        fs::write(&source, "Group,Value\nA,1\nA,3\nB,2\nC,4\nD,0\n").unwrap();
        let dataset = register_csv_inner(p, source.to_str().unwrap()).unwrap();
        let control = AnalyticsControl::default();
        let rows = run_analytics_inner(p, &dataset.id, AnalyticsRequest {
            kind: "rows".into(), filters: Some(FilterExpr::Gt { column: "Value".into(), value: "0".into() }),
            sort: vec![SortSpec { column: "Value".into(), direction: "desc".into(), nulls: "last".into() }],
            group_by: vec![], aggregations: vec![], limit: Some(1), offset: Some(1),
        }, &control).unwrap();
        let grouped = run_analytics_inner(p, &dataset.id, AnalyticsRequest {
            kind: "group".into(), filters: Some(FilterExpr::Gt { column: "Value".into(), value: "0".into() }),
            sort: vec![SortSpec { column: "n".into(), direction: "desc".into(), nulls: "last".into() },
                SortSpec { column: "Group".into(), direction: "asc".into(), nulls: "last".into() }],
            group_by: vec!["Group".into()], aggregations: vec![Aggregation { op: "count".into(), column: None, alias: "n".into() }],
            limit: Some(1), offset: Some(1),
        }, &control).unwrap();
        fs::remove_file(&source).unwrap();
        let history = serde_json::to_value(list_executions_inner(p).unwrap()).unwrap();
        let cell_rows = |pairs: &[(&str, &str)]| pairs.iter().map(|(a,b)| vec![Some((*a).into()), Some((*b).into())]).collect::<Vec<Vec<Option<String>>>>();
        for (saved, first, last, final_offset) in [
            (&rows, cell_rows(&[("C", "4"), ("A", "3")]), cell_rows(&[("B", "2"), ("A", "1")]), 2),
            (&grouped, cell_rows(&[("A", "2"), ("B", "1")]), cell_rows(&[("C", "1")]), 2),
        ] {
            let replay = |page| get_execution_result_inner(p, &saved.execution.id, page, &control).unwrap();
            assert_eq!(replay(None).rows, saved.rows);
            let first_page = replay(Some(ResultPage { offset: 0, limit: 2 }));
            assert_eq!(first_page.rows, first);
            assert!(first_page.has_more);
            assert_eq!(serde_json::to_value(&first_page.execution).unwrap(), serde_json::to_value(&saved.execution).unwrap());
            let final_page = replay(Some(ResultPage { offset: final_offset, limit: 2 }));
            assert_eq!(final_page.rows, last);
            assert!(!final_page.has_more);
            for offset in [4, 100_000] {
                let empty = replay(Some(ResultPage { offset, limit: 200 }));
                assert!(empty.rows.is_empty());
                assert!(!empty.has_more);
            }
        }
        let (guard, _, _) = control.start(&rows.execution.id).unwrap();
        assert_eq!(get_execution_result_inner(p, &rows.execution.id, Some(ResultPage { offset: 0, limit: 1 }), &control)
            .unwrap_err().code, "analytics_busy");
        cancel_execution_inner(&control, &rows.execution.id).unwrap();
        drop(guard);
        let metadata = db(p).unwrap();
        let table: String = metadata.query_row("SELECT table_name FROM representations LIMIT 1", [], |r| r.get(0)).unwrap();
        drop(metadata);
        let conn = DuckConnection::open(p.join("analytics.duckdb")).unwrap();
        conn.execute_batch(&format!("DROP TABLE {table}")).unwrap();
        drop(conn);
        assert_eq!(get_execution_result_inner(p, &rows.execution.id, Some(ResultPage { offset: 0, limit: 1 }), &control)
            .unwrap_err().code, "result_unavailable");
        assert_eq!(serde_json::to_value(list_executions_inner(p).unwrap()).unwrap(), history);
        assert!(!control.is_running());
        fs::remove_dir_all(root).unwrap();
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
        let replay = get_execution_result_inner(project_path, &rows.execution.id, None, &control).unwrap();
        assert_eq!(replay.rows, rows.rows);
        assert_eq!(list_executions_inner(project_path).unwrap().len(), 3);
        assert_eq!(get_execution_result_inner(project_path, "unknown", None, &control).unwrap_err().code, "result_unavailable");
        let metadata = db(project_path).unwrap();
        metadata.execute("UPDATE representations SET duckdb_version='obsolete' WHERE id=(SELECT representation_id FROM executions WHERE id=?1)", [&rows.execution.id]).unwrap();
        drop(metadata);
        assert_eq!(get_execution_result_inner(project_path, &rows.execution.id, None, &control).unwrap_err().code, "result_unavailable");
        assert!(run_analytics_inner(project_path,&dataset.id,AnalyticsRequest{kind:"rows".into(),filters:None,
            sort:vec![],group_by:vec![],aggregations:vec![],limit:None,offset:None},&control).is_err());
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn notebook_count_keeps_execution_identity_after_reopen() {
        let root = std::env::temp_dir().join(format!("dataforge-count-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&root).unwrap();
        let project = create_project_inner("Study", root.to_str().unwrap()).unwrap();
        let path = Path::new(&project.project.path);
        let source = root.join("sample.csv");
        fs::write(&source, "Value\nA\nB\nC\n").unwrap();
        let dataset = register_csv_inner(path, source.to_str().unwrap()).unwrap();
        let control = AnalyticsControl::default();
        let id = uuid::Uuid::new_v4().to_string();
        let request = || serde_json::from_value(serde_json::json!({
            "kind": "group", "group_by": [], "aggregations": [{"op": "count", "alias": "row_count"}], "limit": 1
        })).unwrap();
        let result = run_analytics_with_id(path, &dataset.id, request(), &control, id.clone()).unwrap();
        assert_eq!(result.execution.id, id);
        assert_eq!(result.rows, vec![vec![Some("3".into())]]);
        assert!(!result.has_more);
        let notebook = serde_json::to_value(crate::notebook::create_notebook_inner(path, "Counts").unwrap()).unwrap();
        let notebook_id = notebook["id"].as_str().unwrap();
        crate::notebook::add_block_inner(path, notebook_id, "result", "", Some(&id), None, None, None).unwrap();
        let opened = crate::open_project_inner(path.to_str().unwrap()).unwrap();
        let path = Path::new(&opened.project.path);
        let reopened = serde_json::to_value(crate::notebook::get_notebook_inner(path, notebook_id).unwrap()).unwrap();
        assert_eq!(reopened["blocks"][0]["execution_id"].as_str(), Some(id.as_str()));
        fs::write(&source, "Value\nChanged\n").unwrap();
        assert_eq!(run_analytics_inner(path, &dataset.id, request(), &control).unwrap_err().code, "file_changed");
        fs::remove_file(&source).unwrap();
        assert_eq!(run_analytics_inner(path, &dataset.id, request(), &control).unwrap_err().code, "file_changed");
        assert_eq!(list_executions_inner(path).unwrap().len(), 1);
        let replay = get_execution_result_inner(path, &id, None, &control).unwrap();
        assert_eq!(replay.rows, result.rows);
        assert_eq!(replay.execution.source_fingerprint, result.execution.source_fingerprint);
        let store = path.join("analytics.duckdb");
        let backup = path.join("analytics-unavailable.duckdb");
        fs::rename(&store, &backup).unwrap();
        assert_eq!(get_execution_result_inner(path, &id, None, &control).unwrap_err().code, "result_unavailable");
        fs::rename(&backup, &store).unwrap();
        assert_eq!(get_execution_result_inner(path, &id, None, &control).unwrap().rows, result.rows);

        let empty = root.join("empty.csv");
        fs::write(&empty, "Value\n").unwrap();
        let empty_dataset = register_csv_inner(path, empty.to_str().unwrap()).unwrap();
        let empty_count = run_analytics_inner(path, &empty_dataset.id, request(), &control).unwrap();
        assert_eq!(empty_count.rows, vec![vec![Some("0".into())]]);
        fs::remove_dir_all(&root).unwrap();
    }
    #[test]
    fn notebook_rows_and_group_rerun_keep_one_result_cell() {
        let root=std::env::temp_dir().join(format!("dataforge-notebook-operations-{}",uuid::Uuid::new_v4()));
        fs::create_dir(&root).unwrap();
        let project=create_project_inner("Study",root.to_str().unwrap()).unwrap();let path=Path::new(&project.project.path);
        let source=root.join("sales.csv");fs::write(&source,"Region,Sales\nEast,10\nWest,20\nEast,30\n").unwrap();
        let dataset=register_csv_inner(path,source.to_str().unwrap()).unwrap();let control=AnalyticsControl::default();
        let rows:AnalyticsRequest=serde_json::from_value(serde_json::json!({"kind":"rows","filters":{"op":"and","conditions":[{"op":"eq","column":"Region","value":"East"}]},"sort":[{"column":"Sales","direction":"desc","nulls":"last"}],"limit":2,"offset":0})).unwrap();
        let first=run_analytics_inner(path,&dataset.id,rows,&control).unwrap();
        assert_eq!(first.rows.len(),2);assert_eq!(first.rows[0][1].as_deref(),Some("30"));
        let note=serde_json::to_value(crate::notebook::create_notebook_inner(path,"Analysis").unwrap()).unwrap();
        let note_id=note["id"].as_str().unwrap();
        let block=serde_json::to_value(crate::notebook::add_block_inner(path,note_id,"result","",Some(&first.execution.id),None,None,None).unwrap()).unwrap();
        let block_id=block["id"].as_str().unwrap();
        let grouped:AnalyticsRequest=serde_json::from_value(serde_json::json!({"kind":"group","group_by":["Region"],"aggregations":[{"op":"sum","column":"Sales","alias":"total"},{"op":"count","alias":"row_count"}],"sort":[{"column":"total","direction":"desc","nulls":"last"}],"limit":2,"offset":0})).unwrap();
        let second=run_analytics_inner(path,&dataset.id,grouped,&control).unwrap();
        assert_eq!(second.rows.len(),2);assert_eq!(second.rows[0],vec![Some("East".into()),Some("40.0".into()),Some("2".into())]);
        let updated=serde_json::to_value(crate::notebook::update_result_block_inner(path,block_id,&second.execution.id).unwrap()).unwrap();
        assert_eq!(updated["id"],block["id"]);assert_eq!(updated["position"],block["position"]);
        crate::open_project_inner(path.to_str().unwrap()).unwrap();
        let reopened=serde_json::to_value(crate::notebook::get_notebook_inner(path,note_id).unwrap()).unwrap();
        assert_eq!(reopened["blocks"].as_array().unwrap().len(),1);assert_eq!(reopened["blocks"][0]["execution_id"].as_str(),Some(second.execution.id.as_str()));
        assert_eq!(get_execution_result_inner(path,&second.execution.id,None,&control).unwrap().rows,second.rows);
        assert_eq!(list_executions_inner(path).unwrap().len(),2);
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
        assert_eq!(cancel_execution_inner(&control,"another").unwrap_err().code,"execution_missing");
        assert!(!cancelled.load(Ordering::Relaxed));
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
    #[test]
    fn trusted_notebook_sql_is_bounded_read_only_and_recorded() {
        let root=std::env::temp_dir().join(format!("dataforge-sql-test-{}",uuid::Uuid::new_v4())); fs::create_dir(&root).unwrap();
        let project=create_project_inner("SQL",root.to_str().unwrap()).unwrap(); let p=Path::new(&project.project.path);
        let source=root.join("sample.csv"); fs::write(&source,"Name,Value\nAda,10\nBob,20\n").unwrap();
        let dataset=register_csv_inner(p,source.to_str().unwrap()).unwrap(); let original=fs::read(&source).unwrap();
        let notebook=serde_json::to_value(crate::notebook::create_notebook_inner(p,"Queries").unwrap()).unwrap();
        let sql="SELECT Name, Value FROM source ORDER BY Name";
        let block=serde_json::to_value(crate::notebook::add_block_inner(p,notebook["id"].as_str().unwrap(),"code",sql,None,None,None,Some("sql")).unwrap()).unwrap();
        let block_id=block["id"].as_str().unwrap();
        let control=AnalyticsControl::default();
        let run=|text: &str| run_notebook_sql_inner(p,&dataset.id,block_id,text,&control,uuid::Uuid::new_v4().to_string());
        let result=run(sql).unwrap();
        assert_eq!(result.rows,vec![vec![Some("Ada".into()),Some("10".into())],vec![Some("Bob".into()),Some("20".into())]]);
        assert_eq!(result.columns.len(),2); assert!(!result.has_more);
        let saved=crate::code_outputs::load(p,notebook["id"].as_str().unwrap()).unwrap();
        assert_eq!(saved[0].execution_id,result.execution.id);
        assert_eq!(saved[0].value["rows"],serde_json::json!([["Ada","10"],["Bob","20"]]));
        assert_eq!(saved[0].code,sql);
        assert_eq!(result.execution.operation_type,"sql");
        assert_eq!(serde_json::from_str::<serde_json::Value>(&result.execution.parameters).unwrap()["sql"],sql);
        assert_eq!(run("SELECT 1").unwrap_err().code,"invalid_block");
        crate::notebook::update_block_inner(p,block_id,"SELECT Name FROM source WHERE 1=0",Some("sql")).unwrap();
        let empty=run("SELECT Name FROM source WHERE 1=0").unwrap();
        assert!(empty.rows.is_empty()); assert_eq!(empty.columns[0].name,"Name");
        crate::notebook::update_block_inner(p,block_id,"SELECT Name FROM source, range(1000)",Some("sql")).unwrap();
        let bounded=run("SELECT Name FROM source, range(1000)").unwrap();
        assert_eq!(bounded.rows.len(),200); assert!(bounded.has_more);
        assert_eq!(crate::code_outputs::sql_for_python(p,&bounded.execution.id).unwrap_err().code,"input_limit");
        let wide = format!("SELECT {} FROM source",(0..129).map(|n|format!("1 AS c{n}")).collect::<Vec<_>>().join(","));
        crate::notebook::update_block_inner(p,block_id,&wide,Some("sql")).unwrap();
        assert_eq!(run(&wide).unwrap_err().code,"result_limit");
        let failed=crate::code_outputs::load(p,notebook["id"].as_str().unwrap()).unwrap();
        assert_eq!(failed[0].code,wide);
        assert_eq!(failed[0].status,"failed");
        assert!(failed[0].value["error"].as_str().is_some());
        crate::notebook::update_block_inner(p,block_id,"SELECT repeat('x', 600000) FROM source",Some("sql")).unwrap();
        assert_eq!(run("SELECT repeat('x', 600000) FROM source").unwrap_err().code,"result_limit");
        for forbidden in ["DELETE FROM source", "SELECT * FROM read_text('C:/Windows/win.ini')", "SELECT 1; DELETE FROM source", "SELECT FROM source"] {
            crate::notebook::update_block_inner(p,block_id,forbidden,Some("sql")).unwrap();
            let failure=run(forbidden).unwrap_err();
            if forbidden == "SELECT FROM source" { assert_eq!(failure.code,"sql_worker_error"); }
        }
        crate::notebook::update_block_inner(p,block_id,"SELECT sum(i) FROM range(1000000000000) t(i)",Some("sql")).unwrap();
        let cancellation_id=uuid::Uuid::new_v4().to_string();
        std::thread::scope(|scope| {
            let id=cancellation_id.clone();
            let task=scope.spawn(|| run_notebook_sql_inner(p,&dataset.id,block_id,
                "SELECT sum(i) FROM range(1000000000000) t(i)",&control,id));
            let wait_until=Instant::now()+Duration::from_secs(5);
            while Instant::now()<wait_until && !control.running.lock().unwrap().as_ref().is_some_and(|r|r.child.is_some()) {
                std::thread::sleep(Duration::from_millis(10));
            }
            assert!(control.running.lock().unwrap().as_ref().is_some_and(|r|r.child.is_some()));
            cancel_execution_inner(&control,&cancellation_id).unwrap();
            assert_eq!(task.join().unwrap().unwrap_err().code,"cancelled");
        });
        crate::notebook::update_block_inner(p,block_id,sql,Some("sql")).unwrap();
        assert_eq!(run(sql).unwrap().rows.len(),2);
        assert_eq!(fs::read(&source).unwrap(),original);
        let history=list_executions_inner(p).unwrap();
        assert_eq!(history.len(),11); assert_eq!(history.iter().filter(|item|item.status=="failed").count(),6);
        assert_eq!(history.iter().filter(|item|item.status=="cancelled").count(),1);
        let metadata=db(p).unwrap();
        let (schema_version,representation_id):(i64,Option<String>)=metadata.query_row("SELECT schema_version,representation_id FROM executions WHERE id=?1",[result.execution.id],|r|Ok((r.get(0)?,r.get(1)?))).unwrap();
        assert_eq!(schema_version,2); assert!(representation_id.is_some());
        let failed_sql=history.iter().find(|item|item.parameters.contains("read_text")).unwrap();
        let failed_representation:Option<String>=metadata.query_row("SELECT representation_id FROM executions WHERE id=?1",[&failed_sql.id],|r|r.get(0)).unwrap();
        assert_eq!(failed_representation,representation_id);
        drop(metadata); fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn named_datasets_join_with_stable_handles_and_complete_python_transfer() {
        let root=std::env::temp_dir().join(format!("dataforge-named-test-{}",uuid::Uuid::new_v4())); fs::create_dir(&root).unwrap();
        let project=create_project_inner("Names",root.to_str().unwrap()).unwrap(); let p=Path::new(&project.project.path);
        let first_dir=root.join("first"); let second_dir=root.join("second"); fs::create_dir(&first_dir).unwrap(); fs::create_dir(&second_dir).unwrap();
        let left=first_dir.join("shared.csv"); let right=second_dir.join("shared.csv");
        fs::write(&left,"ID,Amount,Active\n1,1.25,true\n2,2.50,false\n").unwrap();
        fs::write(&right,"ID,Label\n1,Ada\n2,Bob\n").unwrap();
        let a=register_csv_inner(p,left.to_str().unwrap()).unwrap(); let b=register_csv_inner(p,right.to_str().unwrap()).unwrap();
        let names=dataset_names(&list_datasets_inner(&db(p).unwrap()).unwrap());
        assert_eq!(names[&a.id],vec![dataset_handle(&a.id)]);
        assert_eq!(resolve_dataset(&list_datasets_inner(&db(p).unwrap()).unwrap(),"shared.csv").unwrap_err().code,"dataset_ambiguous");
        let control=AnalyticsControl::default();
        let a_table=dataset_for_python(p,&dataset_handle(&a.id),&control).unwrap();
        assert_eq!(a_table.id,a.id); assert!(!a_table.has_more);
        assert_eq!(a_table.columns[1].data_type,"decimal"); assert_eq!(a_table.columns[2].data_type,"boolean");
        assert_eq!(dataset_for_python(p,"missing.csv",&control).unwrap_err().code,"dataset_missing");
        let sql=format!("SELECT l.ID, l.Amount, l.Active, r.Label FROM \"{}\" l JOIN \"{}\" r ON l.ID=r.ID ORDER BY l.ID",dataset_handle(&a.id),dataset_handle(&b.id));
        let note=serde_json::to_value(crate::notebook::create_notebook_inner(p,"Join").unwrap()).unwrap();
        let block=serde_json::to_value(crate::notebook::add_block_inner(p,note["id"].as_str().unwrap(),"code",&sql,None,None,None,Some("sql")).unwrap()).unwrap();
        let result=run_notebook_sql_inner(p,"",block["id"].as_str().unwrap(),&sql,&control,uuid::Uuid::new_v4().to_string()).unwrap();
        assert_eq!(result.rows.len(),2); assert_eq!(result.rows[0][3].as_deref(),Some("Ada"));
        assert_eq!(result.columns[0].data_type,"integer"); assert_eq!(result.columns[1].data_type,"decimal");
        assert_eq!(result.columns[2].data_type,"boolean");
        let provenance:serde_json::Value=serde_json::from_str(&result.execution.parameters).unwrap();
        assert_eq!(provenance["inputs"].as_array().unwrap().len(),2);
        let ambiguous="SELECT * FROM \"shared.csv\"";
        crate::notebook::update_block_inner(p,block["id"].as_str().unwrap(),ambiguous,Some("sql")).unwrap();
        assert_eq!(run_notebook_sql_inner(p,"",block["id"].as_str().unwrap(),ambiguous,&control,uuid::Uuid::new_v4().to_string()).unwrap_err().code,"dataset_ambiguous");
        let missing="SELECT * FROM \"missing.csv\"";
        crate::notebook::update_block_inner(p,block["id"].as_str().unwrap(),missing,Some("sql")).unwrap();
        assert_eq!(run_notebook_sql_inner(p,"",block["id"].as_str().unwrap(),missing,&control,uuid::Uuid::new_v4().to_string()).unwrap_err().code,"dataset_missing");
        assert_eq!(fs::read(&left).unwrap(),b"ID,Amount,Active\n1,1.25,true\n2,2.50,false\n");
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn python_dataset_transfer_rejects_partial_input() {
        let root=std::env::temp_dir().join(format!("dataforge-transfer-test-{}",uuid::Uuid::new_v4())); fs::create_dir(&root).unwrap();
        let project=create_project_inner("Limits",root.to_str().unwrap()).unwrap(); let p=Path::new(&project.project.path);
        let source=root.join("large.csv"); let mut csv=String::from("Value\n"); for value in 0..201 { csv.push_str(&format!("{value}\n")); }
        fs::write(&source,csv).unwrap(); register_csv_inner(p,source.to_str().unwrap()).unwrap();
        assert_eq!(dataset_for_python(p,"large.csv",&AnalyticsControl::default()).unwrap_err().code,"input_limit");
        fs::remove_dir_all(root).unwrap();
    }
}
