use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;

use serde::Serialize;
use sha2::{Digest, Sha256};

use super::MAX_ATTACHMENT_EMBED_BYTES;

const MAX_CHUNK_BYTES: u64 = 512 * 1024;
const HASH_BUFFER_BYTES: usize = 64 * 1024;

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentChunk {
    data: String,
    offset: u64,
    size: u64,
}

fn open_attachment(path: &Path, size: u64, offset: u64) -> Result<File, String> {
    if size > MAX_ATTACHMENT_EMBED_BYTES || offset > size {
        return Err("Invalid attachment size or offset".into());
    }
    let file = File::open(path).map_err(|error| format!("{}: {error}", path.display()))?;
    let metadata = file.metadata().map_err(|error| error.to_string())?;
    if !metadata.is_file() || metadata.len() != size {
        return Err("Attachment size changed or is not a file".into());
    }
    Ok(file)
}

pub(super) fn read_chunk(
    path: &Path,
    size: u64,
    offset: u64,
    length: u64,
) -> Result<AttachmentChunk, String> {
    if length > MAX_CHUNK_BYTES {
        return Err("Attachment chunk is too large".into());
    }
    let mut file = open_attachment(path, size, offset)?;
    file.seek(SeekFrom::Start(offset))
        .map_err(|error| error.to_string())?;
    let mut bytes = vec![0; length.min(size - offset) as usize];
    file.read_exact(&mut bytes)
        .map_err(|error| error.to_string())?;
    if file.metadata().map_err(|error| error.to_string())?.len() != size {
        return Err("Attachment size changed".into());
    }
    Ok(AttachmentChunk {
        data: base64::Engine::encode(&base64::engine::general_purpose::STANDARD, &bytes),
        offset: offset + bytes.len() as u64,
        size,
    })
}

pub(super) fn hash_prefix(path: &Path, size: u64, offset: u64) -> Result<String, String> {
    let mut file = open_attachment(path, size, offset)?;
    let mut remaining = offset;
    let mut bytes = [0_u8; HASH_BUFFER_BYTES];
    let mut hash = Sha256::new();
    while remaining > 0 {
        let length = remaining.min(HASH_BUFFER_BYTES as u64) as usize;
        file.read_exact(&mut bytes[..length])
            .map_err(|error| error.to_string())?;
        hash.update(&bytes[..length]);
        remaining -= length as u64;
    }
    if file.metadata().map_err(|error| error.to_string())?.len() != size {
        return Err("Attachment size changed".into());
    }
    Ok(format!("{:x}", hash.finalize()))
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Fixture(std::path::PathBuf);

    impl Fixture {
        fn new(bytes: &[u8]) -> Self {
            let directory = std::env::temp_dir()
                .join(format!("bycoda-attachment-reads-{}", uuid::Uuid::new_v4()));
            std::fs::create_dir(&directory).unwrap();
            std::fs::write(directory.join("file"), bytes).unwrap();
            Self(directory)
        }

        fn path(&self) -> std::path::PathBuf {
            self.0.join("file")
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn attachment_read_chunks_resume_at_unaligned_offsets_and_keep_the_bound() {
        let bytes: Vec<u8> = (0..600_000).map(|index| (index % 251) as u8).collect();
        let fixture = Fixture::new(&bytes);
        let chunk = read_chunk(&fixture.path(), bytes.len() as u64, 5, MAX_CHUNK_BYTES).unwrap();
        assert_eq!(chunk.offset, 5 + MAX_CHUNK_BYTES);
        assert_eq!(chunk.size, bytes.len() as u64);
        assert_eq!(
            base64::Engine::decode(&base64::engine::general_purpose::STANDARD, &chunk.data)
                .unwrap(),
            bytes[5..5 + MAX_CHUNK_BYTES as usize]
        );
        let final_chunk = read_chunk(
            &fixture.path(),
            bytes.len() as u64,
            chunk.offset,
            MAX_CHUNK_BYTES,
        )
        .unwrap();
        assert_eq!(final_chunk.offset, bytes.len() as u64);
        assert!(read_chunk(&fixture.path(), bytes.len() as u64, 0, MAX_CHUNK_BYTES + 1).is_err());
    }

    #[test]
    fn attachment_prefix_hashes_stream_across_buffer_boundaries() {
        let bytes = vec![7_u8; 5 * 1024 * 1024 + 1];
        let fixture = Fixture::new(&bytes);
        for offset in [1, HASH_BUFFER_BYTES - 1, HASH_BUFFER_BYTES + 1, bytes.len()] {
            assert_eq!(
                hash_prefix(&fixture.path(), bytes.len() as u64, offset as u64).unwrap(),
                format!("{:x}", Sha256::digest(&bytes[..offset]))
            );
        }
    }

    #[test]
    fn attachment_read_and_hash_reject_wrong_sizes_offsets_and_directories() {
        let fixture = Fixture::new(b"abcdef");
        assert!(read_chunk(&fixture.path(), 7, 0, 6).is_err());
        assert!(read_chunk(&fixture.path(), 6, 7, 6).is_err());
        assert!(hash_prefix(&fixture.path(), 6, 7).is_err());
        assert!(hash_prefix(&fixture.path(), MAX_ATTACHMENT_EMBED_BYTES + 1, 0).is_err());
        assert!(read_chunk(&fixture.0, 0, 0, 0).is_err());
        assert!(read_chunk(&fixture.0.join("unknown"), 0, 0, 0).is_err());
        assert!(hash_prefix(&fixture.0.join("unknown"), 0, 0).is_err());
    }

    #[test]
    fn attachment_read_detects_resize_between_upload_chunks() {
        let fixture = Fixture::new(b"abcdef");
        assert_eq!(read_chunk(&fixture.path(), 6, 0, 3).unwrap().offset, 3);
        std::fs::write(fixture.path(), b"abc").unwrap();
        assert!(read_chunk(&fixture.path(), 6, 3, 3).is_err());
        assert!(hash_prefix(&fixture.path(), 6, 3).is_err());
    }

    #[test]
    fn attachment_read_and_hash_accept_zero_byte_files() {
        let fixture = Fixture::new(b"");
        assert_eq!(
            read_chunk(&fixture.path(), 0, 0, MAX_CHUNK_BYTES).unwrap(),
            AttachmentChunk {
                data: String::new(),
                offset: 0,
                size: 0
            }
        );
        assert_eq!(
            hash_prefix(&fixture.path(), 0, 0).unwrap(),
            format!("{:x}", Sha256::digest([]))
        );
    }
}
