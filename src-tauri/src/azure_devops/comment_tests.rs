use super::*;
use std::io::Write;
use std::net::TcpListener;
use std::thread;
use std::time::Instant;

#[test]
fn work_item_comment_explicitly_posts_markdown_without_rewriting_the_draft() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    listener.set_nonblocking(true).unwrap();
    let config = AzureDevOpsConfig {
        url: format!("http://{}", listener.local_addr().unwrap()),
        token: "offline-fixture-token".into(),
    };
    let server = thread::spawn(move || {
        let deadline = Instant::now() + Duration::from_secs(5);
        let mut stream = loop {
            match listener.accept() {
                Ok((stream, _)) => break stream,
                Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                    assert!(Instant::now() < deadline, "comment request did not arrive");
                    thread::sleep(Duration::from_millis(5));
                }
                Err(error) => panic!("fixture accept failed: {error}"),
            }
        };
        stream
            .set_read_timeout(Some(Duration::from_secs(5)))
            .unwrap();
        stream
            .set_write_timeout(Some(Duration::from_secs(5)))
            .unwrap();
        let mut request = Vec::new();
        let mut chunk = [0; 4096];
        loop {
            let size = stream.read(&mut chunk).unwrap();
            assert!(size > 0, "incomplete comment request");
            request.extend_from_slice(&chunk[..size]);
            if let Some(end) = request.windows(4).position(|part| part == b"\r\n\r\n") {
                let headers = String::from_utf8_lossy(&request[..end]);
                let length = headers
                    .lines()
                    .find_map(|line| {
                        let (name, value) = line.split_once(':')?;
                        name.eq_ignore_ascii_case("content-length")
                            .then(|| value.trim().parse::<usize>().unwrap())
                    })
                    .unwrap();
                if request.len() >= end + 4 + length {
                    break;
                }
            }
        }
        let body = r#"{"url":"https://example.test/comments/17"}"#;
        write!(stream, "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).unwrap();
        String::from_utf8(request).unwrap()
    });
    let draft = "**Keep this draft**\n\n- Retry safely\n- Preserve the amount";
    let url = azure_devops_work_item_comment_for(&config, "Payments/service", "issue", 42, draft)
        .unwrap();
    assert_eq!(url, "https://example.test/comments/17");
    let request = server.join().unwrap();
    assert!(request.starts_with("POST /Payments/_apis/wit/workitems/42/comments?format=markdown&api-version=7.1-preview.4 HTTP/1.1\r\n"));
    let payload: Value = serde_json::from_str(request.split_once("\r\n\r\n").unwrap().1).unwrap();
    assert_eq!(payload["text"], draft);
}
