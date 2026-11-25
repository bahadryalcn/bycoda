# Global voice scope provenance

Historical source section preserved verbatim below. These inputs define feature
scope, not future tool/installation authorization or proof of runtime acceptance.
Existing per-operation validators, approvals and source identity remain authoritative.

2026-11-04, continuation of owner chat session `166fcfca-cc6c-4cc6-bbd2-50a5ddb56a6b`:

> this global mode's sessions should run in the background in their own room; we do not have to attach them to any project. We will manage the others through those sessions anyway (translated)

The management identity belongs to a durable global Assistant Room thread. A
project or coding session is an operation target, not a prerequisite for that
identity. Extend existing domain owners and native approval routes; do not invent
a placeholder project/session or elevate a thread to owner authority. The owner
also requested project/session/task/Crew/social/notes/Servers coverage and a
Jarvis roadmap. Unimplemented cross-Host/account scopes remain explicit gaps;
this direction does not authorize a specific send, installation or publication.

2026-11-01, owner chat session `e40795a9-c59f-4a5c-88a8-45d9482b12de`:

> I need to be able to do everything from voice chat: have notes taken, create tasks, create, run, stop and edit automations. I need to manage my social media and detect errors; as far as I understand these do not exist now. Make an overall plan. We should be able to use all of bycoda's features in the best way, including conversation tools. (translated)

Same owner session, implementation authorization:

> if there is a message, image, file and so on I have not sent in the chat, it should be able to see those too. Please start on these with subagents, 10 subagents (translated)

2026-11-10, owner chat during the voice operator program (translated answers to explicit questions):

> All of them except desktop input (from the phone)

Approvals except physical desktop input and secret entry may also be answered from a paired phone, with the full operation summary shown.

> if allowed, a permanent permission can reduce or increase this; like the full access, ask permission, auto settings, let it be configurable with those; I would like to leave it fully autonomous

Computer use gets an owner-only permission mode (ask, auto, full access). Voice cannot change it. Stop computer use always works.

> All of them open with approval (Git push/merge and direct social sending)

Voice may request Git push and merge (never force push or history rewrite) and direct social sends, each through the existing native owner approval with the exact operation.

2026-11-10, owner request for global Room file and shell reach (translated):

> Owner-chosen folders: a Host setting "Assistant folders" ... Owner-only write path (Room/voice cannot change it). ... "Run commands without asking" (new owner-only setting next to the folders, default off).

The global Room reads and changes files only inside owner-added folders (reads unapproved, writes with exact native approval). `commands.run` asks for exact native approval per run unless the owner enabled the default-off "Run commands without asking" setting, which applies to the global and project Room. Folders and the setting are owner-only; no tool writes them.

2026-11-10 (translated): the owner approved moving PR/CI watching to the Host so the assistant can follow pull requests without an open session; the watcher only reads and notifies.

2026-11-12, owner request for computer use permissions (translated):

> I do not want an allowed-apps list; it should follow the permission. Full access allows everything, Auto asks. For example it wants to use Chrome: show "do you allow this?" on screen. If allowed, add it to the list directly and continue. Or full manual, approving one by one. Nobody will use it this way, because everyone wants autonomy.

Computer use needs no prepared app list. A tool call naming an app the owner has not approved asks once in the native dialog; approval adds the app to the owner's approved apps and the call continues. Ask mode still asks before every action; Auto launches and acts on approved apps without a dialog and still asks for the clipboard and physical input; Full access covers every app and asks nothing. Only the owner removes approved apps or changes the mode.

2026-11-25, owner chat after a spoken "Ufak bi Pac-Man oyunu yaptır Arif." became a planned Goal that produced nothing:

> Yeni bir iş verdiğimde, nasıl çalışması gerektiğine, en efektif ve optimum şekilde nasıl çalışacağına kendi karar verebilmesi gerekiyor. Benim yeni bir session açıp “yaptır” dememe gerek kalmaması lazım.

> ben basit günlük [işler veriyorum]

Voice chooses the route itself. A build, create, make or fix request is work and goes by default
to a normal coding session in the matching project, created with the request and submitted; the
project-choice path handles a genuinely unknown project. Assistant jobs, tasks, goals and crews
are used only on an explicit request for tracked, followed-up, background or scheduled work, and
their exact-intent admission is unchanged. A short answer to a pending question, or speech lost
in a reconnect, continues the carried work request. This supersedes the earlier routing rule
that opened a session only on an explicit request for one; native approvals for push, merge,
deletion and commands keep their gates.

2026-11-25, owner chat about approvals in Full access (translated from Turkish):

> there should be no approval or anything like it in full access

When the native standing consent is level "everything" with no critical exclusions
(`assistant_consent_get`, read fresh; any missing, other-credential, loading or failed read counts
as not Full access), voice asks for nothing it controls: a job, note or session delete that the
owner's accepted words identify exactly runs without a confirm card or dialog. Any other level,
or any exclusion, keeps today's cards and dialogs. Disambiguation (several jobs could be meant)
and the explicit-speech requirement of stop-all are not approvals and stay. This supersedes, for
the Full access state only, the earlier same-day line that deletion keeps its gates.

2026-11-25, same owner chat, after being shown the four groups that still prompted under Full
access and told that a push to main and a sent message cannot be undone (Turkish, then translated):

> full access te onay filan olmaması gerekiyor
>
> benim kararlarım da hiç birinde sormasın.

> there should be no approval or anything like it in full access
>
> my decision: it must not ask in any of them.

Full access is one of two owner-set states. For the Room and voice: an active native standing
consent on the current credential at level "everything". For a coding session: its Host runtime
mode "full-access". Under it Git push and merge, direct social sends, saved SSH commands, Room
Inbox comments, reviews and pull request changes, and Room Jira reads and board changes run
without a dialog; so do a full-access coding session's Inbox writes and its task delete, transfer
and note resolve (native asks the Host with `<action>.permission`). The owner's ticked exclusions
keep their own dialog (pushMain for a push or merge to main
and every Inbox pull request merge, sendMessages for social sends and Inbox comments and reviews);
SSH commands, like `commands.run`, skip only with zero exclusions. Any other level, a missing or
unreadable grant, or a supervised session keeps today's dialogs. Admission without a dialog is
recorded (`approvedBy` on the management receipt and SSH status, a native log line for Room
Inbox). This supersedes the 2026-11-10 line that Git push/merge and direct social sends always go
through the native owner approval, and the Host rule that publication keeps its prompt in a Full
access coding session. Credential entry, OS permissions, install/update, account and pairing
changes and clarifying questions keep their own flows.
