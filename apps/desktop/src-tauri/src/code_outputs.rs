use std::path::Path;

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::{db, error, storage_error, Result};

const MAX_SNAPSHOT_BYTES: usize = 2 * 1024 * 1024;

#[derive(Serialize, Deserialize)]
struct Snapshot<T> { version: u32, kind: String, value: T }

#[derive(Debug, Serialize)]
pub(super) struct SavedOutput {
    pub(super) block_id: String, pub(super) execution_id: String, pub(super) kind: String, pub(super) code: String,
    pub(super) status: String, pub(super) value: serde_json::Value,
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
}
