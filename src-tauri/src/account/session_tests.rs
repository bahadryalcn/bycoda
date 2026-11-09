use super::error::{AccountError, ErrorKind};
use super::keychain::{MemoryStore, SecretStore};
use super::session::*;
use super::tokens::{TokenBackend, TokenError, TokenSet};
use std::sync::{Arc, Mutex};

const ACCOUNT: &str = "refresh-token:test";

struct Fake {
    reply: Mutex<Option<Result<TokenSet, TokenError>>>,
    refreshes: Mutex<u32>,
    revoked: Mutex<Vec<String>>,
}

impl Fake {
    fn replying(reply: Result<TokenSet, TokenError>) -> Arc<Self> {
        Arc::new(Self {
            reply: Mutex::new(Some(reply)),
            refreshes: Mutex::new(0),
            revoked: Mutex::new(Vec::new()),
        })
    }
}

impl TokenBackend for Fake {
    fn refresh(&self, _: &str) -> Result<TokenSet, TokenError> {
        *self.refreshes.lock().unwrap() += 1;
        self.reply.lock().unwrap().take().expect("one refresh")
    }
    fn revoke(&self, refresh_token: &str) {
        self.revoked.lock().unwrap().push(refresh_token.into());
    }
}

struct Shared(Arc<MemoryStore>);

impl SecretStore for Shared {
    fn get(&self, account: &str) -> Result<Option<String>, AccountError> {
        self.0.get(account)
    }
    fn set(&self, account: &str, secret: &str) -> Result<(), AccountError> {
        self.0.set(account, secret)
    }
    fn delete(&self, account: &str) -> Result<(), AccountError> {
        self.0.delete(account)
    }
}

fn tokens(access: &str, refresh: Option<&str>) -> TokenSet {
    TokenSet {
        access_token: access.into(),
        refresh_token: refresh.map(str::to_string),
        expires_in: 3600,
    }
}

fn session(reply: Result<TokenSet, TokenError>) -> (Session, Arc<MemoryStore>, Arc<Fake>) {
    let store = Arc::new(MemoryStore::default());
    let fake = Fake::replying(reply);
    let session = Session::new(
        Box::new(Shared(store.clone())),
        Box::new(fake.clone()),
        ACCOUNT.into(),
    );
    (session, store, fake)
}

#[test]
fn signed_out_without_a_stored_refresh_token() {
    let (session, _, fake) = session(Ok(tokens("a", None)));
    assert_eq!(
        session.access_token(0).unwrap_err().kind,
        ErrorKind::SignedOut
    );
    assert_eq!(*fake.refreshes.lock().unwrap(), 0);
}

#[test]
fn sign_in_stores_only_the_refresh_token_and_serves_the_cached_access_token() {
    let (session, store, fake) = session(Ok(tokens("unused", None)));
    session
        .save_sign_in(tokens("access-1", Some("refresh-1")), 1_000)
        .unwrap();
    assert_eq!(store.get(ACCOUNT).unwrap().as_deref(), Some("refresh-1"));
    assert_eq!(store.0.lock().unwrap().len(), 1);
    assert_eq!(
        session.access_token(2_000).unwrap().access_token,
        "access-1"
    );
    assert_eq!(*fake.refreshes.lock().unwrap(), 0);
}

#[test]
fn sign_in_without_a_refresh_token_is_rejected() {
    let (session, store, _) = session(Ok(tokens("a", None)));
    assert!(session.save_sign_in(tokens("a", None), 0).is_err());
    assert_eq!(store.get(ACCOUNT).unwrap(), None);
}

#[test]
fn expired_access_token_refreshes_and_rotates_the_refresh_token() {
    let (session, store, fake) = session(Ok(tokens("access-2", Some("refresh-2"))));
    session
        .save_sign_in(tokens("access-1", Some("refresh-1")), 0)
        .unwrap();
    let late = 3_600_000;
    assert_eq!(session.access_token(late).unwrap().access_token, "access-2");
    assert_eq!(store.get(ACCOUNT).unwrap().as_deref(), Some("refresh-2"));
    assert_eq!(*fake.refreshes.lock().unwrap(), 1);
    // Cached again: no second refresh.
    assert_eq!(
        session.access_token(late + 1).unwrap().access_token,
        "access-2"
    );
    assert_eq!(*fake.refreshes.lock().unwrap(), 1);
}

#[test]
fn rejected_refresh_token_is_forgotten() {
    let (session, store, _) = session(Err(TokenError::InvalidGrant));
    store.set(ACCOUNT, "stale").unwrap();
    let error = session.access_token(0).unwrap_err();
    assert_eq!(error.kind, ErrorKind::SessionExpired);
    assert_eq!(store.get(ACCOUNT).unwrap(), None);
    assert_eq!(
        session.access_token(0).unwrap_err().kind,
        ErrorKind::SignedOut
    );
}

