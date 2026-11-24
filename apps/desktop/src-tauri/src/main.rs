#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    if std::env::args().nth(1).as_deref() == Some("--dataforge-sql-worker") {
        std::process::exit(dataforge_lib::run_sql_worker());
    }
    dataforge_lib::run();
}
