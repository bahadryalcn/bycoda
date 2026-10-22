# Social Media host integration

The global Social Media screen opens from the project rail or session composer. Accounts belong to a host authority; campaigns and conversations refer to projects. UI, session MCP and host CLI operations use the same `SocialService`, SQLite queue and authorization checks.

## Manage the workspace

### Browser workspace and registration

Every platform account has an owner-assisted **Browser workspace** on its selected
executor host. It opens a dedicated Chrome/Edge profile for login, registration,
inbox navigation, supported publishing pages or a validated public post URL for
comments. WhatsApp and Telegram registration is completed through their own native clients;
YouTube has no general private-message inbox. Facebook and Instagram open their
home surface for publishing; the owner chooses the composer there. These routes
are navigation workflows, not new automated publishing or inbox adapters.

The owner starts or cancels work from Accounts. Registration terms, passwords,
Google account selection, verification codes and challenges are completed in the
browser. The host stores up to 20 workflow metadata records per account and tracks
queued, awaiting-owner, closed, cancelled, expired, interrupted and failed states.
Closing a window never establishes successful registration, authenticated identity
or delivery. A host restart marks unfinished work interrupted and does not reopen
registration automatically. Work expires after 20 minutes. Switching executor or
disconnecting cancels active assisted work and removes the host's saved browser
profile. Entered fields, cookies, target post
URLs and page content are not included in workflow records.

The X workspace shares the existing X browser profile and serialization lock.
After registration, use **Manage browser connection** to verify the saved X
identity and connect the existing publishing adapter. Assisted work must finish
before this verification starts. The other platforms' API capabilities remain
unchanged: opening their web page does not grant automated messaging, polling or
publishing support. Their browser identity checks, read/write recipes and live
delivery acceptance remain to be implemented and verified separately.

Owner-device RPC methods are `social.browser.workflow.begin` (`accountId`,
`intent`, optional `targetUrl`, `acknowledgeRisk: true`),
`social.browser.workflow.status` (`accountId`) and
`social.browser.workflow.cancel` (`accountId`). Session social tools cannot use
these owner-only methods or gain send permission through them.

### Background operation

Connected X browser accounts also expose an owner-only **X profile and follow**
section. Explicit actions read the public editor fields, apply changed name/bio/
location/HTTPS website fields, upload JPEG/PNG avatar/banner assets, or follow one
exact username. Saved text is re-read from a reopened editor; changed images require
new persisted public image URLs. Follow resolves the exact profile to a numeric
target and verifies its Following control; an existing follow is a no-op.
Unknown layouts/outcomes fail visibly and never cause an automatic retry.

Host owner RPCs are `social.browser.profile.read`, `.update` and `.follow` with
`accountId`; update accepts `patch` and `confirm: UPDATE_X_PROFILE`, follow accepts
`handle` and `confirm: FOLLOW_X_ACCOUNT`. These actions require a connected,
unpaused X browser account on its executor host, share the profile lock, recheck
identity and honor the global stop state. They do not enable campaign sending or
change policy. Session social credentials cannot invoke these owner methods.
Session-agent proposal/owner-review integration and recurring follow rules are not
implemented. Passwords, passcodes, birth dates and authentication fields are not
accepted as profile patches. Account setup/credential intervention remains separate
from ordinary public profile management.

Connected accounts do not need a foreground account window for routine supported
operations. `SocialService.tick` runs on the host, polls eligible accounts when
`inbox.polling` is enabled, feeds inbound events into existing activated rules and
dispatches approved jobs. Continuous product promotion uses the existing
`SocialPrograms` schedule, verified public facts, generation limits and activation
signature. Automatic reply rules require explicit activation once; matching events
then enqueue and execute without a per-message approval. Incoming content never
changes those grants or limits. This does not enable live sending merely by
opening a browser workspace or configuring a draft program.

X browser accounts participate in that same loop. The adapter captures recognized
mentions/reply timeline responses and legacy web DM inbox responses, validates the
authenticated numeric identity before and after each read, and passes bounded
inbound events to the existing deduplicating ingestion pipeline. It reads recent
web snapshots only; complete historical backfill and encrypted X Chat are not
implemented. If one read channel is unavailable, the successful channel can still
ingest events while monitoring reports partial coverage. Unrecognized response
formats never count as an empty inbox.

