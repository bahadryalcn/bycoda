#![cfg_attr(windows, windows_subsystem = "windows")]

fn main() {
    let mut arguments = std::env::args_os().skip(1);
    if let (Some(path), None) = (arguments.next(), arguments.next()) {
        bycoda_host_service_launcher::run_and_exit(std::path::Path::new(&path));
    }
    eprintln!("Host launcher failed: Expected exactly one Host launcher configuration path.");
    std::process::exit(1);
}
