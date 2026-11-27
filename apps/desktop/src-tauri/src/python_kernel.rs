use std::{io::{BufRead, BufReader, Read, Write}, path::{Path, PathBuf}, process::{Child, ChildStdin, ChildStdout, Command, Stdio}, sync::{atomic::{AtomicBool, Ordering}, Arc, Mutex}, time::{Duration, Instant}};

use rusqlite::params;
use serde::{Deserialize, Serialize};

use crate::{db, error, now, storage_error, AppError, Result};

const BRIDGE: &str = include_str!("python_kernel.py");

#[derive(Clone, Serialize)]
pub(super) struct PythonEnvironment { path: String, version: String }
#[derive(Deserialize)]
struct BridgeReply { version: u32, id: String, status: String, count: Option<u64>, outputs: Option<Vec<PythonOutput>>, names: Option<Vec<String>>,
    result_names: Option<Vec<String>>, publications: Option<Vec<PythonPublication>> }
#[derive(Deserialize)]
struct PythonPublication { name: String, columns: Vec<crate::analytics::ResultColumn>, rows: Vec<Vec<Option<String>>> }
#[derive(Deserialize, Serialize)]
pub(super) struct PythonOutput {
    kind: String, text: String,
    #[serde(default)] mime: Option<String>,
    #[serde(default)] data: Option<String>,
    #[serde(default)] columns: Option<Vec<String>>,
    #[serde(default)] rows: Option<Vec<Vec<String>>>,
    #[serde(default)] truncated: bool,
}
#[derive(Serialize)]
pub(super) struct PythonResult { execution_id: String, status: String, count: Option<u64>, outputs: Vec<PythonOutput>, duration_ms: u128, python: String }
#[derive(Serialize)]
pub(super) struct PythonRuntime { status: &'static str, python: Option<String>, environment: Option<String> }

struct Session {
    notebook: String, project: PathBuf, environment: PythonEnvironment,
    child: Mutex<Child>, input: Mutex<ChildStdin>, output: Mutex<BufReader<ChildStdout>>,
    running: AtomicBool, interrupted: AtomicBool,
}
#[derive(Clone, Default)]
pub(super) struct PythonKernels(Arc<Mutex<Option<Arc<Session>>>>);

fn kernel_error(message: &str) -> AppError { error("python_kernel_error", message) }
fn hidden_command(program: impl AsRef<std::ffi::OsStr>) -> Command {
    let mut command = Command::new(program);
    #[cfg(windows)] {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    command
}
fn command(path: &Path) -> Command {
    let mut command = hidden_command(path);
    command.args(["-u", "-c", BRIDGE]).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null());
    command
}
fn reply(reader: &mut BufReader<ChildStdout>) -> Result<BridgeReply> {
    let mut line = String::new();
    reader.take(8 * 1024 * 1024).read_line(&mut line).map_err(|_| kernel_error("Python kernel output could not be read."))?;
    let reply: BridgeReply = serde_json::from_str(&line).map_err(|_| kernel_error("Python kernel stopped or returned invalid output."))?;
    if reply.version != 2 { return Err(kernel_error("Unsupported Python kernel protocol.")); }
    Ok(reply)
}
fn send(session: &Session, value: serde_json::Value) -> Result<()> {
    let mut input = session.input.lock().map_err(|_| kernel_error("Python kernel is unavailable."))?;
    writeln!(input, "{value}").map_err(|_| kernel_error("Python kernel stopped."))?;
    input.flush().map_err(|_| kernel_error("Python kernel stopped."))
}
fn check_environment(path: &Path) -> Result<PythonEnvironment> {
    if !path.is_absolute() || !path.is_file() || !path.file_name().is_some_and(|name| name.to_string_lossy().to_ascii_lowercase().starts_with("python")) {
        return Err(error("invalid_python", "Choose an existing Python executable."));
    }
    let mut child = hidden_command(path).args(["-c", "import ipykernel,jupyter_client,sys; print(sys.version.split()[0])"])
        .stdout(Stdio::piped()).stderr(Stdio::null()).spawn().map_err(|_| error("invalid_python", "Python could not start."))?;
    let deadline = Instant::now() + Duration::from_secs(5);
    while child.try_wait().map_err(|_| kernel_error("Python environment check failed."))?.is_none() {
        if Instant::now() >= deadline { let _ = child.kill(); let _ = child.wait(); return Err(kernel_error("Python environment check timed out.")); }
        std::thread::sleep(Duration::from_millis(20));
    }
    let output = child.wait_with_output().map_err(|_| kernel_error("Python environment check failed."))?;
    if !output.status.success() { return Err(error("python_missing_kernel", "This Python environment needs ipykernel and jupyter_client installed.")); }
    let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if version.len() > 40 || version.is_empty() { return Err(kernel_error("Python version could not be read.")); }
    Ok(PythonEnvironment { path: path.to_string_lossy().into_owned(), version })
}
pub(super) fn discover() -> Vec<PythonEnvironment> {
    let mut candidates = Vec::<PathBuf>::new();
    if let Some(paths) = std::env::var_os("PATH") {
        for dir in std::env::split_paths(&paths) { candidates.push(dir.join("python.exe")); candidates.push(dir.join("python3.exe")); }
    }
    #[cfg(windows)]
    if let Ok(output) = hidden_command("py").arg("-0p").output() {
        if output.status.success() {
            candidates.extend(launcher_paths(&String::from_utf8_lossy(&output.stdout)));
        }
    }
    if let Ok(output) = hidden_command("uv").args(["--no-cache", "python", "list", "--only-installed"]).output() {
        for line in String::from_utf8_lossy(&output.stdout).lines() {
            if let Some((_,path)) = line.split_once("     ") { candidates.push(PathBuf::from(path.trim())); }
        }
    }
    let mut seen = std::collections::HashSet::new();
    candidates.into_iter().filter(|path| seen.insert(path.to_string_lossy().to_ascii_lowercase()))
        .filter_map(|path| check_environment(&path).ok()).collect()
}
#[cfg(windows)]
fn launcher_paths(output: &str) -> Vec<PathBuf> {
    output.lines().filter_map(|line| {
        let start = line.find(":\\")?;
        let letter = line[..start].chars().last().filter(|ch| ch.is_ascii_alphabetic())?;
        Some(PathBuf::from(format!("{}{}", letter, line[start..].trim())))
    }).collect()
}
pub(super) fn inspect(path: &str) -> Result<PythonEnvironment> { check_environment(Path::new(path)) }

