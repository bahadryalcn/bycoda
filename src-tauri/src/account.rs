//! The optional bycoda account (desktop side). Sign-in runs in the system browser with
//! PKCE over a loopback redirect against the Clerk OAuth application; Rust owns the
//! refresh token (OS credential store only) and hands the UI a short-lived access token.
//! The app works fully signed out; nothing here is required for local use.
pub(crate) mod commands;
mod config;
mod device;
mod error;
mod flow;
mod keychain;
mod session;
mod tokens;

#[cfg(test)]
mod config_tests;
#[cfg(test)]
mod device_tests;
#[cfg(test)]
mod flow_tests;
#[cfg(test)]
mod session_tests;
#[cfg(test)]
mod tokens_tests;
