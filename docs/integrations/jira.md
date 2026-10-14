# Jira Cloud inbox

Open **Settings → Inbox → Jira**, enter your Jira site, Atlassian account email,
and an API token **without scopes**, then select **Connect**. The connection is
validated before credentials are saved. Create a token from
[your Atlassian account](https://id.atlassian.com/manage-profile/security/api-tokens).
Scoped tokens and Jira Data Center are not supported by this integration.

Select the Jira source in Inbox to browse issues, read descriptions and comments,
post comments, ask about a ticket, or start work in a local project. Starting work
and asking about a ticket include its description and Jira identifier.

Select **Board** in the Jira inbox header to choose a Scrum or Kanban board.
**Kanban** uses that board's actual column/status mappings. Filter it to the board,
backlog, or an active/future sprint. **Backlog & sprints** shows active and planned
sprints above the backlog; Kanban boards show their board and backlog sections.
Select allowed boards in **Settings → Inbox → Jira → Boards** first. No board is
enabled by default. The board roster is restricted to selected projects, and board
issue requests also apply the project scope. Assignee filters remain specific to
the list view. Search filters the loaded cards by key, title, or assignee.
If Jira reports that a backlog is unsupported, available sections remain visible
with guidance to enable the backlog in Jira; this does not create a synthetic backlog.

Drag a card onto a column to change its status, onto another sprint/backlog section
to move it, or onto another card to rank it before that card. Dropping into empty
space ranks it after the last card when every page has loaded. **Move** provides
a keyboard-accessible alternative for status, sprint and ranking changes. Open a card to
use the existing issue details and agent actions. Ranking is disabled while searching
or while any section has more pages; use **Load more issues** to finish loading.

Moves are written to Jira using the connected account's permissions. Available
workflow transitions are checked again before writing. Multiple transitions into
a column require an explicit selection; transitions needing required fields link
to Jira. Failed and partially applied moves stay visible as errors while the board
reloads from Jira. No sprint is created, started, or closed by moving cards.
The implementation uses the [Jira Software board APIs](https://developer.atlassian.com/cloud/jira/software/rest/api-group-board/)
and cursor-based issue pagination.

Project selections are shared between Settings and the Inbox filter menu.
Unchecked projects are excluded from fetching and background notifications.
Reconnecting preserves project and board selections. **Automatically refresh Jira
in the background** is off by default. Jira loads on opening its view, manual
refresh, scope changes, and after writes. Background notification polling skips
Jira unless the owner enables automatic refresh. Explicit remote inbox reads
remain available.
The inbox loads up to 40 open issues or 100 issues when including closed history,
ordered by last update. An unfiltered all-status query covers the last year of
activity. Long comment threads show the latest 50 comments, with a link to Jira.

Automations offer **Jira → Issue appeared** after connecting. They run in the
automation's selected local project when a Jira issue first appears in the polled
inbox, after its initial snapshot. Jira triggers require the automatic refresh
option above. The project-key filter uses values such as
`ENG`. This is polling, not a webhook for every issue created on the site.

**Disconnect** removes the saved credentials and clears cached Jira content.
Credentials are stored in the app's local data directory; on Unix the file is
created with owner-only permissions.
