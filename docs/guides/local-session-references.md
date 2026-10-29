# Links to local conversations

In a saved conversation's session menu, choose **Copy session link** for a plain
link or **Copy Markdown reference** for a readable linked title. **Copy session ID**
remains available. Copy progress, confirmation and failures appear on the menu
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

These links operate inside the local desktop application. External OS launch,
mobile navigation and navigation to another computer are separate capabilities.
Opening a reference does not send a message, start an agent, unarchive a target,
change its execution workspace or grant additional permissions.
