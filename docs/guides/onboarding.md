# Getting started

Fresh desktop workspaces open a compact five-step setup dialog: Workspace,
Appearance, Agents, Connections, Projects. Every step is directly accessible and
optional. Navigation and completion actions stay visible while the content scrolls.
The language selector applies immediately. Reopen the flow from Settings → General
→ Setup → Open setup.

- Workspace selects Tasks, Automations, Inbox, Notes and Social Media navigation.
  Coding, files, terminal and Git remain available. Choices save immediately and
  can be changed in Settings → Workspace. Hiding navigation does not stop running
  work or change account permissions. Active Tasks, Automations, Inbox and Social
  Media shortcuts stay reachable until the user leaves the tool. Notes retains
  its existing enabled/disabled behavior.
- Appearance applies Light, Dark or System mode immediately. Still previews show
  the original uncles and Star Wars crew. Users can hide the crew or disable
  decorative animations independently. Existing appearance settings are reused.
- Agents checks local Codex, Claude Code and Antigravity installations. Other
  supported providers can be added from a compact selector; ACP configuration
  opens the existing custom-agent editor. Checkboxes control model-picker visibility.
  Added providers remain listed when setup is reopened, even before installation.
  Missing
  agents link to the provider's installation guide. The CLI path control and
  provider login flow are reused. An installed CLI is not labeled authenticated;
  a successful login in setup displays Signed in. Existing CLI credentials remain
  available through the normal provider integration.
- Connections starts with this computer. Manage connections opens the existing
  editor for computers and sharing. The local sync host is excluded
  from the remote computer list. Remote presence is not presented as proof of a
  successful connection.
- Projects discovers local Claude/Codex interactive conversations and groups them
  by usable folder. Already imported conversations and missing folders are excluded.
  Selected folders import through the existing bounded, cancellable import runner.
  Failures and shortened/history-only imports stay visible in the result screen.
  New folders can be added with the native folder picker. Remote folders use the
  existing remote project picker; remote CLI history is not scanned by this dialog.
  Selections and results remain intact when navigating back to another setup step.

The `bycoda.onboarding.v1` local preference records completion or skipping.
Remembered projects, stored history, restored workspaces and window transfers
suppress automatic setup. Existing workspaces are recorded so clearing their
projects later does not turn an upgrade into a first run. A skipped setup can be
reopened in Settings. Setup does not install providers or import history
automatically. Connection changes use the existing explicit connection controls.
Finishing setup opens the workspace directly. The usage guide is an explicit,
optional action and remains available in Settings.
