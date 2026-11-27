use std::path::Path;
use std::collections::HashSet;

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::{db, error, storage_error, Result};
use crate::analytics::{PythonTable, ResultColumn};

const MAX_SNAPSHOT_BYTES: usize = 2 * 1024 * 1024;

#[derive(Serialize, Deserialize)]
struct Snapshot<T> { version: u32, kind: String, value: T }

#[derive(Debug, Serialize)]
pub(super) struct SavedOutput {
    pub(super) block_id: String, pub(super) execution_id: String, pub(super) kind: String, pub(super) code: String,
    pub(super) status: String, pub(super) value: serde_json::Value,
}

#[derive(Debug, Serialize)]
pub(super) struct OutputUsage { pub(super) total_bytes: u64, pub(super) reclaimable_bytes: u64, pub(super) reclaimable_blobs: u64 }

pub(super) fn clear(project: &Path, notebook: &str, block: Option<&str>) -> Result<()> {
    let mut conn = db(project)?;
    let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate).map_err(|_| storage_error())?;
    let exists: i64 = tx.query_row("SELECT COUNT(*) FROM notebooks WHERE id=?1",[notebook],|r|r.get(0)).map_err(|_|storage_error())?;
    if exists == 0 { return Err(error("notebook_missing","This notebook is not in the active project.")); }
    if let Some(id) = block {
        let valid: i64 = tx.query_row("SELECT COUNT(*) FROM notebook_blocks WHERE id=?1 AND notebook_id=?2 AND kind='code'",params![id,notebook],|r|r.get(0)).map_err(|_|storage_error())?;
        if valid == 0 { return Err(error("invalid_block","Choose a Code cell in this notebook.")); }
        tx.execute("DELETE FROM code_execution_outputs WHERE block_id=?1",[id]).map_err(|_|storage_error())?;
    } else {
        tx.execute("DELETE FROM code_execution_outputs WHERE block_id IN (SELECT id FROM notebook_blocks WHERE notebook_id=?1 AND kind='code')",[notebook]).map_err(|_|storage_error())?;
    }
    tx.commit().map_err(|_|storage_error())
}

fn referenced_blobs(conn: &Connection) -> Result<HashSet<String>> {
    let mut keep = HashSet::new();
    let mut stmt = conn.prepare("SELECT o.payload_hash,b.payload FROM code_execution_outputs o JOIN notebook_blocks n ON n.id=o.block_id AND n.kind='code' JOIN executions e ON e.id=o.execution_id LEFT JOIN code_output_blobs b ON b.hash=o.payload_hash").map_err(|_|storage_error())?;
    let rows = stmt.query_map([],|r|Ok((r.get::<_,String>(0)?,r.get::<_,Option<Vec<u8>>>(1)?))).map_err(|_|storage_error())?;
    for row in rows {
        let (hash,payload)=row.map_err(|_|storage_error())?;
        let payload=payload.ok_or_else(||error("damaged_output","A referenced Code output is missing."))?;
        if payload.len()>MAX_SNAPSHOT_BYTES || format!("{:x}",Sha256::digest(&payload))!=hash { return Err(error("damaged_output","A referenced Code output is damaged.")); }
        let snapshot:Snapshot<serde_json::Value>=serde_json::from_slice(&payload).map_err(|_|error("damaged_output","A referenced Code output is damaged."))?;
        if snapshot.version!=1 || !matches!(snapshot.kind.as_str(),"sql"|"python") { return Err(error("damaged_output","A referenced Code output is damaged.")); }
        keep.insert(hash);
        if snapshot.kind=="python" && !snapshot.value.get("outputs").is_some_and(|v|v.is_array()) { return Err(error("damaged_output","A referenced Code output is damaged.")); }
        if let Some(outputs)=snapshot.value.get("outputs").and_then(|v|v.as_array()) {
            for output in outputs {
                if output.get("data_ref").is_some_and(|value|!value.is_string()) { return Err(error("damaged_output","A referenced Code output is damaged.")); }
                if let Some(image)=output.get("data_ref").and_then(|v|v.as_str()) { keep.insert(image.to_string()); }
            }
        }
    }
    for hash in &keep {
        let exists:i64=conn.query_row("SELECT COUNT(*) FROM code_output_blobs WHERE hash=?1",[hash],|r|r.get(0)).map_err(|_|storage_error())?;
        if exists==0 { return Err(error("damaged_output","A referenced Code image is missing.")); }
    }
    crate::named_results::referenced_hashes(conn,&mut keep)?;
    Ok(keep)
}

