# Social Media host integration

The global Social Media screen opens from the project rail or session composer. Accounts belong to a host authority; campaigns and conversations refer to projects. UI, session MCP and host CLI operations use the same `SocialService`, SQLite queue and authorization checks.

## Manage the workspace

The left navigation separates Accounts, Campaigns, Inbox, Audience, Automations and Settings.
The connection and project filters stay visible. Forms retain their content when
switching sections or visiting another tool; reply forms also retain separate text
for each conversation. Creation and editing dialogs preserve the underlying list layout.
Switching hosts clears that host's private data and forms. Failed refreshes preserve
the current data and show a retry action.

Start by connecting an account and granting the relevant project access. Prepare a
campaign, save it, and check its current preview before approving it for the queue.
Text counters use the account's effective character policy. In Inbox, assign the
conversation to a project before saving a reply. Review drafts can be edited and
saved before approval. Editing a draft removes its previous approval and automatic
rule authorization. Drafts already queued or dispatched cannot be edited.

Audience lists filter locally by name and segment. Saving a contact or adding it to
a project does not create consent. Consent must have an explicit source and date.
Automations separates publishing plans, reply rules, and sending controls, including polling.
Operation history stays inside Social Media: its toolbar shortcut opens the History
subview within Automations. It shows queue and completed results with status, account,
type, date, and text filters; it is not a separate left-navigation entry.
Settings contains content policies and advanced cross-computer authority
configuration. Technical account permissions remain under account details.

## Schedule recurring publications

1. Connect the account in **Accounts** and grant publication access to the selected
   project. The connection must support publishing; connecting an account alone
   does not enable sending.
2. In **Campaigns**, prepare and save the content pool. Review and approve the exact
   text, media and account variant of every campaign you intend to publish.
3. Open **Automations → Publishing plans**, create a plan, select the account,
   project and approved campaigns, and choose the daily time window and IANA time
   zone. Set minimum and maximum intervals, for example **09:00–18:00,
   Europe/Istanbul, 2–5 hours**. The preset fills these values; they remain editable.
4. Save the plan. It starts paused. Review its schedule and content pool, enable
   external sending if needed, confirm the review checkbox and explicitly activate
   the displayed plan revision. The executor host must remain online.

The first publication is due in the next allowed window. Later publications use
stable varying intervals between the selected minimum and maximum, measured from
the preceding actual dispatch. Each exact approved campaign variant is published
once. The finite pool stops when exhausted; it does not repeat old posts or invent
new content. Add approved content and review the updated plan to continue. The plan
shows its next publication, completed/remaining pool count and latest job result;
queue history retains individual outcomes.

The end time is exclusive. An end earlier than the start spans midnight; equal
start and end mean the whole day. Timezone rules, including daylight saving gaps
and repeated hours, apply to the daily window. Quiet hours can extend the maximum
interval until the next open window. After host downtime, the scheduler publishes
one due item and measures the next interval from that dispatch instead of sending
a burst of missed posts.

An account can have one active publishing plan. Campaign variants share the same
deduplication key with one-off scheduling, and an active plan reserves its remaining
pool. Editing a plan saves it paused; keeping its completed pool prefix preserves
confirmed progress. Changes to campaign approval, effective content policy,
connection or project permissions require review and reactivation. Failed or
ambiguous publication outcomes pause the plan; an uncertain dispatch or restart
during sending remains in review and is never blindly retried.

These are owner UI operations: `publishing-plans.create`, `publishing-plans.update`,
`publishing-plans.list`, `publishing-plans.activate` and `publishing-plans.pause`.
Activation requires the exact reviewed revision and explicit owner confirmation.
Session MCP/CLI grants cannot activate a publishing plan or approve its content.

## Prepare bulk replies, comments and messages

In **Inbox**, select conversations and choose **Prepare replies to selected
conversations** to answer multiple comments or messages. In **Audience**, select
individual contacts or select all members of a displayed segment, then prepare
new messages or comments. A new comment requires the target platform post ID for
each selected person. Bulk selection does not expand a platform's supported
operations; for example, X browser-session mode has no direct-message capability.

The recipient preview checks the account's effective character policy, project
access, platform capability, opt-out state and communication eligibility. New
messages require recorded outbound consent; replies require a valid assigned
conversation and any applicable reply window; comments require eligible targets.
A contact, segment membership or imported list does not grant permission. Policy
is read separately for each account before text is prepared, and the host checks
current authorization and limits again before dispatch.

Preparation reports a result for each recipient: draft ready, skipped with a
reason, or failed. Successful preparation creates drafts only. Review and
explicitly approve/send each recipient's exact content; one recipient's approval
does not authorize the others. Editing invalidates the previous approval. After a
partial preparation failure, retry only the failed draft rows to preserve drafts
already created. Queue retries apply only to explicitly failed sends; successful
or uncertain deliveries are not repeated.

