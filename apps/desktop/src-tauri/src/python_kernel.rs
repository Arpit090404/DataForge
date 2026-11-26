use std::{io::{BufRead, BufReader, Read, Write}, path::{Path, PathBuf}, process::{Child, ChildStdin, ChildStdout, Command, Stdio}, sync::{atomic::{AtomicBool, Ordering}, Arc, Mutex}, time::{Duration, Instant}};

use rusqlite::params;
use serde::{Deserialize, Serialize};

use crate::{db, error, now, AppError, Result};

const BRIDGE: &str = include_str!("python_kernel.py");

#[derive(Clone, Serialize)]
pub(super) struct PythonEnvironment { path: String, version: String }
#[derive(Deserialize)]
struct BridgeReply { version: u32, id: String, status: String, count: Option<u64>, outputs: Option<Vec<PythonOutput>> }
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

struct Session {
    notebook: String, project: PathBuf, environment: PythonEnvironment,
    child: Mutex<Child>, input: Mutex<ChildStdin>, output: Mutex<BufReader<ChildStdout>>,
    running: AtomicBool, interrupted: AtomicBool,
}
#[derive(Clone, Default)]
pub(super) struct PythonKernels(Arc<Mutex<Option<Arc<Session>>>>);

fn kernel_error(message: &str) -> AppError { error("python_kernel_error", message) }
fn command(path: &Path) -> Command {
    let mut command = Command::new(path);
    command.args(["-u", "-c", BRIDGE]).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null());
    #[cfg(windows)] {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    command
}
fn reply(reader: &mut BufReader<ChildStdout>) -> Result<BridgeReply> {
    let mut line = String::new();
    reader.take(8 * 1024 * 1024).read_line(&mut line).map_err(|_| kernel_error("Python kernel output could not be read."))?;
    let reply: BridgeReply = serde_json::from_str(&line).map_err(|_| kernel_error("Python kernel stopped or returned invalid output."))?;
    if reply.version != 1 { return Err(kernel_error("Unsupported Python kernel protocol.")); }
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
    let mut child = Command::new(path).args(["-c", "import ipykernel,jupyter_client,sys; print(sys.version.split()[0])"])
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
    if let Ok(output) = Command::new("uv").args(["--no-cache", "python", "list", "--only-installed"]).output() {
        for line in String::from_utf8_lossy(&output.stdout).lines() {
            if let Some((_,path)) = line.split_once("     ") { candidates.push(PathBuf::from(path.trim())); }
        }
    }
    candidates.sort(); candidates.dedup();
    candidates.into_iter().filter_map(|path| check_environment(&path).ok()).collect()
}
pub(super) fn inspect(path: &str) -> Result<PythonEnvironment> { check_environment(Path::new(path)) }

