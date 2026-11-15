use std::path::Path;

use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;

use crate::{db, error, now, AppError, Result};

const MAX_NOTEBOOKS: i64 = 50;
const MAX_BLOCKS: i64 = 200;
const MAX_CONTENT_BYTES: usize = 20_000;

#[derive(Debug, Serialize)]
pub(super) struct NotebookSummary { id: String, title: String, created_at: String, updated_at: String, block_count: i64 }
#[derive(Debug, Serialize)]
pub(super) struct Notebook { id: String, title: String, created_at: String, updated_at: String, blocks: Vec<NotebookBlock> }
#[derive(Debug, Serialize)]
pub(super) struct NotebookBlock { id: String, notebook_id: String, position: i64, kind: String, content: String,
    execution_id: Option<String>, language: Option<String>, created_at: String, updated_at: String }

pub(super) fn create_tables(conn: &Connection) -> Result<()> {
    conn.execute_batch("CREATE TABLE notebooks (
            id TEXT PRIMARY KEY, title TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
        CREATE TABLE notebook_blocks (
            id TEXT PRIMARY KEY, notebook_id TEXT NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
            position INTEGER NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('markdown','code','result')),
            content TEXT NOT NULL, execution_id TEXT, language TEXT,
            created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
            CHECK((kind='code' AND language IS NOT NULL AND language IN ('python','sql')) OR
                  (kind IN ('markdown','result') AND language IS NULL)));
        CREATE INDEX notebook_blocks_order ON notebook_blocks(notebook_id,position,id);")
        .map_err(|_| notebook_error())
}
pub(super) fn migrate_v3_to_v4(conn: &Connection) -> Result<()> {
    conn.execute_batch("CREATE TABLE notebook_blocks_v4 (
            id TEXT PRIMARY KEY, notebook_id TEXT NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
            position INTEGER NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('markdown','code','result')),
            content TEXT NOT NULL, execution_id TEXT, language TEXT,
            created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
            CHECK((kind='code' AND language IS NOT NULL AND language IN ('python','sql')) OR
                  (kind IN ('markdown','result') AND language IS NULL)));
        INSERT INTO notebook_blocks_v4(id,notebook_id,position,kind,content,execution_id,language,created_at,updated_at)
            SELECT id,notebook_id,position,kind,content,execution_id,NULL,created_at,updated_at FROM notebook_blocks;
        DROP TABLE notebook_blocks;
        ALTER TABLE notebook_blocks_v4 RENAME TO notebook_blocks;
        CREATE INDEX notebook_blocks_order ON notebook_blocks(notebook_id,position,id);")
        .map_err(|_| notebook_error())
}
fn notebook_error() -> AppError { error("notebook_error", "The notebook could not be saved or read.") }
fn title(input: &str) -> Result<String> {
    let value = input.trim();
    if value.is_empty() || value.len() > 120 || value.chars().any(char::is_control) {
        Err(error("invalid_title", "Use a notebook title of 1–120 characters."))
    } else { Ok(value.to_string()) }
}
fn source_content(input: &str) -> Result<String> {
    if input.len() > MAX_CONTENT_BYTES { Err(error("invalid_content", "Text and code cells are limited to 20 KB.")) }
    else { Ok(input.to_string()) }
}
fn code_language(language: Option<&str>) -> Result<&str> {
    match language { Some("python") => Ok("python"), Some("sql") => Ok("sql"),
        _ => Err(error("invalid_language", "Choose Python or SQL for a code cell.")) }
}
fn summary(conn: &Connection, id: &str) -> Result<NotebookSummary> {
    conn.query_row("SELECT n.id,n.title,n.created_at,n.updated_at,COUNT(b.id)
        FROM notebooks n LEFT JOIN notebook_blocks b ON b.notebook_id=n.id WHERE n.id=?1 GROUP BY n.id",[id], |r|
        Ok(NotebookSummary {id:r.get(0)?,title:r.get(1)?,created_at:r.get(2)?,updated_at:r.get(3)?,block_count:r.get(4)?}))
        .map_err(|_|error("notebook_missing","This notebook is not in the active project."))
}
fn block(conn: &Connection, id: &str) -> Result<NotebookBlock> {
    conn.query_row("SELECT id,notebook_id,position,kind,content,execution_id,language,created_at,updated_at FROM notebook_blocks WHERE id=?1",[id],|r|
        Ok(NotebookBlock {id:r.get(0)?,notebook_id:r.get(1)?,position:r.get(2)?,kind:r.get(3)?,content:r.get(4)?,
            execution_id:r.get(5)?,language:r.get(6)?,created_at:r.get(7)?,updated_at:r.get(8)?}))
        .map_err(|_|error("block_missing","This block is not in the active project."))
}
fn blocks(conn: &Connection, notebook_id: &str) -> Result<Vec<NotebookBlock>> {
    let mut stmt = conn.prepare("SELECT id,notebook_id,position,kind,content,execution_id,language,created_at,updated_at
        FROM notebook_blocks WHERE notebook_id=?1 ORDER BY position,id").map_err(|_|notebook_error())?;
    let result = stmt.query_map([notebook_id],|r| Ok(NotebookBlock {id:r.get(0)?,notebook_id:r.get(1)?,position:r.get(2)?,
        kind:r.get(3)?,content:r.get(4)?,execution_id:r.get(5)?,language:r.get(6)?,created_at:r.get(7)?,updated_at:r.get(8)?}))
        .map_err(|_|notebook_error())?.collect::<rusqlite::Result<Vec<_>>>().map_err(|_|notebook_error());
    result
}
pub(super) fn list_notebooks_inner(project: &Path) -> Result<Vec<NotebookSummary>> {
    let conn=db(project)?;
    let mut stmt=conn.prepare("SELECT n.id,n.title,n.created_at,n.updated_at,COUNT(b.id)
        FROM notebooks n LEFT JOIN notebook_blocks b ON b.notebook_id=n.id GROUP BY n.id ORDER BY n.updated_at DESC,n.id DESC")
        .map_err(|_|notebook_error())?;
    let result = stmt.query_map([],|r| Ok(NotebookSummary {id:r.get(0)?,title:r.get(1)?,created_at:r.get(2)?,updated_at:r.get(3)?,block_count:r.get(4)?}))
        .map_err(|_|notebook_error())?.collect::<rusqlite::Result<Vec<_>>>().map_err(|_|notebook_error());
    result
}
pub(super) fn get_notebook_inner(project: &Path, id: &str) -> Result<Notebook> {
    let conn=db(project)?;
    let item=summary(&conn,id)?;
    Ok(Notebook {id:item.id,title:item.title,created_at:item.created_at,updated_at:item.updated_at,blocks:blocks(&conn,id)?})
}
pub(super) fn create_notebook_inner(project: &Path, value: &str) -> Result<Notebook> {
    let value=title(value)?;
    let conn=db(project)?;
    conn.execute_batch("BEGIN IMMEDIATE").map_err(|_|notebook_error())?;
    let count:i64=conn.query_row("SELECT COUNT(*) FROM notebooks",[],|r|r.get(0)).map_err(|_|notebook_error())?;
    if count>=MAX_NOTEBOOKS {return Err(error("notebook_limit","This project has reached its 50-notebook limit."));}
    let id=uuid::Uuid::new_v4().to_string(); let timestamp=now();
    conn.execute("INSERT INTO notebooks(id,title,created_at,updated_at) VALUES(?1,?2,?3,?3)",params![id,value,timestamp])
        .map_err(|_|notebook_error())?;
    conn.execute_batch("COMMIT").map_err(|_|notebook_error())?;
    get_notebook_inner(project,&id)
}
pub(super) fn rename_notebook_inner(project: &Path, id: &str, value: &str) -> Result<Notebook> {
    let value=title(value)?;
    let conn=db(project)?;
    if conn.execute("UPDATE notebooks SET title=?1,updated_at=?2 WHERE id=?3",params![value,now(),id]).map_err(|_|notebook_error())? == 0 {
        return Err(error("notebook_missing","This notebook is not in the active project."));
    }
    get_notebook_inner(project,id)
}
pub(super) fn delete_notebook_inner(project: &Path, id: &str) -> Result<()> {
    let conn=db(project)?;
    conn.execute_batch("PRAGMA foreign_keys=ON").map_err(|_|notebook_error())?;
    if conn.execute("DELETE FROM notebooks WHERE id=?1",[id]).map_err(|_|notebook_error())? == 0 {
        return Err(error("notebook_missing","This notebook is not in the active project."));
    }
    Ok(())
}
pub(super) fn add_block_inner(project: &Path, notebook_id: &str, kind: &str, content: &str, execution_id: Option<&str>, relative_to: Option<&str>, placement: Option<&str>, language: Option<&str>) -> Result<NotebookBlock> {
    let conn=db(project)?;
    conn.execute_batch("BEGIN IMMEDIATE").map_err(|_|notebook_error())?;
    let _=summary(&conn,notebook_id)?;
    let content=match kind {
        "markdown" => {if execution_id.is_some() || language.is_some() {return Err(error("invalid_block","Text cells cannot reference an execution or language."));} source_content(content)?},
        "code" => {if execution_id.is_some() {return Err(error("invalid_block","Code cells cannot reference an execution."));} code_language(language)?; source_content(content)?},
        "result" => {
            if !content.is_empty() || language.is_some() {return Err(error("invalid_block","Result blocks use a saved execution without submitted content or language."));}
            let id=execution_id.ok_or_else(||error("invalid_block","Choose an execution for this result block."))?;
            let project_id:String=conn.query_row("SELECT id FROM project LIMIT 1",[],|r|r.get(0)).map_err(|_|notebook_error())?;
            let found:Option<i64>=conn.query_row("SELECT 1 FROM executions WHERE id=?1 AND project_id=?2 AND status='succeeded'",
                params![id,project_id],|r|r.get(0)).optional().map_err(|_|notebook_error())?;
            if found.is_none() {return Err(error("invalid_execution","Choose a completed execution from this project."));}
            String::new()
        },
        _ => return Err(error("unsupported_block","Only text, code, and saved result cells are supported."))
    };
    let count:i64=conn.query_row("SELECT COUNT(*) FROM notebook_blocks WHERE notebook_id=?1",[notebook_id],|r|r.get(0)).map_err(|_|notebook_error())?;
    if count>=MAX_BLOCKS {return Err(error("block_limit","A notebook can contain at most 200 blocks."));}
    let insertion_index=match (relative_to,placement) {
        (None,None) => None,
        (Some(reference),Some("before" | "after")) => {
            let all=blocks(&conn,notebook_id)?;
            let index=all.iter().position(|item|item.id==reference).ok_or_else(||error("block_missing","This block is not in the selected notebook."))?;
            Some(index + usize::from(placement==Some("after")))
        },
        _ => return Err(error("invalid_placement","Choose a block and insert before or after it."))
    };
    let position:i64=conn.query_row("SELECT COALESCE(MAX(position),-1)+1 FROM notebook_blocks WHERE notebook_id=?1",[notebook_id],|r|r.get(0)).map_err(|_|notebook_error())?;
    let id=uuid::Uuid::new_v4().to_string(); let timestamp=now();
    conn.execute("INSERT INTO notebook_blocks(id,notebook_id,position,kind,content,execution_id,language,created_at,updated_at)
        VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?8)",params![id,notebook_id,position,kind,content,execution_id,language,timestamp])
        .map_err(|_|notebook_error())?;
    if let Some(index)=insertion_index {
        let mut order=blocks(&conn,notebook_id)?;
        let inserted=order.pop().ok_or_else(notebook_error)?;
        order.insert(index,inserted);
        for (position,item) in order.iter().enumerate() {
            conn.execute("UPDATE notebook_blocks SET position=?1 WHERE id=?2",params![position as i64,item.id]).map_err(|_|notebook_error())?;
        }
    }
    conn.execute("UPDATE notebooks SET updated_at=?1 WHERE id=?2",params![timestamp,notebook_id]).map_err(|_|notebook_error())?;
    conn.execute_batch("COMMIT").map_err(|_|notebook_error())?;
    block(&conn,&id)
}
pub(super) fn update_block_inner(project: &Path, id: &str, content: &str, language: Option<&str>) -> Result<NotebookBlock> {
    let content=source_content(content)?; let conn=db(project)?;
    conn.execute_batch("BEGIN IMMEDIATE").map_err(|_|notebook_error())?;
    let existing=block(&conn,id)?;
    if existing.kind!="markdown" && existing.kind!="code" {return Err(error("invalid_block","Only text and code cells can be edited."));}
    let language=if existing.kind=="code" {Some(code_language(language.or(existing.language.as_deref()))?)}
        else if language.is_some() {return Err(error("invalid_language","Text cells do not have a code language."));}
        else {None};
    let timestamp=now();
    conn.execute("UPDATE notebook_blocks SET content=?1,language=?2,updated_at=?3 WHERE id=?4",params![content,language,timestamp,id]).map_err(|_|notebook_error())?;
    conn.execute("UPDATE notebooks SET updated_at=?1 WHERE id=?2",params![timestamp,existing.notebook_id]).map_err(|_|notebook_error())?;
    conn.execute_batch("COMMIT").map_err(|_|notebook_error())?;
    block(&conn,id)
}
pub(super) fn delete_block_inner(project: &Path, id: &str) -> Result<()> {
    let conn=db(project)?;
    conn.execute_batch("BEGIN IMMEDIATE").map_err(|_|notebook_error())?;
    let existing=block(&conn,id)?;
    conn.execute("DELETE FROM notebook_blocks WHERE id=?1",[id]).map_err(|_|notebook_error())?;
    conn.execute("UPDATE notebooks SET updated_at=?1 WHERE id=?2",params![now(),existing.notebook_id]).map_err(|_|notebook_error())?;
    conn.execute_batch("COMMIT").map_err(|_|notebook_error())?;
    Ok(())
}
pub(super) fn move_block_inner(project: &Path, id: &str, direction: &str) -> Result<Vec<NotebookBlock>> {
    if direction!="up" && direction!="down" {return Err(error("invalid_direction","Move a block up or down."));}
    let mut conn=db(project)?;
    let transaction=conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate).map_err(|_|notebook_error())?;
    let existing=block(&transaction,id)?;
    let all=blocks(&transaction,&existing.notebook_id)?;
    let index=all.iter().position(|b|b.id==id).ok_or_else(notebook_error)?;
    let neighbor=if direction=="up" {index.checked_sub(1)} else { (index+1<all.len()).then_some(index+1) };
    let Some(neighbor)=neighbor else {return Ok(all)};
    transaction.execute("UPDATE notebook_blocks SET position=?1,updated_at=?2 WHERE id=?3",params![all[neighbor].position,now(),id]).map_err(|_|notebook_error())?;
    transaction.execute("UPDATE notebook_blocks SET position=?1,updated_at=?2 WHERE id=?3",params![existing.position,now(),all[neighbor].id]).map_err(|_|notebook_error())?;
    transaction.execute("UPDATE notebooks SET updated_at=?1 WHERE id=?2",params![now(),existing.notebook_id]).map_err(|_|notebook_error())?;
    transaction.commit().map_err(|_|notebook_error())?;
    blocks(&conn,&existing.notebook_id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::create_project_inner;
    fn fixture() -> (std::path::PathBuf,std::path::PathBuf) {
        let root=std::env::temp_dir().join(format!("dataforge-notebook-test-{}",uuid::Uuid::new_v4())); std::fs::create_dir(&root).unwrap();
        let project=create_project_inner("Study",root.to_str().unwrap()).unwrap();
        (root,std::path::PathBuf::from(project.project.path))
    }
    #[test]
    fn ordered_markdown_survives_reopen() {
        let (root,project)=fixture();
        let note=create_notebook_inner(&project,"Research").unwrap();
        let first=add_block_inner(&project,&note.id,"markdown","First",None,None,None,None).unwrap();
        let second=add_block_inner(&project,&note.id,"markdown","Second",None,None,None,None).unwrap();
        assert_eq!(move_block_inner(&project,&second.id,"up").unwrap()[0].id,second.id);
        assert_eq!(update_block_inner(&project,&first.id,"Edited",None).unwrap().content,"Edited");
        let reopened=get_notebook_inner(&project,&note.id).unwrap();
        assert_eq!(reopened.blocks.len(),2);assert_eq!(reopened.blocks[0].id,second.id);
        assert_eq!(list_notebooks_inner(&project).unwrap()[0].block_count,2);
        delete_block_inner(&project,&first.id).unwrap();
        delete_notebook_inner(&project,&note.id).unwrap();
        assert!(list_notebooks_inner(&project).unwrap().is_empty());
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn rejects_invalid_references_and_blocks() {
        let (root,project)=fixture();let note=create_notebook_inner(&project,"Research").unwrap();
        let other=create_project_inner("Other",root.to_str().unwrap()).unwrap();
        let other_project=std::path::PathBuf::from(&other.project.path);
        let conn=db(&other_project).unwrap();
        conn.execute("INSERT INTO executions(id,project_id,dataset_id,source_fingerprint,operation_type,parameters,started_at,status,schema_version) VALUES('foreign-run',?1,'dataset','hash','rows','{}',?2,'succeeded',1)",params![other.project.id,now()]).unwrap();
        drop(conn);
        assert_eq!(add_block_inner(&project,&note.id,"result","",Some("foreign-run"),None,None,None).unwrap_err().code,"invalid_execution");
        assert_eq!(get_notebook_inner(&other_project,&note.id).unwrap_err().code,"notebook_missing");
        assert_eq!(add_block_inner(&project,&note.id,"result","",Some("other-project-run"),None,None,None).unwrap_err().code,"invalid_execution");
        assert_eq!(add_block_inner(&project,&note.id,"chart","",None,None,None,None).unwrap_err().code,"unsupported_block");
        assert_eq!(add_block_inner(&project,&note.id,"markdown",&"x".repeat(MAX_CONTENT_BYTES+1),None,None,None,None).unwrap_err().code,"invalid_content");
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn inserts_relative_to_existing_block_and_preserves_order() {
        let (root,project)=fixture();
        let note=create_notebook_inner(&project,"Research").unwrap();
        let first=add_block_inner(&project,&note.id,"markdown","First",None,None,None,None).unwrap();
        let last=add_block_inner(&project,&note.id,"markdown","Last",None,None,None,None).unwrap();
        let above=add_block_inner(&project,&note.id,"markdown","Above",None,Some(&last.id),Some("before"),None).unwrap();
        let below=add_block_inner(&project,&note.id,"markdown","Below",None,Some(&first.id),Some("after"),None).unwrap();
        let reopened=get_notebook_inner(&project,&note.id).unwrap();
        assert_eq!(reopened.blocks.iter().map(|b|b.id.as_str()).collect::<Vec<_>>(),vec![first.id.as_str(),below.id.as_str(),above.id.as_str(),last.id.as_str()]);
        assert_eq!(add_block_inner(&project,&note.id,"markdown","Bad",None,Some("missing"),Some("after"),None).unwrap_err().code,"block_missing");
        assert_eq!(get_notebook_inner(&project,&note.id).unwrap().blocks.len(),4);
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn code_source_and_language_survive_reopen() {
        let (root,project)=fixture();
        let note=create_notebook_inner(&project,"Research").unwrap();
        let text=add_block_inner(&project,&note.id,"markdown","Context",None,None,None,None).unwrap();
        let code=add_block_inner(&project,&note.id,"code","print(1)",None,Some(&text.id),Some("after"),Some("python")).unwrap();
        assert_eq!(code.language.as_deref(),Some("python"));
        assert_eq!(add_block_inner(&project,&note.id,"code","bad",None,None,None,Some("ruby")).unwrap_err().code,"invalid_language");
        assert_eq!(add_block_inner(&project,&note.id,"code","bad",None,None,None,None).unwrap_err().code,"invalid_language");
        assert_eq!(add_block_inner(&project,&note.id,"markdown","bad",None,None,None,Some("sql")).unwrap_err().code,"invalid_block");
        assert_eq!(update_block_inner(&project,&code.id,"SELECT 1",Some("sql")).unwrap().language.as_deref(),Some("sql"));
        assert_eq!(update_block_inner(&project,&code.id,"SELECT 2",None).unwrap().language.as_deref(),Some("sql"));
        let reopened=get_notebook_inner(&project,&note.id).unwrap();
        assert_eq!(reopened.blocks.iter().map(|b|b.id.as_str()).collect::<Vec<_>>(),vec![text.id.as_str(),code.id.as_str()]);
        assert_eq!(reopened.blocks[1].content,"SELECT 2");
        assert_eq!(reopened.blocks[1].language.as_deref(),Some("sql"));
        std::fs::remove_dir_all(root).unwrap();
    }
}