Browser polling also rotates through two saved published post IDs per tick and
reads their recognized `TweetDetail` responses. Directed replies are ingested
through the same account identity checks and event deduplication. The durable
cursor rotates the saved post list; this is a bounded recent snapshot, not a
complete historical or hidden-reply backfill. Monitoring reports comments as a
separate channel.

The X composer accepts up to four owner-uploaded JPEG/PNG images (5 MiB each) or
one MP4 video (64 MiB), including post replies/comments. Mixed image/video batches
are rejected. New file selections replace existing attachments; removal is explicit.
Documents such as PDF are shared by URL, not as native tweet attachments.
The browser waits for a video attachment and enabled Post control before submitting;
an ambiguous create response still requires review. The OAuth adapter uses the
v2 initialize/append/finalize/status media flow, checkpoints pending processing,
and never creates the post before processing succeeds. These local byte limits
are deliberately narrower than X's account-dependent platform limits.
OAuth DM sends accept one uploaded image/video attachment using DM media categories.
Browser DM media and encrypted X Chat remain unavailable. Editing draft attachments
is owner-only, revokes the previous approval, and includes the media in the next
exact draft review and queued send.

A missing mentions response counts as an empty read only when the authenticated
page positively exposes the selected mentions tab and its known empty-state
structure on the exact X mentions route. Redirects into `/i/chat/pin/` report
required Chat credential setup; other `/i/chat` routes report unsupported
encrypted Chat. Neither route is treated as a legacy inbox or successful read.

Legacy browser DM sends require `dm.write`, an exact numeric recipient and an
observed conversation containing that recipient and the connected sender. The
adapter accepts delivery only when a matching platform message ID, sender,
recipient and exact text are present in the response. Missing/ambiguous evidence
requires review and is not automatically resent. Newly connected browser accounts
record DM capabilities; older sessions must reconnect to obtain them. Project
message permissions, contact consent and send/rule authorization still apply.

`social.monitoring.status` accepts `accountId` and returns the last checked time,
healthy/partial/blocked status, read-channel coverage, polling enablement and
whether the account is active on this executor. It contains no cookies or message
bodies. This status describes the last read and does not prove future delivery.
The Accounts recovery disclosure displays it and supports explicit refresh.

The X web parser/driver has synthetic adapter and host-loop acceptance; live
authenticated acceptance, including the current Chat UI, remains unverified.
Other platforms' autonomous browser read/write adapters and automatic account
registration are not implemented by the owner-assisted route registry. Credentials,
verification challenges and account creation/terms approval remain separate from
routine background operation.

### Platform connections

Accounts supports X, Instagram, Facebook, LinkedIn, YouTube, TikTok, Snapchat,
WhatsApp and Telegram. Capabilities reflect the implemented adapter, independently
of a successful account connection. Project grants and external-send approval still apply.

- TikTok: OAuth identity and Direct Post video publishing through `user.info.basic`
  and `video.publish`. Use the TikTok client
  key as `BYCODA_SOCIAL_TIKTOK_CLIENT_ID`, and configure the matching
  `_CLIENT_SECRET`, `_REDIRECT_URI` and `_APPROVED=1` variables. Callback:
  `/social/oauth/tiktok/callback`. Existing profile-only accounts must reconnect to
  grant `video.publish`. The campaign editor loads current creator settings, offers
  only the returned privacy choices without a default, previews the video and
  requires explicit music/content consent. The current adapter uses one HTTPS video
  URL on a domain or URL prefix verified with TikTok (`PULL_FROM_URL`); local file
  uploads and photos are not implemented. Processing keeps a durable publish ID,
  never initializes the same job twice, and reports success only at `PUBLISH_COMPLETE`.
  An accepted post cannot be recalled through the queue. App audit/access restrictions
  still apply; an unaudited client is limited to TikTok's private-account/private-viewing
  test rules. The integration does not establish that bycoda has obtained an app audit.
  Personal/creator Login and Content Posting do not provide general comment/DM
  management. Those require separately eligible TikTok for Business/Organic products;
  no communication adapter for them is currently installed.