impl PythonKernels {
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
        send(session, serde_json::json!({"version":1,"id":"interrupt","action":"interrupt"}))
    }
    pub(super) fn restart(&self, notebook: &str) -> Result<()> {
        let slot = self.0.lock().map_err(|_| kernel_error("Python kernel state is unavailable."))?;
        let session = slot.as_ref().filter(|s| s.notebook == notebook).ok_or_else(|| kernel_error("No Python kernel is active for this notebook."))?;
        if session.running.load(Ordering::Acquire) { return Err(kernel_error("Interrupt the running cell before restarting.")); }
        send(session, serde_json::json!({"version":1,"id":"restart","action":"restart"}))?;
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
        let _ = send(self, serde_json::json!({"version":1,"id":"shutdown","action":"shutdown"}));
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
    let provenance: Vec<_> = inputs.iter().map(|item|serde_json::json!({"kind":item.kind,"id":item.id,
        "source_fingerprint":item.source_fingerprint,"representation_id":item.representation_id,
        "duckdb_version":item.duckdb_version,"has_more":item.has_more})).collect();
    let parameters = serde_json::json!({"version":1,"notebook_id":notebook,"code_block_id":block,"code":code,"python":session.environment.version,"inputs":provenance}).to_string();
    metadata.execute("INSERT INTO executions (id,project_id,dataset_id,source_fingerprint,operation_type,parameters,started_at,status,schema_version) VALUES (?1,?2,'','','python',?3,?4,'running',3)",params![id,project_id,parameters,started])
        .map_err(|_| kernel_error("Python execution could not be recorded."))?;
    let work = (|| {
        send(&session,serde_json::json!({"version":1,"id":id,"action":"execute","code":code,"inputs":inputs}))?;
        let mut output = session.output.lock().map_err(|_| kernel_error("Python kernel is unavailable."))?;
        let response = reply(&mut output)?;
        if response.id != id { return Err(kernel_error("Python kernel response did not match the cell.")); }
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
        Ok((status.to_string(),response.count,outputs))
    })();
    let (status,count,outputs) = work.unwrap_or_else(|failure| ("failed".into(),None,vec![PythonOutput {kind:"error".into(),text:failure.message,mime:None,data:None,columns:None,rows:None,truncated:false}]));
    let duration_ms = clock.elapsed().as_millis();
    let result = PythonResult { execution_id:id.into(),status:status.clone(),count,outputs,duration_ms,python:session.environment.version.clone() };
    if let Err(failure) = crate::code_outputs::store(&metadata,block,id,"python",&result) {
        let _ = metadata.execute("UPDATE executions SET completed_at=?1,status='failed',error_summary=?2 WHERE id=?3",params![now(),failure.message,id]);
        return Err(failure);
    }
    metadata.execute("UPDATE executions SET completed_at=?1,status=?2,error_summary=?3 WHERE id=?4",
        params![now(),status,result.outputs.iter().find(|o|o.kind=="error").map(|o|o.text.chars().take(500).collect::<String>()),id])
        .map_err(|_| kernel_error("Python execution status could not be recorded."))?;
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
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
        let note=serde_json::to_value(crate::notebook::create_notebook_inner(path,"Mixed").unwrap()).unwrap();
        let note_id=note["id"].as_str().unwrap();
        let sql="SELECT SUM(CAST(Value AS INTEGER)) AS total FROM source";
        let sql_block=serde_json::to_value(crate::notebook::add_block_inner(path,note_id,"code",sql,None,None,None,Some("sql")).unwrap()).unwrap();
        let control=crate::analytics::AnalyticsControl::default();
        let sql_result=crate::analytics::run_notebook_sql_inner(path,&dataset.id,sql_block["id"].as_str().unwrap(),sql,&control,uuid::Uuid::new_v4().to_string()).unwrap();
        let sql_id=serde_json::to_value(&sql_result).unwrap()["execution"]["id"].as_str().unwrap().to_string();
        let code="a=dataforge.dataset(); b=dataforge.sql_result(); print(a['Value'].dtype, b['total'].dtype, a.iloc[0]['Value'] + b.iloc[0]['total'], a.attrs['dataforge']['source_fingerprint'])";
        let block=serde_json::to_value(crate::notebook::add_block_inner(path,note_id,"code",code,None,None,None,Some("python")).unwrap()).unwrap();
        let block_id=block["id"].as_str().unwrap();
        let kernels=PythonKernels::default();
        let result=execute(&kernels,path,note_id,block_id,code,&python,&uuid::Uuid::new_v4().to_string(),Some(&dataset.id),Some(&sql_id),&control).unwrap();
        assert_eq!(result.status,"succeeded");
        assert!(result.outputs.iter().any(|o|o.kind=="stdout" && o.text.contains("Int64") && o.text.contains("40") && o.text.contains(&dataset.fingerprint)));
        let parameters:String=db(path).unwrap().query_row("SELECT parameters FROM executions WHERE id=?1",[&result.execution_id],|r|r.get(0)).unwrap();
        let recorded:serde_json::Value=serde_json::from_str(&parameters).unwrap();
        assert_eq!(recorded["inputs"][0]["id"],dataset.id);
        assert_eq!(recorded["inputs"][1]["id"],sql_id);
        assert!(!parameters.contains(&project.project.path));
        assert_eq!(std::fs::read_to_string(&source).unwrap(),"Name,Value,Active\nAda,10,true\nBob,20,false\n");
        crate::notebook::update_block_inner(path,block_id,"dataforge.dataset()",Some("python")).unwrap();
        let cleared=execute(&kernels,path,note_id,block_id,"dataforge.dataset()",&python,&uuid::Uuid::new_v4().to_string(),None,None,&control).unwrap();
        assert_eq!(cleared.status,"failed");
        assert!(cleared.outputs.iter().any(|o|o.text.contains("Select this DataForge input")));
        assert!(crate::code_outputs::sql_for_python(path,"missing").is_err());
        let large=root.join("many.csv");
        std::fs::write(&large,format!("Value\n{}",(0..250).map(|n|format!("{n}\n")).collect::<String>())).unwrap();
        let large_dataset=crate::register_csv_inner(path,large.to_str().unwrap()).unwrap();
        let page=crate::analytics::dataset_for_python(path,&large_dataset.id,&control).unwrap();
        assert_eq!(page.rows.len(),200); assert!(page.has_more);
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
        let first = execute(&kernels,path,notebook_id,block_id,code,&python,&uuid::Uuid::new_v4().to_string(),None,None,&control).unwrap();
        assert_eq!(first.status,"succeeded"); assert_eq!(first.count,Some(1));
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
            std::thread::sleep(Duration::from_millis(500));
            kernels.interrupt(notebook_id).unwrap();
            assert_eq!(task.join().unwrap().unwrap().status,"interrupted");
        });
        kernels.restart(notebook_id).unwrap();
        crate::notebook::update_block_inner(path,block_id,"value + 3",Some("python")).unwrap();
        let third = execute(&kernels,path,notebook_id,block_id,"value + 3",&python,&uuid::Uuid::new_v4().to_string(),None,None,&control).unwrap();
        assert_eq!(third.status,"failed"); assert_eq!(third.count,Some(1));
        let count:i64 = db(path).unwrap().query_row("SELECT COUNT(*) FROM executions WHERE operation_type='python'",[],|r|r.get(0)).unwrap();
        assert_eq!(count,5);
        kernels.close(); std::fs::remove_dir_all(root).unwrap();
    }
}
