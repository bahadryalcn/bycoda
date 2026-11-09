//! Opt-in checks against real accounts. Skipped by default; run with
//! `cargo test messaging::live_tests -- --ignored --nocapture` and:
//! - `BYCODA_LIVE_PROVIDER`: email | slack | discord
//! - `BYCODA_LIVE_CONFIG`: provider config JSON (no secrets)
//! - `BYCODA_LIVE_SECRET_KEY` + `BYCODA_LIVE_SECRET_FILE`: secret field name and a file holding its value
//! - `BYCODA_LIVE_REPLY_THREAD` + `BYCODA_LIVE_REPLY_BODY`: only for `live_reply`, which sends a real message.
//!
//! Output is limited to counts, titles and lengths so message bodies stay out of logs.
use super::types::{Account, Provider, Secret};
use super::{discord, email, slack};
use serde_json::Value;

fn env(name: &str) -> String {
    std::env::var(name).unwrap_or_else(|_| panic!("{name} is not set"))
}

fn setup() -> (Account, Secret) {
    let provider = match env("BYCODA_LIVE_PROVIDER").as_str() {
        "email" => Provider::Email,
        "slack" => Provider::Slack,
        "discord" => Provider::Discord,
        other => panic!("unsupported live provider {other}"),
    };
    let raw: Value = serde_json::from_str(&env("BYCODA_LIVE_CONFIG")).expect("config JSON");
    let config = match provider {
        Provider::Email => email::normalize_config(&raw),
        Provider::Slack => slack::normalize_config(&raw),
        Provider::Discord => discord::normalize_config(&raw),
        Provider::Teams => unreachable!(),
    }
    .expect("config is valid");
    let value = std::fs::read_to_string(env("BYCODA_LIVE_SECRET_FILE")).expect("secret file");
    let mut secret = Secret::new();
    secret.insert(
        env("BYCODA_LIVE_SECRET_KEY"),
        Value::String(value.trim().to_string()),
    );
    let account = Account {
        id: "live".into(),
        provider,
        label: "live".into(),
        identity: String::new(),
        config,
        created_at: 0,
        updated_at: 0,
    };
    (account, secret)
}

fn call<T>(
    account: &Account,
    secret: &mut Secret,
    email_fn: impl FnOnce(&Account, &mut Secret) -> Result<T, String>,
    slack_fn: impl FnOnce(&Account, &mut Secret) -> Result<T, String>,
    discord_fn: impl FnOnce(&Account, &mut Secret) -> Result<T, String>,
) -> Result<T, String> {
    match account.provider {
        Provider::Email => email_fn(account, secret),
        Provider::Slack => slack_fn(account, secret),
        Provider::Discord => discord_fn(account, secret),
        Provider::Teams => unreachable!(),
    }
}

fn short(text: &str) -> String {
    text.chars().take(50).collect()
}

#[test]
#[ignore = "needs a real account"]
fn live_read() {
    let (account, mut secret) = setup();
    let identity = match account.provider {
        Provider::Email => email::verify(&account.config, &mut secret),
        Provider::Slack => slack::verify(&account.config, &mut secret),
        Provider::Discord => discord::verify(&account.config, &mut secret),
        Provider::Teams => unreachable!(),
    };
    println!("verify: {:?}", identity.as_ref().map(|_| "ok"));
    identity.expect("verify");
    let threads = call(
        &account,
        &mut secret,
        |a, s| email::list_threads(a, s, 20),
        |a, s| slack::list_threads(a, s, 20),
        |a, s| discord::list_threads(a, s, 20),
    )
    .expect("list threads");
    println!("threads: {}", threads.len());
    for thread in threads.iter().take(5) {
        println!(
            "  id={} title={:?} participants={} preview_len={} unread={} updated_at={}",
            short(&thread.id),
            short(&thread.title),
            thread.participants.len(),
            thread.preview.chars().count(),
            thread.unread,
            thread.updated_at
        );
    }
    let Some(first) = threads.first() else {
        return;
    };
    let id = first.id.clone();
    let messages = call(
        &account,
        &mut secret,
        |a, s| email::thread_messages(a, s, &id),
        |a, s| slack::thread_messages(a, s, &id),
        |a, s| discord::thread_messages(a, s, &id),
    )
    .expect("thread messages");
    println!("first thread messages: {}", messages.len());
    for message in messages.iter().rev().take(3) {
        println!(
            "  author={:?} body_len={} outbound={} attachments={} at={}",
            short(&message.author),
            message.body.chars().count(),
            message.outbound,
            message.attachments.len(),
            message.at
        );
    }
}