## Configure an account connection

Use an existing local or paired bycoda Host. Configure the host service environment with the relevant platform app settings; do not place them in provider environments, frontend storage, project files or prompts.

For each platform, replace `PLATFORM` with `X`, `INSTAGRAM`, `FACEBOOK`, `LINKEDIN` or `YOUTUBE`:

- `BYCODA_SOCIAL_PLATFORM_CLIENT_ID`
- `BYCODA_SOCIAL_PLATFORM_CLIENT_SECRET` (required for Meta/LinkedIn/Google; optional for a public X PKCE client)
- `BYCODA_SOCIAL_PLATFORM_REDIRECT_URI`, pointing to `/social/oauth/<platform>/callback` on this host
- `BYCODA_SOCIAL_PLATFORM_APPROVED=1` only after checking the app's actual product access/review

Public callbacks must use HTTPS. Loopback HTTP callbacks are accepted for local development only when the platform app permits them. Default Graph API version is `v25.0`; `BYCODA_SOCIAL_GRAPH_VERSION` selects another valid version. LinkedIn defaults to `202609`; `BYCODA_SOCIAL_LINKEDIN_VERSION` selects a supported monthly version.

In Accounts, add the correct account type and related projects, choose the operations whose permissions should be requested, then connect through OAuth. Choose the identity returned by the platform; scopes requested by the app are not assumed granted. Facebook requires an eligible managed Page; Instagram uses a professional Business/Creator account with Instagram Login. LinkedIn organization connections require an organization ID and verified administrative access.

Access and refresh tokens stay in a host-only encrypted vault. Its encryption key is protected by Windows DPAPI CurrentUser, macOS Keychain or Linux Secret Service. There is no plaintext fallback. A locked or missing key preserves existing encrypted credentials and fails the operation. Expired connections require reconnect; unattended token refresh is not implemented.

## X browser-session mode

X accounts can alternatively connect through the owner's own logged-in X web session instead of the paid X API. This mode is unofficial: it automates x.com, can break when the site changes, and X may restrict or suspend accounts it considers automated. The owner must explicitly accept that risk for each connection.

The host launches system Microsoft Edge or Google Chrome (`BYCODA_SOCIAL_BROWSER` selects another Chromium executable) with a dedicated profile under the host's `social/x-browser/<accountId>` directory. No browser is downloaded. **Log in to X in browser** opens a plain, non-automated window on the executor host (Google and X block sign-in in debugger-controlled browsers). The owner logs in, including with Google, and closes the window; bycoda never receives the password. The host then opens the profile in the background and completes login only when the `auth_token` and `twid` cookies exist. The `twid` user ID becomes the account identity, and reconnecting with a different X account is rejected. The profile is the credential: cookies stay in the profile (encrypted by the browser), the vault stores only a marker, and nothing reaches the renderer, session tools or logs. Disconnecting deletes the profile.

Sends use the same approval, queue and policy checks as OAuth accounts. Each send launches the profile headless (`BYCODA_SOCIAL_BROWSER_HEADED=1` shows the window for debugging), verifies the logged-in user ID matches the account, types the text, attaches up to four images and clicks Post. The post ID comes from the X web `CreateTweet`/`CreateNoteTweet` response. If no response confirms the outcome after the click, the job goes to review and is never retried automatically. Operations on one profile are serialized and sends are spaced at least 30 seconds apart.

Only publishing (text, link, up to four images) and replying to a given post ID are supported. Inbox/DM reading, direct messages, search and polling are unsupported in this mode. The executor host must run in an interactive user session for the login window to appear.

## Project access and approval

Account grants separately control reading, drafting, publishing, replies, outbound messages and comments for each project. A session's project and provider come from the host/native session registry, never the tool's JSON. Private threads from another project cannot be read or sent to. Unmatched conversations remain in owner review until explicitly assigned.

Campaigns may select multiple projects/accounts and store independent content, media, links and publication times. Only explicitly entered, verified public project facts are offered to drafts/rules; project files and private transcripts are not scraped. Editing content invalidates its exact-content approval. Successful, pending and uncertain targets cannot be silently duplicated.

Real sending is disabled initially. The owner must explicitly enable execution and approve the exact campaign/draft, or explicitly activate an automatic rule. Existing user authorization outside this module is not inferred from a draft or stored contact.

Automatic rules support draft-only, approval and automatic modes. Rules start paused. An automatic rule needs explicit confirmation, an account/project, an inbound trigger, allowed topics, exact keyword-to-public-fact mappings, a daily limit and stop conditions. Uncertain, out-of-scope, complaint and suspicious instruction content is held for review. LinkedIn inbound third-party API content is withheld from AI session tools and automatic reply rules under its developer AI policy.

