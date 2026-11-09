# Links to local conversations

In a saved conversation's session menu, open **Copy**, then choose **Copy session
link** for a plain link or **Copy Markdown reference** for a readable linked title.
**Harness session ID** and **bycoda session ID** are available in the same submenu. Copy progress, confirmation and failures appear on the menu
action; select it again to retry a failure. A new, unsaved conversation has no
persistent reference yet.

Paste the Markdown reference into a conversation or a Notes document. Activating
the title opens that conversation through the usual workspace navigation. An
already open conversation focuses its existing tab. Current composer drafts and
the referenced conversation's archive membership remain intact.

The information button beside a reference opens compact details. Details are
loaded when requested and show the current authorized title, project, local
origin and available status. **Open beside** opens the source and target using
the existing split-layout limits. Saved prose keeps its original title even when
the referenced conversation is renamed.

Conversation Tools `sessions.list` and `sessions.read` return `reference`, `link`
and `markdownReference` for targets whose persistent owner can be verified.
Read results also return references for the cited user turns. Agents should cite
these exact returned links and read the conversation before describing its work.
Finding or reading a conversation does not mean that a message was sent or that
another agent acknowledged an agreement.

References to an orchestrated worker open its existing read-only agent tab beside
the lead conversation. A cited turn belongs to that worker's transcript, even
when earlier history must be loaded first.

Links identify the owning local Host environment or Native store and profile,
plus the saved conversation ID. Titles, file paths, provider session IDs and
temporary process identities are not used as the target. Renaming and restarting
therefore preserve the reference. A Native reference can follow an existing
verified migration receipt, but activating a link never starts migration.

Wrong-profile, missing, disconnected, locked and hidden targets are unavailable;
bycoda does not substitute a similarly named conversation. Retry after restoring
the relevant access. If a cited turn has been removed, **Open conversation** opens
the conversation without that turn reference. Native sessions display an unknown
status when the read-only metadata source supplies no live status.

References can open inside the desktop application or through the HTTPS handoff
at `https://link.bycoda.codes`. Desktop cold and warm launches route through the
installed `bycoda` protocol handler. Mobile uses the versioned entry route and
verified domain configuration. These capabilities require an application build
containing their handlers; the public website does not update installed apps.
Opening a reference does not send a message, start an agent, unarchive a target,
change its execution workspace or grant additional permissions.

## Link format and web entry

The versioned address is independent of the conversation title:

```text
https://link.bycoda.codes/session/v1/host/<environment>/<session>
https://link.bycoda.codes/session/v1/native/<store>/<profile>/<session>
bycoda://session/v1/host/<environment>/<session>
bycoda://session/v1/native/<store>/<profile>/<session>
```

An optional `?turn=<user-turn-id>` identifies an exact saved user turn. Identity
segments are encoded by bycoda; copy the returned address instead of constructing
one from a provider ID or folder name. Both plain addresses and Markdown
references are clickable in bycoda conversation and document previews.

Copy actions produce HTTPS addresses; existing `bycoda://` references remain
valid. Open the HTTPS address and select **Open in bycoda**. The root page also
converts a pasted legacy reference into its canonical HTTPS address. The page
offers desktop downloads and, once configured, mobile installation destinations.
Download options stay visible beside the session action, or below it on a phone.
The page uses the canonical bycoda logo in both themes and states when mobile
distribution is not ready.

On another device, the owning computer must already be paired and reachable.
The authenticated Host must advertise `sessions.references.v1` and validate the
complete environment or Native store/profile/session locator before disclosure
and after history loading. A Native address follows an existing verified
migration receipt only; a link never initiates migration. Matching bare session
IDs is insufficient. Mobile asks the user to choose the paired owning computer
when the Native locator has no Host environment identity. A cited-turn link on
mobile explicitly offers opening the conversation when exact-turn navigation is
unavailable.

The website never fetches or publishes conversation content. A public link alone
does not grant access. iOS Universal Links and Android App Links additionally
require real signing identities served in the corresponding `.well-known`
association files, plus a matching signed app build. Missing identities leave
association unavailable; custom-scheme activation still requires a supporting
installed app. The service is operated by the maintainer; its deployment is not part of this repository.