fn usage_in(conn: &Connection, keep: &HashSet<String>) -> Result<OutputUsage> {
    let mut usage=OutputUsage {total_bytes:0,reclaimable_bytes:0,reclaimable_blobs:0};
    let mut stmt=conn.prepare("SELECT hash,length(payload) FROM code_output_blobs").map_err(|_|storage_error())?;
    let rows=stmt.query_map([],|r|Ok((r.get::<_,String>(0)?,r.get::<_,u64>(1)?))).map_err(|_|storage_error())?;
    for row in rows { let (hash,bytes)=row.map_err(|_|storage_error())?; usage.total_bytes+=bytes;
        if !keep.contains(&hash) {usage.reclaimable_bytes+=bytes;usage.reclaimable_blobs+=1;}
    }
    Ok(usage)
}

pub(super) fn usage(project: &Path) -> Result<OutputUsage> {
    let conn=db(project)?; let keep=referenced_blobs(&conn)?; usage_in(&conn,&keep)
}

pub(super) fn cleanup(project: &Path) -> Result<OutputUsage> {
    let mut conn=db(project)?;
    let tx=conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate).map_err(|_|storage_error())?;
    tx.execute("DELETE FROM code_execution_outputs WHERE NOT EXISTS (SELECT 1 FROM notebook_blocks n WHERE n.id=block_id AND n.kind='code') OR NOT EXISTS (SELECT 1 FROM executions e WHERE e.id=execution_id)",[]).map_err(|_|storage_error())?;
    let keep=referenced_blobs(&tx)?;
    let before=usage_in(&tx,&keep)?;
    let hashes:Vec<String>={
        let mut stmt=tx.prepare("SELECT hash FROM code_output_blobs").map_err(|_|storage_error())?;
        let found=stmt.query_map([],|r|r.get::<_,String>(0)).map_err(|_|storage_error())?.collect::<std::result::Result<_,_>>().map_err(|_|storage_error())?;
        found
    };
    for hash in hashes { if !keep.contains(&hash) { tx.execute("DELETE FROM code_output_blobs WHERE hash=?1",[hash]).map_err(|_|storage_error())?; } }
    tx.commit().map_err(|_|storage_error())?;
    Ok(before)
}

pub(super) fn create_tables(conn: &Connection) -> Result<()> {
    conn.execute_batch("CREATE TABLE code_output_blobs (
            hash TEXT PRIMARY KEY, payload BLOB NOT NULL);
        CREATE TABLE code_execution_outputs (
            execution_id TEXT PRIMARY KEY REFERENCES executions(id),
            block_id TEXT NOT NULL, payload_hash TEXT NOT NULL REFERENCES code_output_blobs(hash));")
        .map_err(|_| storage_error())
}