impl PythonKernels {
    pub(super) fn status(&self, notebook: &str) -> PythonRuntime {
        let Ok(slot)=self.0.lock() else { return PythonRuntime { status:"unavailable",python:None,environment:None } };
        let Some(session)=slot.as_ref().filter(|session|session.notebook==notebook) else { return PythonRuntime { status:"stopped",python:None,environment:None } };
        let alive=session.child.lock().ok().and_then(|mut child|child.try_wait().ok()).is_some_and(|status|status.is_none());
        PythonRuntime { status:if !alive {"stopped"} else if session.running.load(Ordering::Acquire) {"running"} else {"idle"},
            python:Some(session.environment.version.clone()), environment:Some(session.environment.path.clone()) }
    }
    pub(super) fn is_running(&self) -> bool {
        self.0.lock().ok().and_then(|slot| slot.as_ref().map(|s|s.running.load(Ordering::Acquire))).unwrap_or(false)
    }
    fn session(&self, project: &Path, notebook: &str, python: &str) -> Result<Arc<Session>> {
        let mut slot = self.0.lock().map_err(|_| kernel_error("Python kernel state is unavailable."))?;
        if let Some(current) = slot.as_ref() {
            if current.project == project && current.notebook == notebook && current.environment.path == python { return Ok(current.clone()); }
            if current.running.load(Ordering::Acquire) { return Err(kernel_error("Wait for the running Python cell before switching kernels.")); }
        }
        if let Some(old) = slot.take() { old.close(); }
        let environment = inspect(python)?;
        let mut child = command(Path::new(python)).spawn().map_err(|_| kernel_error("Python kernel could not start."))?;
        let input = child.stdin.take().ok_or_else(|| kernel_error("Python kernel input is unavailable."))?;
        let output = child.stdout.take().ok_or_else(|| kernel_error("Python kernel output is unavailable."))?;
        let mut reader = BufReader::new(output);
        let ready = reply(&mut reader)?;
        if ready.status != "ready" { return Err(kernel_error("Python kernel did not become ready.")); }
        let session = Arc::new(Session { notebook: notebook.into(), project: project.into(), environment,
            child: Mutex::new(child), input: Mutex::new(input), output: Mutex::new(reader),
            running: AtomicBool::new(false), interrupted: AtomicBool::new(false) });
        *slot = Some(session.clone());
        Ok(session)
    }
    pub(super) fn interrupt(&self, notebook: &str) -> Result<()> {
        let slot = self.0.lock().map_err(|_| kernel_error("Python kernel state is unavailable."))?;
        let session = slot.as_ref().filter(|s| s.notebook == notebook).ok_or_else(|| kernel_error("No Python kernel is active for this notebook."))?;
        session.interrupted.store(true, Ordering::Release);
        send(session, serde_json::json!({"version":2,"id":"interrupt","action":"interrupt"}))
    }
    pub(super) fn restart(&self, notebook: &str) -> Result<()> {
        let slot = self.0.lock().map_err(|_| kernel_error("Python kernel state is unavailable."))?;
        let session = slot.as_ref().filter(|s| s.notebook == notebook).ok_or_else(|| kernel_error("No Python kernel is active for this notebook."))?;
        if session.running.load(Ordering::Acquire) { return Err(kernel_error("Interrupt the running cell before restarting.")); }
        send(session, serde_json::json!({"version":2,"id":"restart","action":"restart"}))?;
        let mut output = session.output.lock().map_err(|_| kernel_error("Python kernel is unavailable."))?;
        let response = reply(&mut output)?;
        if response.status != "restarted" { return Err(kernel_error("Python kernel restart failed.")); }
        Ok(())
    }
    pub(super) fn close(&self) {
        if let Ok(mut slot) = self.0.lock() { if let Some(session) = slot.take() { session.close(); } }
    }
}
impl Session {
    fn close(&self) {
        let _ = send(self, serde_json::json!({"version":2,"id":"shutdown","action":"shutdown"}));
        if let Ok(mut child) = self.child.lock() {
            let until = Instant::now() + Duration::from_secs(2);
            while Instant::now() < until { if child.try_wait().ok().flatten().is_some() { return; } std::thread::sleep(Duration::from_millis(20)); }
            let _ = child.kill(); let _ = child.wait();
        }
    }
}
impl Drop for PythonKernels { fn drop(&mut self) { if Arc::strong_count(&self.0) == 1 { self.close(); } } }

