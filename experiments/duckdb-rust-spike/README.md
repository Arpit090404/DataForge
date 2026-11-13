# DuckDB Rust/Windows compatibility check

On Windows with the MSVC Rust toolchain, run from the repository root:

```powershell
cargo run --locked --manifest-path experiments/duckdb-rust-spike/Cargo.toml
```

The pinned `duckdb-rs` 1.4.5 bundled build completed on this machine and the program printed `DuckDB v1.4.5 returned 42`. Its first link failed because the bundled DuckDB library referenced Windows Restart Manager symbols; `build.rs` explicitly links the Windows SDK `rstrtmgr` import library. This checks compilation and one embedded in-memory query, not the DataForge application or resource/security behavior.
