use std::{collections::HashSet, fs::{self, File}, io::{BufReader, Read}, path::{Path, PathBuf}, sync::Mutex, time::UNIX_EPOCH};

use rusqlite::{params, Connection, OpenFlags};
use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::State;

mod analytics;
mod notebook;

const SCHEMA_VERSION: i64 = 3;
const MAX_SCAN_BYTES: u64 = 32 * 1024 * 1024;
const MAX_SCAN_ROWS: usize = 20_000;
const MAX_COLUMNS: usize = 128;
const MAX_PREVIEW_ROWS: usize = 200;
const MAX_PREVIEW_BYTES: usize = 1024 * 1024;
const MAX_DISTINCT: usize = 10_000;

struct ActiveProject(Mutex<Option<PathBuf>>);

#[derive(Debug, Serialize)]
pub struct AppError { code: &'static str, message: String }
type Result<T> = std::result::Result<T, AppError>;
fn error(code: &'static str, message: impl Into<String>) -> AppError { AppError { code, message: message.into() } }
fn storage_error() -> AppError { error("storage_error", "Project storage could not be read or written. Check access and available disk space.") }
fn now() -> String { chrono::Utc::now().to_rfc3339() }
fn shown(path: &Path) -> String {
    let s = path.to_string_lossy();
    if let Some(rest) = s.strip_prefix(r"\\?\UNC\") { format!(r"\\{rest}") }
    else { s.strip_prefix(r"\\?\").unwrap_or(&s).to_string() }
}
fn modified_ns(metadata: &fs::Metadata) -> Result<u128> {
    metadata.modified().map_err(|_| error("file_error", "The file modification time is unavailable."))?
        .duration_since(UNIX_EPOCH).map(|d| d.as_nanos())
        .map_err(|_| error("file_error", "The file modification time is invalid."))
}
fn hash_file(path: &Path) -> Result<String> {
    let file = File::open(path).map_err(|_| error("file_error", "The source file cannot be opened for reading."))?;
    let mut reader = BufReader::new(file);
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 64 * 1024];
    loop {
        let count = reader.read(&mut buffer).map_err(|_| error("file_error", "The source file could not be read."))?;
        if count == 0 { break; }
        hasher.update(&buffer[..count]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}
fn source_info(path: &Path) -> Result<(u64, u128, String)> {
    let before = fs::metadata(path).map_err(|_| error("file_missing", "The source file is missing or cannot be accessed."))?;
    if !before.is_file() { return Err(error("invalid_file", "Choose a CSV file, not a folder.")); }
    let before_time = modified_ns(&before)?;
    let hash = hash_file(path)?;
    let after = fs::metadata(path).map_err(|_| error("file_missing", "The source file is missing or cannot be accessed."))?;
    if before.len() != after.len() || before_time != modified_ns(&after)? {
        return Err(error("file_changed", "The source file changed while it was being read. Try again."));
    }
    Ok((after.len(), before_time, hash))
}
fn db_path(project: &Path) -> PathBuf { project.join("project.sqlite") }
fn create_analytics_tables(conn: &Connection) -> Result<()> {
    conn.execute_batch("CREATE TABLE representations (
            id TEXT PRIMARY KEY, dataset_id TEXT NOT NULL, source_fingerprint TEXT NOT NULL,
            table_name TEXT NOT NULL UNIQUE, duckdb_version TEXT NOT NULL,
            materializer_version TEXT NOT NULL, schema_json TEXT NOT NULL,
            created_at TEXT NOT NULL, status TEXT NOT NULL,
            UNIQUE(dataset_id, source_fingerprint, materializer_version, duckdb_version));
        CREATE TABLE executions (
            id TEXT PRIMARY KEY, project_id TEXT NOT NULL, dataset_id TEXT NOT NULL,
            representation_id TEXT, source_fingerprint TEXT NOT NULL,
            operation_type TEXT NOT NULL, parameters TEXT NOT NULL,
            started_at TEXT NOT NULL, completed_at TEXT, status TEXT NOT NULL,
            result_row_count INTEGER, error_summary TEXT, duckdb_version TEXT,
            schema_version INTEGER NOT NULL);")
        .map_err(|_| storage_error())
}
fn db(project: &Path) -> Result<Connection> {
    let path = db_path(project);
    if !path.is_file() { return Err(error("invalid_project", "This folder does not contain a DataForge project.")); }
    let conn = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_WRITE).map_err(|_| storage_error())?;
    let version: i64 = conn.pragma_query_value(None, "user_version", |row| row.get(0))
        .map_err(|_| error("invalid_project", "Project metadata is damaged or unreadable."))?;
    if version == 1 || version == 2 {
        conn.execute_batch("BEGIN IMMEDIATE").map_err(|_| storage_error())?;
        let current: i64 = conn.pragma_query_value(None, "user_version", |row| row.get(0)).map_err(|_| storage_error())?;
        if current == 1 { create_analytics_tables(&conn)?; }
        if current == 1 || current == 2 { notebook::create_tables(&conn)?; }
        else if current != SCHEMA_VERSION { return Err(error("unsupported_project", "This project uses an unsupported metadata version.")); }
        conn.execute_batch("PRAGMA user_version = 3; COMMIT").map_err(|_| storage_error())?;
    } else if version != SCHEMA_VERSION {
        return Err(error("unsupported_project", "This project uses an unsupported metadata version."));
    }
    Ok(conn)
}

#[derive(Clone, Debug, Serialize)]
pub struct Project { id: String, name: String, path: String, created_at: String }
#[derive(Clone, Debug, Serialize)]
pub struct Dataset { id: String, name: String, path: String, size_bytes: u64, registered_at: String, fingerprint: String, status: String }
#[derive(Debug, Serialize)]
pub struct ProjectState { project: Project, datasets: Vec<Dataset> }
#[derive(Debug, Serialize)]
pub struct ColumnProfile { name: String, data_type: String, null_count: u64, distinct_count: usize, distinct_exact: bool, min: Option<f64>, max: Option<f64>, mean: Option<f64>, median: Option<f64> }
#[derive(Debug, Serialize)]
pub struct Inspection { dataset: Dataset, columns: Vec<ColumnProfile>, rows: Vec<Vec<Option<String>>>, row_count: Option<u64>, row_count_exact: bool, preview_truncated: bool, scanned_rows: u64 }

fn project_record(conn: &Connection, path: &Path) -> Result<Project> {
    conn.query_row("SELECT id,name,created_at FROM project LIMIT 1", [], |r| Ok(Project {
        id: r.get(0)?, name: r.get(1)?, path: shown(path), created_at: r.get(2)?
    })).map_err(|_| error("invalid_project", "Project metadata is missing or damaged."))
}
fn create_project_inner(name: &str, location: &str) -> Result<ProjectState> {
    let name = name.trim();
    if name.is_empty() || name.len() > 80 || name == "." || name == ".." ||
        name.chars().any(|c| c.is_control() || "\\/:*?\"<>|".contains(c)) || name.ends_with([' ', '.']) {
        return Err(error("invalid_name", "Use a project name of 1–80 characters without Windows path characters."));
    }
    let parent = fs::canonicalize(location).map_err(|_| error("invalid_path", "Choose an existing project location."))?;
    if !parent.is_dir() { return Err(error("invalid_path", "Choose a folder for the project location.")); }
    let path = parent.join(name);
    fs::create_dir(&path).map_err(|e| if e.kind() == std::io::ErrorKind::AlreadyExists {
        error("project_exists", "A folder with this project name already exists. Choose another name or open it.")
    } else { error("invalid_path", "Could not create the project folder at that location.") })?;
    let conn = Connection::open_with_flags(db_path(&path), OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_CREATE)
        .map_err(|_| storage_error())?;
    conn.execute_batch("BEGIN;
        CREATE TABLE project (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL);
        CREATE TABLE datasets (id TEXT PRIMARY KEY, name TEXT NOT NULL, path TEXT NOT NULL COLLATE NOCASE UNIQUE,
            size_bytes INTEGER NOT NULL, modified_ns TEXT NOT NULL, fingerprint TEXT NOT NULL,
            registered_at TEXT NOT NULL, status TEXT NOT NULL);").map_err(|_| storage_error())?;
    create_analytics_tables(&conn)?;
    notebook::create_tables(&conn)?;
    conn.execute_batch("PRAGMA user_version = 3; COMMIT;").map_err(|_| storage_error())?;
    conn.execute("INSERT INTO project (id,name,created_at) VALUES (?1,?2,?3)",
        params![uuid::Uuid::new_v4().to_string(), name, now()]).map_err(|_| storage_error())?;
    Ok(ProjectState { project: project_record(&conn, &path)?, datasets: Vec::new() })
}
fn open_project_inner(path: &str) -> Result<ProjectState> {
    let project_path = fs::canonicalize(path).map_err(|_| error("invalid_path", "The project folder does not exist."))?;
    if !project_path.is_dir() { return Err(error("invalid_path", "Choose a project folder.")); }
    let conn = db(&project_path)?;
    conn.execute("UPDATE executions SET status='interrupted', completed_at=?1 WHERE status='running'", [now()])
        .map_err(|_| storage_error())?;
    let project = project_record(&conn, &project_path)?;
    let datasets = list_datasets_inner(&conn)?;
    Ok(ProjectState { project, datasets })
}
fn load_datasets(conn: &Connection) -> Result<Vec<(Dataset, String)>> {
    let mut statement = conn.prepare("SELECT id,name,path,size_bytes,modified_ns,fingerprint,registered_at,status FROM datasets ORDER BY registered_at,id")
        .map_err(|_| storage_error())?;
    let mapped = statement.query_map([], |r| {
        let canonical: String = r.get(2)?;
        Ok((Dataset { id: r.get(0)?, name: r.get(1)?, path: shown(Path::new(&canonical)),
            size_bytes: r.get(3)?, fingerprint: r.get(5)?, registered_at: r.get(6)?, status: r.get(7)? }, canonical, r.get::<_, String>(4)?))
    }).map_err(|_| storage_error())?;
    let mut result = Vec::new();
    for entry in mapped {
        let (dataset, canonical, modified) = entry.map_err(|_| storage_error())?;
        result.push((dataset, format!("{canonical}\0{modified}")));
    }
    Ok(result)
}
fn current_status(path: &Path, size: u64, modified: &str, fingerprint: &str) -> &'static str {
    let Ok(meta) = fs::metadata(path) else { return "missing"; };
    if !meta.is_file() { return "missing"; }
    if meta.len() != size || modified_ns(&meta).map(|n| n.to_string()).ok().as_deref() != Some(modified) { return "changed"; }
    match hash_file(path) { Ok(hash) if hash == fingerprint => "ready", Ok(_) => "changed", Err(_) => "missing" }
}
fn list_datasets_inner(conn: &Connection) -> Result<Vec<Dataset>> {
    let mut result = Vec::new();
    for (mut dataset, stored) in load_datasets(conn)? {
        let (path, modified) = stored.split_once('\0').ok_or_else(storage_error)?;
        let status = current_status(Path::new(path), dataset.size_bytes, modified, &dataset.fingerprint);
        if dataset.status != status {
            conn.execute("UPDATE datasets SET status=?1 WHERE id=?2", params![status, dataset.id]).map_err(|_| storage_error())?;
            dataset.status = status.to_string();
        }
        result.push(dataset);
    }
    Ok(result)
}
fn register_csv_inner(project: &Path, path: &str) -> Result<Dataset> {
    let canonical = fs::canonicalize(path).map_err(|_| error("file_missing", "The selected CSV file does not exist."))?;
    if !canonical.extension().is_some_and(|e| e.to_string_lossy().eq_ignore_ascii_case("csv")) {
        return Err(error("unsupported_file", "Only CSV files are supported in this version."));
    }
    let conn = db(project)?;
    let canonical_text = canonical.to_string_lossy().to_string();
    if conn.query_row("SELECT 1 FROM datasets WHERE path=?1", [&canonical_text], |r| r.get::<_, i64>(0)).is_ok() {
        return Err(error("duplicate_dataset", "This CSV file is already registered in the project."));
    }
    let (size, modified, fingerprint) = source_info(&canonical)?;
    let _ = scan_csv(&canonical, 1)?; // Reject malformed headers/rows within the bounded scan.
    let name = canonical.file_name().map(|v| v.to_string_lossy().to_string()).unwrap_or_else(|| "Dataset.csv".into());
    let dataset = Dataset { id: uuid::Uuid::new_v4().to_string(), name, path: shown(&canonical),
        size_bytes: size, registered_at: now(), fingerprint, status: "ready".into() };
    conn.execute("INSERT INTO datasets (id,name,path,size_bytes,modified_ns,fingerprint,registered_at,status)
        VALUES (?1,?2,?3,?4,?5,?6,?7,'ready')", params![dataset.id, dataset.name, canonical_text,
        dataset.size_bytes, modified.to_string(), dataset.fingerprint, dataset.registered_at]).map_err(|_| storage_error())?;
    Ok(dataset)
}

struct ProfileWork { name: String, nulls: u64, distinct: HashSet<String>, distinct_capped: bool,
    all_int: bool, all_number: bool, all_bool: bool, numeric_count: u64, sum: f64, min: f64, max: f64, numbers: Vec<f64> }
impl ProfileWork {
    fn new(name: String) -> Self { Self { name, nulls: 0, distinct: HashSet::new(), distinct_capped: false,
        all_int: true, all_number: true, all_bool: true, numeric_count: 0, sum: 0.0, min: f64::INFINITY, max: f64::NEG_INFINITY, numbers: Vec::new() } }
    fn add(&mut self, value: &str) {
        let value = value.trim();
        if value.is_empty() { self.nulls += 1; return; }
        if self.distinct.len() < MAX_DISTINCT { self.distinct.insert(value.to_string()); }
        else if !self.distinct.contains(value) { self.distinct_capped = true; }
        self.all_int &= value.parse::<i64>().is_ok();
        self.all_bool &= value.eq_ignore_ascii_case("true") || value.eq_ignore_ascii_case("false");
        match value.parse::<f64>() {
            Ok(number) if number.is_finite() => { self.numeric_count += 1; self.sum += number; self.numbers.push(number);
                self.min = self.min.min(number); self.max = self.max.max(number); }
            _ => self.all_number = false
        }
    }
    fn finish(mut self, complete: bool) -> ColumnProfile {
        let numeric = self.all_number && self.numeric_count > 0;
        let median = if numeric {
            self.numbers.sort_by(f64::total_cmp);
            let middle = self.numbers.len() / 2;
            let value = if self.numbers.len() % 2 == 0 { self.numbers[middle - 1] / 2.0 + self.numbers[middle] / 2.0 }
                else { self.numbers[middle] };
            value.is_finite().then_some(value)
        } else { None };
        let mean = if numeric {
            let value = self.sum / self.numeric_count as f64;
            value.is_finite().then_some(value)
        } else { None };
        ColumnProfile { name: self.name,
            data_type: if self.all_bool && !self.distinct.is_empty() { "boolean" }
                else if self.all_int && numeric { "integer" }
                else if numeric { "decimal" } else { "text" }.into(),
            null_count: self.nulls, distinct_count: self.distinct.len(), distinct_exact: complete && !self.distinct_capped,
            min: numeric.then_some(self.min), max: numeric.then_some(self.max),
            mean, median }
    }
}
#[derive(Debug)]
struct Scan { columns: Vec<ColumnProfile>, rows: Vec<Vec<Option<String>>>, row_count: Option<u64>, scanned_rows: u64, preview_truncated: bool }
fn scan_csv(path: &Path, limit: usize) -> Result<Scan> {
    let size = fs::metadata(path).map_err(|_| error("file_missing", "The source file is missing."))?.len();
    let file = File::open(path).map_err(|_| error("file_error", "The source file could not be opened."))?;
    let mut csv = csv::ReaderBuilder::new().has_headers(true).flexible(false).from_reader(file.take(MAX_SCAN_BYTES));
    let headers = csv.headers().map_err(|_| error("malformed_csv", "Could not read CSV headers. Check the file encoding and quoting."))?.clone();
    if headers.is_empty() { return Err(error("malformed_csv", "The CSV is empty or has no header row.")); }
    if headers.len() > MAX_COLUMNS { return Err(error("csv_too_wide", "The CSV has more than 128 columns.")); }
    let mut profiles: Vec<_> = headers.iter().map(|name| ProfileWork::new(name.to_string())).collect();
    let mut rows = Vec::new();
    let mut preview_bytes = 0usize;
    let mut cell_truncated = false;
    let mut scanned = 0u64;
    let mut hit_row_cap = false;
    let mut record = csv::StringRecord::new();
    loop {
        match csv.read_record(&mut record) {
            Ok(true) => {}
            Ok(false) => break,
            Err(_) if size > MAX_SCAN_BYTES && csv.get_ref().limit() == 0 => break,
            Err(_) => return Err(error("malformed_csv", "A CSV row is malformed or has a different column count."))
        }
        if record.len() != profiles.len() { return Err(error("malformed_csv", "A CSV row has a different column count.")); }
        for (work, value) in profiles.iter_mut().zip(record.iter()) { work.add(value); }
        scanned += 1;
        if rows.len() < limit && preview_bytes < MAX_PREVIEW_BYTES {
            let row: Vec<Option<String>> = record.iter().map(|v| if v.trim().is_empty() { None }
                else {
                    if v.chars().nth(4096).is_some() { cell_truncated = true; }
                    Some(v.chars().take(4096).collect())
                }).collect();
            preview_bytes += row.iter().flatten().map(String::len).sum::<usize>();
            if preview_bytes <= MAX_PREVIEW_BYTES { rows.push(row); }
        }
        if scanned as usize >= MAX_SCAN_ROWS { hit_row_cap = true; break; }
    }
    let complete = !hit_row_cap && size <= MAX_SCAN_BYTES;
    Ok(Scan { columns: profiles.into_iter().map(|p| p.finish(complete)).collect(),
        preview_truncated: cell_truncated || !complete || scanned as usize > rows.len(), rows,
        row_count: complete.then_some(scanned), scanned_rows: scanned })
}
fn inspect_csv_inner(project: &Path, dataset_id: &str, limit: usize) -> Result<Inspection> {
    if limit == 0 || limit > MAX_PREVIEW_ROWS { return Err(error("invalid_limit", "Preview must contain 1–200 rows.")); }
    let conn = db(project)?;
    let datasets = list_datasets_inner(&conn)?;
    let dataset = datasets.into_iter().find(|d| d.id == dataset_id)
        .ok_or_else(|| error("dataset_missing", "This dataset is not registered in the active project."))?;
    if dataset.status != "ready" {
        return Err(error(if dataset.status == "missing" { "file_missing" } else { "file_changed" },
            if dataset.status == "missing" { "The source file is missing. Its registration was kept." }
            else { "The source file changed. The registration was not refreshed." }));
    }
    let scan = scan_csv(Path::new(&dataset.path), limit)?;
    let refreshed = list_datasets_inner(&conn)?.into_iter().find(|d| d.id == dataset_id).ok_or_else(storage_error)?;
    if refreshed.status != "ready" { return Err(error("file_changed", "The source changed during inspection. Try again after reviewing it.")); }
    Ok(Inspection { dataset, columns: scan.columns, rows: scan.rows, row_count: scan.row_count,
        row_count_exact: scan.row_count.is_some(), preview_truncated: scan.preview_truncated, scanned_rows: scan.scanned_rows })
}

fn active(state: &State<'_, ActiveProject>) -> Result<PathBuf> {
    state.0.lock().map_err(|_| storage_error())?.clone().ok_or_else(|| error("no_project", "Create or open a project first."))
}
#[tauri::command]
async fn create_project(name: String, location: String, state: State<'_, ActiveProject>, control: State<'_, analytics::AnalyticsControl>) -> Result<ProjectState> {
    if control.is_running() { return Err(error("analytics_busy", "Wait for the analytical operation to finish before switching projects.")); }
    let result = tauri::async_runtime::spawn_blocking(move || create_project_inner(&name, &location)).await.map_err(|_| storage_error())??;
    *state.0.lock().map_err(|_| storage_error())? = Some(PathBuf::from(&result.project.path));
    Ok(result)
}
#[tauri::command]
async fn open_project(path: String, state: State<'_, ActiveProject>, control: State<'_, analytics::AnalyticsControl>) -> Result<ProjectState> {
    if control.is_running() { return Err(error("analytics_busy", "Wait for the analytical operation to finish before switching projects.")); }
    let result = tauri::async_runtime::spawn_blocking(move || open_project_inner(&path)).await.map_err(|_| storage_error())??;
    *state.0.lock().map_err(|_| storage_error())? = Some(PathBuf::from(&result.project.path));
    Ok(result)
}
#[tauri::command]
async fn register_csv(path: String, state: State<'_, ActiveProject>) -> Result<Dataset> {
    let project = active(&state)?;
    tauri::async_runtime::spawn_blocking(move || register_csv_inner(&project, &path)).await.map_err(|_| storage_error())?
}
#[tauri::command]
async fn list_datasets(state: State<'_, ActiveProject>) -> Result<Vec<Dataset>> {
    let project = active(&state)?;
    tauri::async_runtime::spawn_blocking(move || list_datasets_inner(&db(&project)?)).await.map_err(|_| storage_error())?
}
#[tauri::command]
async fn inspect_csv(dataset_id: String, limit: usize, state: State<'_, ActiveProject>) -> Result<Inspection> {
    let project = active(&state)?;
    tauri::async_runtime::spawn_blocking(move || inspect_csv_inner(&project, &dataset_id, limit)).await.map_err(|_| storage_error())?
}
#[tauri::command]
async fn run_analytics(dataset_id: String, request: analytics::AnalyticsRequest,
    state: State<'_, ActiveProject>, control: State<'_, analytics::AnalyticsControl>) -> Result<analytics::AnalyticsResult> {
    let project = active(&state)?;
    let control = control.inner().clone();
    tauri::async_runtime::spawn_blocking(move || analytics::run_analytics_inner(&project, &dataset_id, request, &control))
        .await.map_err(|_| storage_error())?
}
#[tauri::command]
async fn list_executions(state: State<'_, ActiveProject>) -> Result<Vec<analytics::Execution>> {
    let project = active(&state)?;
    tauri::async_runtime::spawn_blocking(move || analytics::list_executions_inner(&project)).await.map_err(|_| storage_error())?
}
#[tauri::command]
fn cancel_execution(execution_id: String, control: State<'_, analytics::AnalyticsControl>) -> Result<()> {
    analytics::cancel_execution_inner(&control, &execution_id)
}
#[tauri::command]
fn active_execution(control: State<'_, analytics::AnalyticsControl>) -> Option<String> { control.running_id() }
#[tauri::command]
async fn export_result(path: String, columns: Vec<String>, rows: Vec<Vec<Option<String>>>) -> Result<()> {
    tauri::async_runtime::spawn_blocking(move || analytics::export_result_inner(&path, &columns, &rows))
        .await.map_err(|_| storage_error())?
}

#[tauri::command]
async fn list_notebooks(state: State<'_, ActiveProject>) -> Result<Vec<notebook::NotebookSummary>> {
    let project = active(&state)?;
    tauri::async_runtime::spawn_blocking(move || notebook::list_notebooks_inner(&project)).await.map_err(|_| storage_error())?
}
#[tauri::command]
async fn get_notebook(id: String, state: State<'_, ActiveProject>) -> Result<notebook::Notebook> {
    let project = active(&state)?;
    tauri::async_runtime::spawn_blocking(move || notebook::get_notebook_inner(&project, &id)).await.map_err(|_| storage_error())?
}
#[tauri::command]
async fn create_notebook(title: String, state: State<'_, ActiveProject>) -> Result<notebook::Notebook> {
    let project = active(&state)?;
    tauri::async_runtime::spawn_blocking(move || notebook::create_notebook_inner(&project, &title)).await.map_err(|_| storage_error())?
}
#[tauri::command]
async fn rename_notebook(id: String, title: String, state: State<'_, ActiveProject>) -> Result<notebook::Notebook> {
    let project = active(&state)?;
    tauri::async_runtime::spawn_blocking(move || notebook::rename_notebook_inner(&project, &id, &title)).await.map_err(|_| storage_error())?
}
#[tauri::command]
async fn delete_notebook(id: String, state: State<'_, ActiveProject>) -> Result<()> {
    let project = active(&state)?;
    tauri::async_runtime::spawn_blocking(move || notebook::delete_notebook_inner(&project, &id)).await.map_err(|_| storage_error())?
}
#[tauri::command]
async fn add_block(notebook_id: String, kind: String, content: String, execution_id: Option<String>, state: State<'_, ActiveProject>) -> Result<notebook::NotebookBlock> {
    let project = active(&state)?;
    tauri::async_runtime::spawn_blocking(move || notebook::add_block_inner(&project, &notebook_id, &kind, &content, execution_id.as_deref())).await.map_err(|_| storage_error())?
}
#[tauri::command]
async fn update_block(id: String, content: String, state: State<'_, ActiveProject>) -> Result<notebook::NotebookBlock> {
    let project = active(&state)?;
    tauri::async_runtime::spawn_blocking(move || notebook::update_block_inner(&project, &id, &content)).await.map_err(|_| storage_error())?
}
#[tauri::command]
async fn delete_block(id: String, state: State<'_, ActiveProject>) -> Result<()> {
    let project = active(&state)?;
    tauri::async_runtime::spawn_blocking(move || notebook::delete_block_inner(&project, &id)).await.map_err(|_| storage_error())?
}
#[tauri::command]
async fn move_block(id: String, direction: String, state: State<'_, ActiveProject>) -> Result<Vec<notebook::NotebookBlock>> {
    let project = active(&state)?;
    tauri::async_runtime::spawn_blocking(move || notebook::move_block_inner(&project, &id, &direction)).await.map_err(|_| storage_error())?
}
#[tauri::command]
async fn get_execution_result(execution_id: String, state: State<'_, ActiveProject>, control: State<'_, analytics::AnalyticsControl>) -> Result<analytics::AnalyticsResult> {
    let project = active(&state)?;
    let control = control.inner().clone();
    tauri::async_runtime::spawn_blocking(move || analytics::get_execution_result_inner(&project, &execution_id, &control)).await.map_err(|_| storage_error())?
}

pub fn run() {
    tauri::Builder::default().plugin(tauri_plugin_dialog::init())
        .manage(ActiveProject(Mutex::new(None)))
        .manage(analytics::AnalyticsControl::default())
        .invoke_handler(tauri::generate_handler![create_project, open_project, register_csv, list_datasets, inspect_csv,
            run_analytics, list_executions, cancel_execution, active_execution, export_result,
            list_notebooks, get_notebook, create_notebook, rename_notebook, delete_notebook,
            add_block, update_block, delete_block, move_block, get_execution_result])
        .run(tauri::generate_context!()).expect("DataForge could not start");
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> PathBuf { let p = std::env::temp_dir().join(format!("dataforge-test-{}", uuid::Uuid::new_v4())); fs::create_dir(&p).unwrap(); p }
    #[test]
    fn project_persists_and_refuses_overwrite() {
        let root = fixture(); let created = create_project_inner("Study", root.to_str().unwrap()).unwrap();
        assert_eq!(open_project_inner(&created.project.path).unwrap().project.id, created.project.id);
        assert_eq!(create_project_inner("Study", root.to_str().unwrap()).unwrap_err().code, "project_exists");
        let conn = db(Path::new(&created.project.path)).unwrap();
        conn.pragma_update(None, "user_version", 4).unwrap();
        drop(conn);
        assert_eq!(open_project_inner(&created.project.path).unwrap_err().code, "unsupported_project");
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn corrupted_project_is_rejected() {
        let root = fixture(); let project = root.join("Damaged"); fs::create_dir(&project).unwrap();
        fs::write(db_path(&project), b"not a SQLite database").unwrap();
        assert_eq!(open_project_inner(project.to_str().unwrap()).unwrap_err().code, "invalid_project");
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn legacy_project_gains_analytics_tables() {
        let root = fixture(); let project = create_project_inner("Legacy", root.to_str().unwrap()).unwrap();
        let conn = db(Path::new(&project.project.path)).unwrap();
        conn.execute_batch("DROP TABLE notebook_blocks; DROP TABLE notebooks; DROP TABLE representations; DROP TABLE executions; PRAGMA user_version = 1;").unwrap();
        drop(conn);
        let reopened = open_project_inner(&project.project.path).unwrap();
        assert_eq!(reopened.project.id, project.project.id);
        let conn = db(Path::new(&project.project.path)).unwrap();
        assert_eq!(conn.pragma_query_value::<i64, _>(None, "user_version", |r| r.get(0)).unwrap(), 3);
        assert!(conn.prepare("SELECT id FROM representations").is_ok());
        drop(conn); fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn version_two_project_gains_notebooks() {
        let root = fixture(); let project = create_project_inner("Legacy2", root.to_str().unwrap()).unwrap();
        let conn = db(Path::new(&project.project.path)).unwrap();
        conn.execute_batch("DROP TABLE notebook_blocks; DROP TABLE notebooks; PRAGMA user_version = 2;").unwrap();
        drop(conn);
        assert!(notebook::create_notebook_inner(Path::new(&project.project.path), "Notes").is_ok());
        let conn = db(Path::new(&project.project.path)).unwrap();
        assert_eq!(conn.pragma_query_value::<i64, _>(None, "user_version", |r| r.get(0)).unwrap(), 3);
        drop(conn); fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn reopening_marks_incomplete_execution_interrupted() {
        let root = fixture(); let project = create_project_inner("Recovery", root.to_str().unwrap()).unwrap();
        let conn = db(Path::new(&project.project.path)).unwrap();
        conn.execute("INSERT INTO executions (id,project_id,dataset_id,source_fingerprint,operation_type,parameters,started_at,status,schema_version)
            VALUES ('run-1',?1,'source-1','hash','rows','{}',?2,'running',1)", params![project.project.id, now()]).unwrap();
        drop(conn);
        open_project_inner(&project.project.path).unwrap();
        let conn = db(Path::new(&project.project.path)).unwrap();
        let status: String = conn.query_row("SELECT status FROM executions WHERE id='run-1'", [], |r| r.get(0)).unwrap();
        assert_eq!(status, "interrupted");
        drop(conn); fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn register_detects_duplicate_change_and_missing() {
        let root = fixture(); let project = create_project_inner("Study", root.to_str().unwrap()).unwrap();
        let source = root.join("sample.csv"); fs::write(&source, "value\n1\n").unwrap();
        let dataset = register_csv_inner(Path::new(&project.project.path), source.to_str().unwrap()).unwrap();
        assert_eq!(inspect_csv_inner(Path::new(&project.project.path), &dataset.id, 0).unwrap_err().code, "invalid_limit");
        assert_eq!(inspect_csv_inner(Path::new(&project.project.path), &dataset.id, 201).unwrap_err().code, "invalid_limit");
        assert_eq!(fs::read_to_string(&source).unwrap(), "value\n1\n");
        assert_eq!(register_csv_inner(Path::new(&project.project.path), source.to_str().unwrap()).unwrap_err().code, "duplicate_dataset");
        fs::write(&source, "value\n2\n").unwrap();
        let conn = db(Path::new(&project.project.path)).unwrap();
        assert_eq!(list_datasets_inner(&conn).unwrap()[0].status, "changed");
        assert_eq!(inspect_csv_inner(Path::new(&project.project.path), &dataset.id, 10).unwrap_err().code, "file_changed");
        fs::remove_file(&source).unwrap();
        assert_eq!(list_datasets_inner(&conn).unwrap()[0].status, "missing");
        drop(conn);
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn malformed_and_bounded_preview() {
        let root = fixture(); let source = root.join("sample.csv");
        fs::write(&source, "").unwrap();
        assert_eq!(scan_csv(&source, 2).unwrap_err().code, "malformed_csv");
        fs::write(&source, "a,b\n1,2\n3\n").unwrap();
        assert_eq!(scan_csv(&source, 2).unwrap_err().code, "malformed_csv");
        fs::write(&source, "a,b\n1,2\n3,\n4,5\n").unwrap();
        let scan = scan_csv(&source, 2).unwrap();
        assert_eq!(scan.rows.len(), 2); assert_eq!(scan.row_count, Some(3)); assert!(scan.preview_truncated);
        assert_eq!(scan.columns[1].null_count, 1);
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn clipped_cell_is_labeled_as_truncated_preview() {
        let root = fixture(); let source = root.join("long-cell.csv");
        fs::write(&source, format!("note\n{}\n", "x".repeat(5000))).unwrap();
        let scan = scan_csv(&source, 2).unwrap();
        assert_eq!(scan.rows[0][0].as_ref().unwrap().len(), 4096);
        assert!(scan.preview_truncated);
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn large_file_does_not_hide_early_malformed_row() {
        let root = fixture(); let source = root.join("large.csv");
        let mut data = String::from("a,b\n1\n");
        data.push_str(&"2,3\n".repeat((MAX_SCAN_BYTES as usize / 4) + 1));
        fs::write(&source, data).unwrap();
        assert_eq!(scan_csv(&source, 2).unwrap_err().code, "malformed_csv");
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn reopened_project_preserves_known_csv_profile_and_source() {
        let root = fixture(); let project = create_project_inner("Verification", root.to_str().unwrap()).unwrap();
        let source = root.join("known.csv");
        let original = b"age,city,active\n10,Paris,true\n20,,false\n,Paris,true\n";
        fs::write(&source, original).unwrap();
        let registered = register_csv_inner(Path::new(&project.project.path), source.to_str().unwrap()).unwrap();
        let reopened = open_project_inner(&project.project.path).unwrap();
        assert_eq!(reopened.project.id, project.project.id);
        assert_eq!(reopened.datasets.len(), 1);
        assert_eq!(reopened.datasets[0].id, registered.id);
        let inspection = inspect_csv_inner(Path::new(&project.project.path), &registered.id, 2).unwrap();
        assert_eq!(inspection.columns.iter().map(|c| c.name.as_str()).collect::<Vec<_>>(), ["age", "city", "active"]);
        assert_eq!(inspection.columns.iter().map(|c| c.data_type.as_str()).collect::<Vec<_>>(), ["integer", "text", "boolean"]);
        assert_eq!(inspection.columns[0].null_count, 1);
        assert_eq!(inspection.columns[0].distinct_count, 2);
        assert_eq!(inspection.columns[0].min, Some(10.0));
        assert_eq!(inspection.columns[0].max, Some(20.0));
        assert_eq!(inspection.columns[0].mean, Some(15.0));
        assert_eq!(inspection.columns[0].median, Some(15.0));
        assert_eq!(inspection.columns[1].null_count, 1);
        assert_eq!(inspection.columns[1].distinct_count, 1);
        assert_eq!(inspection.columns[2].distinct_count, 2);
        assert_eq!(inspection.rows.len(), 2);
        assert_eq!(inspection.row_count, Some(3));
        assert!(inspection.row_count_exact && inspection.preview_truncated);
        assert_eq!(fs::read(&source).unwrap(), original);
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn registration_rejects_bad_inputs_and_large_preview_is_partial() {
        let root = fixture(); let project = create_project_inner("Verification", root.to_str().unwrap()).unwrap();
        let path = Path::new(&project.project.path);
        assert_eq!(open_project_inner(root.to_str().unwrap()).unwrap_err().code, "invalid_project");
        let unsupported = root.join("notes.txt"); fs::write(&unsupported, "value\n1\n").unwrap();
        assert_eq!(register_csv_inner(path, unsupported.to_str().unwrap()).unwrap_err().code, "unsupported_file");
        let empty = root.join("empty.csv"); fs::write(&empty, "").unwrap();
        assert_eq!(register_csv_inner(path, empty.to_str().unwrap()).unwrap_err().code, "malformed_csv");
        let malformed = root.join("malformed.csv"); fs::write(&malformed, "a,b\n1\n").unwrap();
        assert_eq!(register_csv_inner(path, malformed.to_str().unwrap()).unwrap_err().code, "malformed_csv");
        let large = root.join("large.csv");
        let mut content = String::from("value\n");
        for index in 0..20_050 { content.push_str(&format!("{index}\n")); }
        fs::write(&large, content.as_bytes()).unwrap();
        let dataset = register_csv_inner(path, large.to_str().unwrap()).unwrap();
        let inspection = inspect_csv_inner(path, &dataset.id, 100).unwrap();
        assert_eq!(inspection.rows.len(), 100);
        assert_eq!(inspection.scanned_rows, 20_000);
        assert_eq!(inspection.row_count, None);
        assert!(!inspection.row_count_exact && inspection.preview_truncated);
        assert!(!inspection.columns[0].distinct_exact);
        assert_eq!(fs::read(&large).unwrap(), content.as_bytes());
        fs::remove_dir_all(root).unwrap();
    }
}
