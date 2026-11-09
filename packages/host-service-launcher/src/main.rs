#![cfg_attr(windows, windows_subsystem = "windows")]

fn main() {
    let mut arguments = std::env::args_os().skip(1);
    let code = match (arguments.next(), arguments.next()) {
        (Some(path), None) => bycoda_host_service_launcher::run(std::path::Path::new(&path)),
        _ => Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "Expected exactly one Host launcher configuration path.",
        )),
    };
    std::process::exit(code.unwrap_or_else(|error| {
        eprintln!("Host launcher failed: {error}");
        1
    }));
}
