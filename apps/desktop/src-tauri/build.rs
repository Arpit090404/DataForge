fn main() {
    #[cfg(windows)]
    println!("cargo:rustc-link-lib=rstrtmgr");
    tauri_build::build()
}
