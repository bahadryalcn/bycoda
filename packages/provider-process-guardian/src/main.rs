fn main() {
    let args: Vec<_> = std::env::args_os().collect();
    if args.len() == 2 && args[1] == std::ffi::OsStr::new("--tunnel-custody-capability") {
        if cfg!(any(windows, target_os = "linux")) {
            println!("bycoda-tunnel-custody-v1");
        } else {
            std::process::exit(2);
        }
        return;
    }
    if args.len() == 2 && args[1] == std::ffi::OsStr::new("--build-receipt-capability") {
        if cfg!(windows) {
            println!("bycoda-build-receipt-v1");
        } else {
            std::process::exit(2);
        }
        return;
    }
    if args.len() != 2 || args[1] != std::ffi::OsStr::new("--provider-process-guardian") {
        std::process::exit(2);
    }
    if let Err(error) = bycoda_provider_process_guardian::runtime::protect_control_handles() {
        bycoda_provider_process_guardian::diagnostic::report_failure("handle protection", &error);
        std::process::exit(2);
    }
    let result = bycoda_provider_process_guardian::runtime::run(
        &mut std::io::stdin().lock(),
        std::io::stdout(),
    );
    if let Err(error) = result {
        bycoda_provider_process_guardian::diagnostic::report_failure("control run", &error);
        std::process::exit(2);
    }
}
