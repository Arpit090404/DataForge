fn main() -> duckdb::Result<()> {
    let conn = duckdb::Connection::open_in_memory()?;
    let answer: i64 = conn.query_row("SELECT 40 + 2", [], |row| row.get(0))?;
    assert_eq!(answer, 42);
    println!("DuckDB {} returned {answer}", conn.version()?);
    Ok(())
}