#[test]
fn offline_or_service_errors_keep_the_session() {
    let (session, store, _) = session(Err(TokenError::Network));
    store.set(ACCOUNT, "kept").unwrap();
    assert_eq!(
        session.access_token(0).unwrap_err().kind,
        ErrorKind::Offline
    );
    assert_eq!(store.get(ACCOUNT).unwrap().as_deref(), Some("kept"));

    let (session, store, _) = session_with_failure();
    store.set(ACCOUNT, "kept").unwrap();
    assert_eq!(
        session.access_token(0).unwrap_err().kind,
        ErrorKind::Unavailable
    );
    assert_eq!(store.get(ACCOUNT).unwrap().as_deref(), Some("kept"));
}

fn session_with_failure() -> (Session, Arc<MemoryStore>, Arc<Fake>) {
    session(Err(TokenError::Failed("busy".into())))
}

#[test]
fn sign_out_revokes_and_clears_everything() {
    let (session, store, fake) = session(Ok(tokens("a", None)));
    session
        .save_sign_in(tokens("access-1", Some("refresh-1")), 0)
        .unwrap();
    session.sign_out().unwrap();
    assert_eq!(store.get(ACCOUNT).unwrap(), None);
    assert_eq!(*fake.revoked.lock().unwrap(), vec!["refresh-1".to_string()]);
    assert_eq!(
        session.access_token(1).unwrap_err().kind,
        ErrorKind::SignedOut
    );
    assert!(!session.is_signed_in().unwrap());
}

struct Gate {
    entered: std::sync::mpsc::Sender<()>,
    release: Mutex<std::sync::mpsc::Receiver<()>>,
}

impl TokenBackend for Gate {
    fn refresh(&self, _: &str) -> Result<TokenSet, TokenError> {
        self.entered.send(()).unwrap();
        self.release.lock().unwrap().recv().unwrap();
        Ok(tokens("access-2", Some("rotated")))
    }
    fn revoke(&self, _: &str) {}
}

#[test]
fn sign_out_during_a_refresh_is_not_undone_by_the_rotated_token() {
    let store = Arc::new(MemoryStore::default());
    store.set(ACCOUNT, "refresh-1").unwrap();
    let (entered_tx, entered_rx) = std::sync::mpsc::channel();
    let (release_tx, release_rx) = std::sync::mpsc::channel();
    let session = Arc::new(Session::new(
        Box::new(Shared(store.clone())),
        Box::new(Gate {
            entered: entered_tx,
            release: Mutex::new(release_rx),
        }),
        ACCOUNT.into(),
    ));
    let refresher = {
        let session = session.clone();
        std::thread::spawn(move || session.access_token(0))
    };
    entered_rx.recv().unwrap();
    let signer = {
        let session = session.clone();
        std::thread::spawn(move || session.sign_out())
    };
    std::thread::sleep(std::time::Duration::from_millis(100));
    release_tx.send(()).unwrap();
    let _ = refresher.join().unwrap();
    signer.join().unwrap().unwrap();
    assert_eq!(store.get(ACCOUNT).unwrap(), None);
    assert!(!session.is_signed_in().unwrap());
}

/// A store whose writes can be switched off.
struct Flaky(Arc<MemoryStore>, Arc<Mutex<bool>>);

impl SecretStore for Flaky {
    fn get(&self, account: &str) -> Result<Option<String>, AccountError> {
        self.0.get(account)
    }
    fn set(&self, account: &str, secret: &str) -> Result<(), AccountError> {
        if *self.1.lock().unwrap() {
            return Err(AccountError::keychain());
        }
        self.0.set(account, secret)
    }
    fn delete(&self, account: &str) -> Result<(), AccountError> {
        self.0.delete(account)
    }
}

/// Answers refreshes in order and checks which token each one presented.
struct Seq(Mutex<Vec<(String, Result<TokenSet, TokenError>)>>);

impl TokenBackend for Seq {
    fn refresh(&self, token: &str) -> Result<TokenSet, TokenError> {
        let (expected, reply) = self.0.lock().unwrap().remove(0);
        assert_eq!(token, expected);
        reply
    }
    fn revoke(&self, _: &str) {}
}

#[test]
fn rotated_token_the_keychain_refused_is_kept_in_memory_and_flagged() {
    let store = Arc::new(MemoryStore::default());
    store.set(ACCOUNT, "refresh-1").unwrap();
    let broken = Arc::new(Mutex::new(true));
    let session = Session::new(
        Box::new(Flaky(store.clone(), broken.clone())),
        Box::new(Seq(Mutex::new(vec![
            (
                "refresh-1".into(),
                Ok(tokens("access-2", Some("refresh-2"))),
            ),
            (
                "refresh-2".into(),
                Ok(tokens("access-3", Some("refresh-3"))),
            ),
        ]))),
        ACCOUNT.into(),
    );
    assert_eq!(session.access_token(0).unwrap().access_token, "access-2");
    assert!(session.keychain_failed());
    assert!(session.is_signed_in().unwrap());
    // The next refresh presents the in-memory token and persists once the store works.
    *broken.lock().unwrap() = false;
    assert_eq!(
        session.access_token(3_600_000).unwrap().access_token,
        "access-3"
    );
    assert!(!session.keychain_failed());
    assert_eq!(store.get(ACCOUNT).unwrap().as_deref(), Some("refresh-3"));
}
