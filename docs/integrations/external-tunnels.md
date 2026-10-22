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

The selected host must have the native `ngrok` or `cloudflared` executable on its
PATH (standard Homebrew/local binary locations are also checked). bycoda does not
install a CLI or modify an existing provider service. ngrok requires an authtoken
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
their URLs and stop authority are cleared. Tunnels are not automatically restarted
or adopted. Foreign/corrupt state is preserved and reported as unavailable.

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
