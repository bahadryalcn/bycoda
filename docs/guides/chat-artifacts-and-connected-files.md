# Inspect chat output and connected-machine files

Tool rows keep the conversation compact. Use **Changes** beside an edit or the output chevron beside a command to inspect its saved code, patch, or result. Expanded text can be selected and copied. A failed call shows its error before any earlier output.

These details describe the tool call at that point in the conversation. They do not reread the current file and present it as historical output. New code details are bounded to keep long conversations responsive; subagent history has a shared retention budget. When only an older shortened preview remains, the viewer says so.

## Documents, tables, and media

Click a chat attachment or a generated file link to open it. PDF, Word, Excel, CSV, and TSV use document/table viewers. Video and audio use native playback controls. Codec support depends on the operating system; the default-app action is available when a file path can be opened on this computer.

CSV and TSV file tabs offer **Preview** and **Source**. Switching views retains source edits. The preview displays the saved file; unsaved changes remain in Source. Delimited values are displayed as text, without evaluating formulas.

Document previews are limited to 25 MiB. Connected project files are checked before downloading. Large media uses a local authorized file or an on-demand disk copy instead of keeping the whole video in JavaScript memory. Session attachment previews use the session's authorized reader and have a 25 MiB limit.

## Files on another computer

Every connected path retains its owning machine. Windows drive paths, macOS/Linux paths, and network paths are never interpreted as a local path merely because they have the same spelling.

- **Open local copy** downloads a snapshot and opens it on this computer. Changes to that copy do not sync to the connected machine.
- Existing shared or mounted folders can be configured under **Shared folder settings**. The mapping is local to the viewing computer and applies to subfolders. Opening a mapped file accesses that shared original.
- **Open live folder (read-only)** uses the saved bycoda connection to expose a temporary folder to this computer's file manager. It supports browsing and opening; writes are rejected. The OS must provide its WebDAV client. An unavailable OS client produces an actionable error and leaves the shared-folder and copy alternatives available.

Only folders and files inside projects/worktrees already authorized on the owning host can be read through bycoda. Browsing metadata outside those roots does not grant file access. Temporary native-folder access is private to loopback, expires, and does not publish a share or change OS services.

Local downloads are limited to 1 GiB per file and four simultaneous transfers. The cache is bounded to 4 GiB. Unchanged cached snapshots can be reused; edited copies are preserved. A file changing during transfer causes a retryable failure rather than opening inconsistent bytes.

## Open a remote development website

Use **Open in this computer's browser** in Development servers, or click a matching development URL in the remote conversation. bycoda resolves the conversation's machine and project, finds the registered running server, and verifies its process identity before creating a private local browser address. Refresh Development servers when a process restarts.

HTTP requests and WebSocket connections use the paired host connection. No public tunnel is created. Remote HTTPS sites open in the owning host's browser preview. Ordinary public URLs continue to open normally.

The HTTP bridge accepts fixed-length request bodies; streaming/chunked request bodies are rejected. Custom private DNS names are not automatically classified from arbitrary chat links; choose the registered endpoint in Development servers. Opening a file or server never silently falls back to a different machine.
