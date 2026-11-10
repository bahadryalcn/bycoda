# Notification decisions

## Application-owned approval presentation

Owner decision, 2026-11-07: "I do not want native approvals; if permission is needed they should be requested from inside the app, even from the chat" (translated)

Native code retains exact source, operation and reply authority. Required approvals appear in the source chat when visible, otherwise in the shared application confirmation. No platform-dialog fallback; unavailable or revoked presentation cannot grant consent. Full access reuses only existing execution permission and does not expand separate publication, credential, clipboard/input, persistent-access, privacy or delegation authority.

## Notification history is the common log

Owner decision, 2026-11-10: "Ortak bi yapımız olması gerektiğini düşünüyorum" ("I think we should have one common structure"), and, asked whether finished and failed events should be listed in the panel: "tamam bunları ... yap" ("okay, do these") (translated)

The Notifications sheet history (capped, `bycoda.notifications.history.v1`) is the common log of what the app announced, not only approvals and questions. It replaces the earlier rule that history is not a ledger of every notification. Kinds: approval, question, finished, failed, reminder, assistant, background, account. An entry opens a conversation or a `background:*` target. An event is logged when its event-kind setting allows it, even when the banner was suppressed (focused window, banners off); a muted project is not logged and a locked group is logged with masked text. It remains capped, local to this device and is not an unread or resolved state.
