// Disposable security probe. Never used by the DataForge application.
use std::{io::{self, Read}, path::Path};
use duckdb::{AccessMode, Config, Connection};

fn run() -> Result<(), String> {
    let mut args = std::env::args().skip(1);
    let mode = args.next().ok_or("missing mode")?;
    let path = args.next().ok_or("missing database path")?;
    if mode == "read-file" { return std::fs::read(&path).map(|_| ()).map_err(|_| "read_denied".into()); }
    if mode == "write-file" { return std::fs::write(&path, b"changed").map_err(|_| "write_denied".into()); }
    if mode == "network" { return std::net::TcpStream::connect_timeout(&"127.0.0.1:45678".parse().unwrap(), std::time::Duration::from_millis(500)).map(|_| ()).map_err(|_| "network_denied".into()); }
    if mode == "child-hold" { std::fs::write(&path, std::process::id().to_string()).map_err(|_| "child_marker_denied")?; std::thread::sleep(std::time::Duration::from_secs(30)); return Ok(()); }
    if mode == "spawn-child" || mode == "breakaway" {
        use std::os::windows::process::CommandExt;
        let exe = std::env::current_exe().map_err(|_| "self_path")?;
        let mut child = std::process::Command::new(exe);
        child.args(["child-hold", &path]);
        if mode == "breakaway" { child.creation_flags(0x0100_0000); }
        return child.spawn().map(|_| ()).map_err(|_| "child_launch_denied".into());
    }
    if mode == "hold" { std::thread::sleep(std::time::Duration::from_secs(30)); return Ok(()); }
    if mode == "memory" { let mut data = Vec::new(); loop { data.push(vec![0u8; 16 * 1024 * 1024]); std::hint::black_box(&data); } }
    if mode == "alloc-test" {
        unsafe extern "system" { fn VirtualAlloc(address: *mut u8, size: usize, kind: u32, protect: u32) -> *mut u8; fn VirtualFree(address: *mut u8, size: usize, kind: u32) -> i32; }
        let pointer = unsafe { VirtualAlloc(std::ptr::null_mut(), 256 * 1024 * 1024, 0x3000, 0x04) };
        if pointer.is_null() { return Err("allocation_denied".into()); }
        unsafe { VirtualFree(pointer, 0, 0x8000); }
        return Ok(());
    }
    let mut sql = String::new();
    if mode != "db-open" && mode != "db-query" { io::stdin().take(8193).read_to_string(&mut sql).map_err(|_| "input error")?; }
    if sql.len() > 8192 { return Err("sql_too_large".into()); }
    if mode == "setup" {
        let conn = Connection::open(Path::new(&path)).map_err(|_| "setup_open")?;
        conn.execute_batch("CREATE TABLE approved(id INTEGER, value VARCHAR); INSERT INTO approved VALUES (1, 'a'), (2, 'b');").map_err(|_| "setup_query")?;
        println!("setup_ok");
        return Ok(());
    }
    let config = Config::default().access_mode(AccessMode::ReadOnly)
        .and_then(|c| c.enable_external_access(false))
        .and_then(|c| c.enable_autoload_extension(false))
        .and_then(|c| c.with("autoinstall_known_extensions", "false"))
        .and_then(|c| c.with("allow_community_extensions", "false"))
        .and_then(|c| c.max_memory("128MB"))
        .and_then(|c| c.threads(2))
        .and_then(|c| c.with("max_temp_directory_size", "32MB"))
        .map_err(|_| "config_error")?;
    let config = if mode == "parse" { config } else { config.with("lock_configuration", "true").map_err(|_| "config_error")? };
    let conn = Connection::open_with_flags(Path::new(&path), config).map_err(|_| "read_only_open")?;
    if mode == "db-open" { println!("db_open_ok"); }
    else if mode == "db-query" { let count: i64 = conn.query_row("SELECT COUNT(*) FROM approved", [], |row| row.get(0)).map_err(|_| "db_query_failed")?; if count != 2 { return Err("unexpected_count".into()); } }
    else if mode == "parse" {
        conn.execute_batch("LOAD json").map_err(|_| "json_extension_unavailable")?;
        let ast: String = conn.query_row("SELECT json_serialize_sql(?1)", [&sql], |row| row.get(0)).map_err(|_| "parse_error")?;
        println!("{ast}");
    } else if mode == "probe" {
        conn.execute_batch(&sql).map_err(|_| "probe_denied")?;
        println!("probe_succeeded");
    } else if mode == "run" {
        let wrapped = format!("SELECT * FROM ({sql}) AS bounded_result LIMIT 201");
        let mut stmt = conn.prepare(&wrapped).map_err(|_| "prepare_error")?;
        let mut cursor = stmt.query([]).map_err(|_| "query_error")?;
        let mut rows = 0; let mut bytes = 0;
        while let Some(row) = cursor.next().map_err(|_| "fetch_error")? {
            rows += 1;
            if rows > 200 { return Err("row_limit".into()); }
            for i in 0..row.as_ref().column_count() {
                let value = row.get_ref(i).map_err(|_| "value_error")?;
                bytes += format!("{value:?}").len();
                if bytes > 1024 * 1024 { return Err("byte_limit".into()); }
            }
        }
        println!("rows={rows} bytes={bytes} version={}", conn.version().map_err(|_| "version_error")?);
    } else { return Err("unknown_mode".into()); }
    Ok(())
}

fn main() {
    if let Err(code) = run() { eprintln!("{code}"); std::process::exit(2); }
}