#[test]
#[ignore = "sends a real message"]
fn live_reply() {
    let (account, mut secret) = setup();
    let thread = env("BYCODA_LIVE_REPLY_THREAD");
    let body = env("BYCODA_LIVE_REPLY_BODY");
    let sent = call(
        &account,
        &mut secret,
        |a, s| email::reply(a, s, &thread, &body),
        |a, s| slack::reply(a, s, &thread, &body),
        |a, s| discord::reply(a, s, &thread, &body),
    )
    .expect("reply");
    println!(
        "sent: id={} outbound={} body_len={}",
        short(&sent.id),
        sent.outbound,
        sent.body.chars().count()
    );
}

/// Browser sign-in against a real app registration: `BYCODA_LIVE_SIGN_IN` = google | slack,
/// client IDs from `BYCODA_GOOGLE_CLIENT_ID` / `BYCODA_GOOGLE_CLIENT_SECRET` / `BYCODA_SLACK_CLIENT_ID`.
/// Writes the authorize URL to `BYCODA_LIVE_URL_FILE`, waits for the browser, then reads threads.
#[test]
#[ignore = "needs a real account and a browser"]
fn live_browser_sign_in() {
    use super::oauth;
    let purpose = oauth::Purpose::parse(&env("BYCODA_LIVE_SIGN_IN")).expect("purpose");
    let start = oauth::start(purpose, None, None, None).expect("start");
    std::fs::write(env("BYCODA_LIVE_URL_FILE"), &start.authorize_url).expect("url file");
    println!("waiting for browser sign-in");
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(start.expires_in);
    let identity = loop {
        let poll = oauth::poll(&start.handle).expect("poll");
        match poll.status.as_str() {
            "pending" if std::time::Instant::now() < deadline => {
                std::thread::sleep(std::time::Duration::from_secs(1))
            }
            "done" => break poll.identity.unwrap_or_default(),
            other => panic!("sign-in ended: {other} {:?}", poll.error),
        }
    };
    println!("signed in: {}", short(&identity));
    let (_, record) = oauth::tokens(&start.handle).expect("tokens");
    let mut secret = Secret::new();
    secret.insert(purpose.secret_key().into(), record);
    let (provider, config) = match purpose {
        oauth::Purpose::Slack => (Provider::Slack, serde_json::json!({})),
        oauth::Purpose::Google => (
            Provider::Email,
            email::normalize_config(&serde_json::json!({ "preset": "gmail", "address": identity }))
                .expect("config"),
        ),
    };
    let account = Account {
        id: "live".into(),
        provider,
        label: "live".into(),
        identity: identity.clone(),
        config,
        created_at: 0,
        updated_at: 0,
    };
    let verified = match provider {
        Provider::Slack => slack::verify(&account.config, &mut secret),
        _ => email::verify(&account.config, &mut secret),
    };
    println!("verify: {:?}", verified.as_ref().map(|value| short(value)));
    verified.expect("verify");
    let threads = match provider {
        Provider::Slack => slack::list_threads(&account, &mut secret, 20),
        _ => email::list_threads(&account, &mut secret, 20),
    }
    .expect("threads");
    println!("threads: {}", threads.len());
    for thread in threads.iter().take(5) {
        println!(
            "  title={:?} participants={} unread={}",
            short(&thread.title),
            thread.participants.len(),
            thread.unread
        );
    }
    if let Some(first) = threads.first() {
        let messages = match provider {
            Provider::Slack => slack::thread_messages(&account, &mut secret, &first.id),
            _ => email::thread_messages(&account, &mut secret, &first.id),
        }
        .expect("messages");
        println!(
            "first thread messages: {} outbound={}",
            messages.len(),
            messages.iter().filter(|message| message.outbound).count()
        );
    }
    // Optional real reply, only when both variables are set.
    if let (Ok(title), Ok(body)) = (
        std::env::var("BYCODA_LIVE_REPLY_TITLE"),
        std::env::var("BYCODA_LIVE_REPLY_BODY"),
    ) {
        let thread = threads
            .iter()
            .find(|thread| thread.title == title)
            .expect("reply thread by title");
        let sent = match provider {
            Provider::Slack => slack::reply(&account, &mut secret, &thread.id, &body),
            _ => email::reply(&account, &mut secret, &thread.id, &body),
        }
        .expect("reply");
        println!(
            "sent: outbound={} body_len={}",
            sent.outbound,
            sent.body.chars().count()
        );
        let after = match provider {
            Provider::Slack => slack::thread_messages(&account, &mut secret, &thread.id),
            _ => email::thread_messages(&account, &mut secret, &thread.id),
        }
        .expect("messages after reply");
        println!(
            "reply visible: {}",
            after
                .iter()
                .any(|message| message.outbound && message.body == body)
        );
    }
}
