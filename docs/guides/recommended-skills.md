# Recommended skills

Open **Settings > Skills > Discover skills** to browse ranked recommendations.

An installation shows **Installing…** while running. **Check status** shows
**Checking…** while reconciling an uncertain result; it does not start another install.

Searching Settings for skill folders opens **Advanced: skill controls and folders**
in the Skills page. Closing that dialog keeps it closed until another reveal request.
The order reflects broad usefulness, followed by specialized workflows; it is not
a benchmark score. Search by name, purpose or category. Each entry links to the
publisher's original repository and lists additional requirements. Open **Before you
install** for the replacement, permission and prerequisite notes.

The catalog covers interface design, React composition and performance, Expo native
development, PostgreSQL, Cloudflare Workers and Durable Objects, Stripe integrations,
Hugging Face tooling, property-based testing, MCP servers and PDF workflows. New
recommendations come from the original Vercel, Expo, Supabase, Cloudflare, Stripe,
Hugging Face, Trail of Bits and Anthropic repositories. Publisher links let you
inspect the current source before installation.
Expo's native UI workflows also use its companion `expo-ui` skill. Install the
relevant companion skills when the publisher's workflow calls for them.

Service workflows also include Firebase setup, Authentication, Firestore and its
Security Rules, Hosting, App Hosting, SQL Connect and AI Logic; Stripe Connect,
account verification, API/SDK upgrades, Stripe Apps, Metronome and documentation;
Neon platform/PostgreSQL and Better Auth. These entries use the service publishers'
own repositories. Additional CLIs, SDKs, accounts and billing plans are listed in
each entry. Installing a skill does not connect an account or provision services.

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

## Skill groups in chat

Skill groups reference installed skills by name. In the composer, choose a group from the **Skill groups** section to insert its available skills together as ordinary skill tokens. Missing, disabled and non-user-invocable skills are skipped. Groups retain missing names so reinstalling a skill restores membership. Group insertion refreshes the current machine policy and preserves the draft if that refresh fails.

AI grouping uses the selected skill grouping provider and model, falling back to the title-generation utility choice. Only skill names and descriptions are sent. Generation returns a proposal; existing groups change only when that proposal is explicitly applied.

## Organize installed skills

Switch between **All skills** and **Groups** in the Skills library. Create groups from the toolbar or a skill’s actions menu. Right-click a skill to open the same actions, add it to several groups, or remove it from the current group. Drag a skill onto a group header to move it from its source group; drop onto **Ungrouped** to remove that source membership. Group headers offer rename, delete and collapse actions. Deleting a group keeps its skills installed. View and collapse preferences are remembered locally. Missing group members remain saved and appear in the header count.

Use the settings icon beside **Group with AI** to open **Settings > Background work > Assignments** directly. Generation can be canceled. Review the proposed names and skills, then explicitly choose **Replace my groups** or **Add as new groups**. Cancel leaves existing groups unchanged.
