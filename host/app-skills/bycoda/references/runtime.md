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
- A shared headless Chromium (1280x720, no profile).
- Flow: `browser.claim` (gives a lease), then `browser.open` (url), `browser.frame`
  (screenshot), `browser.input` (click, scroll, text, key). End with `browser.release`
  or `browser.close`.
- Leases are short and one operation runs at a time. Other devices can see opened pages.

## Logs
- Use `runtime_logs_read` (`bycoda-runtime-logs`) or `logs.read` (source `browser` or
  `server`, with search and levels) to check errors after a change.
- `logs.monitors.start` captures a URL's browser logs.
- `resources.read` reads this machine's resource diagnostics (the Resources tool tab).
