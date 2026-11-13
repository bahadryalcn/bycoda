# Integrations and messages

## Inbox attachments

Jira, GitHub, GitLab, Azure DevOps and Linear descriptions and comments use the same
attachment preview. Images appear inline and open in the zoomable image viewer;
videos play inline. PDFs open in a dialog. Other files and failed previews open a
dialog with an explicit **Open in browser** action; failed downloads also offer
**Retry**. Provider permissions and the existing preview size limit still apply.

Jira issue details include the issue's full attachment collection, including files
mentioned only by filename in the description. Azure DevOps work item details include
attached-file relations. GitLab upload links resolve against the current project.

Jira Inbox list filters support multiple assignees, **Assigned to me**, **Unassigned**,
and multiple actual workflow statuses under **Board status**. Assignees and statuses
come from loaded issues in visible projects. Assignment choices are combined with OR;
workflow statuses are combined with the existing Open/Closed, Time and Projects filters.
Assignment and workflow selections narrow Jira's server query before its result limit.
Selections persist with Inbox filters and **Clear filters** resets them.
The filter panel groups assignment shortcuts and Open/Closed choices side by side.
Assignee options show people's names; the closed picker shows selected names.

Settings > **Integrations** holds every external service bycoda connects to. Each card
shows what the service supplies: **Inbox** (work items) or **Messages** (conversations
you can reply to).

| Service                                    | Supplies | How you connect                                                                                                              |
| ------------------------------------------ | -------- | ---------------------------------------------------------------------------------------------------------------------------- |
| GitHub, GitLab, Azure DevOps, Jira, Linear | Inbox    | Token or CLI, as before                                                                                                      |
| Email (several accounts)                   | Messages | Gmail signs in with Google or uses an app password; Yahoo, iCloud and other IMAP/SMTP servers use a password or app password |
| Slack                                      | Messages | Sign in with Slack in your browser; a bot token is the fallback                                                              |

Discord, Microsoft Teams and Outlook / Hotmail mail are temporarily unavailable for new
connections. Accounts connected earlier keep appearing in Messages.

## Social Media

Open **Social Media** to manage content, audience, outreach and messages on the
selected computer. Lists and segments have edit and delete actions. Deleting a
collection keeps its people; a collection used by a capture rule or unfinished
sequence must first be removed from that work. The automatic Commenters list is
managed by its rule.

Use **AI chat** for a conversation dedicated to the selected Social workspace.
Close and reopen the panel without losing its draft. Select a project before
opening a conversation on a remote computer. **Open live view** inside the panel
opens an account's browser for owner interaction. Existing account permissions,
sending approvals and stop controls still apply.

Account connection status and operation availability are separate. After signing
in, use **Check connection**; capabilities that remain unavailable explain their
own state. A browser login does not enable operations the platform does not support.

## Jira working folders

In the Jira integration, **Default bycoda project** chooses the working folder for
issues. Set a global default, then optional defaults for individual Jira projects
and boards. A board default takes precedence when opening an issue from that board;
otherwise the Jira project default takes precedence over the global default.
Without a default, Inbox keeps its current folder selection behavior.

Change **Agent working folder** in an issue to save an explicit choice for that
issue. It survives reopening and takes precedence over every default. These choices
use the same local settings storage as Jira scope preferences and do not change Jira
access or agent permissions.

## Email

Add as many accounts as you need. Pick a preset (Gmail, Yahoo, iCloud) or **Other
IMAP/SMTP** and enter your server details. bycoda reads your inbox
without marking anything as read and sends replies through your SMTP server.

- **Gmail**: choose **Sign in with Google**, finish signing in in the browser that
  opens, then save. The address fills in from the signed-in account. Google sign-in
  is open to the first 100 users while bycoda's Google app is in testing, and a
  Workspace administrator can block it. When Google shows an error page instead of
  returning to bycoda, choose **Use an app password instead** under the sign-in button
  (also under **Advanced**) and enter a Gmail app password; it needs 2-step
  verification on your Google account.
