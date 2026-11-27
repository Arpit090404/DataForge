use std::{collections::HashSet, path::Path};

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::{analytics::{PythonTable, ResultColumn}, db, error, now, storage_error, Result};

const MAX_TABLE_BYTES: usize = 1024 * 1024;

#[derive(Clone, Debug, Serialize)]
pub(super) struct NamedResult {
    pub(super) id: String,
    pub(super) name: Option<String>,
    pub(super) execution_id: String,
    pub(super) created_at: String,
    pub(super) available: bool,
    pub(super) stale: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub(super) struct Table {
    pub(super) columns: Vec<ResultColumn>,
    pub(super) rows: Vec<Vec<Option<String>>>,
}

pub(super) fn create_tables(conn: &Connection) -> Result<()> {
    conn.execute_batch("CREATE TABLE IF NOT EXISTS named_results (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL, name TEXT COLLATE NOCASE UNIQUE,
        execution_id TEXT NOT NULL REFERENCES executions(id), payload_hash TEXT REFERENCES code_output_blobs(hash),
        created_at TEXT NOT NULL, deleted_at TEXT);") .map_err(|_|storage_error())
}

fn valid_name(name: &str) -> bool {
    name.len() <= 64 && name.len() >= 2 && name.bytes().next().is_some_and(|ch|ch.is_ascii_alphabetic())
        && name.bytes().all(|ch|ch.is_ascii_alphanumeric() || ch==b'_')
        && !name.eq_ignore_ascii_case("source") && !name.to_ascii_lowercase().starts_with("dataset_")
        && !name.to_ascii_lowercase().starts_with("result_")
}

pub(super) fn validate_table(table: &Table) -> Result<()> {
    let mut names=HashSet::new();
    if table.columns.is_empty() || table.columns.len()>128 || table.rows.len()>200 ||
        table.columns.iter().any(|c|c.name.is_empty() || c.name.len()>255 || !names.insert(c.name.to_lowercase()) ||
            !matches!(c.data_type.as_str(),"text"|"integer"|"decimal"|"boolean")) ||
        table.rows.iter().any(|row|row.len()!=table.columns.len()) ||
        serde_json::to_vec(table).map_err(|_|storage_error())?.len()>MAX_TABLE_BYTES {
        return Err(error("result_limit","A named result must be a complete table of at most 200 rows, 128 unique columns, and 1 MiB."));
    }
    Ok(())
}

pub(super) fn publish(conn: &Connection, name: &str, execution: &str, table: &Table, sql_output_hash: Option<&str>) -> Result<NamedResult> {
    Ok(publish_many(conn,execution,&[(name.to_string(),table.clone(),sql_output_hash.map(str::to_string))])?.remove(0))
}

pub(super) fn publish_many(conn: &Connection, execution: &str, items: &[(String,Table,Option<String>)]) -> Result<Vec<NamedResult>> {
    let (project_id,status):(String,String)=conn.query_row("SELECT project_id,status FROM executions WHERE id=?1 AND project_id=(SELECT id FROM project LIMIT 1)",[execution],|r|Ok((r.get(0)?,r.get(1)?)))
        .map_err(|_|error("invalid_execution","The execution is not in this project."))?;
    if status!="succeeded" { return Err(error("invalid_execution","Only a completed successful run can publish a result.")); }
    validate_publications(conn,items)?;
    let tx=conn.unchecked_transaction().map_err(|_|storage_error())?;
    let mut published=Vec::new();
    for (name,table,sql_output_hash) in items {
        let payload=serde_json::to_vec(table).map_err(|_|storage_error())?;
        let hash=sql_output_hash.clone().unwrap_or_else(||format!("{:x}",Sha256::digest(&payload)));
        if sql_output_hash.is_none() { tx.execute("INSERT OR IGNORE INTO code_output_blobs(hash,payload) VALUES (?1,?2)",params![hash,payload]).map_err(|_|storage_error())?; }
        else {
            let exists:i64=tx.query_row("SELECT COUNT(*) FROM code_output_blobs WHERE hash=?1",[&hash],|r|r.get(0)).map_err(|_|storage_error())?;
            if exists!=1 { return Err(error("result_unavailable","The saved SQL output is unavailable.")); }
        }
        let id=uuid::Uuid::new_v4().to_string(); let created_at=now();
        tx.execute("UPDATE named_results SET name=NULL WHERE name=?1 COLLATE NOCASE",[name]).map_err(|_|storage_error())?;
        tx.execute("INSERT INTO named_results(id,project_id,name,execution_id,payload_hash,created_at) VALUES (?1,?2,?3,?4,?5,?6)",
            params![id,project_id,name,execution,hash,created_at]).map_err(|_|storage_error())?;
        published.push(NamedResult{id,name:Some(name.clone()),execution_id:execution.into(),created_at,available:true,stale:false});
    }
    tx.commit().map_err(|_|storage_error())?;
    Ok(published)
}

pub(super) fn validate_publications(conn: &Connection, items: &[(String,Table,Option<String>)]) -> Result<()> {
    if items.len()>4 {return Err(error("result_limit","A Python cell can publish at most four named results."));}
    let mut names=HashSet::new();
    for (name,table,_) in items {
        if !valid_name(name) { return Err(error("invalid_result_name","Use 2–64 letters, digits, or underscores, starting with a letter; source, dataset_, and result_ are reserved.")); }
        if !names.insert(name.to_lowercase()) {return Err(error("result_name_conflict","Publish each result name once per run."));}
        validate_table(table)?;
        let dataset_collision:i64=conn.query_row("SELECT COUNT(*) FROM datasets WHERE name=?1 COLLATE NOCASE",[name],|r|r.get(0)).map_err(|_|storage_error())?;
        if dataset_collision!=0 { return Err(error("result_name_conflict","A registered dataset already has this name.")); }
    }
    Ok(())
}

pub(super) fn list(project: &Path) -> Result<Vec<NamedResult>> {
    let conn=db(project)?;
    let datasets=crate::list_datasets_inner(&conn)?;
    let mut stmt=conn.prepare("SELECT n.id,n.name,n.execution_id,n.created_at,n.payload_hash IS NOT NULL,e.parameters FROM named_results n JOIN executions e ON e.id=n.execution_id WHERE n.project_id=(SELECT id FROM project LIMIT 1) ORDER BY n.created_at DESC,n.id DESC").map_err(|_|storage_error())?;
    let results=stmt.query_map([],|r|{
        let name:Option<String>=r.get(1)?;
        let parameters:String=r.get(5)?;
        let recorded:serde_json::Value=serde_json::from_str(&parameters).unwrap_or_default();
        let inputs=recorded["inputs"].as_array();
        let stale=name.is_none() || inputs.is_none_or(|items|items.iter().any(|input| {
            let Some(dataset_id)=input.get("dataset_id").or_else(||if input["kind"]=="dataset" {input.get("id")} else {None}).and_then(|id|id.as_str()) else {return false};
            datasets.iter().find(|dataset|dataset.id==dataset_id).is_none_or(|dataset|dataset.status!="ready")
        }));
        Ok(NamedResult{id:r.get(0)?,name,execution_id:r.get(2)?,created_at:r.get(3)?,available:r.get(4)?,stale})
    })
        .map_err(|_|storage_error())?.collect::<std::result::Result<Vec<_>,_>>().map_err(|_|storage_error())?;
    Ok(results)
}

pub(super) fn resolve(conn: &Connection, name: &str) -> Result<(NamedResult, Table)> {
    let id=name.strip_prefix("result_").and_then(|simple|uuid::Uuid::parse_str(simple).ok()).map(|id|id.to_string());
    let row=conn.query_row("SELECT n.id,n.name,n.execution_id,n.created_at,n.payload_hash,b.payload FROM named_results n
        LEFT JOIN code_output_blobs b ON b.hash=n.payload_hash WHERE n.project_id=(SELECT id FROM project LIMIT 1)
        AND (n.name=?1 COLLATE NOCASE OR n.id=?2)",params![name,id],|r|Ok((r.get::<_,String>(0)?,r.get::<_,Option<String>>(1)?,r.get::<_,String>(2)?,r.get::<_,String>(3)?,r.get::<_,Option<String>>(4)?,r.get::<_,Option<Vec<u8>>>(5)?)))
        .optional().map_err(|_|storage_error())?.ok_or_else(||error("result_missing","No published result has that name or ID."))?;
    let (id,name,execution_id,created_at,hash,payload)=row;
    let (Some(hash),Some(payload))=(hash,payload) else { return Err(error("result_unavailable","This result was released or its storage is missing.")); };
    if payload.len()>2*MAX_TABLE_BYTES || format!("{:x}",Sha256::digest(&payload))!=hash { return Err(error("result_unavailable","The saved result is damaged.")); }
    let table=if let Ok(table)=serde_json::from_slice::<Table>(&payload) {table} else {
        let snapshot:serde_json::Value=serde_json::from_slice(&payload).map_err(|_|error("result_unavailable","The saved result is damaged."))?;
        if snapshot["version"]!=1 || snapshot["kind"]!="sql" || snapshot["value"]["has_more"]!=false { return Err(error("result_unavailable","The saved result is incomplete.")); }
        serde_json::from_value(snapshot["value"].clone()).map_err(|_|error("result_unavailable","The saved result is damaged."))?
    };
    validate_table(&table)?;
    Ok((NamedResult{id,name,execution_id,created_at,available:true,stale:false},table))
}

pub(super) fn for_python(project: &Path, name: &str) -> Result<PythonTable> {
    let conn=db(project)?; let (result,table)=resolve(&conn,name)?;
    Ok(PythonTable{kind:"named_result".into(),id:result.id,name:Some(name.into()),columns:table.columns,rows:table.rows,has_more:false,
        source_fingerprint:String::new(),representation_id:String::new(),duckdb_version:String::new()})
}

pub(super) fn release(project: &Path, id: &str) -> Result<()> {
    let conn=db(project)?;
    let changed=conn.execute("UPDATE named_results SET name=NULL,payload_hash=NULL,deleted_at=?1 WHERE id=?2 AND project_id=(SELECT id FROM project LIMIT 1) AND payload_hash IS NOT NULL",params![now(),id]).map_err(|_|storage_error())?;
    if changed!=1 { return Err(error("result_missing","This result is unavailable or already released.")); }
    Ok(())
}

pub(super) fn referenced_hashes(conn: &Connection, keep: &mut HashSet<String>) -> Result<()> {
    let mut stmt=conn.prepare("SELECT payload_hash FROM named_results WHERE payload_hash IS NOT NULL").map_err(|_|storage_error())?;
    for hash in stmt.query_map([],|r|r.get::<_,String>(0)).map_err(|_|storage_error())? { keep.insert(hash.map_err(|_|storage_error())?); }
    Ok(())
}
