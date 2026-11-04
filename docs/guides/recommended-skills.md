# Recommended skills

Open **Settings > Skills > Discover skills** to browse ranked recommendations.
The order reflects broad usefulness, followed by specialized workflows; it is not
a benchmark score. Search by name, purpose or category. Each entry links to the
publisher's original repository and lists additional requirements.

Choose the computer, installation scope and provider before pressing **Install**:

- **Global · all projects** installs for your user account on the selected computer.
- **This project** installs in the open project on that computer. This choice is
  unavailable when that computer has no open project.
- **All providers** uses the shared skills folder. Choosing a provider uses that
  provider's folder and limits catalog-managed visibility within bycoda.

Only public third-party skill sources appear in this catalog. Personal and
project-owned skills are not imported into recommendations. Expand **Installation
command** to inspect and copy the command and open its installer reference.

Bycoda runs the public `skills@1.7.6` CLI against the publisher's source at one
resolved commit, then applies your selected scope and provider. This is the
standard public Skills installer; it is not a claim that every publisher endorses
that command instead of their own installer. Node.js 22.20 or newer, npm and Git
must be available on the selected computer. Missing prerequisites produce an error
next to the skill. Skill content is not redistributed in Bycoda packages.
Optional CLIs, browser runtimes, accounts and hooks require their own setup.
Existing skill folders are never replaced. A publisher's current skill may differ
from an older or customized copy already on another computer.

Installation does not enable a disabled skill or override provider permissions.
Skills already present on disk remain visible in the normal library. Changes take
effect on subsequent turns. Native tools outside bycoda retain their own discovery
and permission rules; catalog scope is not a filesystem security boundary.

Installation progress and errors appear next to the skill. If completion is
uncertain, use **Check status**; bycoda checks the original operation instead of
automatically downloading again. Confirmed failures can be dismissed before another
attempt. Reopen Discover skills to inspect the same window's retained operation.