pub(super) fn store<T: Serialize>(conn: &Connection, block: &str, execution: &str, kind: &str, value: &T) -> Result<()> {
    let mut value = serde_json::to_value(value).map_err(|_| storage_error())?;
    let full = serde_json::to_vec(&value).map_err(|_| storage_error())?;
    if full.len() > MAX_SNAPSHOT_BYTES { return Err(error("output_limit", "The saved Code output exceeds 2 MiB.")); }
    let mut images = Vec::new();
    if let Some(outputs) = value.get_mut("outputs").and_then(|v|v.as_array_mut()) {
        for output in outputs {
            if let Some(data) = output.get("data").and_then(|v|v.as_str()).filter(|s|s.len()>32*1024) {
                let bytes = data.as_bytes().to_vec();
                let image_hash = format!("{:x}",Sha256::digest(&bytes));
                images.push((image_hash.clone(),bytes));
                output.as_object_mut().unwrap().remove("data");
                output["data_ref"] = serde_json::Value::String(image_hash);
            }
        }
    }
    let payload = serde_json::to_vec(&Snapshot { version: 1, kind: kind.into(), value }).map_err(|_| storage_error())?;
    let hash = format!("{:x}", Sha256::digest(&payload));
    let tx = conn.unchecked_transaction().map_err(|_| storage_error())?;
    for (image_hash,bytes) in images {
        tx.execute("INSERT OR IGNORE INTO code_output_blobs(hash,payload) VALUES (?1,?2)",params![image_hash,bytes]).map_err(|_| storage_error())?;
    }
    tx.execute("INSERT OR IGNORE INTO code_output_blobs(hash,payload) VALUES (?1,?2)", params![hash,payload]).map_err(|_| storage_error())?;
    let inserted = tx.execute("INSERT INTO code_execution_outputs(execution_id,block_id,payload_hash)
        SELECT e.id,?2,?3 FROM executions e JOIN notebook_blocks b ON b.id=?2
        WHERE e.id=?1 AND e.operation_type=?4 AND b.kind='code'", params![execution,block,hash,kind])
        .map_err(|_| storage_error())?;
    if inserted != 1 { return Err(error("invalid_execution", "Code output must belong to a saved execution and Code cell.")); }
    tx.commit().map_err(|_| storage_error())?;
    Ok(())
}

pub(super) fn load(project: &Path, notebook: &str) -> Result<Vec<SavedOutput>> {
    let conn = db(project)?;
    let mut stmt = conn.prepare("SELECT b.id,e.id,e.operation_type,e.parameters,e.status,o.payload_hash,h.payload
        FROM notebook_blocks b JOIN code_execution_outputs o ON o.block_id=b.id
        JOIN executions e ON e.id=o.execution_id JOIN code_output_blobs h ON h.hash=o.payload_hash
        WHERE b.notebook_id=?1 AND b.kind='code' AND e.id=(
            SELECT latest.id FROM executions latest JOIN code_execution_outputs saved ON saved.execution_id=latest.id
            WHERE saved.block_id=b.id ORDER BY latest.started_at DESC,latest.rowid DESC LIMIT 1)")
        .map_err(|_| storage_error())?;
    let rows = stmt.query_map([notebook], |r| Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,String>(2)?,r.get::<_,String>(3)?,r.get::<_,String>(4)?,r.get::<_,String>(5)?,r.get::<_,Vec<u8>>(6)?)))
        .map_err(|_| storage_error())?;
    let mut saved = Vec::new();
    for row in rows {
        let (block_id,execution_id,kind,parameters,status,hash,payload) = row.map_err(|_| storage_error())?;
        if payload.len() > MAX_SNAPSHOT_BYTES || format!("{:x}",Sha256::digest(&payload)) != hash {
            return Err(error("damaged_output", "Saved Code output is damaged."));
        }
        let mut snapshot: Snapshot<serde_json::Value> = serde_json::from_slice(&payload).map_err(|_| error("damaged_output", "Saved Code output is damaged."))?;
        if snapshot.version != 1 || snapshot.kind != kind { return Err(error("damaged_output", "Saved Code output is damaged.")); }
        let mut expanded_bytes = payload.len();
        if let Some(outputs) = snapshot.value.get_mut("outputs").and_then(|v|v.as_array_mut()) {
            for output in outputs {
                let Some(image_hash) = output.get("data_ref").and_then(|v|v.as_str()) else { continue };
                let bytes: Vec<u8> = conn.query_row("SELECT payload FROM code_output_blobs WHERE hash=?1",[image_hash],|r|r.get(0))
                    .map_err(|_| error("damaged_output", "Saved Code image is missing."))?;
                if bytes.len()>MAX_SNAPSHOT_BYTES || format!("{:x}",Sha256::digest(&bytes))!=image_hash {
                    return Err(error("damaged_output", "Saved Code image is damaged."));
                }
                expanded_bytes += bytes.len();
                if expanded_bytes > MAX_SNAPSHOT_BYTES { return Err(error("damaged_output", "Saved Code output exceeds the limit.")); }
                let data = String::from_utf8(bytes).map_err(|_| error("damaged_output", "Saved Code image is damaged."))?;
                output.as_object_mut().unwrap().remove("data_ref");
                output["data"] = serde_json::Value::String(data);
            }
        }
        let parameters: serde_json::Value = serde_json::from_str(&parameters).map_err(|_| storage_error())?;
        let code = parameters.get(if kind == "python" { "code" } else { "sql" }).and_then(|v|v.as_str()).unwrap_or_default().to_string();
        saved.push(SavedOutput { block_id,execution_id,kind,code,status,value:snapshot.value });
    }
    Ok(saved)
}

