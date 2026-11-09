//! Messaging integrations: email (IMAP/SMTP), Slack, Discord and Microsoft Teams.
//! Credentials stay native; the UI receives account views, threads and plain-text messages.
pub(crate) mod commands;
mod discord;
mod email;
mod microsoft;
mod oauth;
mod slack;
mod store;
mod teams;
mod types;

#[cfg(test)]
mod live_tests;
