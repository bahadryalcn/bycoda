# Dev servers, Servers, machines, devices, browser, logs

## Dev servers

- Dev servers are the project's development processes (Vite, Next, Metro...). They
  show in the Servers tool tab.
- `devServers.list` / `devServers.details`.
- `devServers.start` takes `command` and an optional `expectedPort`, and runs in the
  project folder. Use `stop` and `restart` to manage it.
- `devServers.logs` reads managed server output. `openExternal` opens an exact port
  from details.
- Prefer these to a hidden background shell so the owner sees and controls the process.
- For unmanaged processes, pass the `identity` from details. Never guess a PID.

## Servers and machines

- Servers are saved personal SSH servers. They are different from dev servers.
  - Use `servers.list` / `servers.get`, then `servers.ssh.save`, `servers.ssh.remove`
    and `servers.metadata.update`.
  - Read before you edit. Passwords and keys are never exposed.
- Machines are computers connected to bycoda (Settings > Connections > Add machine,
  over SSH). Each one runs a host that keeps its sessions alive.
  - `machines.list` gives a `machineId` for `devices.*` and `ui.tools.open`.
  - Pairing machines or a phone is owner-only.

## Devices (simulators, emulators, phones)

1. `machines.list`, then `devices.status` and `devices.list`.
2. `devices.start`, then `devices.boot` (`deviceId`).
3. `devices.capture` or `devices.action`: `snapshot`, `pressElement`, `type`, `press`,
   `swipe`, `waitForText`, `openApp`, `home`. On iOS, run `openApp` first.

Expo preview flow:

1. `devices.preflight`.
2. `devServers.start` for Metro.
3. `devices.preview` with `expectedText`.
4. Poll `devices.preview.status`. Only `ready` with verified text confirms the content.

Omitting `machineId` targets this host; a remote target never falls back to local.
SDKs and device tools must already be installed by the owner.

## Browser

- A shared Chromium (default 1280x720, no profile), visible through the Browser panel.
- For requested browser work, prefer `browser.preview` with a stable `requestId`,
  URL and `show:true`. It verifies a frame and requests the originating conversation's
  project-Host panel. Check `execution` and `presentation` separately; headless runs
  may have no visible desktop. Never claim the user saw a page from navigation alone.
- `browser.resize` changes the leased CSS viewport for narrow checks (for example
  390x844). Capture a fresh frame afterwards; old annotation targets are invalidated.
  This does not emulate a physical device. Never take another owner's lease.
- Flow: `browser.claim` (gives a lease), then `browser.open` (url), `browser.frame`
  (screenshot), `browser.input` (click, scroll, text, key). End with `browser.release`
  or `browser.close`.
- Leases are short and one operation runs at a time. Other devices can see opened pages.
- Older Hosts without preview retain the claim/open/frame flow; use `ui.tools.open`
  with `tab:"browser",projectHost:true` and inspect `ui.tools.status` to verify mounting.
  Fall back only for an unavailable/unsupported step or a reported repeated failure;
  never expand machine scope or bypass permissions. Reconcile uncertain mutations first.

## Logs

- Use `runtime_logs_read` (`bycoda-runtime-logs`) or `logs.read` (source `browser` or
  `server`, with search and levels) to check errors after a change.
- `logs.monitors.start` captures a URL's browser logs.
- `resources.read` reads this machine's resource diagnostics (the Resources tool tab).