pub(super) fn sql_for_python(project: &Path, execution_id: &str) -> Result<PythonTable> {
    let conn=db(project)?;
    let unavailable=||error("sql_output_unavailable","Choose a successful SQL execution with saved output in this project.");
    let (hash,payload,fingerprint,representation,version): (String,Vec<u8>,String,String,String)=conn.query_row(
        "SELECT o.payload_hash,b.payload,e.source_fingerprint,e.representation_id,e.duckdb_version
         FROM executions e JOIN code_execution_outputs o ON o.execution_id=e.id
         JOIN code_output_blobs b ON b.hash=o.payload_hash
         WHERE e.id=?1 AND e.project_id=(SELECT id FROM project LIMIT 1)
           AND e.operation_type='sql' AND e.status='succeeded'",[execution_id],
        |r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?))).map_err(|_|unavailable())?;
    if payload.len()>MAX_SNAPSHOT_BYTES || format!("{:x}",Sha256::digest(&payload))!=hash { return Err(unavailable()); }
    let snapshot:Snapshot<serde_json::Value>=serde_json::from_slice(&payload).map_err(|_|unavailable())?;
    if snapshot.version!=1 || snapshot.kind!="sql" { return Err(unavailable()); }
    let columns:Vec<ResultColumn>=serde_json::from_value(snapshot.value["columns"].clone()).map_err(|_|unavailable())?;
    let rows:Vec<Vec<Option<String>>>=serde_json::from_value(snapshot.value["rows"].clone()).map_err(|_|unavailable())?;
    let bytes=columns.iter().map(|c|c.name.len()).sum::<usize>()+rows.iter().flatten().flatten().map(String::len).sum::<usize>();
    let mut names=HashSet::new();
    if columns.is_empty() || columns.len()>128 || rows.len()>200 || rows.iter().any(|r|r.len()!=columns.len()) || bytes>1024*1024 ||
        columns.iter().any(|c|c.name.is_empty() || !names.insert(c.name.to_ascii_lowercase()) || !matches!(c.data_type.as_str(),"text"|"integer"|"decimal"|"boolean")) {
        return Err(unavailable());
    }
    let has_more=snapshot.value["has_more"].as_bool().ok_or_else(unavailable)?;
    if has_more { return Err(error("input_limit","The saved SQL output is truncated and cannot be used as a complete Python input. Filter or aggregate it first.")); }
    Ok(PythonTable { kind:"sql_result".into(),id:execution_id.into(),name:None,columns,rows,
        has_more:false,
        source_fingerprint:fingerprint,representation_id:representation,duckdb_version:version })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{create_project_inner, notebook};

    #[test]
    fn snapshots_survive_reopen_and_edits_without_duplicate_blobs() {
        let root=std::env::temp_dir().join(format!("dataforge-output-test-{}",uuid::Uuid::new_v4()));
        std::fs::create_dir(&root).unwrap();
        let project=create_project_inner("Outputs",root.to_str().unwrap()).unwrap();
        let path=Path::new(&project.project.path);
        let note=serde_json::to_value(notebook::create_notebook_inner(path,"Test").unwrap()).unwrap();
        let note_id=note["id"].as_str().unwrap();
        let block=serde_json::to_value(notebook::add_block_inner(path,note_id,"code","print(1)",None,None,None,Some("python")).unwrap()).unwrap();
        let block_id=block["id"].as_str().unwrap();
        let conn=db(path).unwrap();
        let payload=serde_json::json!({"outputs":[{"kind":"image","mime":"image/png","data":"A".repeat(40_000),"text":"chart"}],"count":1});
        for id in ["first","second"] {
            conn.execute("INSERT INTO executions(id,project_id,dataset_id,source_fingerprint,operation_type,parameters,started_at,status,schema_version)
                VALUES(?1,?2,'','','python',?3,?4,'succeeded',3)",params![id,project.project.id,"{\"code\":\"print(1)\"}",crate::now()]).unwrap();
            store(&conn,block_id,id,"python",&payload).unwrap();
        }
        assert_eq!(conn.query_row("SELECT COUNT(*) FROM code_output_blobs",[],|r|r.get::<_,i64>(0)).unwrap(),2);
        crate::open_project_inner(&project.project.path).unwrap();
        assert_eq!(load(path,note_id).unwrap().len(),1);
        notebook::update_block_inner(path,block_id,"print(2)",Some("python")).unwrap();
        let restored=load(path,note_id).unwrap();
        assert_eq!(restored[0].code,"print(1)");
        assert_eq!(restored[0].value,payload);
        assert_eq!(serde_json::to_value(notebook::get_notebook_inner(path,note_id).unwrap()).unwrap()["blocks"][0]["content"],"print(2)");
        assert!(store(&conn,"missing","first","python",&payload).is_err());
        assert_eq!(store(&conn,block_id,"missing","python",&payload).unwrap_err().code,"invalid_execution");
        assert_eq!(store(&conn,block_id,"missing","python",&serde_json::json!({"text":"x".repeat(MAX_SNAPSHOT_BYTES)})).unwrap_err().code,"output_limit");
        conn.execute("UPDATE code_output_blobs SET payload=X'00' WHERE hash=(SELECT payload_hash FROM code_execution_outputs WHERE execution_id='second')",[]).unwrap();
        assert_eq!(load(path,note_id).unwrap_err().code,"damaged_output");
        drop(conn); std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn clear_and_cleanup_preserve_shared_blobs_history_and_rollback() {
        let root=std::env::temp_dir().join(format!("dataforge-cleanup-test-{}",uuid::Uuid::new_v4()));
        std::fs::create_dir(&root).unwrap();
        let project=create_project_inner("Cleanup",root.to_str().unwrap()).unwrap();
        let path=Path::new(&project.project.path);
        let note=notebook::create_notebook_inner(path,"Test").unwrap();
        let note_id=serde_json::to_value(note).unwrap()["id"].as_str().unwrap().to_string();
        let first=notebook::add_block_inner(path,&note_id,"code","print(1)",None,None,None,Some("python")).unwrap();
        let second=notebook::add_block_inner(path,&note_id,"code","print(2)",None,None,None,Some("python")).unwrap();
        let first_id=serde_json::to_value(first).unwrap()["id"].as_str().unwrap().to_string();
        let second_id=serde_json::to_value(second).unwrap()["id"].as_str().unwrap().to_string();
        let conn=db(path).unwrap();
        let image=serde_json::json!({"kind":"image","mime":"image/png","data":"A".repeat(40_000),"text":"chart"});
        for (id,block) in [("first",&first_id),("second",&second_id)] {
            conn.execute("INSERT INTO executions(id,project_id,dataset_id,source_fingerprint,operation_type,parameters,started_at,status,schema_version)
                VALUES(?1,?2,'','','python','{}',?3,'succeeded',3)",params![id,project.project.id,crate::now()]).unwrap();
            store(&conn,block,id,"python",&serde_json::json!({"outputs":[image],"count":id})).unwrap();
        }
        assert_eq!(usage(path).unwrap().total_bytes>40_000,true);
        clear(path,&note_id,Some(&first_id)).unwrap();
        assert_eq!(load(path,&note_id).unwrap().len(),1);
        assert_eq!(cleanup(path).unwrap().reclaimable_blobs,1);
        assert_eq!(load(path,&note_id).unwrap()[0].value["outputs"][0]["data"],"A".repeat(40_000));
        assert_eq!(conn.query_row("SELECT COUNT(*) FROM executions",[],|r|r.get::<_,i64>(0)).unwrap(),2);
        assert_eq!(clear(path,&note_id,Some("other-project-cell")).unwrap_err().code,"invalid_block");
        clear(path,&note_id,None).unwrap();
        assert_eq!(load(path,&note_id).unwrap().len(),0);
        crate::open_project_inner(&project.project.path).unwrap();
        assert_eq!(load(path,&note_id).unwrap().len(),0);
        assert_eq!(usage(path).unwrap().reclaimable_blobs,2);
        conn.execute_batch("CREATE TRIGGER deny_blob_delete AFTER DELETE ON code_output_blobs WHEN (SELECT COUNT(*) FROM code_output_blobs)=0 BEGIN SELECT RAISE(ABORT,'denied'); END;").unwrap();
        assert!(cleanup(path).is_err());
        assert_eq!(usage(path).unwrap().reclaimable_blobs,2);
        conn.execute_batch("DROP TRIGGER deny_blob_delete").unwrap();
        assert_eq!(cleanup(path).unwrap().reclaimable_blobs,2);
        assert_eq!(usage(path).unwrap().total_bytes,0);
        assert_eq!(conn.query_row("SELECT COUNT(*) FROM executions",[],|r|r.get::<_,i64>(0)).unwrap(),2);
        drop(conn); std::fs::remove_dir_all(root).unwrap();
    }
}