- Snapchat: Public Profile OAuth with `snapchat-profile-api`. Configure
  `BYCODA_SOCIAL_SNAPCHAT_CLIENT_ID`, `_CLIENT_SECRET`, `_REDIRECT_URI`,
  `_APPROVED=1`. Callback: `/social/oauth/snapchat/callback`. An eligible Public
  Profile and approved API access are required. Publishing, comments and messaging
  are not implemented; local campaign drafts remain available.
- Telegram: configure `BYCODA_SOCIAL_TELEGRAM_TOKEN` and
  `BYCODA_SOCIAL_TELEGRAM_APPROVED=1` on the selected host, then choose **Host hesabını
  bağla**. The host verifies the bot with `getMe`. Text messages are read using
  `getUpdates` with a durable offset and sent with `sendMessage`. Existing webhooks
  disable polling; bycoda never deletes them. Bots cannot contact arbitrary users:
  the chat must already be accessible, and outbound initiation requires recorded
  consent. Channel publishing, attachments and personal-user sessions are not supported.
- WhatsApp: Business Cloud API only. Configure `BYCODA_SOCIAL_WHATSAPP_TOKEN`,
  `BYCODA_SOCIAL_WHATSAPP_PHONE_NUMBER_ID`, `_APPROVED=1`, `_CLIENT_SECRET`
  (the Meta app secret) and `_WEBHOOK_VERIFY_TOKEN`. The host verifies the phone
  identity before connection. Register `/social/webhooks/whatsapp` and subscribe the
  Business Account to `messages`. Signed text-message events populate Inbox and
  permit text replies within 24 hours of the inbound timestamp. Replayed events are
  deduplicated. Personal accounts, historical inbox polling, templates, attachments,
  Channels/Status publishing and outbound initiation are not implemented.

Token configuration currently selects one bot/phone identity per platform per host.
Secrets stay in host configuration and the existing OS-protected social credential
store; they are never returned in account snapshots or supplied to session tools.
Connecting or preparing a draft does not send anything. Real-account authorization,
platform reviews and webhook subscriptions require deployment-specific setup.

### Messaging and comments

| Connection                   | Comment reads/replies                                                                                 | Private messages                                                                                              |
| ---------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| X OAuth/API                  | Mentions/replies through permitted reads; replies to post IDs                                         | Read/reply/send with DM scopes, enabled API product and recipient eligibility                                 |
| X browser session            | Bounded recent mentions/replies from recognized web responses; replies to exact post IDs | Legacy web inbox and verified numeric-conversation text sends; encrypted Chat unavailable |
| Instagram professional OAuth | Read/reply on owned media                                                                             | Read and reply to user-initiated conversations within the supported response window; no cold initiation       |
| Facebook Page OAuth          | Read/reply to eligible Page content                                                                   | Read and reply to user-initiated Page conversations within the supported response window; no cold initiation  |
| LinkedIn OAuth               | Comments on known published posts; organization discovery additionally requires Posts API read access | Not implemented; LinkedIn Messages API is a restricted partner product, not enabled by ordinary sharing OAuth |

Select the intended capabilities before OAuth. Selecting polling requests the
comment and message read permissions together. An existing account with only one
authorized read channel can still synchronize that channel; polling does not
require unrelated Page comment permissions for Messenger-only accounts. X DM sends
request `dm.write`, `dm.read`, `tweet.read` and `users.read`. Reconnecting to add
scopes never grants project send permission or turns on external sending.

