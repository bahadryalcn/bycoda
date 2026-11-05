use super::QuickAttachment;
use std::collections::HashSet;
use std::path::{Path, PathBuf};
#[cfg(any(target_os = "macos", test))]
use std::sync::Mutex;
use std::time::{Duration, SystemTime};
#[cfg(target_os = "macos")]
use tauri::{AppHandle, Manager, State, WebviewWindow};

#[derive(Default)]
#[cfg(target_os = "macos")]
pub struct Captures(pub Mutex<HashSet<PathBuf>>);

#[cfg(target_os = "macos")]
fn root() -> PathBuf {
    std::env::temp_dir().join("bycoda-captures")
}

#[cfg(target_os = "macos")]
pub fn new_path() -> Result<PathBuf, String> {
    let dir = root().join(format!("{}-{}", std::process::id(), uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir).map_err(|err| err.to_string())?;
    Ok(dir.join("Screenshot.png"))
}

fn remove(path: &Path) {
    let _ = std::fs::remove_file(path);
    if let Some(dir) = path.parent() {
        let _ = std::fs::remove_dir(dir);
    }
}

#[cfg(target_os = "macos")]
pub fn register(app: &AppHandle, path: &str) -> Result<(), String> {
    app.state::<Captures>()
        .0
        .lock()
        .map_err(|_| "Capture ownership is unavailable.")?
        .insert(path.into());
    Ok(())
}

fn release(owned: &mut HashSet<PathBuf>, paths: &[String]) {
    for path in paths {
        let path = PathBuf::from(path);
        // Never unlink uploads, persistent session attachments, or arbitrary IPC paths.
        if owned.remove(&path) {
            remove(&path);
        }
    }
}

#[cfg(target_os = "macos")]
pub(crate) fn discard(app: &AppHandle, path: &str) {
    if let Ok(mut owned) = app.state::<Captures>().0.lock() {
        release(&mut owned, &[path.to_owned()]);
    }
}

#[tauri::command]
#[cfg(target_os = "macos")]
pub fn quick_composer_release_capture(
    window: WebviewWindow,
    state: State<'_, Captures>,
    paths: Vec<String>,
) -> Result<(), String> {
    if window.label() != crate::window::QUICK_COMPOSER_LABEL {
        return Err("Invalid capture owner.".into());
    }
    release(&mut *state.0.lock().map_err(|err| err.to_string())?, &paths);
    Ok(())
}

// Stage copies first. If any copy fails the draft's originals remain usable.
fn persist_to(
    owned: &HashSet<PathBuf>,
    files: &mut [QuickAttachment],
    destination: &Path,
) -> Result<(), String> {
    let mut copies = Vec::new();
    let result = (|| {
        for (index, file) in files.iter().enumerate() {
            if !owned.contains(Path::new(&file.path)) {
                continue;
            }
            let dir = destination.join(uuid::Uuid::new_v4().to_string());
            std::fs::create_dir_all(&dir).map_err(|err| err.to_string())?;
            let path = dir.join("Screenshot.png");
            copies.push((index, path.clone()));
            std::fs::copy(&file.path, &path).map_err(|err| err.to_string())?;
            std::fs::OpenOptions::new()
                .write(true)
                .open(&path)
                .and_then(|file| file.sync_all())
                .map_err(|err| err.to_string())?;
        }
        Ok(())
    })();
    if result.is_err() {
        for (_, path) in copies {
            remove(&path);
        }
        return result;
    }
    for (index, path) in copies {
        files[index].path = path.to_string_lossy().into_owned();
        // The live/newer raw draft may still reference the original, including
        // after a lost delivery ACK. Only explicit renderer release consumes
        // owned originals; copying to a session is not draft-retirement proof.
    }
    Ok(())
}

#[cfg(any(target_os = "macos", test))]
fn persist_snapshot(
    owned: &Mutex<HashSet<PathBuf>>,
    files: &mut [QuickAttachment],
    destination: &Path,
    persist: impl FnOnce(&HashSet<PathBuf>, &mut [QuickAttachment], &Path) -> Result<(), String>,
) -> Result<(), String> {
    let snapshot = {
        let owned = owned.lock().map_err(|err| err.to_string())?;
        files.iter().filter_map(|file| {
            let path = PathBuf::from(&file.path);
            owned.contains(&path).then_some(path)
        }).collect()
    };
    // Copy/fsync never holds the shared capture lock: explicit release and new
    // captures remain responsive while this original request persists its bytes.
    persist(&snapshot, files, destination)
}

#[cfg(target_os = "macos")]
pub(crate) fn persist(app: &AppHandle, files: &mut [QuickAttachment]) -> Result<(), String> {
    let destination = app
        .path()
        .app_data_dir()
        .map_err(|err| err.to_string())?
        .join("attachments/quick-captures");
    persist_snapshot(
        &app.state::<Captures>().0,
        files,
        &destination,
        persist_to,
    )
}

#[cfg(target_os = "macos")]
pub fn cleanup_abandoned() {
    // Limited legacy orphan policy only: known-absent original processes and
    // old temp files, never live/unknown owners. PID/age is NOT proof that a
    // durable raw/profile reference is retired; that tracking is still absent.
    // Never follow symlinks or turn permission/probe errors into absence.
    sweep(&root(), SystemTime::now(), probe_process);
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ProcessState {
    Alive,
    Absent,
    Unknown,
}

fn checked_pid(pid: u32) -> Option<i32> {
    i32::try_from(pid).ok().filter(|pid| *pid > 0)
}

/// Only a failed kill(positive_pid, 0) with ESRCH establishes absence.
/// EPERM and every other/unknown error preserve the temp capture. Invalid
/// unsigned IDs must never wrap into process-group/all-process probes.
fn classify_process_probe(
    pid: u32,
    result: i32,
    error: Option<i32>,
    absent_code: i32,
) -> ProcessState {
    if checked_pid(pid).is_none() {
        return ProcessState::Unknown;
    }
    match (result, error) {
        (0, _) => ProcessState::Alive,
        (-1, Some(error)) if error == absent_code => ProcessState::Absent,
        _ => ProcessState::Unknown,
    }
}

#[cfg(target_os = "macos")]
fn probe_process(pid: u32) -> ProcessState {
    let Some(checked) = checked_pid(pid) else {
        return ProcessState::Unknown;
    };
    let result = unsafe { libc::kill(checked, 0) };
    let error = if result == -1 {
        // Capture errno immediately on this thread, before any other OS work.
        std::io::Error::last_os_error().raw_os_error()
    } else {
        None
    };
    classify_process_probe(pid, result, error, libc::ESRCH)
}

fn sweep(root: &Path, now: SystemTime, process: impl Fn(u32) -> ProcessState) {
    let Ok(entries) = std::fs::read_dir(root) else {
        return;
    };
    for entry in entries.flatten() {
        let name = entry.file_name();
        let Some((pid, id)) = name.to_str().and_then(|name| name.split_once('-')) else {
            continue;
        };
        let Ok(pid) = pid.parse::<u32>() else {
            continue;
        };
        if uuid::Uuid::parse_str(id).is_err()
            || checked_pid(pid).is_none()
            || process(pid) != ProcessState::Absent
        {
            continue;
        }
        let Ok(meta) = entry.path().symlink_metadata() else {
            continue;
        };
        if !meta.is_dir() || meta.is_symlink() {
            continue;
        }
        let old = meta
            .modified()
            .ok()
            .and_then(|at| now.duration_since(at).ok())
            .is_some_and(|age| age >= Duration::from_secs(24 * 60 * 60));
        if old {
            remove(&entry.path().join("Screenshot.png"));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    // The platform-neutral classifier is exercised with a deliberately
    // synthetic absent code. Only the macOS OS wrapper supplies the actual ESRCH constant.
    const ABSENT_CODE: i32 = 7321;
    fn classified(pid: u32, result: i32, error: Option<i32>) -> ProcessState {
        classify_process_probe(pid, result, error, ABSENT_CODE)
    }
    fn temp() -> PathBuf {
        let path = std::env::temp_dir().join(format!("capture-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&path).unwrap();
        path
    }
    fn attachment(path: &Path) -> QuickAttachment {
        QuickAttachment {
            id: "shot".into(),
            name: "Screenshot.png".into(),
            mime_type: "image/png".into(),
            kind: "image".into(),
            size: 4,
            path: path.to_string_lossy().into_owned(),
        }
    }
    #[test]
    fn persistence_releases_capture_mutex_before_blocking_copy_and_keeps_exact_bytes() {
        let root = temp();
        let capture = root.join("capture/Screenshot.png");
        std::fs::create_dir_all(capture.parent().unwrap()).unwrap();
        let bytes = [0, 137, 80, 78, 71, 255, 10, 0];
        std::fs::write(&capture, bytes).unwrap();
        let owned = std::sync::Arc::new(Mutex::new(HashSet::from([capture.clone()])));
        let original = owned.clone();
        let input = capture.clone();
        let destination = root.join("persistent");
        let (entered_tx, entered_rx) = std::sync::mpsc::channel();
        let (release_tx, release_rx) = std::sync::mpsc::channel();
        let work = std::thread::spawn(move || {
            let mut file = attachment(&input);
            file.size = 8;
            let mut files = vec![file];
            persist_snapshot(&original, &mut files, &destination, |snapshot, files, destination| {
                entered_tx.send(()).unwrap();
                release_rx.recv_timeout(Duration::from_secs(10)).unwrap();
                persist_to(snapshot, files, destination)
            }).unwrap();
            files
        });
        entered_rx.recv_timeout(Duration::from_secs(10)).unwrap();
        assert!(owned.try_lock().is_ok(), "copy/fsync must not hold the UI capture mutex");
        release_tx.send(()).unwrap();
        let files = work.join().unwrap();
        assert_eq!(std::fs::read(&files[0].path).unwrap(), bytes);
        assert!(owned.lock().unwrap().contains(&capture));
        assert!(capture.exists());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn explicit_original_release_during_preparation_cannot_publish_a_partial_attachment() {
        let root = temp();
        let capture = root.join("capture/Screenshot.png");
        std::fs::create_dir_all(capture.parent().unwrap()).unwrap();
        std::fs::write(&capture, b"test").unwrap();
        let owned = Mutex::new(HashSet::from([capture.clone()]));
        let mut files = vec![attachment(&capture)];
        let result = persist_snapshot(&owned, &mut files, &root.join("persistent"), |snapshot, files, destination| {
            release(&mut owned.lock().unwrap(), &[capture.to_string_lossy().into_owned()]);
            persist_to(snapshot, files, destination)
        });
        assert!(result.is_err());
        assert_eq!(files[0].path, capture.to_string_lossy());
        assert!(!capture.exists());
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn release_only_deletes_owned_captures_and_promotion_retains_session_copy() {
        let root = temp();
        let capture = root.join("capture/Screenshot.png");
        std::fs::create_dir_all(capture.parent().unwrap()).unwrap();
        std::fs::write(&capture, b"test").unwrap();
        let upload = root.join("uploaded.png");
        std::fs::write(&upload, b"user").unwrap();
        let mut owned = HashSet::from([capture.clone()]);
        release(&mut owned, &[upload.to_string_lossy().into_owned()]);
        assert!(upload.exists());
        let mut files = vec![attachment(&capture), attachment(&upload)];
        persist_to(&owned, &mut files, &root.join("persistent")).unwrap();
        assert!(capture.exists());
        assert!(owned.contains(&capture));
        assert_eq!(std::fs::read(&files[0].path).unwrap(), b"test");
        release(&mut owned, &[files[0].path.clone()]);
        assert!(Path::new(&files[0].path).exists());
        release(&mut owned, &[capture.to_string_lossy().into_owned()]);
        assert!(!capture.exists());
        assert!(Path::new(&files[0].path).exists());
        assert_eq!(files[1].path, upload.to_string_lossy());
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn failed_promotion_keeps_the_original_for_retry() {
        let root = temp();
        let capture = root.join("Screenshot.png");
        std::fs::write(&capture, b"test").unwrap();
        let destination = root.join("not-a-directory");
        std::fs::write(&destination, b"x").unwrap();
        let owned = HashSet::from([capture.clone()]);
        let mut files = vec![attachment(&capture)];
        assert!(persist_to(&owned, &mut files, &destination).is_err());
        assert!(owned.contains(&capture));
        assert!(capture.exists());
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn sweep_retains_recent_live_and_unrecognized_files() {
        let root = temp();
        let dead = root.join(format!("1-{}", uuid::Uuid::new_v4()));
        let live = root.join(format!("2-{}", uuid::Uuid::new_v4()));
        let other = root.join("user-folder");
        for dir in [&dead, &live, &other] {
            std::fs::create_dir_all(dir).unwrap();
            std::fs::write(dir.join("Screenshot.png"), b"test").unwrap();
        }
        sweep(&root, SystemTime::now(), |_| ProcessState::Absent);
        assert!(dead.exists());
        sweep(
            &root,
            SystemTime::now() + Duration::from_secs(48 * 60 * 60),
            |pid| {
                if pid == 2 {
                    ProcessState::Alive
                } else {
                    ProcessState::Absent
                }
            },
        );
        assert!(!dead.exists());
        assert!(live.exists());
        assert!(other.exists());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn process_classifier_requires_positive_pid_and_only_esrch_establishes_absence() {
        assert_eq!(classified(7, 0, Some(ABSENT_CODE)), ProcessState::Alive);
        assert_eq!(classified(7, -1, Some(ABSENT_CODE)), ProcessState::Absent);
        for error in [
            None,
            Some(ABSENT_CODE + 1),
            Some(ABSENT_CODE - 1),
            Some(0),
            Some(i32::MAX),
        ] {
            assert_eq!(classified(7, -1, error), ProcessState::Unknown);
        }
        assert_eq!(classified(7, 1, Some(ABSENT_CODE)), ProcessState::Unknown);
        for pid in [0, i32::MAX as u32 + 1, u32::MAX] {
            assert_eq!(
                classified(pid, -1, Some(ABSENT_CODE)),
                ProcessState::Unknown
            );
            assert_eq!(classified(pid, 0, None), ProcessState::Unknown);
        }
        assert_eq!(checked_pid(i32::MAX as u32), Some(i32::MAX));
    }

    #[test]
    fn sweep_preserves_old_unknown_probe_errors_and_invalid_pids_without_probing_them() {
        let root = temp();
        let pids = [3, 4, 5, 6, 0, i32::MAX as u32 + 1, u32::MAX];
        let directories: Vec<_> = pids
            .iter()
            .map(|pid| {
                let path = root.join(format!("{pid}-{}", uuid::Uuid::new_v4()));
                std::fs::create_dir_all(&path).unwrap();
                std::fs::write(path.join("Screenshot.png"), b"retained draft").unwrap();
                (*pid, path)
            })
            .collect();
        let probed = std::cell::RefCell::new(Vec::new());
        sweep(
            &root,
            SystemTime::now() + Duration::from_secs(48 * 60 * 60),
            |pid| {
                probed.borrow_mut().push(pid);
                match pid {
                    3 => classified(pid, -1, Some(ABSENT_CODE + 1)),
                    4 => classified(pid, -1, Some(ABSENT_CODE)),
                    5 => classified(pid, 0, None),
                    6 => classified(pid, -1, None),
                    _ => panic!("invalid process ID must not reach an OS probe"),
                }
            },
        );
        assert_eq!(probed.borrow().len(), 4);
        for (pid, path) in directories {
            if pid == 4 {
                assert!(!path.exists());
            } else {
                assert_eq!(
                    std::fs::read(path.join("Screenshot.png")).unwrap(),
                    b"retained draft"
                );
            }
        }
        std::fs::remove_dir_all(root).unwrap();
    }
}
