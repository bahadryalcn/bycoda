use super::Gateway;
use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::Deserialize;
use serde_json::json;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::TcpStream;
use std::time::{Duration, Instant};

const METHODS: &str = "OPTIONS, PROPFIND, GET, HEAD";
const CHUNK: u64 = 1024 * 1024;
const MAX_FILE: u64 = 1024 * 1024 * 1024;

struct Request {
    method: String,
    segments: Vec<String>,
    headers: HashMap<String, String>,
    discovery: bool,
}

fn decode_segment(value: &str) -> Result<String, String> {
    let mut bytes = Vec::with_capacity(value.len());
    let mut source = value.as_bytes().iter().copied();
    while let Some(byte) = source.next() {
        if byte == b'%' {
            let high = source
                .next()
                .and_then(|value| (value as char).to_digit(16))
                .ok_or("Invalid path encoding")?;
            let low = source
                .next()
                .and_then(|value| (value as char).to_digit(16))
                .ok_or("Invalid path encoding")?;
            bytes.push((high * 16 + low) as u8);
        } else {
            bytes.push(byte);
        }
    }
    let value = String::from_utf8(bytes).map_err(|_| "Invalid path encoding")?;
    if value.is_empty()
        || value == "."
        || value == ".."
        || value
            .chars()
            .any(|ch| ch.is_control() || ch == '/' || ch == '\\')
    {
        return Err("Invalid folder path".into());
    }
    Ok(value)
}

fn request(header: &str, port: u16, capability: &str) -> Result<Request, String> {
    let mut lines = header.split("\r\n");
    let fields: Vec<_> = lines.next().ok_or("Missing request")?.split(' ').collect();
    if fields.len() != 3 || !matches!(fields[2], "HTTP/1.0" | "HTTP/1.1") {
        return Err("Invalid request".into());
    }
    let method = fields[0].to_owned();
    let target = fields[1];
    if target.len() > 8192 || target.contains(['?', '#']) || target.starts_with("//") {
        return Err("Invalid folder address".into());
    }
    let authority = format!("127.0.0.1:{port}");
    let origin = format!("http://{authority}");
    let mut headers = HashMap::new();
    for line in lines {
        if line.is_empty() {
            continue;
        }
        let (name, value) = line.split_once(':').ok_or("Invalid request headers")?;
        if name.is_empty()
            || name
                .bytes()
                .any(|byte| !byte.is_ascii_alphanumeric() && byte != b'-')
            || value.chars().any(|ch| ch.is_control() && ch != '\t')
        {
            return Err("Invalid request headers".into());
        }
        let name = name.to_ascii_lowercase();
        if headers.insert(name, value.trim().to_owned()).is_some() {
            return Err("Duplicate request header".into());
        }
    }
    if headers.get("host") != Some(&authority)
        || headers.contains_key("transfer-encoding")
        || headers.get("origin").is_some_and(|value| value != &origin)
        || headers
            .get("referer")
            .is_some_and(|value| !value.starts_with(&format!("{origin}/")))
        || headers
            .get("sec-fetch-site")
            .is_some_and(|value| !matches!(value.as_str(), "none" | "same-origin"))
    {
        return Err("Only this computer's private folder address is allowed".into());
    }
    let discovery = (method == "OPTIONS" && matches!(target, "*" | "/"))
        || (method == "PROPFIND" && target == "/");
    let mut segments = Vec::new();
    if !discovery {
        let prefix = format!("/{capability}");
        let suffix = target
            .strip_prefix(&prefix)
            .ok_or("Unknown folder address")?;
        if !suffix.is_empty() && !suffix.starts_with('/') {
            return Err("Unknown folder address".into());
        }
        if suffix.contains("//") {
            return Err("Invalid folder path".into());
        }
        let suffix = suffix.strip_prefix('/').unwrap_or(suffix);
        let suffix = suffix.strip_suffix('/').unwrap_or(suffix);
        if !suffix.is_empty() {
            for part in suffix.split('/') {
                segments.push(decode_segment(part)?);
            }
        }
    }
    Ok(Request {
        method,
        segments,
        headers,
        discovery,
    })
}

