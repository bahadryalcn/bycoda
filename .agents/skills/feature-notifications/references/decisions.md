# Notification decisions

## Application-owned approval presentation

Owner decision, 2026-11-07: "I do not want native approvals; if permission is needed they should be requested from inside the app, even from the chat" (translated)

Native code retains exact source, operation and reply authority. Required approvals appear in the source chat when visible, otherwise in the shared application confirmation. No platform-dialog fallback; unavailable or revoked presentation cannot grant consent. Full access reuses only existing execution permission and does not expand separate publication, credential, clipboard/input, persistent-access, privacy or delegation authority.

## Notification history is the common log

Owner decision, 2026-11-10: "Ortak bi yapımız olması gerektiğini düşünüyorum" ("I think we should have one common structure"), and, asked whether finished and failed events should be listed in the panel: "tamam bunları ... yap" ("okay, do these") (translated)

The Notifications sheet history (capped, `bycoda.notifications.history.v1`) is the common log of what the app announced, not only approvals and questions. It replaces the earlier rule that history is not a ledger of every notification. Kinds: approval, question, finished, failed, reminder, assistant, background, account. An entry opens a conversation or a `background:*` target. An event is logged when its event-kind setting allows it, even when the banner was suppressed (focused window, banners off); a muted project is not logged and a locked group is logged with masked text. It remains capped, local to this device and is not a resolved state.

## One list with a new-arrivals badge

Owner decision, 2026-11-11: "tek bir liste olsun pending ler en üstte gözüksün kendi kartı altında" ("make it one list; pending ones appear at the top inside their own card") and "sağ alttaki ikon ve badge filan hiç birşey yok" ("the bottom-right icon has no badge at all") (translated)

The sheet has no Pending/Recent tabs: pending requests sit in one card at the top, the log follows, and a request that is still pending is listed only in that card. The bell badge counts pending requests plus log entries newer than the device-local "last looked" time (`bycoda.notifications.seenAt.v1`), which opening or closing the sheet advances. This replaces "not an unread state" above with a single time marker; there is still no per-entry read flag, and the marker never resolves or dismisses a request.
