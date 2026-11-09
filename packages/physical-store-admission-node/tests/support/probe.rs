//! Explicit test-only cross-process kernel observer. No SQL or UI imports.
use bycoda_physical_store_admission::{Error, Registry};
use std::{fs::File, path::Path};

fn run() -> Result<(), String> {
    let arguments: Vec<_> = std::env::args().collect();
    if arguments.len() != 4 {
        return Err("usage: physical-admission-probe writer|closed REGISTRY FILE".into());
    }
    let registry = Registry::open(Path::new(&arguments[2])).map_err(|error| error.to_string())?;
    let file = File::open(&arguments[3]).map_err(|error| error.to_string())?;
    let store = registry.bind(file).map_err(|error| error.to_string())?;
    match arguments[1].as_str() {
        "writer" => match store.try_writer() {
            Ok(_held) => println!("acquired-writer"),
            Err(Error::Busy(_)) => {
                println!("busy-ingress");
                std::process::exit(11);
            }
            Err(error) => return Err(error.to_string()),
        },
        "closed" => {
            let closing = match store.try_begin_close() {
                Ok(closing) => closing,
                Err(Error::Busy(_)) => {
                    println!("busy-ingress");
                    std::process::exit(11);
                }
                Err(error) => return Err(error.to_string()),
            };
            match closing.try_upgrade() {
                Ok(_held) => println!("acquired-closed"),
                Err(error) => {
                    let (error, _retained_closing) = error.into_parts();
                    if matches!(error, Error::Busy(_)) {
                        println!("busy-writers");
                        std::process::exit(12);
                    }
                    return Err(error.to_string());
                }
            }
        }
        _ => return Err("unknown probe operation".into()),
    }
    Ok(())
}

fn main() {
    if let Err(error) = run() {
        eprintln!("{error}");
        std::process::exit(2);
    }
}
