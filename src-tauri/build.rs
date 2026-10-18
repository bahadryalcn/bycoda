fn main() {
    // generate_context! embeds icons; cargo ignores them unless we watch here.
    println!("cargo:rerun-if-changed=icons");
    println!("cargo:rerun-if-env-changed=BYCODA_HOST_RELEASE_URL");
    // GNU ld exports every symbol from the Tauri cdylib and blows past the
    // 65535 PE ordinal limit. Hide them; the desktop exe links the rlib.
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows")
        && std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("gnu")
    {
        println!("cargo::rustc-link-arg-cdylib=-Wl,--exclude-libs=ALL,--exclude-all-symbols");
    }
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows")
        && std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc")
    {
        // tauri-winres links its resource only into application binaries. Library
        // test executables also reach native dialogs and need Common Controls v6
        // before the Windows loader resolves TaskDialogIndirect. Let the linker
        // embed the same dependency in every executable, avoiding a duplicate
        // RT_MANIFEST in the application's resource file.
        println!("cargo:rustc-link-arg=/MANIFEST:EMBED");
        println!("cargo:rustc-link-arg=/MANIFESTDEPENDENCY:type='win32' name='Microsoft.Windows.Common-Controls' version='6.0.0.0' processorArchitecture='*' publicKeyToken='6595b64144ccf1df' language='*'");
        tauri_build::try_build(
            tauri_build::Attributes::new()
                .windows_attributes(tauri_build::WindowsAttributes::new_without_app_manifest()),
        )
        .expect("failed to build Tauri resources");
    } else {
        tauri_build::build()
    }
}