## Saved agents and content limits

In **Settings → Content and AI settings**, the owner saves a global provider/model and separate maximum character counts for campaign content, comments/comment replies, and messages/message replies. An unset global agent keeps verified fixed replies until an agent is explicitly saved. The saved provider uses that host's configured authentication, independently of the chat provider. A model ID is optional; blank uses the selected provider's default model. No unavailable provider is silently replaced with Claude or another provider.

Each platform can override individual fields. Empty platform fields inherit global values; clearing an override restores inheritance. A rule-specific agent overrides the global agent, while an explicit platform agent takes precedence over both. Limits accept integers from 1 to 20,000, count Unicode code points (including links), and remain subject to platform/API limits. Limits are enforced when drafting, scheduling and immediately before dispatch, including existing queued jobs after a policy change. These settings do not grant communication permission or enable external sending.

The host persists generation tasks with the selected agent and effective limits, passes the same policy in every generation prompt, and checks authorization and policy again after generation. Prompts contain only owner-entered public facts and brand voice, never raw inbound instructions, social credentials or project files. Generation uses the existing harness text runner in an empty host workspace without a social session grant. Gemini has a fresh ACP plan-mode helper with no client filesystem/terminal tools or attached social MCP, and permission requests are denied. Its compatible installed CLI and login must be verified on the executor host; a mocked ACP test does not establish account access. Harnesses without a text runner hold the draft for review.

Draft/approval rules may produce rewritten text for owner review. Automatic sends require the generated text to match an allowed verified answer exactly; rewritten facts, exceeding limits, invalid output, stopped rules, opted-out recipients or changed policies require review. Generation consumes the rule's daily generation budget, including held drafts. Queued tasks survive restart; interrupted running tasks require review rather than rerunning blindly. A host tick generates at most one draft and has a 90-second deadline. The UI shows the selected agent, model and generation state on drafts.

## Session tools

MCP tool names are `social_accounts_list`, `social_campaigns_create`, etc. CLI actions retain dots. All 22 actions are available through the same host service:

```text
policy.get           accounts.list        capabilities.get
campaigns.create     campaigns.preview     campaigns.schedule     campaigns.status
inbox.list           thread.read           replies.draft           replies.send
contacts.upsert      contacts.search       segments.create
messages.draft       messages.send         comments.draft          comments.send
automations.create   automations.pause     jobs.status             jobs.cancel
```

The native/headless backend supplies a limited, memory-only session credential directly to the agent process. The renderer receives executable metadata only. Claude and Codex receive process-local MCP configuration; ACP session setup adds the same stdio server. OpenCode v2 uses a private ACP process for social-enabled sessions. Pi/OMP and other shell-capable agents can use the host CLI bridge. Existing running processes need to be stopped/restarted to receive a newly connected authority or newly available MCP server; stored sessions retain access when resumed through a new process.

Run the executable command shown to the agent with `social --help` for actions, or `social <action> --input -` with JSON on stdin. The CLI does not accept actor/provider/token claims from that JSON. Session credentials cannot use owner controls or unrelated host operations.

Every provider's session instructions require `social_policy_get` (CLI `policy.get`) with the target account before generating social text. It returns the effective platform/global policy under the account's read grant. `policy.save` is owner-only and is not exposed as a session MCP tool. Incoming content cannot change these settings or communication grants.

## One authority across computers

Pair the hosts using the existing Connections workflow. In Social Media, choose one central host and expand “Session araçlarının merkezi host'u”. Explicitly map local projects to projects on the authority and provide this source host's HTTPS endpoint reachable from the authority. Limited peer credentials remain between native code and hosts. The authority verifies source session identity on calls and again before queued sends.

Selecting a central authority suspends the source host's execution and polling. Both Windows and Mac should select that authority; connecting the same account independently on unrelated hosts does not create a shared queue. Peer chains are rejected. Removing delegation keeps local execution stopped until the owner explicitly enables it again.

## Inbox events and delivery

Meta webhook receivers use `/social/webhooks/instagram` and `/social/webhooks/facebook`. Configure each host's `BYCODA_SOCIAL_PLATFORM_WEBHOOK_VERIFY_TOKEN` and client secret, verify the callback in the platform dashboard and create the required account subscription. The receiver verifies the raw HMAC signature before parsing and deduplicates event IDs. Its presence alone does not prove that external subscription works; capabilities remain pending. X/LinkedIn webhook receivers are not implemented.

Owner-enabled polling uses authorized API reads with durable pagination cursors and platform backoff. Historic coverage still depends on platform access and retention. The UI can request a manual account sync. Incoming text is untrusted data and cannot alter account grants, secrets or send approval.

The host owns the durable queue. Jobs continue across UI/session closure, but do not execute while the host is offline. Account/campaign/global stops, opt-outs, consent and current project permissions are checked before dispatch, including after credential I/O. Parallel replies to the same inbound event produce one job.

