# External tunnels

Manage ngrok and Cloudflare Quick Tunnels from **Settings → Connections → External
tunnels**, or from the development server tool's **Share server** action. Choose
the computer, provider and target. A project action resolves that project's
existing host connection; it does not fall back to this computer when a remote
host is unavailable.

**Dev server sharing** forwards an HTTP or HTTPS loopback service on the selected
computer. Enter its URL or port, for example `http://127.0.0.1:5173` or `5173`.
The service's own access controls apply. **bycoda host access** forwards the
selected host's actual listening port. Existing device authentication, environment
identity validation, origin restrictions, revocation and pairing remain required.
The host port cannot be shared under the dev-server target.

Start and stop tunnels, inspect their state, copy a public URL, and display its QR
code.
Closing the tunnel panel does not stop a running tunnel. Stopping its tunnel,
losing access to its status, or an unexpected exit removes URL sharing controls.

The selected host uses an existing native `ngrok` or `cloudflared` executable on its
PATH (standard Homebrew/local binary locations are also checked). If cloudflared
is absent, bycoda downloads release **2026.1.2**, verifies the official SHA-256
against constants in source, and installs it privately under the Host's data
directory. A checksum mismatch prevents installation and execution. No global
provider service is modified. ngrok requires an authtoken
saved through this panel. It uses the existing host credential vault implementation:
Windows DPAPI CurrentUser, macOS Keychain, or Linux Secret Service, with no
plaintext fallback. Tokens are isolated from social accounts. Only credential
availability is returned to the UI; raw tokens and CLI output are never recorded
in tunnel status or logs. The token crosses private host/guardian IPC and the
ngrok process environment, not command arguments or provider config files.
Global provider config is isolated; ngrok request inspection and its local
inspection API are disabled.

Cloudflare Quick Tunnels need no account or token. Their hostnames are temporary,
there is no uptime guarantee, and SSE is unsupported. They are intended for
development and testing. Managed Cloudflare tunnel profiles and custom ngrok
domains are not part of this integration.

## Process ownership and recovery

The selected host starts a hidden guardian and provider child. Both use argument
arrays with no shell; Windows uses `windowsHide`. The guardian stops only its own
retained child when host IPC disconnects. Normal host shutdown also waits for
tunnel cleanup. Stop operations never enumerate or kill a provider by name or
reuse a stored PID. A failed stop retains ownership so it can be retried.

The host stores a bounded, credential-free manifest under its existing data
directory's `tunnels/` folder. On restart, active records become interrupted and
their URLs and stop authority are cleared. Manual tunnels are not restarted or
adopted. **Access from outside the network (Cloudflare Quick Tunnel)** is off by
default. Turning it on persists Host access intent: startup creates a fresh tunnel,
and verified unexpected retirement creates a replacement. Unknown retirement
blocks replacement. Stopping the Host tunnel or turning the switch off disables
automatic restart. Foreign/corrupt state is preserved and reported as unavailable.

While **Let my signed-in phones find this computer** is on and the desktop is signed in, the
publisher checks Host routes every five seconds. Routes are ordered LAN, Tailscale,
then the live tunnel, capped at four with one slot reserved for the tunnel.
Stopping a tunnel removes its URL at the next successful check. Only endpoints
are published, never device credentials. The publisher runs in the desktop;
a headless Host alone does not update the account.

After a desktop reconnect probe exhausts known routes, it re-fetches the account
computer list and selects the same environmentId. A new Quick Tunnel route is
learned only after a credential-free `GET /.well-known/bycoda-host` confirms that
identity over HTTPS. The native client rechecks identity before using a learned
hostname. Reconnect probes retry once; operations with unknown outcomes are never
replayed. Account API authorization is still required for listing computers.

Cloudflared forwards the origin's loopback Host header, preserving the existing
native WebSocket Host and browser Origin restrictions. HTTP RPC remains available
as the fallback transport.

Status distinguishes missing executables, missing/invalid credentials, locked
credential storage, unreachable local services, provider connection failures,
startup timeouts, failed stops and unexpected exits. A local TCP listener and a
provider connection message do not establish that an external client can reach
the public URL. The UI reports public reachability as unverified.

## References and validation boundaries

Provider behavior was checked against the official [ngrok CLI reference](https://ngrok.com/docs/gateway/agent/cli),
[ngrok v3 agent configuration](https://ngrok.com/docs/gateway/agent/config/v3), and
[Cloudflare Quick Tunnel documentation](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/).
OpenChamber's [tunnel service](https://github.com/openchamber/openchamber/tree/main/packages/web/server/lib/tunnels)
and [tunnel settings](https://github.com/openchamber/openchamber/blob/main/packages/ui/src/components/sections/openchamber/TunnelSettings.tsx)
informed the provider/controller separation, lifecycle and URL/QR interaction.
bycoda extends its existing authenticated RPC and native method allowlist.

Focused tests simulate provider logs and failure cases, exercise real stand-in
Node children and guardian IPC disconnects without opening an internet tunnel,
and verify existing host authentication gates and UI routing. These checks do not
prove installed desktop behavior, provider account acceptance or live public
internet access. Run acceptance on the intended host and provider separately.
