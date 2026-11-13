use rusqlite::{Connection, params};
use serde_json::{Value, json};
use std::{collections::HashSet, env, fs, io::{Read, Write}, path::{Path, PathBuf}, process::{Child, ChildStdin, Command, Stdio}, sync::mpsc, thread, time::{Duration, Instant}};
const MAX: usize = 1024 * 1024;

struct Worker { child: Child, input: ChildStdin, rx: mpsc::Receiver<Result<Value,String>>, generation: u64 }
impl Worker {
    fn start(python: &Path, script: &Path, base: &Path, generation: u64) -> Result<Self,String> {
        let mut child = Command::new(python).arg(script).arg(base).arg(generation.to_string())
            .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null()).spawn().map_err(|e| e.to_string())?;
        let input = child.stdin.take().ok_or("stdin")?;
        let mut output = child.stdout.take().ok_or("stdout")?;
        let (tx, rx) = mpsc::channel();
        thread::spawn(move || loop { let result=read_frame(&mut output); let done=result.is_err(); if tx.send(result).is_err() || done {break} });
        let worker=Self{child,input,rx,generation};
        let hello=worker.recv(3000)?;
        if hello["kind"]!="hello" || hello["major"]!=1 || hello["generation"]!=generation {return Err("handshake mismatch".into())}
        Ok(worker)
    }
    fn send(&mut self, mut v: Value) -> Result<(),String> {
        v["major"]=json!(1); v["generation"]=json!(self.generation);
        let bytes=serde_json::to_vec(&v).map_err(|e|e.to_string())?;
        write_frame(&mut self.input,&bytes)
    }
    fn recv(&self, ms: u64) -> Result<Value,String> {self.rx.recv_timeout(Duration::from_millis(ms)).map_err(|e|e.to_string())?}
    fn stop(&mut self) {let _=self.child.kill(); let _=self.child.wait();}
}
impl Drop for Worker {fn drop(&mut self){self.stop()}}
fn write_frame(w:&mut impl Write,b:&[u8])->Result<(),String>{if b.is_empty()||b.len()>MAX{return Err("size".into())} w.write_all(&(b.len() as u32).to_be_bytes()).and_then(|_|w.write_all(b)).and_then(|_|w.flush()).map_err(|e|e.to_string())}
fn read_frame(r:&mut impl Read)->Result<Value,String>{let mut h=[0;4];r.read_exact(&mut h).map_err(|e|e.to_string())?;let n=u32::from_be_bytes(h) as usize;if n==0||n>MAX{return Err("size".into())}let mut b=vec![0;n];r.read_exact(&mut b).map_err(|e|e.to_string())?;serde_json::from_slice(&b).map_err(|e|e.to_string())}
fn db(base:&Path)->Result<Connection,String>{fs::create_dir_all(base).map_err(|e|e.to_string())?;let c=Connection::open(base.join("project.sqlite")).map_err(|e|e.to_string())?;c.execute_batch("CREATE TABLE IF NOT EXISTS journal(op TEXT PRIMARY KEY, idem TEXT UNIQUE NOT NULL, phase TEXT NOT NULL, generation INTEGER NOT NULL);CREATE TABLE IF NOT EXISTS executions(op TEXT PRIMARY KEY, status TEXT NOT NULL);CREATE TABLE IF NOT EXISTS artifacts(op TEXT PRIMARY KEY, path TEXT NOT NULL);").map_err(|e|e.to_string())?;Ok(c)}
fn dirs(base:&Path)->Result<(),String>{for name in ["staging","artifacts","quarantine"]{fs::create_dir_all(base.join(name)).map_err(|e|e.to_string())?}Ok(())}
fn worker(python:&Path,script:&Path,base:&Path,g:u64)->Result<Worker,String>{Worker::start(python,script,base,g)}
fn request(w:&mut Worker,kind:&str,id:&str,op:&str)->Result<Value,String>{w.send(json!({"kind":kind,"request_id":id,"operation_id":op}))?;w.recv(3000)}
fn phase(c:&Connection,op:&str,p:&str)->Result<(),String>{let prior=match p{"worker_result_observed"=>"prepared","outputs_verified"=>"worker_result_observed",_=>return Err("invalid target phase".into())};let n=c.execute("UPDATE journal SET phase=?2 WHERE op=?1 AND phase=?3",params![op,p,prior]).map_err(|e|e.to_string())?;if n!=1{return Err("invalid state transition".into())}Ok(())}
fn barrier(op:&str){if op=="opbad"{std::process::exit(77)}} // Abrupt host exit: no Rust destructors or graceful worker shutdown.
fn run_case(base:&Path,python:&Path,script:&Path,scenario:&str,op:&str)->Result<(),String>{
    dirs(base)?;let mut c=db(base)?;
    if scenario=="journal_fail" {c.execute_batch("CREATE TEMP TRIGGER fail_journal BEFORE INSERT ON journal BEGIN SELECT RAISE(FAIL,'injected journal I/O failure'); END;").map_err(|e|e.to_string())?;}
    let tx=c.transaction().map_err(|e|e.to_string())?;
    tx.execute("INSERT INTO journal VALUES (?1,?2,'prepared',1)",params![op,format!("key_{op}")]).map_err(|e|e.to_string())?;
    tx.execute("INSERT INTO executions VALUES (?1,'running')",params![op]).map_err(|e|e.to_string())?;
    tx.commit().map_err(|e|e.to_string())?;
    if scenario=="journal" {barrier(op);return Ok(())}
    let mut w=worker(python,script,base,1)?;
    if scenario=="worker_crash" {let _=request(&mut w,"crash","r1",op);return Ok(())}
    let response=request(&mut w,"write_representation","r1",op)?;
    if response["kind"]!="ok" {return Err("worker write failed".into())}
    if scenario=="duckdb" {barrier(op);return Ok(())}
    phase(&c,op,"worker_result_observed")?;
    if scenario=="worker_success" {barrier(op);return Ok(())}
    if scenario=="disk_stage" {return Err("injected staging I/O failure at write boundary".into())}
    let stage=base.join("staging").join(format!("{op}.txt"));fs::write(&stage,b"synthetic artifact").map_err(|e|e.to_string())?;
    phase(&c,op,"outputs_verified")?;
    if scenario=="stage" {barrier(op);return Ok(())}
    if scenario=="disk_promote" {return Err("injected promotion I/O failure at rename boundary".into())}
    let promoted=base.join("artifacts").join(format!("{op}.txt"));fs::rename(stage,promoted).map_err(|e|e.to_string())?;
    if scenario=="promoted" {barrier(op);return Ok(())}
    if scenario=="sqlite_fail" {c.execute_batch("CREATE TEMP TRIGGER fail_artifact BEFORE INSERT ON artifacts BEGIN SELECT RAISE(FAIL,'injected SQLite final-commit failure'); END;").map_err(|e|e.to_string())?;}
    let tx=c.transaction().map_err(|e|e.to_string())?;
    tx.execute("INSERT INTO artifacts VALUES (?1,?2)",params![op,format!("artifacts/{op}.txt")]).map_err(|e|e.to_string())?;
    tx.execute("UPDATE executions SET status='succeeded' WHERE op=?1",params![op]).map_err(|e|e.to_string())?;
    let n=tx.execute("UPDATE journal SET phase='committed' WHERE op=?1 AND phase='outputs_verified'",params![op]).map_err(|e|e.to_string())?;if n!=1{return Err("invalid final transition".into())}
    tx.commit().map_err(|e|e.to_string())?;
    if scenario=="complete" {barrier(op)}
    Ok(())
}
fn recover(base:&Path,python:&Path,script:&Path)->Result<Value,String>{
    dirs(base)?;let mut c=db(base)?;
    let mut stmt=c.prepare("SELECT op,phase FROM journal ORDER BY op").map_err(|e|e.to_string())?;
    let entries:Vec<(String,String)>=stmt.query_map([],|r|Ok((r.get(0)?,r.get(1)?))).map_err(|e|e.to_string())?.map(|r|r.unwrap()).collect();drop(stmt);
    let mut committed=Vec::new();let mut interrupted=Vec::new();let mut orphans=Vec::new();
    let mut w=worker(python,script,base,2)?;
    let list=request(&mut w,"list_representations","list","")?;
    let tables:HashSet<String>=list["tables"].as_array().ok_or("no table list")?.iter().filter_map(|v|v.as_str().map(str::to_string)).collect();
    for (op,p) in entries {
        if p=="committed" {committed.push(op);continue}
        let tx=c.transaction().map_err(|e|e.to_string())?;
        tx.execute("UPDATE executions SET status='interrupted' WHERE op=?1 AND status!='succeeded'",params![op]).map_err(|e|e.to_string())?;
        tx.execute("UPDATE journal SET phase='reconciled' WHERE op=?1",params![op]).map_err(|e|e.to_string())?;
        tx.commit().map_err(|e|e.to_string())?;
        if tables.contains(&format!("rep_{op}")) {let ans=request(&mut w,"quarantine_representation","quarantine",&op)?;if ans["kind"]!="ok" {return Err("quarantine failed".into())}orphans.push(format!("representation:{op}"));}
        for folder in ["staging","artifacts"] {let p=base.join(folder).join(format!("{op}.txt"));if p.exists(){let dest=base.join("quarantine").join(format!("{folder}_{op}.txt"));fs::rename(p,dest).map_err(|e|e.to_string())?;orphans.push(format!("{folder}:{op}"));}}
        interrupted.push(op);
    }
    Ok(json!({"committed":committed,"interrupted":interrupted,"orphans":orphans}))
}
fn ipc(base:&Path,python:&Path,script:&Path)->Result<Value,String>{
    fs::create_dir_all(base).map_err(|e|e.to_string())?;
    let bad_hello=Worker::start(python,script,base,99).is_err();
    let mut w=worker(python,script,base,1)?;let mut results=Vec::new();
    results.push(json!({"case":"handshake_major_mismatch","pass":bad_hello}));
    w.send(json!({"kind":"echo","request_id":"a","value":1}))?;w.send(json!({"kind":"echo","request_id":"b","value":2}))?;
    let a=w.recv(3000)?;let b=w.recv(3000)?;results.push(json!({"case":"correlation_concurrent","pass":a["request_id"]=="a"&&b["request_id"]=="b"&&a["value"]==1&&b["value"]==2}));
    let unknown=request(&mut w,"unknown","u","")?;results.push(json!({"case":"unknown_type","pass":unknown["code"]=="unsupported_capability"}));
    w.send(json!({"kind":"duplicate","request_id":"d"}))?;let d1=w.recv(3000)?;let d2=w.recv(3000)?;let mut seen=HashSet::new();let accepted=seen.insert(d1["request_id"].as_str().unwrap_or(""));let duplicate=!seen.insert(d2["request_id"].as_str().unwrap_or(""));results.push(json!({"case":"duplicate_response","pass":accepted&&duplicate}));
    let wrong_bytes=serde_json::to_vec(&json!({"kind":"echo","request_id":"wrong","major":2,"generation":1})).map_err(|e|e.to_string())?;write_frame(&mut w.input,&wrong_bytes)?;let wrong=w.recv(3000)?;results.push(json!({"case":"version_mismatch","pass":wrong["code"]=="version_or_generation"}));
    let split=serde_json::to_vec(&json!({"kind":"echo","request_id":"split","major":1,"generation":1,"value":7})).map_err(|e|e.to_string())?;let head=(split.len() as u32).to_be_bytes();w.input.write_all(&head[..2]).map_err(|e|e.to_string())?;w.input.flush().map_err(|e|e.to_string())?;thread::sleep(Duration::from_millis(5));w.input.write_all(&head[2..]).map_err(|e|e.to_string())?;w.input.write_all(&split[..3]).map_err(|e|e.to_string())?;w.input.flush().map_err(|e|e.to_string())?;thread::sleep(Duration::from_millis(5));w.input.write_all(&split[3..]).and_then(|_|w.input.flush()).map_err(|e|e.to_string())?;let split_reply=w.recv(3000)?;results.push(json!({"case":"partial_frame","pass":split_reply["request_id"]=="split"&&split_reply["value"]==7}));
    w.send(json!({"kind":"echo","request_id":"same","value":1}))?;w.send(json!({"kind":"echo","request_id":"same","value":1}))?;let dup_req1=w.recv(3000)?;let dup_req2=w.recv(3000)?;let mut accepted_requests=HashSet::new();let first=accepted_requests.insert(dup_req1["request_id"].as_str().unwrap_or(""));let second=accepted_requests.insert(dup_req2["request_id"].as_str().unwrap_or(""));results.push(json!({"case":"duplicate_request_detected_by_host","pass":first&&!second}));
    w.send(json!({"kind":"defer","request_id":"first","value":1}))?;w.send(json!({"kind":"echo","request_id":"second","value":2}))?;let out1=w.recv(3000)?;let out2=w.recv(3000)?;results.push(json!({"case":"out_of_order_correlation","pass":out1["request_id"]=="second"&&out2["request_id"]=="first"&&out1["value"]==2&&out2["value"]==1}));
    let mut malformed=Vec::new();malformed.extend_from_slice(&1u32.to_be_bytes());malformed.push(b'{');w.input.write_all(&malformed).map_err(|e|e.to_string())?;let bad=w.recv(3000)?;results.push(json!({"case":"malformed","pass":bad["code"]=="malformed"}));
    w.input.write_all(&((MAX+1) as u32).to_be_bytes()).map_err(|e|e.to_string())?;let too_big=w.recv(3000)?;results.push(json!({"case":"oversized","pass":too_big["code"]=="oversized"}));
    drop(w);
    let mut w2=worker(python,script,base,2)?;let r=request(&mut w2,"echo","new","")?;results.push(json!({"case":"restart","pass":r["generation"]==2}));
    w2.send(json!({"kind":"long_start","request_id":"job"}))?;let running=w2.recv(100).is_err();w2.send(json!({"kind":"cancel","request_id":"cancel_job","target":"job"}))?;let ack=w2.recv(3000)?;let no_success=w2.recv(2200).is_err();results.push(json!({"case":"cancel_during_execution","pass":running&&ack["kind"]=="cancelled"&&no_success}));
    w2.send(json!({"kind":"sleep","request_id":"slow"}))?;let timed_out=w2.recv(100).is_err();let mut state="running";if timed_out{state="cancel_requested"}let late=w2.recv(2500)?;let accepted=state=="running";results.push(json!({"case":"late_after_cancel_request","pass":timed_out&&late["request_id"]=="slow"&&!accepted&&state=="cancel_requested"}));w2.stop();
    let mut w3=worker(python,script,base,3)?;w3.send(json!({"kind":"sleep","request_id":"terminate"}))?;let pending=w3.recv(100).is_err();w3.stop();let mut w4=worker(python,script,base,4)?;let after=request(&mut w4,"echo","after_cancel","")?;results.push(json!({"case":"cancel_by_process_termination","pass":pending&&after["generation"]==4}));
    let transition_base=base.join("transition");let conn=db(&transition_base)?;conn.execute("INSERT INTO journal VALUES ('t','k','prepared',1)",[]).map_err(|e|e.to_string())?;results.push(json!({"case":"invalid_transition","pass":phase(&conn,"t","outputs_verified").is_err()}));
    Ok(json!({"tests":results}))
}
fn main()->Result<(),String>{let a:Vec<String>=env::args().collect();if a.len()<5{return Err("usage: binary MODE BASE PYTHON WORKER [SCENARIO OP]".into())}let mode=&a[1];let base=PathBuf::from(&a[2]);let python=PathBuf::from(&a[3]);let script=PathBuf::from(&a[4]);let t=Instant::now();let result=match mode.as_str(){"case"=>{if a.len()<7{return Err("missing scenario/op".into())}run_case(&base,&python,&script,&a[5],&a[6])?;json!({"scenario":a[5],"op":a[6],"elapsed_ms":t.elapsed().as_millis()})},"recover"=>recover(&base,&python,&script)?,"ipc"=>ipc(&base,&python,&script)?,"versions"=>json!({"sqlite_bundled":rusqlite::version()}),_=>return Err("unknown mode".into())};println!("{}",result);Ok(())}
