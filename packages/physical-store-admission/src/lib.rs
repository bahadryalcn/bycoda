//! Mechanical coordination for participating users of one real physical file.
//!
//! All participants must use the same protected [`Registry`] root and this lock
//! protocol. Names derive from an open file's OS identity, never its pathname,
//! so hardlink aliases share a domain. The actual file is retained while any
//! reservation/fence exists. Every lock uses an independently opened `File`.
//!
//! This is **not** SQLite connection attestation, permission, writer discovery,
//! complete enrollment, durability, or an application/checkpoint receipt. A
//! supplied `File` says nothing about which SQLite connection a caller uses.
//! Nonparticipants and external namespace removal/replacement remain outside
//! this cooperative protocol. Do not remove sidecars while the registry is in
//! use. Unsupported platforms and detected namespace changes fail explicitly.

mod os;
#[cfg(windows)]
mod windows_copy_preflight;
pub mod guarded_copy;
mod guarded_metadata;
pub mod guarded_move;
pub mod guarded_move_paths;
pub mod guarded_snapshot;
mod rename_no_replace;
pub mod rename_no_replace_at;
pub use rename_no_replace::rename_no_replace;

use std::{
    error, fmt,
    fs::{File, TryLockError},
    io,
    path::{Path, PathBuf},
    sync::Arc,
};

const TURNSTILE: &str = "turnstile.lock";
const WRITERS: &str = "writers.lock";

/// Profile-canonical registry location shared by Native and Node adapters.
pub const DATABASE_REGISTRY_DIRECTORY: &str = ".bycoda-physical-admission-v1";

/// Derive a location from a caller's canonical absolute database path. This
/// performs no mkdir, file open, SQL operation or permission/connection grant.
/// The caller must establish canonical/profile/actual-connection provenance;
/// structural path validation here does not attest any of those properties.
pub fn database_registry_root(canonical_abs_database: &Path) -> Result<PathBuf, Error> {
    if !canonical_abs_database.is_absolute()
        || canonical_abs_database.file_name().is_none()
        || canonical_abs_database.components().any(|component| {
            matches!(
                component,
                std::path::Component::CurDir | std::path::Component::ParentDir
            )
        })
    {
        return Err(Error::Unsafe(
            "registry derivation requires a canonical absolute database path",
        ));
    }
    let parent = canonical_abs_database
        .parent()
        .filter(|path| path.is_absolute())
        .ok_or(Error::Unsafe(
            "canonical database path has no absolute parent",
        ))?;
    Ok(parent.join(DATABASE_REGISTRY_DIRECTORY))
}

/// The contested mechanical resource, not an application authorization state.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BusyResource {
    Ingress,
    Writers,
}

#[derive(Debug)]
pub enum Error {
    Busy(BusyResource),
    Unsupported(&'static str),
    Unsafe(&'static str),
    Changed(&'static str),
    Io {
        operation: &'static str,
        source: io::Error,
    },
}

impl Error {
    fn io(operation: &'static str, source: io::Error) -> Self {
        Self::Io { operation, source }
    }
}

impl fmt::Display for Error {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Busy(resource) => write!(formatter, "physical admission is busy: {resource:?}"),
            Self::Unsupported(reason) => {
                write!(formatter, "physical admission unsupported: {reason}")
            }
            Self::Unsafe(reason) => {
                write!(formatter, "unsafe physical admission namespace: {reason}")
            }
            Self::Changed(reason) => {
                write!(formatter, "physical admission namespace changed: {reason}")
            }
            Self::Io { operation, source } => write!(formatter, "{operation}: {source}"),
        }
    }
}

impl error::Error for Error {
    fn source(&self) -> Option<&(dyn error::Error + 'static)> {
        match self {
            Self::Io { source, .. } => Some(source),
            _ => None,
        }
    }
}

/// Opaque, OS-derived identity. There is deliberately no parser or field/path
/// constructor. This data is not an attestation of a SQL connection.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct PhysicalFileId {
    native: String,
    namespace: String,
}

impl PhysicalFileId {
    /// Inspect the OS identity and current link count of an actual open handle.
    /// This is read-only identity data, not SQL connection/permission evidence.
    pub fn inspect(actual: &File) -> Result<(Self, u64), Error> {
        os::file_identity(actual)
    }

    /// Stable existing Native identity representation. Not a constructor/token.
    pub fn native_format(&self) -> &str {
        &self.native
    }
}

impl fmt::Display for PhysicalFileId {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.native)
    }
}

#[derive(Debug)]
struct Directory {
    path: PathBuf,
    file: File,
    identity: PhysicalFileId,
}

impl Directory {
    fn open(path: &Path) -> Result<(Self, bool), Error> {
        let created = os::create_directory(path)?;
        let file = os::open_directory(path)?;
        let identity = os::file_identity(&file)?.0;
        let path = std::fs::canonicalize(path)
            .map_err(|error| Error::io("resolve registry directory", error))?;
        let directory = Self {
            path,
            file,
            identity,
        };
        directory.verify()?;
        Ok((directory, created))
    }