pub(super) fn execute(kernels: &PythonKernels, project: &Path, notebook: &str, block: &str, code: &str, python: &str, id: &str,
    dataset_id: Option<&str>, sql_execution_id: Option<&str>, analytics: &crate::analytics::AnalyticsControl) -> Result<PythonResult> {
    if code.len() > 20_000 { return Err(error("invalid_python", "Python Code cells are limited to 20 KB.")); }
    let metadata = db(project)?;
    let (saved, language): (String,String) = metadata.query_row(
        "SELECT content,language FROM notebook_blocks WHERE id=?1 AND notebook_id=?2 AND kind='code'",[block,notebook],|r|Ok((r.get(0)?,r.get(1)?)))
        .map_err(|_| error("invalid_block", "Choose a saved Python Code cell."))?;
    if saved != code || language != "python" { return Err(error("invalid_block", "Save the Python Code cell before running it.")); }
    let mut inputs = Vec::new();
    if let Some(dataset_id) = dataset_id.filter(|id| !id.is_empty()) {
        inputs.push(crate::analytics::dataset_for_python(project,dataset_id,analytics)?);
    }
    if let Some(sql_id) = sql_execution_id.filter(|id| !id.is_empty()) {
        inputs.push(crate::code_outputs::sql_for_python(project,sql_id)?);
    }
    if serde_json::to_vec(&inputs).map_err(|_| kernel_error("Python input could not be serialized."))?.len()>3*1024*1024 {
        return Err(error("input_limit","Selected Python inputs exceed the 3 MiB transfer limit."));
    }
    let session = kernels.session(project,notebook,python)?;
    if session.running.swap(true,Ordering::AcqRel) { return Err(kernel_error("Another Python cell is running.")); }
    struct RunningFlag<'a>(&'a AtomicBool);
    impl Drop for RunningFlag<'_> { fn drop(&mut self) { self.0.store(false,Ordering::Release); } }
    let _running = RunningFlag(&session.running);
    session.interrupted.store(false,Ordering::Release);
    let started = now(); let clock = Instant::now();
    let project_id: String = metadata.query_row("SELECT id FROM project LIMIT 1",[],|r|r.get(0)).map_err(|_| kernel_error("Project metadata is unavailable."))?;
    let provenance: Vec<_> = inputs.iter().map(|item|serde_json::json!({"kind":item.kind,"id":item.id,"name":item.name,
        "source_fingerprint":item.source_fingerprint,"representation_id":item.representation_id,
        "duckdb_version":item.duckdb_version,"has_more":item.has_more})).collect();
    let mut parameters = serde_json::json!({"version":2,"notebook_id":notebook,"code_block_id":block,"code":code,"python":session.environment.version,"inputs":provenance}).to_string();
    metadata.execute("INSERT INTO executions (id,project_id,dataset_id,source_fingerprint,operation_type,parameters,started_at,status,schema_version) VALUES (?1,?2,'','','python',?3,?4,'running',3)",params![id,project_id,parameters,started])
        .map_err(|_| kernel_error("Python execution could not be recorded."))?;
    let work = (|| {
        send(&session,serde_json::json!({"version":2,"id":id,"action":"execute","code":code,"inputs":&inputs}))?;
        let mut output = session.output.lock().map_err(|_| kernel_error("Python kernel is unavailable."))?;
        let response = loop {
            let response = reply(&mut output)?;
            if response.id != id { return Err(kernel_error("Python kernel response did not match the cell.")); }
            if response.status != "input_request" { break response; }
            let names = response.names.unwrap_or_default();
            let result_names=response.result_names.unwrap_or_default();
            if names.len()+result_names.len()==0 || names.len()+result_names.len()>16 || names.iter().chain(&result_names).any(|name| name.is_empty() || name.len() > 255) {
                return Err(kernel_error("Python requested too many or invalid dataset names."));
            }
            let resolved = names.iter().map(|name| crate::analytics::dataset_for_python(project,name,analytics))
                .chain(result_names.iter().map(|name|crate::named_results::for_python(project,name))).collect::<Result<Vec<_>>>();
            let answer = match resolved {
                Ok(tables) if serde_json::to_vec(&inputs.iter().chain(tables.iter()).collect::<Vec<_>>()).map_err(|_| kernel_error("Python inputs could not be serialized."))?.len() <= 3*1024*1024 => {
                    let response = serde_json::json!({"version":2,"id":id,"action":"inputs","inputs":&tables});
                    inputs.extend(tables);
                    response
                },
                Ok(_) => serde_json::json!({"version":2,"id":id,"action":"inputs","error":"Named datasets exceed the 3 MiB Python transfer limit."}),
                Err(failure) => serde_json::json!({"version":2,"id":id,"action":"inputs","error":failure.message}),
            };
            send(&session,answer)?;
        };
        if response.id != id { return Err(kernel_error("Python kernel response did not match the cell.")); }
        let provenance: Vec<_> = inputs.iter().map(|item|serde_json::json!({"kind":item.kind,"id":item.id,"name":item.name,
            "source_fingerprint":item.source_fingerprint,"representation_id":item.representation_id,
            "duckdb_version":item.duckdb_version,"has_more":item.has_more})).collect();
        parameters = serde_json::json!({"version":2,"notebook_id":notebook,"code_block_id":block,"code":code,"python":session.environment.version,"inputs":provenance}).to_string();
        metadata.execute("UPDATE executions SET parameters=?1 WHERE id=?2",params![parameters,id]).map_err(|_| kernel_error("Python input provenance could not be recorded."))?;
        let outputs = response.outputs.unwrap_or_default();
        let mut bytes = 0usize;
        if outputs.len() > 200 || outputs.iter().any(|o| {
            bytes += o.text.len();
            match o.kind.as_str() {
                "stdout"|"stderr"|"result"|"error" => false,
                "image" => {
                    let Some(data) = o.data.as_ref() else { return true };
                    bytes += data.len() * 3 / 4;
                    !matches!(o.mime.as_deref(),Some("image/png"|"image/jpeg")) || data.len() > 1024*1024 ||
                        !data.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b,b'+'|b'/'|b'='))
                },
                "table" => {
                    let (Some(columns),Some(rows)) = (&o.columns,&o.rows) else { return true };
                    bytes += columns.iter().map(String::len).sum::<usize>();
                    bytes += rows.iter().flatten().map(String::len).sum::<usize>();
                    columns.is_empty() || columns.len()>64 || rows.len()>200 ||
                        rows.iter().any(|row|row.len()>64) ||
                        columns.iter().chain(rows.iter().flatten()).any(|cell|cell.len()>4096)
                },
                _ => true,
            }
        }) || bytes > 1024*1024 { return Err(kernel_error("Python output exceeded the limit or had an unsupported format.")); }
        let status = if session.interrupted.load(Ordering::Acquire) { "interrupted" } else { response.status.as_str() };
        if !matches!(status,"succeeded"|"failed"|"interrupted") { return Err(kernel_error("Invalid Python execution status.")); }
        let publications=response.publications.unwrap_or_default();
        if publications.len()>4 || publications.iter().any(|item|crate::named_results::validate_table(&crate::named_results::Table{columns:item.columns.clone(),rows:item.rows.clone()}).is_err()) {
            return Err(error("result_limit","Python published an invalid or oversized table."));
        }
        let candidates=publications.iter().map(|item|(item.name.clone(),crate::named_results::Table{columns:item.columns.clone(),rows:item.rows.clone()},None)).collect::<Vec<_>>();
        if status=="succeeded" { crate::named_results::validate_publications(&metadata,&candidates)?; }
        Ok((status.to_string(),response.count,outputs,publications))
    })();
    let (status,count,outputs,publications) = work.unwrap_or_else(|failure| ("failed".into(),None,vec![PythonOutput {kind:"error".into(),text:failure.message,mime:None,data:None,columns:None,rows:None,truncated:false}],Vec::new()));
    let duration_ms = clock.elapsed().as_millis();
    let result = PythonResult { execution_id:id.into(),status:status.clone(),count,outputs,duration_ms,python:session.environment.version.clone() };
    if let Err(failure) = crate::code_outputs::store(&metadata,block,id,"python",&result) {
        let _ = metadata.execute("UPDATE executions SET completed_at=?1,status='failed',error_summary=?2 WHERE id=?3",params![now(),failure.message,id]);
        return Err(failure);
    }
    metadata.execute("UPDATE executions SET completed_at=?1,status=?2,error_summary=?3 WHERE id=?4",
        params![now(),status,result.outputs.iter().find(|o|o.kind=="error").map(|o|o.text.chars().take(500).collect::<String>()),id])
        .map_err(|_| kernel_error("Python execution status could not be recorded."))?;
    if status=="succeeded" && !publications.is_empty() {
        let items=publications.into_iter().map(|item|(item.name,crate::named_results::Table{columns:item.columns,rows:item.rows},None)).collect::<Vec<_>>();
        if let Err(failure)=crate::named_results::publish_many(&metadata,id,&items) {
            metadata.execute("UPDATE executions SET status='failed',error_summary=?1 WHERE id=?2",params![failure.message,id]).map_err(|_|storage_error())?;
            return Err(failure);
        }
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[cfg(windows)]
    #[test]
    fn parses_windows_launcher_interpreters() {
        assert_eq!(launcher_paths(" -V:3.13 * C:\\Python313\\python.exe\n -V:3.12 C:\\Users\\Me\\Python312\\python.exe\n"),
            vec![PathBuf::from("C:\\Python313\\python.exe"), PathBuf::from("C:\\Users\\Me\\Python312\\python.exe")]);
    }
    #[test]
    fn named_results_cross_sql_python_and_cleanup() {
        let Ok(python)=std::env::var("DATAFORGE_TEST_PYTHON") else { return };
        let root=std::env::temp_dir().join(format!("dataforge-results-test-{}",uuid::Uuid::new_v4()));
        std::fs::create_dir(&root).unwrap();
        let project=crate::create_project_inner("Results",root.to_str().unwrap()).unwrap();
        let path=Path::new(&project.project.path);
        let csv=root.join("people.csv"); std::fs::write(&csv,"ID,Amount\n1,10\n2,20\n").unwrap();
        crate::register_csv_inner(path,csv.to_str().unwrap()).unwrap();
        let note=serde_json::to_value(crate::notebook::create_notebook_inner(path,"Results").unwrap()).unwrap();
        let note_id=note["id"].as_str().unwrap();
        let sql="SELECT ID, Amount FROM \"people.csv\" ORDER BY ID";
        let sql_block=serde_json::to_value(crate::notebook::add_block_inner(path,note_id,"code",sql,None,None,None,Some("sql")).unwrap()).unwrap();
        let sql_block_id=sql_block["id"].as_str().unwrap();
        let control=crate::analytics::AnalyticsControl::default();
        let first=crate::analytics::run_notebook_sql_named_inner(path,"",sql_block_id,sql,Some("base_values"),&control,uuid::Uuid::new_v4().to_string()).unwrap();
        assert!(!first.has_more);
        let first_result=crate::named_results::list(path).unwrap().into_iter().find(|r|r.name.as_deref()==Some("base_values")).unwrap();
        let stable=format!("result_{}",first_result.id.replace('-',""));
        let code="a=dataforge.result('base_values'); dataforge.publish('doubled', a.assign(Double=a['Amount']*2)); print(a['Amount'].dtype, a.attrs['dataforge']['extent'])";
        let py_block=serde_json::to_value(crate::notebook::add_block_inner(path,note_id,"code",code,None,None,None,Some("python")).unwrap()).unwrap();
        let py_block_id=py_block["id"].as_str().unwrap();
        let kernels=PythonKernels::default();
        let py=execute(&kernels,path,note_id,py_block_id,code,&python,&uuid::Uuid::new_v4().to_string(),None,None,&control).unwrap();
        assert_eq!(py.status,"succeeded","{:?}",py.outputs.iter().map(|o|o.text.as_str()).collect::<Vec<_>>());
        assert!(py.outputs.iter().any(|o|o.text.contains("Int64 complete")));
        let join="SELECT b.ID, d.Double FROM base_values b JOIN doubled d ON b.ID=d.ID ORDER BY b.ID";
        crate::notebook::update_block_inner(path,sql_block_id,join,Some("sql")).unwrap();
        let joined=crate::analytics::run_notebook_sql_named_inner(path,"",sql_block_id,join,Some("joined_values"),&control,uuid::Uuid::new_v4().to_string()).unwrap();
        assert_eq!(joined.rows,vec![vec![Some("1".into()),Some("20".into())],vec![Some("2".into()),Some("40".into())]]);
        assert_eq!(serde_json::to_value(&joined).unwrap()["columns"][1]["data_type"],"integer");
        let joined_id=serde_json::to_value(&joined).unwrap()["execution"]["id"].as_str().unwrap().to_string();
        let joined_parameters:String=db(path).unwrap().query_row("SELECT parameters FROM executions WHERE id=?1",[&joined_id],|r|r.get(0)).unwrap();
        let provenance:serde_json::Value=serde_json::from_str(&joined_parameters).unwrap();
        assert_eq!(provenance["result_inputs"].as_array().unwrap().len(),2);
        let by_id=format!("SELECT count(*) FROM \"{stable}\"");
        crate::notebook::update_block_inner(path,sql_block_id,&by_id,Some("sql")).unwrap();
        assert_eq!(crate::analytics::run_notebook_sql_inner(path,"",sql_block_id,&by_id,&control,uuid::Uuid::new_v4().to_string()).unwrap().rows[0][0].as_deref(),Some("2"));
        let replacement="SELECT ID, Amount + 1 AS Amount FROM \"people.csv\" ORDER BY ID";
        crate::notebook::update_block_inner(path,sql_block_id,replacement,Some("sql")).unwrap();
        crate::analytics::run_notebook_sql_named_inner(path,"",sql_block_id,replacement,Some("base_values"),&control,uuid::Uuid::new_v4().to_string()).unwrap();
        let listed=crate::named_results::list(path).unwrap();
        assert!(listed.iter().any(|item|item.id==first_result.id && item.name.is_none() && item.stale));
        assert_eq!(crate::named_results::resolve(&db(path).unwrap(),&stable).unwrap().1.rows[0][1].as_deref(),Some("10"));
        assert_eq!(crate::named_results::resolve(&db(path).unwrap(),"base_values").unwrap().1.rows[0][1].as_deref(),Some("11"));
        assert_eq!(crate::analytics::run_notebook_sql_named_inner(path,"",sql_block_id,replacement,Some("bad-name"),&control,uuid::Uuid::new_v4().to_string()).unwrap_err().code,"invalid_result_name");
        assert_eq!(crate::named_results::resolve(&db(path).unwrap(),"base_values").unwrap().1.rows[0][1].as_deref(),Some("11"));
        let missing="SELECT * FROM absent_result";
        crate::notebook::update_block_inner(path,sql_block_id,missing,Some("sql")).unwrap();
        assert_eq!(crate::analytics::run_notebook_sql_inner(path,"",sql_block_id,missing,&control,uuid::Uuid::new_v4().to_string()).unwrap_err().code,"dataset_missing");
        std::fs::write(&csv,"ID,Amount\n1,99\n").unwrap();
        assert!(crate::named_results::list(path).unwrap().iter().any(|item|item.name.as_deref()==Some("base_values") && item.stale));
        crate::named_results::release(path,&first_result.id).unwrap();
        assert_eq!(crate::named_results::resolve(&db(path).unwrap(),&stable).unwrap_err().code,"result_unavailable");
        let doubled=crate::named_results::list(path).unwrap().into_iter().find(|item|item.name.as_deref()==Some("doubled")).unwrap();
        let hash:String=db(path).unwrap().query_row("SELECT payload_hash FROM named_results WHERE id=?1",[&doubled.id],|r|r.get(0)).unwrap();
        crate::code_outputs::clear(path,note_id,Some(py_block_id)).unwrap();
        crate::code_outputs::cleanup(path).unwrap();
        assert!(crate::named_results::resolve(&db(path).unwrap(),"doubled").is_ok());
        crate::named_results::release(path,&doubled.id).unwrap();
        crate::code_outputs::cleanup(path).unwrap();
        let retained:i64=db(path).unwrap().query_row("SELECT COUNT(*) FROM code_output_blobs WHERE hash=?1",[hash],|r|r.get(0)).unwrap();
        assert_eq!(retained,0);
        kernels.close(); std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn selected_dataset_and_sql_result_reach_real_kernel_as_dataframes() {
        let Ok(python)=std::env::var("DATAFORGE_TEST_PYTHON") else { return };
        let root=std::env::temp_dir().join(format!("dataforge-interop-test-{}",uuid::Uuid::new_v4()));
        std::fs::create_dir(&root).unwrap();
        let project=crate::create_project_inner("Interop",root.to_str().unwrap()).unwrap();
        let path=Path::new(&project.project.path);
        let source=root.join("sample.csv");
        std::fs::write(&source,"Name,Value,Active\nAda,10,true\nBob,20,false\n").unwrap();
        let dataset=crate::register_csv_inner(path,source.to_str().unwrap()).unwrap();
        let lookup=root.join("lookup.csv");
        std::fs::write(&lookup,"Name,Weight\nAda,1.25\nBob,2.50\n").unwrap();
        let lookup_dataset=crate::register_csv_inner(path,lookup.to_str().unwrap()).unwrap();
        let note=serde_json::to_value(crate::notebook::create_notebook_inner(path,"Mixed").unwrap()).unwrap();
        let note_id=note["id"].as_str().unwrap();
        let sql="SELECT SUM(CAST(Value AS INTEGER)) AS total FROM source";
        let sql_block=serde_json::to_value(crate::notebook::add_block_inner(path,note_id,"code",sql,None,None,None,Some("sql")).unwrap()).unwrap();
        let control=crate::analytics::AnalyticsControl::default();
        let sql_result=crate::analytics::run_notebook_sql_inner(path,&dataset.id,sql_block["id"].as_str().unwrap(),sql,&control,uuid::Uuid::new_v4().to_string()).unwrap();
        let sql_id=serde_json::to_value(&sql_result).unwrap()["execution"]["id"].as_str().unwrap().to_string();
        let code="a=dataforge.dataset('sample.csv'); c=dataforge.dataset('lookup.csv'); b=dataforge.sql_result(); joined=a.merge(c,on='Name'); print(a['Value'].dtype, a['Active'].dtype, c['Weight'].dtype, b['total'].dtype, joined.iloc[0]['Weight'], a.iloc[0]['Value'] + b.iloc[0]['total'], a.attrs['dataforge']['source_fingerprint'], c.attrs['dataforge']['id'])";
        let block=serde_json::to_value(crate::notebook::add_block_inner(path,note_id,"code",code,None,None,None,Some("python")).unwrap()).unwrap();
        let block_id=block["id"].as_str().unwrap();
        let kernels=PythonKernels::default();
        let result=execute(&kernels,path,note_id,block_id,code,&python,&uuid::Uuid::new_v4().to_string(),None,Some(&sql_id),&control).unwrap();
        assert_eq!(result.status,"succeeded","{}",result.outputs.iter().map(|o|o.text.as_str()).collect::<Vec<_>>().join(" | "));
        assert!(result.outputs.iter().any(|o|o.kind=="stdout" && o.text.contains("Int64") && o.text.contains("boolean") && o.text.contains("1.25") && o.text.contains("40") && o.text.contains(&dataset.fingerprint) && o.text.contains(&lookup_dataset.id)));
        let parameters:String=db(path).unwrap().query_row("SELECT parameters FROM executions WHERE id=?1",[&result.execution_id],|r|r.get(0)).unwrap();
        let recorded:serde_json::Value=serde_json::from_str(&parameters).unwrap();
        assert_eq!(recorded["inputs"].as_array().unwrap().len(),3);
        assert!(recorded["inputs"].as_array().unwrap().iter().any(|input| input["id"]==dataset.id));
        assert!(recorded["inputs"].as_array().unwrap().iter().any(|input| input["id"]==lookup_dataset.id));
        assert!(recorded["inputs"].as_array().unwrap().iter().any(|input| input["id"]==sql_id));
        assert!(!parameters.contains(&project.project.path));
        assert_eq!(std::fs::read_to_string(&source).unwrap(),"Name,Value,Active\nAda,10,true\nBob,20,false\n");
        crate::notebook::update_block_inner(path,block_id,"dataforge.dataset('missing.csv')",Some("python")).unwrap();
        let missing=execute(&kernels,path,note_id,block_id,"dataforge.dataset('missing.csv')",&python,&uuid::Uuid::new_v4().to_string(),None,None,&control).unwrap();
        assert_eq!(missing.status,"failed");
        assert!(missing.outputs.iter().any(|o|o.text.contains("No registered dataset")));
        crate::notebook::update_block_inner(path,block_id,"dataforge.dataset()",Some("python")).unwrap();
        let cleared=execute(&kernels,path,note_id,block_id,"dataforge.dataset()",&python,&uuid::Uuid::new_v4().to_string(),None,None,&control).unwrap();
        assert_eq!(cleared.status,"failed");
        assert!(cleared.outputs.iter().any(|o|o.text.contains("literal registered dataset name")));
        assert!(crate::code_outputs::sql_for_python(path,"missing").is_err());
        let large=root.join("many.csv");
        std::fs::write(&large,format!("Value\n{}",(0..250).map(|n|format!("{n}\n")).collect::<String>())).unwrap();
        let large_dataset=crate::register_csv_inner(path,large.to_str().unwrap()).unwrap();
        assert_eq!(crate::analytics::dataset_for_python(path,&large_dataset.id,&control).unwrap_err().code,"input_limit");
        crate::notebook::update_block_inner(path,block_id,"dataforge.dataset('many.csv')",Some("python")).unwrap();
        let limited=execute(&kernels,path,note_id,block_id,"dataforge.dataset('many.csv')",&python,&uuid::Uuid::new_v4().to_string(),None,None,&control).unwrap();
        assert_eq!(limited.status,"failed");
        assert!(limited.outputs.iter().any(|o|o.text.contains("200-row Python transfer limit")));
        let mut combined_code=String::new();
        for index in 0..5 {
            let name=format!("bulk{index}.csv");
            let file=root.join(&name);
            std::fs::write(&file,format!("Text\n{}",(0..200).map(|_|format!("{}\n","x".repeat(3500))).collect::<String>())).unwrap();
            crate::register_csv_inner(path,file.to_str().unwrap()).unwrap();
            combined_code.push_str(&format!("dataforge.dataset('{name}')\n"));
        }
        crate::notebook::update_block_inner(path,block_id,&combined_code,Some("python")).unwrap();
        let combined=execute(&kernels,path,note_id,block_id,&combined_code,&python,&uuid::Uuid::new_v4().to_string(),None,None,&control).unwrap();
        assert_eq!(combined.status,"failed");
        assert!(combined.outputs.iter().any(|o|o.text.contains("3 MiB Python transfer limit")));
        std::fs::write(&source,"Name,Value,Active\nChanged,99,true\n").unwrap();
        assert_eq!(crate::analytics::dataset_for_python(path,&dataset.id,&control).err().unwrap().code,"dataset_unavailable");
        kernels.close(); std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn trusted_python_kernel_persists_state_and_execution_history() {
        let Ok(python) = std::env::var("DATAFORGE_TEST_PYTHON") else { return };
        let root = std::env::temp_dir().join(format!("dataforge-python-test-{}",uuid::Uuid::new_v4()));
        std::fs::create_dir(&root).unwrap();
        let project = crate::create_project_inner("Python",root.to_str().unwrap()).unwrap();
        let path = Path::new(&project.project.path);
        let notebook = serde_json::to_value(crate::notebook::create_notebook_inner(path,"Kernel").unwrap()).unwrap();
        let notebook_id = notebook["id"].as_str().unwrap();
        let code = "value = 4\nprint('hello')\nvalue";
        let block = serde_json::to_value(crate::notebook::add_block_inner(path,notebook_id,"code",code,None,None,None,Some("python")).unwrap()).unwrap();
        let block_id = block["id"].as_str().unwrap();
        let kernels = PythonKernels::default();
        let control = crate::analytics::AnalyticsControl::default();
        assert_eq!(kernels.status(notebook_id).status,"stopped");
        let first = execute(&kernels,path,notebook_id,block_id,code,&python,&uuid::Uuid::new_v4().to_string(),None,None,&control).unwrap();
        assert_eq!(first.status,"succeeded"); assert_eq!(first.count,Some(1));
        assert_eq!(kernels.status(notebook_id).status,"idle");
        assert!(first.outputs.iter().any(|item|item.kind=="stdout" && item.text.contains("hello")));
        let restored = crate::code_outputs::load(path,notebook_id).unwrap();
        assert_eq!(restored.len(),1);
        assert_eq!(restored[0].execution_id,first.execution_id);
        assert_eq!(restored[0].code,code);
        assert!(restored[0].value["outputs"].as_array().unwrap().iter().any(|item|item["text"].as_str().is_some_and(|text|text.contains("hello"))));
        crate::notebook::update_block_inner(path,block_id,"value + 3",Some("python")).unwrap();
        let second = execute(&kernels,path,notebook_id,block_id,"value + 3",&python,&uuid::Uuid::new_v4().to_string(),None,None,&control).unwrap();
        assert_eq!(second.count,Some(2)); assert!(second.outputs.iter().any(|item|item.kind=="result" && item.text.contains('7')));
        let rich = "import pandas as pd,base64\nfrom IPython.display import display,Image\ndisplay(pd.DataFrame({'name':['Ada']}))\ndisplay(Image(data=base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/dS8AAAAASUVORK5CYII='),format='png'))";
        crate::notebook::update_block_inner(path,block_id,rich,Some("python")).unwrap();
        let rich_result = execute(&kernels,path,notebook_id,block_id,rich,&python,&uuid::Uuid::new_v4().to_string(),None,None,&control).unwrap();
        assert_eq!(rich_result.status,"succeeded");
        assert!(rich_result.outputs.iter().any(|item|item.kind=="table" && item.rows.as_ref().is_some_and(|rows| rows.iter().flatten().any(|cell|cell=="Ada"))));
        assert!(rich_result.outputs.iter().any(|item|item.kind=="image" && item.mime.as_deref()==Some("image/png")));
        let restored = crate::code_outputs::load(path,notebook_id).unwrap();
        assert_eq!(restored[0].execution_id,rich_result.execution_id);
        assert!(restored[0].value["outputs"].as_array().unwrap().iter().any(|item|item["kind"]=="table"));
        assert!(restored[0].value["outputs"].as_array().unwrap().iter().any(|item|item["kind"]=="image"));
        crate::notebook::update_block_inner(path,block_id,"import time; time.sleep(10)",Some("python")).unwrap();
        std::thread::scope(|scope| {
            let task = scope.spawn(||execute(&kernels,path,notebook_id,block_id,"import time; time.sleep(10)",&python,&uuid::Uuid::new_v4().to_string(),None,None,&control));
            let until = Instant::now()+Duration::from_secs(5);
            while !kernels.is_running() && Instant::now()<until { std::thread::sleep(Duration::from_millis(20)); }
            assert!(kernels.is_running());
            assert_eq!(kernels.status(notebook_id).status,"running");
            std::thread::sleep(Duration::from_millis(500));
            kernels.interrupt(notebook_id).unwrap();
            assert_eq!(task.join().unwrap().unwrap().status,"interrupted");
        });
        kernels.restart(notebook_id).unwrap();
        assert_eq!(kernels.status(notebook_id).status,"idle");
        crate::notebook::update_block_inner(path,block_id,"value + 3",Some("python")).unwrap();
        let third = execute(&kernels,path,notebook_id,block_id,"value + 3",&python,&uuid::Uuid::new_v4().to_string(),None,None,&control).unwrap();
        assert_eq!(third.status,"failed"); assert_eq!(third.count,Some(1));
        let count:i64 = db(path).unwrap().query_row("SELECT COUNT(*) FROM executions WHERE operation_type='python'",[],|r|r.get(0)).unwrap();
        assert_eq!(count,5);
        kernels.close(); assert_eq!(kernels.status(notebook_id).status,"stopped"); std::fs::remove_dir_all(root).unwrap();
    }
}