- **Outlook / Hotmail**: temporarily unavailable. Outlook.com no longer accepts IMAP
  passwords, and Microsoft sign-in is not registered yet. Saved Outlook accounts can
  still be edited.
- **Yahoo, iCloud and other servers**: enter the password, or an app password when
  2-step verification is on.

## Slack

Choose **Sign in with Slack**, approve access in the browser and the workspace is
saved. bycoda then reads the channels and direct messages your Slack account can see
and replies as you. To connect a bot instead, open **Advanced** and turn on **Use a bot
token instead**; a bot sees only the channels it was invited to and replies as the bot.

## Discord (temporarily unavailable)

Discord connects with a bot token only, because Discord does not let apps read a
user's own messages. Discord shows the channels you list; enable the bot's Message
Content intent so message text is visible. Replies post as the bot and never mention
anyone automatically.

## Microsoft Teams and Outlook (temporarily unavailable)

Microsoft sign-in shows a code. Open the sign-in page, enter the code and approve.
It needs a Microsoft app registration; if the card says one is missing, add the client
ID under advanced options. Some work accounts need an administrator to approve access.

## Browser sign-in setup (owner)

Browser sign-in needs an app registration for Google and for Slack. A build includes
them from the environment variables below; a running app also reads the same variables
at startup. A user can instead enter their own client ID under the card's advanced
options.

| Variable                      | Used for                                              |
| ----------------------------- | ----------------------------------------------------- |
| `BYCODA_GOOGLE_CLIENT_ID`     | Gmail sign-in                                         |
| `BYCODA_GOOGLE_CLIENT_SECRET` | Gmail sign-in (Google issues one for desktop clients) |
| `BYCODA_SLACK_CLIENT_ID`      | Slack sign-in                                         |

**Google.** In Google Cloud, create an OAuth client of type **Desktop app** and add
the Gmail API. While the consent screen is in **Testing**, only listed test users (up
to 100) can sign in and their refresh tokens expire after 7 days, so they must sign in
again weekly. The Gmail scope (`https://mail.google.com/`) is restricted: a public
release needs Google's app verification and a CASA security assessment.

**Slack.** Create a Slack app, turn on **PKCE** under OAuth & Permissions, add the
redirect URL `https://bycoda.codes/oauth/slack/` (a static page that forwards the sign-in code to `http://localhost:47213/callback` on your device) and add these **user token** scopes:
`channels:read`, `channels:history`, `groups:read`, `groups:history`, `im:read`,
`im:history`, `mpim:read`, `mpim:history`, `users:read`, `chat:write`. Distribute the
app so other workspaces can install it.

## Reading and replying

Open Inbox > **Messages** to see recent conversations from every connected account,
newest first. Filter by account or service, search, and open a conversation to read
it. Write a reply and press **Send** or Ctrl/Cmd+Enter. Nothing is sent without your
click, and drafts are kept while you switch conversations. Messages refresh while the
view is open; use the refresh button any time.

Credentials stay on this computer. Remove an account from its card to disconnect it
and delete its stored credentials.

## Mention work items in chat

Connected tracker items can be referenced in drafts with `@alias:ref`. Jira accepts
`jira`, `jr`, `j`; GitHub `github`, `gh`; Linear `linear`, `lin`, `ln`; GitLab
`gitlab`, `gl`; Azure DevOps `ado`, `azure`, `az`. Examples: `@jira:PROJ-123`,
`@gh:142`, `@github:owner/repo#142`, `@linear:ENG-42`, `@gl:group/proj!57`,
`@ado:12`. Sending includes available item context without changing the draft token;
an unavailable lookup does not prevent sending. See [chat references](chat-artifacts-and-connected-files.md#reference-tracker-work-items)
for reference limits and sent-message behavior.

Jira key prefixes and numeric queries use Jira Cloud's issue picker, then load up to
20 existing issues in picker order. Exact keys also retain their direct lookup;
ordinary text searches use Jira text search. Hidden Jira projects remain excluded.
