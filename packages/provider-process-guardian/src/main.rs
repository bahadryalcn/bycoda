fn main() {
    let args: Vec<_> = std::env::args_os().collect();
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
    if bycoda_provider_process_guardian::runtime::protect_control_handles().is_err() {
        std::process::exit(2);
    }
    let result = bycoda_provider_process_guardian::runtime::run(
        &mut std::io::stdin().lock(),
        std::io::stdout(),
    );
    if result.is_err() {
        std::process::exit(2);
    }
}
