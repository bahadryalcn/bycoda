fn main() {
    let headers =
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../vendor/sqlite-extension-abi");
    cc::Build::new()
        .file("src/sqlite_identity.c")
        .include(&headers)
        .warnings(true)
        .warnings_into_errors(true)
        .compile("bycoda_sqlite_identity");
    println!("cargo:rerun-if-changed=src/sqlite_identity.c");
    println!(
        "cargo:rerun-if-changed={}",
        headers.join("sqlite3.h").display()
    );
    println!(
        "cargo:rerun-if-changed={}",
        headers.join("sqlite3ext.h").display()
    );
    napi_build::setup();
}