fn encode_segment(value: &str) -> String {
    value
        .bytes()
        .map(|byte| {
            if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'~') {
                (byte as char).to_string()
            } else {
                format!("%{byte:02X}")
            }
        })
        .collect()
}

fn href(capability: &str, segments: &[String], directory: bool) -> String {
    format!(
        "/{}/{}{}",
        capability,
        segments
            .iter()
            .map(|part| encode_segment(part))
            .collect::<Vec<_>>()
            .join("/"),
        if directory && !segments.is_empty() {
            "/"
        } else {
            ""
        }
    )
}

fn xml(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}

fn etag(version: &str) -> String {
    format!("\"{:x}\"", Sha256::digest(version.as_bytes()))
}

fn matches_etag(header: &str, tag: &str, weak: bool) -> bool {
    header.split(',').map(str::trim).any(|candidate| {
        candidate == "*" || candidate == tag || (weak && candidate.strip_prefix("W/") == Some(tag))
    })
}

fn http_date(ms: f64) -> String {
    let date = time::OffsetDateTime::from_unix_timestamp((ms / 1000.0) as i64)
        .unwrap_or(time::OffsetDateTime::UNIX_EPOCH);
    let week = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
        [date.weekday().number_days_from_sunday() as usize];
    let month = [
        "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    ][date.month() as usize - 1];
    format!(
        "{week}, {:02} {month} {:04} {:02}:{:02}:{:02} GMT",
        date.day(),
        date.year(),
        date.hour(),
        date.minute(),
        date.second()
    )
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Entry {
    name: String,
    is_dir: bool,
    size: u64,
    mtime_ms: f64,
    version: String,
    #[serde(default)]
    entries: Vec<Entry>,
}

fn property_response(capability: &str, segments: &[String], entry: &Entry) -> String {
    property_response_at(&href(capability, segments, entry.is_dir), entry)
}

fn property_response_at(address: &str, entry: &Entry) -> String {
    format!("<D:response><D:href>{}</D:href><D:propstat><D:prop><D:displayname>{}</D:displayname><D:resourcetype>{}</D:resourcetype><D:getcontentlength>{}</D:getcontentlength><D:getcontenttype>{}</D:getcontenttype><D:getlastmodified>{}</D:getlastmodified><D:getetag>{}</D:getetag><D:supportedlock/><D:lockdiscovery/><D:current-user-privilege-set><D:privilege><D:read/></D:privilege></D:current-user-privilege-set><Z:Win32FileAttributes>{}</Z:Win32FileAttributes></D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>",
        xml(address), xml(&entry.name), if entry.is_dir { "<D:collection/>" } else { "" },
        entry.size, if entry.is_dir { "httpd/unix-directory" } else { "application/octet-stream" }, http_date(entry.mtime_ms),
        xml(&etag(&entry.version)), if entry.is_dir { "00000011" } else { "00000001" })
}

fn byte_range(value: Option<&str>, size: u64) -> Result<Option<(u64, u64)>, String> {
    let Some(value) = value else {
        return Ok(None);
    };
    let pair = value.strip_prefix("bytes=").ok_or("Invalid range")?;
    if pair.contains(',') || size == 0 {
        return Err("Invalid range".into());
    }
    let (start, end) = pair.split_once('-').ok_or("Invalid range")?;
    let number = |value: &str| -> Result<u64, String> {
        if value.is_empty() || !value.bytes().all(|byte| byte.is_ascii_digit()) {
            return Err("Invalid range".into());
        }
        value.parse().map_err(|_| "Invalid range".into())
    };
    if start.is_empty() {
        let suffix = number(end)?;
        if suffix == 0 {
            return Err("Invalid range".into());
        }
        return Ok(Some((size.saturating_sub(suffix), size - 1)));
    }
    let start = number(start)?;
    let end = if end.is_empty() {
        size - 1
    } else {
        number(end)?.min(size - 1)
    };
    if start >= size || end < start {
        return Err("Invalid range".into());
    }
    Ok(Some((start, end)))
}

fn headers(
    socket: &mut TcpStream,
    status: &str,
    length: u64,
    extra: &[(&str, String)],
) -> Result<(), String> {
    let mut value = format!("HTTP/1.1 {status}\r\nConnection: close\r\nContent-Length: {length}\r\nDAV: 1\r\nAllow: {METHODS}\r\nCache-Control: private, no-store\r\nX-Content-Type-Options: nosniff\r\n");
    for (name, content) in extra {
        value.push_str(&format!("{name}: {content}\r\n"));
    }
    value.push_str("\r\n");
    socket
        .write_all(value.as_bytes())
        .map_err(|error| error.to_string())
}

fn message(socket: &mut TcpStream, status: &str, body: &str) -> Result<(), String> {
    headers(
        socket,
        status,
        body.len() as u64,
        &[("Content-Type", "text/plain; charset=utf-8".into())],
    )?;
    socket
        .write_all(body.as_bytes())
        .map_err(|error| error.to_string())
}

pub(super) fn serve(mut socket: TcpStream, gateway: &Gateway) -> Result<(), String> {
    let deadline = Instant::now() + Duration::from_secs(15);
    let read_request = |socket: &mut TcpStream, buffer: &mut [u8]| -> Result<usize, String> {
        if !gateway.alive.load(std::sync::atomic::Ordering::Acquire) {
            return Err("The remote folder is disconnected".into());
        }
        let remaining = deadline
            .checked_duration_since(Instant::now())
            .filter(|duration| !duration.is_zero())
            .ok_or("Folder request timed out")?;
        socket
            .set_read_timeout(Some(remaining))
            .map_err(|error| error.to_string())?;
        socket.read(buffer).map_err(|error| error.to_string())
    };
    socket
        .set_write_timeout(Some(Duration::from_secs(30)))
        .map_err(|error| error.to_string())?;
    let mut bytes = Vec::new();
    let mut buffer = [0_u8; 4096];
    let end = loop {
        let count = read_request(&mut socket, &mut buffer)?;
        if count == 0 {
            return Ok(());
        }
        bytes.extend_from_slice(&buffer[..count]);
        if let Some(end) = bytes.windows(4).position(|part| part == b"\r\n\r\n") {
            break end;
        }
        if bytes.len() > 16 * 1024 {
            return message(
                &mut socket,
                "431 Request Header Fields Too Large",
                "Request headers are too large",
            );
        }
    };
    if end > 16 * 1024 {
        return message(
            &mut socket,
            "431 Request Header Fields Too Large",
            "Request headers are too large",
        );
    }
    let parsed = std::str::from_utf8(&bytes[..end])
        .map_err(|_| "Invalid request headers".to_string())
        .and_then(|header| request(header, gateway.port, &gateway.capability));
    let request = match parsed {
        Ok(value) => value,
        Err(_) => {
            return message(
                &mut socket,
                "403 Forbidden",
                "This private folder address is not available",
            )
        }
    };
    let length = match request.headers.get("content-length") {
        Some(length) if !length.is_empty() && length.bytes().all(|byte| byte.is_ascii_digit()) => {
            length.parse::<usize>().unwrap_or(usize::MAX)
        }
        Some(_) => return message(&mut socket, "400 Bad Request", "Invalid content length"),
        None => 0,
    };
    if length > 64 * 1024 || (request.method != "PROPFIND" && length != 0) {
        return message(
            &mut socket,
            "413 Content Too Large",
            "Request body is not supported",
        );
    }
    let mut received = bytes.len() - end - 4;
    if received > length {
        return message(
            &mut socket,
            "400 Bad Request",
            "Pipelined requests are not supported",
        );
    }
    // PROPFIND XML is deliberately not parsed: no entity resolution or request-controlled paths.
    while received < length {
        let count = read_request(&mut socket, &mut buffer[..(length - received).min(4096)])?;
        if count == 0 {
            return Ok(());
        }
        received += count;
    }
    if request.method == "OPTIONS" {
        return headers(&mut socket, "200 OK", 0, &[("MS-Author-Via", "DAV".into())]);
    }
    if !matches!(request.method.as_str(), "PROPFIND" | "GET" | "HEAD") {
        return message(
            &mut socket,
            "405 Method Not Allowed",
            "This connected folder is read-only",
        );
    }
    if request.method == "PROPFIND" {
        let depth = request
            .headers
            .get("depth")
            .map(String::as_str)
            .unwrap_or("1");
        if !matches!(depth, "0" | "1") {
            return message(
                &mut socket,
                "403 Forbidden",
                "Only folder depth 0 or 1 is supported",
            );
        }
        if request.discovery {
            // Native WebDAV clients may inspect the server ancestor. This public
            // synthetic root never names or enumerates any capability or host folder.
            let root = Entry {
                name: "bycoda".into(),
                is_dir: true,
                size: 0,
                mtime_ms: 0.0,
                version: "readonly-discovery".into(),
                entries: vec![],
            };
            let body = format!("<?xml version=\"1.0\" encoding=\"utf-8\"?><D:multistatus xmlns:D=\"DAV:\" xmlns:Z=\"urn:schemas-microsoft-com:\">{}</D:multistatus>", property_response_at("/", &root));
            headers(
                &mut socket,
                "207 Multi-Status",
                body.len() as u64,
                &[("Content-Type", "application/xml; charset=utf-8".into())],
            )?;
            return socket
                .write_all(body.as_bytes())
                .map_err(|error| error.to_string());
        }
        let entry = gateway
            .call(
                "read_folder_entry",
                &request.segments,
                json!({"children":depth == "1"}),
            )
            .and_then(|value| {
                serde_json::from_value::<Entry>(value).map_err(|_| "Invalid folder metadata".into())
            });
        let entry = match entry {
            Ok(entry) => entry,
            Err(_) => {
                return message(
                    &mut socket,
                    "404 Not Found",
                    "The folder entry is unavailable",
                )
            }
        };
        if entry.entries.len() > 2000 {
            return message(
                &mut socket,
                "507 Insufficient Storage",
                "This folder has too many entries",
            );
        }
        let mut body = format!("<?xml version=\"1.0\" encoding=\"utf-8\"?><D:multistatus xmlns:D=\"DAV:\" xmlns:Z=\"urn:schemas-microsoft-com:\">{}", property_response(&gateway.capability, &request.segments, &entry));
        if depth == "1" && entry.is_dir {
            for child in entry.entries {
                if child.name.is_empty()
                    || child.name == "."
                    || child.name == ".."
                    || child
                        .name
                        .chars()
                        .any(|ch| ch.is_control() || ch == '/' || ch == '\\')
                {
                    continue;
                }
                let mut segments = request.segments.clone();
                segments.push(child.name.clone());
                body.push_str(&property_response(&gateway.capability, &segments, &child));
                if body.len() > 1024 * 1024 {
                    return message(
                        &mut socket,
                        "507 Insufficient Storage",
                        "Folder properties are too large",
                    );
                }
            }
        }
        body.push_str("</D:multistatus>");
        headers(
            &mut socket,
            "207 Multi-Status",
            body.len() as u64,
            &[("Content-Type", "application/xml; charset=utf-8".into())],
        )?;
        return socket
            .write_all(body.as_bytes())
            .map_err(|error| error.to_string());
    }
    let info = match gateway.call("read_file_info", &request.segments, json!({})) {
        Ok(info) => info,
        Err(_) => {
            if request.method == "HEAD"
                && gateway
                    .call(
                        "read_folder_entry",
                        &request.segments,
                        json!({"children":false}),
                    )
                    .is_ok_and(|entry| entry["isDir"].as_bool() == Some(true))
            {
                return headers(
                    &mut socket,
                    "200 OK",
                    0,
                    &[("Content-Type", "httpd/unix-directory".into())],
                );
            }
            if request.method == "HEAD" {
                return headers(&mut socket, "404 Not Found", 0, &[]);
            }
            return message(
                &mut socket,
                "404 Not Found",
                "This file cannot be read through the connected folder",
            );
        }
    };
    let size = info["size"]
        .as_u64()
        .filter(|size| *size <= MAX_FILE)
        .ok_or("Invalid file size")?;
    let version = info["version"]
        .as_str()
        .filter(|version| version.len() <= 256)
        .ok_or("Invalid file version")?;
    let tag = etag(version);
    if request
        .headers
        .get("if-match")
        .is_some_and(|value| !matches_etag(value, &tag, false))
    {
        return headers(&mut socket, "412 Precondition Failed", 0, &[("ETag", tag)]);
    }
    if request
        .headers
        .get("if-none-match")
        .is_some_and(|value| matches_etag(value, &tag, true))
    {
        return headers(&mut socket, "304 Not Modified", 0, &[("ETag", tag)]);
    }
    let range_header = if request
        .headers
        .get("if-range")
        .is_some_and(|value| value != &tag)
    {
        None
    } else {
        request.headers.get("range").map(String::as_str)
    };
    let range = match byte_range(range_header, size) {
        Ok(range) => range,
        Err(_) => {
            return headers(
                &mut socket,
                "416 Range Not Satisfiable",
                0,
                &[("Content-Range", format!("bytes */{size}"))],
            )
        }
    };
    let (mut offset, length, status) = match range {
        Some((start, end)) => (start, end - start + 1, "206 Partial Content"),
        None => (0, size, "200 OK"),
    };
    let mut extra = vec![
        ("Content-Type", "application/octet-stream".into()),
        ("Accept-Ranges", "bytes".into()),
        ("ETag", tag),
    ];
    if let Some((start, end)) = range {
        extra.push(("Content-Range", format!("bytes {start}-{end}/{size}")));
    }
    headers(&mut socket, status, length, &extra)?;
    if request.method == "HEAD" {
        return Ok(());
    }
    let until = offset + length;
    while offset < until {
        let length = CHUNK.min(until - offset);
        let chunk = gateway.call(
            "read_file_chunk",
            &request.segments,
            json!({"version":version,"offset":offset,"length":length}),
        )?;
        if chunk["offset"].as_u64() != Some(offset) {
            return Err("Invalid file chunk".into());
        }
        let data = chunk["data"]
            .as_str()
            .filter(|data| data.len() <= (CHUNK as usize).div_ceil(3) * 4)
            .ok_or("Invalid file chunk")?;
        let data = STANDARD.decode(data).map_err(|_| "Invalid file chunk")?;
        if data.is_empty()
            || data.len() as u64 > length
            || chunk["length"].as_u64() != Some(data.len() as u64)
        {
            return Err("Invalid file chunk length".into());
        }
        socket.write_all(&data).map_err(|error| error.to_string())?;
        offset += data.len() as u64;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::remote::folder_access::{listen, Reader};
    use serde_json::Value;
    use std::sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    };

    struct Fixture {
        calls: Mutex<Vec<(String, Value)>>,
        connected: AtomicBool,
        bytes: Vec<u8>,
        fail_after_first: bool,
    }
    impl Reader for Fixture {
        fn current(&self) -> bool {
            self.connected.load(Ordering::SeqCst)
        }
        fn call(&self, command: &str, args: Value) -> Result<Value, String> {
            self.calls
                .lock()
                .unwrap()
                .push((command.to_owned(), args.clone()));
            match command {
                "read_folder_entry" => Ok(
                    json!({"name":"project & files","isDir":true,"size":0,"mtimeMs":0,"version":"v1",
                    "entries":if args["children"] == true { vec![json!({"name":"ölçüm & <1>.pdf","isDir":false,"size":self.bytes.len(),"mtimeMs":0,"version":"v1"})] } else {vec![]} }),
                ),
                "read_file_info" => Ok(json!({"size":self.bytes.len(),"version":"v1"})),
                "read_file_chunk" => {
                    let offset = args["offset"].as_u64().unwrap() as usize;
                    if self.fail_after_first && offset > 0 {
                        return Err("File version changed".into());
                    }
                    let length =
                        (args["length"].as_u64().unwrap() as usize).min(self.bytes.len() - offset);
                    Ok(
                        json!({"offset":offset,"length":length,"data":STANDARD.encode(&self.bytes[offset..offset+length])}),
                    )
                }
                _ => Err("Unsupported command".into()),
            }
        }
    }

    fn fixture(bytes: Vec<u8>, fail_after_first: bool) -> (Arc<Fixture>, Arc<Gateway>) {
        let source = Arc::new(Fixture {
            calls: Mutex::new(vec![]),
            connected: AtomicBool::new(true),
            bytes,
            fail_after_first,
        });
        let gateway = listen(
            source.clone(),
            "/repo/selected".into(),
            "selected-id".into(),
            "machine".into(),
            "env".into(),
        )
        .unwrap();
        (source, gateway)
    }

    fn exchange(gateway: &Gateway, method: &str, path: &str, extra: &str) -> Vec<u8> {
        let (bytes, result) = exchange_result(gateway, method, path, extra);
        if let Err(error) = result {
            // macOS can reset a closed socket after the complete HTTP response.
            // Accept it only when HTTP framing proves no response bytes are missing.
            assert_eq!(error.kind(), std::io::ErrorKind::ConnectionReset);
            let end = bytes
                .windows(4)
                .position(|part| part == b"\r\n\r\n")
                .expect("complete response headers");
            let header = std::str::from_utf8(&bytes[..end]).unwrap();
            let length = header
                .lines()
                .find_map(|line| line.strip_prefix("Content-Length: "))
                .expect("response content length")
                .parse::<usize>()
                .unwrap();
            let body_length = if method == "HEAD" { 0 } else { length };
            assert_eq!(bytes.len(), end + 4 + body_length, "truncated response");
        }
        bytes
    }

    fn exchange_result(
        gateway: &Gateway,
        method: &str,
        path: &str,
        extra: &str,
    ) -> (Vec<u8>, std::io::Result<usize>) {
        let mut socket = TcpStream::connect(("127.0.0.1", gateway.port)).unwrap();
        socket
            .set_read_timeout(Some(Duration::from_secs(3)))
            .unwrap();
        write!(
            socket,
            "{method} {path} HTTP/1.1\r\nHost: 127.0.0.1:{}\r\n{extra}\r\n",
            gateway.port
        )
        .unwrap();
        let mut bytes = Vec::new();
        let result = socket.read_to_end(&mut bytes);
        (bytes, result)
    }

    #[test]
    fn paths_headers_and_query_strings_cannot_escape_the_capability_root() {
        let header = |path: &str, extra: &str| {
            format!("GET {path} HTTP/1.1\r\nHost: 127.0.0.1:1234\r\n{extra}")
        };
        for path in [
            "/wrong/",
            "/token-other/",
            "/token/../secret",
            "/token/%2e%2e/secret",
            "/token/%2Fsecret",
            "/token/%5Csecret",
            "/token//",
            "/token/file?path=/secret",
            "/token/file#fragment",
            "http://127.0.0.1:1234/token/",
        ] {
            assert!(
                request(&header(path, ""), 1234, "token").is_err(),
                "accepted {path}"
            );
        }
        for extra in [
            "Origin: https://evil.example\r\n",
            "Sec-Fetch-Site: cross-site\r\n",
            "Host: 127.0.0.1:1234\r\n",
            "Transfer-Encoding: chunked\r\n",
            "Referer: http://127.0.0.1:12340/token/\r\n",
        ] {
            assert!(request(&header("/token/file", extra), 1234, "token").is_err());
        }
        let parsed = request(
            &header("/token/%C3%B6zet%20%26%20plan.pdf", ""),
            1234,
            "token",
        )
        .unwrap();
        assert_eq!(parsed.segments, ["özet & plan.pdf"]);
        // Decode exactly once: a literal percent-encoded-looking filename is not traversal.
        assert_eq!(
            request(&header("/token/%252e%252e", ""), 1234, "token")
                .unwrap()
                .segments,
            ["%2e%2e"]
        );
    }

    #[test]
    fn ranges_are_single_bounded_and_support_suffix_and_open_end() {
        assert_eq!(byte_range(Some("bytes=2-4"), 10).unwrap(), Some((2, 4)));
        assert_eq!(byte_range(Some("bytes=7-"), 10).unwrap(), Some((7, 9)));
        assert_eq!(byte_range(Some("bytes=-3"), 10).unwrap(), Some((7, 9)));
        for value in [
            "bytes=0-1,4-5",
            "bytes=-0",
            "bytes=10-",
            "bytes=9-2",
            "bytes=+1-3",
            "bytes=18446744073709551616-",
        ] {
            assert!(byte_range(Some(value), 10).is_err());
        }
        assert!(byte_range(Some("bytes=0-"), 0).is_err());
    }

    #[test]
    fn live_loopback_propfind_get_head_and_readonly_denials_work_without_mounting() {
        let (source, gateway) = fixture(b"abcdef".to_vec(), false);
        let root = format!("/{}/", gateway.capability);
        let public =
            String::from_utf8(exchange(&gateway, "PROPFIND", "/", "Depth: 1\r\n")).unwrap();
        assert!(public.starts_with("HTTP/1.1 207"));
        assert!(!public.contains(&gateway.capability));
        assert!(!public.contains("selected"));
        assert!(source.calls.lock().unwrap().is_empty());
        let response =
            String::from_utf8(exchange(&gateway, "PROPFIND", &root, "Depth: 1\r\n")).unwrap();
        assert!(response.starts_with("HTTP/1.1 207"));
        assert!(response.contains("project &amp; files"));
        assert!(response.contains("%C3%B6l%C3%A7%C3%BCm%20%26%20%3C1%3E.pdf"));
        assert!(response.contains("<D:read/>"));
        assert!(response.contains("<Z:Win32FileAttributes>00000011</Z:Win32FileAttributes>"));
        let file = format!("{root}file.pdf");
        let response =
            String::from_utf8(exchange(&gateway, "GET", &file, "Range: bytes=1-3\r\n")).unwrap();
        assert!(response.starts_with("HTTP/1.1 206"));
        assert!(response.contains("Content-Range: bytes 1-3/6"));
        assert!(response.ends_with("\r\n\r\nbcd"));
        let before = source
            .calls
            .lock()
            .unwrap()
            .iter()
            .filter(|(method, _)| method == "read_file_chunk")
            .count();
        let response = String::from_utf8(exchange(&gateway, "HEAD", &file, "")).unwrap();
        assert!(response.contains("Content-Length: 6"));
        assert!(response.ends_with("\r\n\r\n"));
        assert_eq!(
            source
                .calls
                .lock()
                .unwrap()
                .iter()
                .filter(|(method, _)| method == "read_file_chunk")
                .count(),
            before
        );
        let mismatch = String::from_utf8(exchange(
            &gateway,
            "GET",
            &file,
            "Range: bytes=1-3\r\nIf-Match: \"old-version\"\r\n",
        ))
        .unwrap();
        assert!(mismatch.starts_with("HTTP/1.1 412"));
        assert_eq!(
            source
                .calls
                .lock()
                .unwrap()
                .iter()
                .filter(|(method, _)| method == "read_file_chunk")
                .count(),
            before
        );
        assert!(String::from_utf8(exchange(&gateway, "PUT", &file, ""))
            .unwrap()
            .starts_with("HTTP/1.1 405"));
        assert!(
            String::from_utf8(exchange(&gateway, "PROPFIND", &root, "Depth: infinity\r\n"))
                .unwrap()
                .starts_with("HTTP/1.1 403")
        );
        for (_, args) in source.calls.lock().unwrap().iter() {
            assert_eq!(args["root"], "/repo/selected");
            assert_eq!(args["rootIdentity"], "selected-id");
        }
        gateway.stop();
    }

    #[test]
    fn disconnected_or_changed_files_never_complete_a_successful_transfer() {
        let (source, gateway) = fixture(vec![7; CHUNK as usize + 2], true);
        let file = format!("/{}/movie.mp4", gateway.capability);
        let (response, result) = exchange_result(&gateway, "GET", &file, "");
        if let Err(error) = result {
            assert_eq!(error.kind(), std::io::ErrorKind::ConnectionReset);
        }
        let header_end = response
            .windows(4)
            .position(|part| part == b"\r\n\r\n")
            .unwrap()
            + 4;
        // Aborting a changed file can reset the TCP connection before all
        // previously written bytes reach the peer. The declared transfer must
        // remain incomplete, regardless of how many first-chunk bytes arrived.
        let body_len = response.len() - header_end;
        assert!(body_len <= CHUNK as usize);
        assert!(String::from_utf8_lossy(&response[..header_end])
            .contains(&format!("Content-Length: {}", CHUNK + 2)));
        source.connected.store(false, Ordering::SeqCst);
        let response = String::from_utf8(exchange(&gateway, "GET", &file, "")).unwrap();
        assert!(response.starts_with("HTTP/1.1 404"));
        gateway.stop();
    }
}
