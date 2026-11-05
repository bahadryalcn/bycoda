//! Handle-relative copying primitive. Callers must retain and validate both
//! parent directory handles, and own publication, receipts and recovery.
use crate::guarded_metadata::child_metadata;
use std::{ffi::OsStr, io::{self, Read, Seek, Write}};
use cap_std::fs::{Dir, OpenOptions};
use cap_fs_ext::{DirExt, FollowSymlinks, MetadataExt, OpenOptionsFollowExt};

/// Fill `buffer` until it is full or EOF, so chunk boundaries never depend on short reads.
fn read_full(reader: &mut impl Read, buffer: &mut [u8]) -> io::Result<usize> {
    let mut filled = 0;
    while filled < buffer.len() {
        match reader.read(&mut buffer[filled..]) {
            Ok(0) => break,
            Ok(count) => filled += count,
            Err(error) if error.kind() == io::ErrorKind::Interrupted => {}
            Err(error) => return Err(error),
        }
    }
    Ok(filled)
}

fn names(dir: &Dir) -> io::Result<Vec<std::ffi::OsString>> {
    let mut result = dir.entries()?.map(|e| e.map(|v| v.file_name())).collect::<io::Result<Vec<_>>>()?;
    result.sort();
    Ok(result)
}

/// Copy one child without following symbolic links. Destination must be absent.
/// This primitive does not retire source or claim external writers are closed.
pub fn copy_child_no_follow(source: &Dir, name: &OsStr, dest: &Dir, target: &OsStr) -> io::Result<()> {
    let meta = child_metadata(source, name)?;
    let kind = meta.file_type();
    if kind.is_symlink() {
        #[cfg(windows)]
        return Err(io::Error::new(io::ErrorKind::Unsupported, "Windows symbolic-link ACLs cannot yet be preserved"));
        #[cfg(not(windows))]
        let link = source.read_link_contents(name)?;
        #[cfg(not(windows))] dest.symlink_contents(&link, target)?;
        #[cfg(not(windows))]
        if let Ok(modified) = meta.modified() {
            dest.set_symlink_times(target, None, Some(cap_fs_ext::SystemTimeSpec::Absolute(modified)))?;
        }
        #[cfg(not(windows))]
        if source.read_link_contents(name)? != link { return Err(io::Error::other("Source link changed during copy")); }
    } else if kind.is_dir() {
        let input = source.open_dir_nofollow(name)?;
        let opened = input.dir_metadata()?;
        if meta.dev() != opened.dev() || meta.ino() != opened.ino() { return Err(io::Error::other("Source directory replaced")); }
        let before = names(&input)?;
        dest.create_dir(target)?;
        let output = dest.open_dir_nofollow(target)?;
        for child in &before { copy_child_no_follow(&input, child, &output, child)?; }
        let after = child_metadata(source, name)?;
        if names(&input)? != before || meta.dev() != after.dev() || meta.ino() != after.ino() || meta.modified().ok() != after.modified().ok() { return Err(io::Error::other("Source directory changed during copy")); }
        #[cfg(not(windows))]
        let handle = output.into_std_file();
        #[cfg(windows)]
        let handle = {
            use cap_fs_ext::OpenOptionsMaybeDirExt;
            use cap_primitives::fs::OpenOptionsExt;
            use windows_sys::Win32::Storage::FileSystem::{FILE_READ_ATTRIBUTES, FILE_WRITE_ATTRIBUTES, FILE_SHARE_READ, FILE_SHARE_WRITE};
            let mut options = OpenOptions::new();
            options.read(true).maybe_dir(true).follow(FollowSymlinks::No);
            options.access_mode(FILE_READ_ATTRIBUTES | FILE_WRITE_ATTRIBUTES | 0x0002_0000).share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE);
            dest.open_with(target, &options)?.into_std()
        };
        handle.set_permissions(meta.permissions().into_std(&handle)?)?;
        if let Ok(modified) = meta.modified() { handle.set_times(std::fs::FileTimes::new().set_modified(modified.into_std()))?; }
        #[cfg(windows)] crate::windows_copy_preflight::verify(&input.try_clone()?.into_std_file(), &handle)?;
        #[cfg(unix)] handle.sync_all()?;
    } else if kind.is_file() {
        let mut options = OpenOptions::new();
        options.read(true).follow(FollowSymlinks::No);
        #[cfg(windows)]
        { use cap_primitives::fs::OpenOptionsExt; options.share_mode(0x0000_0001 | 0x0000_0002); }
        let input = source.open_with(name, &options)?;
        let opened = input.metadata()?;
        if meta.dev() != opened.dev() || meta.ino() != opened.ino() { return Err(io::Error::other("Source file replaced")); }
        let mut input = input.into_std();
        let before = input.metadata()?;
        if !before.is_file() { return Err(io::Error::other("Source changed while opening")); }
        let mut options = OpenOptions::new();
        options.read(true).write(true).create_new(true).follow(FollowSymlinks::No);
        #[cfg(windows)]
        { use cap_primitives::fs::OpenOptionsExt; options.share_mode(0x0000_0001 | 0x0000_0002); }
        let mut output = dest.open_with(target, &options)?.into_std();
        let mut buffer = [0u8; 65536];
        loop { let count = input.read(&mut buffer)?; if count == 0 { break; } output.write_all(&buffer[..count])?; }
        input.rewind()?;
        output.rewind()?;
        let mut copied = [0u8; 65536];
        loop {
            let source_count = read_full(&mut input, &mut buffer)?;
            let copied_count = read_full(&mut output, &mut copied)?;
            if source_count != copied_count || buffer[..source_count] != copied[..copied_count] {
                return Err(io::Error::other("Copied file differs from source"));
            }
            if source_count == 0 { break; }
        }
        let after = input.metadata()?;
        if before.len() != after.len() || before.modified().ok() != after.modified().ok() {
            return Err(io::Error::other("Source file changed during copy"));
        }
        let current = child_metadata(source, name)?;
        if meta.dev() != current.dev() || meta.ino() != current.ino() { return Err(io::Error::other("Source file replaced during copy")); }
        output.set_permissions(before.permissions())?;
        if let Ok(modified) = before.modified() { output.set_times(std::fs::FileTimes::new().set_modified(modified))?; }
        #[cfg(windows)] crate::windows_copy_preflight::verify(&input, &output)?;
        output.sync_all()?;
    } else {
        return Err(io::Error::new(io::ErrorKind::Unsupported, "Special files are not supported"));
    }
    Ok(())
}