Rate limits use Retry-After/reset headers. A dispatched timeout, crash or uncertain platform response goes to review; these adapters do not have a reliable reconciliation lookup and will not retry blindly. Only explicitly failed jobs can be retried. Per-target results retain error state and publication URL when returned. Media preparation checkpoints survive retries.

Source and browser-fixture checks verify the implementation and mocked workflow.
They do not prove that an installed app/host includes these changes, that an actual
platform account permits every operation, or that a real publication was delivered.
Use the shared [local update workflow](../local-update.md) for app/host installation;
verify installed versions and real account results separately. Scheduling a job or
activating a plan is not evidence that it has been sent.

## Current adapter boundaries

- X: text and up to four locally uploaded JPEG/PNG images, each at most 5 MiB; mentions and API direct messages. External search is a documented product candidate, not an implemented discovery command.
- Instagram: one HTTPS image, owned-media comments and permitted professional inbox replies. Cold messaging and arbitrary third-party comments are unavailable.
- Facebook: managed Page text/link or one HTTPS photo, eligible comments and standard-window inbox replies. Personal-profile publication and unsolicited messaging are unavailable.
- LinkedIn: member/organization text and one locally uploaded organization image with readiness verification; approved comments. General inbox messaging is unavailable. Member image publishing is not implemented with write-only tokens.
- YouTube: an OAuth-verified channel, one owner-selected MP4/WebM video up to 64 MiB per campaign target, explicit title/description/privacy/audience/synthetic-media declarations, published channel comments and complete reply pagination. Replies use top-level comment IDs. Eligible comments on external videos resolve the video's channel ID through the API. General direct messages, Community-post creation, external discovery and comment webhooks are not implemented.

Videos on platforms other than YouTube, carousels, Stories and reply/message attachments are rejected explicitly in this version. A contact record alone grants no communication permission. Manual/imported/API contacts retain independent outbound consent, reply eligibility, comment eligibility, exact platform identity, project tags and interaction history. Cross-platform identities are not merged by similar names, and segments do not infer sensitive traits.

## YouTube configuration and delivery

Enable YouTube Data API v3 in the Google Cloud project and configure a Web Application OAuth client, consent screen, allowed users/access approval and the exact `/social/oauth/youtube/callback` redirect on the central host. Use `BYCODA_SOCIAL_YOUTUBE_CLIENT_ID`, `BYCODA_SOCIAL_YOUTUBE_CLIENT_SECRET`, `BYCODA_SOCIAL_YOUTUBE_REDIRECT_URI` and `BYCODA_SOCIAL_YOUTUBE_APPROVED`. The owner must review the actual app access before setting the approval flag. OAuth requests `youtube.readonly` to verify the selected channel, `youtube.upload` for video publishing and `youtube.force-ssl` for comments/replies. Google account/Brand-channel selection happens in Google's external authorization flow; ambiguous channel enumeration is rejected. Tokens and upload-session URLs never reach the renderer, session tools or transcripts.

Select a Channel account, upload a video to the host in 1 MiB chunks and choose its metadata. Visibility defaults to **private**. The exact metadata is included in the owner's campaign approval and passed through the same provider-independent tool/queue contract. The host submits a resumable-upload initiation followed by one final video PUT; the result records the returned privacy rather than assuming the requested visibility. Upload acceptance does not prove video processing/playback success. This adapter does not persist/resume the platform upload session after an interruption: timeout/restart after dispatch requires review and never starts another upload automatically. Host ingestion of an incomplete file must be restarted; completed files and jobs survive restart. Incomplete staging uploads expire after 30 minutes and are cleaned on subsequent uploads.

The 64 MiB limit is an explicit local adapter bound, not YouTube's maximum. Platform quotas, comments-disabled responses, OAuth expiry and processing/access restrictions still apply. Quota errors back off for six hours or the supplied Retry-After; the effective Google Cloud quota must be checked externally. Owner-enabled polling reads at most four comment/reply pages per account sync with a durable cursor; channel-owner comments are skipped. A thread with `canReply=false` cannot be sent a reply through the shared service. Video-change push notifications do not supply comment/DM inbox events.

Official contracts: [OAuth](https://developers.google.com/youtube/v3/guides/auth/server-side-web-apps), [video insert](https://developers.google.com/youtube/v3/docs/videos/insert), [upload protocol](https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol), [comment threads](https://developers.google.com/youtube/v3/docs/commentThreads/list), [comment replies](https://developers.google.com/youtube/v3/docs/comments/insert), [new video comments](https://developers.google.com/youtube/v3/docs/commentThreads/insert), [push notifications](https://developers.google.com/youtube/v3/guides/push_notifications).
