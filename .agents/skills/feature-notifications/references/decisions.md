# Notification decisions

## Application-owned approval presentation

Owner decision, 2026-11-07: "I do not want native approvals; if permission is needed they should be requested from inside the app, even from the chat" (translated)

Native code retains exact source, operation and reply authority. Required approvals appear in the source chat when visible, otherwise in the shared application confirmation. No platform-dialog fallback; unavailable or revoked presentation cannot grant consent. Full access reuses only existing execution permission and does not expand separate publication, credential, clipboard/input, persistent-access, privacy or delegation authority.
