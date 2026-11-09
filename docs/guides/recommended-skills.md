# Recommended skills

Open **Settings > Skills > Discover skills** to browse ranked recommendations.
The order reflects broad usefulness, followed by specialized workflows; it is not
a benchmark score. Search by name, purpose or category. Each entry links to the
publisher's original repository and lists additional requirements. Open **Before you
install** for the replacement, permission and prerequisite notes.

The list opens on **Not installed**: a recommendation whose skill name already exists
on the selected computer moves to **Installed**, where its button stays disabled. A
recommendation installed only on another connected computer names that computer.

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
Skills already present on disk remain visible in the normal library. The library merges every
connected computer into one list, with one column per computer. A check mark means
the skill is on that computer; where it is missing, the cloud button in that column
copies it there. On the skill's **Machines** tab, **Replace…** asks for confirmation
before overwriting an existing copy. Changes take
effect on subsequent turns. Native tools outside bycoda retain their own discovery
and permission rules; catalog scope is not a filesystem security boundary.

Installation progress and errors appear next to the skill. If completion is
uncertain, use **Check status**; bycoda checks the original operation instead of
automatically downloading again. Confirmed failures can be dismissed before another
attempt. Reopen Discover skills to inspect the same window's retained operation.