References: [X messaging](https://docs.x.com/x-api/direct-messages/manage/introduction),
[Instagram conversations](https://www.postman.com/meta/messenger-platform-api/folder/22794852-255610cd-47f5-4f4d-b3fa-71aec360be9a),
[LinkedIn partner messaging restrictions](https://learn.microsoft.com/en-us/linkedin/shared/integrations/communications/messages),
[TikTok Direct Post and audit requirements](https://developers.tiktok.com/docs/en/content-sharing-guidelines),
[TikTok Business Messaging prerequisites](https://business-api.tiktok.com/portal/docs/business-messaging-api-get-started/v1.3).

API references: [TikTok user info](https://developers.tiktok.com/docs/en/tiktok-api-v2-get-user-info),
[Snapchat profiles](https://developers.snap.com/marketing-api/Public-Profile-API/Profiles),
[Telegram Bot API](https://core.telegram.org/bots/api),
[WhatsApp Cloud API](https://developers.facebook.com/documentation/business-messaging/whatsapp/overview).

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

For topic-driven AI generation, independent image providers, fixed-time/frequency schedules and customizable approval stages, see [AI campaign programs](social-programs.md). The original approved-pool plans below keep their existing behavior.

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
operations; for example, X browser-session mode cannot read or send encrypted
X Chat messages.

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

Access and refresh tokens stay in a host-only encrypted vault. Its encryption key is protected by Windows DPAPI CurrentUser, macOS Keychain or Linux Secret Service. There is no plaintext fallback. A locked or missing key preserves existing encrypted credentials and fails the operation. X and YouTube connections with valid refresh tokens renew through the host OAuth integration without changing scopes. Unsupported, revoked or scope-changed connections require owner reconnection.

## X browser-session mode

X accounts can alternatively connect through the owner's own logged-in X web session instead of the paid X API. This mode is unofficial: it automates x.com, can break when the site changes, and X may restrict or suspend accounts it considers automated. The owner must explicitly accept that risk for each connection.

The host launches system Microsoft Edge or Google Chrome (`BYCODA_SOCIAL_BROWSER` selects another Chromium executable) with a dedicated profile under the host's `social/x-browser/<accountId>` directory. No browser is downloaded. **Log in to X in browser** opens a plain, non-automated window on the executor host (Google and X block sign-in in debugger-controlled browsers). The owner logs in, including with Google, and closes the window; bycoda never receives the password. The host then opens the profile in the background and completes login only when the `auth_token` and `twid` cookies exist. The `twid` user ID becomes the account identity, and reconnecting with a different X account is rejected. The profile is the credential: cookies stay in the profile (encrypted by the browser), the vault stores only a marker, and nothing reaches the renderer, session tools or logs. Disconnecting deletes the profile.

Sends use the same approval, queue and policy checks as OAuth accounts. Each send launches the profile headless (`BYCODA_SOCIAL_BROWSER_HEADED=1` shows the window for debugging), verifies the logged-in user ID matches the account, types the text, attaches up to four images and clicks Post. The post ID comes from the X web `CreateTweet`/`CreateNoteTweet` response. If no response confirms the outcome after the click, the job goes to review and is never retried automatically. Operations on one profile are serialized and sends are spaced at least 30 seconds apart.

Publishing supports text, links, up to four JPEG/PNG images or one MP4 video, and
replies to a given post ID. Background monitoring reads recognized mentions and
saved-post comments, plus legacy web DM responses. Legacy text DM sending requires
verified numeric participants and a matching delivery acknowledgement. Encrypted
X Chat, browser DM attachments and search are unavailable. Inspect monitoring
coverage for partial results. The executor host must run in an interactive user
session for the login window to appear.

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

MCP tool names are `social_accounts_list`, `social_campaigns_create`, etc. CLI actions retain dots. All session actions are available through the same host service:

```text
policy.get           accounts.list        capabilities.get
campaigns.create     campaigns.preview     campaigns.schedule     campaigns.status
inbox.list           thread.read           replies.draft           replies.send
contacts.upsert      contacts.search       segments.create
messages.draft       messages.send         comments.draft          comments.send
automations.create   automations.pause     jobs.status             jobs.cancel
programs.list        programs.configure    programs.status         programs.generate
programs.preview-schedule
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

- X: text with up to four locally uploaded JPEG/PNG images (5 MiB each) or one MP4 video (64 MiB); mentions, saved-post browser comments and API direct messages. API messages accept one image/video attachment. Encrypted browser Chat is unavailable. External search is a documented product candidate, not an implemented discovery command.
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