    fn verify(&self) -> Result<(), Error> {
        if os::file_identity(&self.file)?.0 != self.identity {
            return Err(Error::Changed("held directory"));
        }
        let current = os::open_directory(&self.path)?;
        if os::file_identity(&current)?.0 != self.identity {
            return Err(Error::Changed("directory pathname"));
        }
        Ok(())
    }
}

/// A caller-owned common coordination root. Its parent must already exist.
/// Creation uses a private Unix directory; existing insecure/link directories
/// are refused. On Windows the caller must also protect the root's ACL; this
/// crate rejects reparse points but does not attest ACL policy or user identity.
#[derive(Clone, Debug)]
pub struct Registry {
    root: Arc<Directory>,
}

impl Registry {
    pub fn open(protected_root: &Path) -> Result<Self, Error> {
        let (root, _) = Directory::open(protected_root)?;
        Ok(Self {
            root: Arc::new(root),
        })
    }

    /// Consume and retain an actual regular file. Hardlinks of this file are
    /// allowed; sidecar hardlinks are not. No SQLite open or SQL binding occurs.
    pub fn bind(&self, actual: File) -> Result<PhysicalStore, Error> {
        self.root.verify()?;
        let metadata = actual
            .metadata()
            .map_err(|error| Error::io("read physical file", error))?;
        if !metadata.is_file() {
            return Err(Error::Unsafe("the supplied physical file is not regular"));
        }
        let identity = os::file_identity(&actual)?.0;
        let path = self
            .root
            .path
            .join(format!("physical-v1-{}", identity.namespace));
        let (directory, created) = Directory::open(&path)?;
        // An existing incomplete namespace is not silently repaired. Someone
        // may still hold an old lock inode; a new file would split that cohort.
        let turnstile = os::safe_file(&directory.path.join(TURNSTILE), created)?;
        let writers = os::safe_file(&directory.path.join(WRITERS), created)?;
        let domain = Arc::new(Domain {
            root: Arc::clone(&self.root),
            directory,
            identity,
            actual,
            turnstile,
            writers,
        });
        domain.verify()?;
        Ok(PhysicalStore { domain })
    }
}

#[derive(Debug)]
struct Domain {
    root: Arc<Directory>,
    directory: Directory,
    identity: PhysicalFileId,
    actual: File,
    // Unlocked anchor handles pin these files on Windows and permit identity
    // revalidation elsewhere. They are NEVER cloned into lock ownership.
    turnstile: File,
    writers: File,
}

impl Domain {
    fn verify(&self) -> Result<(), Error> {
        self.root.verify()?;
        self.directory.verify()?;
        if !self
            .actual
            .metadata()
            .map_err(|error| Error::io("read held physical file", error))?
            .is_file()
            || os::file_identity(&self.actual)?.0 != self.identity
        {
            return Err(Error::Changed("held physical file"));
        }
        self.open_lock(TURNSTILE, &self.turnstile)?;
        self.open_lock(WRITERS, &self.writers)?;
        Ok(())
    }

    fn open_lock(&self, name: &str, anchor: &File) -> Result<File, Error> {
        os::check_sidecar(anchor)?;
        let current = os::safe_file(&self.directory.path.join(name), false)?;
        if os::file_identity(&current)?.0 != os::file_identity(anchor)?.0 {
            return Err(Error::Changed("lock sidecar"));
        }
        Ok(current)
    }

    fn fresh_locks(&self) -> Result<(File, File), Error> {
        self.verify()?;
        let turnstile = self.open_lock(TURNSTILE, &self.turnstile)?;
        let writers = self.open_lock(WRITERS, &self.writers)?;
        Ok((turnstile, writers))
    }
}

/// Cloneable mechanical domain, with independent fresh lock handles per call.
#[derive(Clone, Debug)]
pub struct PhysicalStore {
    domain: Arc<Domain>,
}

impl PhysicalStore {
    pub fn identity(&self) -> &PhysicalFileId {
        &self.domain.identity
    }

    /// Try once. An exclusive short turnstile serializes the admission step;
    /// the shared writer handle remains held after the turnstile is dropped.
    pub fn try_writer(&self) -> Result<WriterReservation, Error> {
        let (turnstile, writers) = self.domain.fresh_locks()?;
        try_exclusive(&turnstile, BusyResource::Ingress)?;
        match writers.try_lock_shared() {
            Ok(()) => {}
            Err(error) => return Err(lock_error(error, BusyResource::Writers)),
        }
        self.domain.verify()?;
        drop(turnstile);
        Ok(WriterReservation {
            domain: Arc::clone(&self.domain),
            _writers: writers,
        })
    }

    /// Close new ingress immediately, independently of existing writer drain.
    /// Returning this fence does NOT mean the existing writers have finished.
    pub fn try_begin_close(&self) -> Result<ClosingFence, Error> {
        let (turnstile, writers) = self.domain.fresh_locks()?;
        try_exclusive(&turnstile, BusyResource::Ingress)?;
        self.domain.verify()?;
        Ok(ClosingFence {
            domain: Arc::clone(&self.domain),
            turnstile,
            writers,
            writers_exclusive: false,
        })
    }
}

