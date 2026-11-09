use super::*;

pub(super) fn run(
    command: &mut Command,
    args: &[&str],
    max_bytes: usize,
    cancel: Option<&AtomicBool>,
    deadline: Instant,
) -> Option<(Vec<u8>, bool)> {
    let turn = GIT_SPAWN_GATE.enter_until(cancel, deadline)?;
    if Instant::now() >= deadline {
        return None;
    }
    let mut child = command.spawn().ok()?;
    drop(turn);
    let Some(mut stdout) = child.stdout.take() else {
        let _ = child.kill();
        let _ = child.wait();
        return None;
    };
    let (sender, receiver) = mpsc::sync_channel(GIT_OUTPUT_QUEUE_CHUNKS);
    let reader = thread::Builder::new()
        .name("git-output-reader".to_string())
        .spawn(move || {
            let mut chunk = vec![0u8; 8192];
            loop {
                match stdout.read(&mut chunk) {
                    Ok(0) => {
                        let _ = sender.send(Ok(Vec::new()));
                        break;
                    }
                    Ok(read) => {
                        if sender.send(Ok(chunk[..read].to_vec())).is_err() {
                            break;
                        }
                    }
                    Err(error) => {
                        let _ = sender.send(Err(error));
                        break;
                    }
                }
            }
        });
    let mut reader = match reader {
        Ok(reader) => Some(reader),
        Err(_) => {
            let _ = child.kill();
            let _ = child.wait();
            return None;
        }
    };
    let stop = |child: &mut std::process::Child, reader: &mut Option<thread::JoinHandle<()>>| {
        let _ = child.kill();
        let _ = child.wait();
        // Dropping the handle detaches the reader. A killed git process can leave
        // a shell descendant holding the pipe, so joining here would re-block the
        // cancelled search until that unrelated descendant exits.
        reader.take();
    };

    let mut buf = Vec::new();
    loop {
        if Instant::now() >= deadline || cancel.is_some_and(|token| token.load(Ordering::Acquire)) {
            stop(&mut child, &mut reader);
            return None;
        }
        match receiver.recv_timeout(Duration::from_millis(100)) {
            Ok(Ok(chunk)) if chunk.is_empty() => break,
            Ok(Ok(chunk)) => {
                let remaining = max_bytes.saturating_sub(buf.len());
                if chunk.len() > remaining {
                    buf.extend_from_slice(&chunk[..remaining]);
                    stop(&mut child, &mut reader);
                    return Some((buf, true));
                }
                buf.extend_from_slice(&chunk);
            }
            Ok(Err(_)) => {
                stop(&mut child, &mut reader);
                return None;
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {
                if cancel.is_some_and(|token| token.load(Ordering::Acquire)) {
                    stop(&mut child, &mut reader);
                    return None;
                }
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => {
                stop(&mut child, &mut reader);
                return None;
            }
        }
    }
    let _ = reader.take().map(thread::JoinHandle::join);
    let status = loop {
        if Instant::now() >= deadline || cancel.is_some_and(|token| token.load(Ordering::Acquire)) {
            stop(&mut child, &mut reader);
            return None;
        }
        if let Some(status) = child.try_wait().ok()? {
            break status;
        }
        thread::sleep(Duration::from_millis(10));
    };
    if git_status_ok(&status, args) {
        Some((buf, false))
    } else {
        None
    }
}