fn lock_error(error: TryLockError, resource: BusyResource) -> Error {
    match error {
        TryLockError::WouldBlock => Error::Busy(resource),
        TryLockError::Error(error) if error.kind() == io::ErrorKind::Unsupported => {
            Error::Unsupported("kernel file locks")
        }
        TryLockError::Error(error) => Error::io("try kernel file lock", error),
    }
}

fn try_exclusive(file: &File, resource: BusyResource) -> Result<(), Error> {
    file.try_lock().map_err(|error| lock_error(error, resource))
}

/// An actual shared kernel lock. Not Clone, serializable, or reconstructible.
/// Drop releases only this reservation's independently opened handle.
#[derive(Debug)]
#[must_use = "the actual writer must retain its reservation until it finishes"]
pub struct WriterReservation {
    _writers: File,
    domain: Arc<Domain>,
}

impl WriterReservation {
    pub fn identity(&self) -> &PhysicalFileId {
        &self.domain.identity
    }
}

/// Owns exclusive ingress closure while old writer handles may still be live.
#[derive(Debug)]
#[must_use = "retain ingress closure until the caller deliberately releases it"]
pub struct ClosingFence {
    writers: File,
    turnstile: File,
    domain: Arc<Domain>,
    writers_exclusive: bool,
}

impl ClosingFence {
    pub fn identity(&self) -> &PhysicalFileId {
        &self.domain.identity
    }

    /// A single nonblocking drain attempt. EVERY error returns this same live
    /// closing fence, including I/O/namespace errors, with no ingress gap.
    pub fn try_upgrade(mut self) -> Result<ClosedFence, UpgradeError> {
        let attempt = (|| {
            self.domain.verify()?;
            if !self.writers_exclusive {
                try_exclusive(&self.writers, BusyResource::Writers)?;
                self.writers_exclusive = true;
            }
            self.domain.verify()
        })();
        if let Err(error) = attempt {
            return Err(UpgradeError {
                error,
                closing: self,
            });
        }
        Ok(ClosedFence {
            domain: self.domain,
            _turnstile: self.turnstile,
            _writers: self.writers,
        })
    }
}

/// Upgrade failure keeps the original lock-owning fence alive. Dropping this
/// error is an explicit RAII release; inspect/return it while closure is needed.
#[derive(Debug)]
pub struct UpgradeError {
    error: Error,
    closing: ClosingFence,
}

impl UpgradeError {
    pub fn error(&self) -> &Error {
        &self.error
    }
    pub fn into_parts(self) -> (Error, ClosingFence) {
        (self.error, self.closing)
    }
}

impl fmt::Display for UpgradeError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        fmt::Display::fmt(&self.error, formatter)
    }
}

impl error::Error for UpgradeError {
    fn source(&self) -> Option<&(dyn error::Error + 'static)> {
        Some(&self.error)
    }
}

/// Exclusive writer lock AND original ingress lock, retained until Drop. This
/// proves only participating kernel-lock exclusion, never application authority.
#[derive(Debug)]
#[must_use = "dropping the closed fence reopens this mechanical ingress"]
pub struct ClosedFence {
    _writers: File,
    _turnstile: File,
    domain: Arc<Domain>,
}

impl ClosedFence {
    pub fn identity(&self) -> &PhysicalFileId {
        &self.domain.identity
    }
}

#[cfg(test)]
mod root_tests {
    use super::*;

    #[test]
    fn registry_root_is_only_canonical_parent_plus_shared_constant() {
        let parent = std::fs::canonicalize(std::env::temp_dir()).unwrap();
        let database = parent.join("bycoda-not-opened-by-registry-derivation.db");
        assert_eq!(
            database_registry_root(&database).unwrap(),
            parent.join(DATABASE_REGISTRY_DIRECTORY)
        );
        assert_eq!(
            database_registry_root(&parent.join("another.db")).unwrap(),
            database_registry_root(&database).unwrap()
        );
    }

    #[test]
    fn registry_derivation_refuses_relative_and_parent_traversal_inputs() {
        assert!(matches!(
            database_registry_root(Path::new("relative.db")),
            Err(Error::Unsafe(_))
        ));
        // Windows PathBuf::join on a verbatim canonical prefix normalizes `..`
        // before the helper sees it. Supply literal traversal, not a normalized
        // absolute path which no longer contains the rejected component.
        #[cfg(windows)]
        let traversal = Path::new(r"C:\physical-root\..\store.db");
        #[cfg(not(windows))]
        let traversal = Path::new("/physical-root/../store.db");
        assert!(matches!(
            database_registry_root(traversal),
            Err(Error::Unsafe(_))
        ));
        #[cfg(unix)]
        assert!(matches!(
            database_registry_root(Path::new("/")),
            Err(Error::Unsafe(_))
        ));
    }
}
