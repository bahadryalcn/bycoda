# Social Media host integration

The global Social Media screen opens from the project rail or session composer. Accounts belong to a host authority; campaigns and conversations refer to projects. UI, session MCP and host CLI operations use the same `SocialService`, SQLite queue and authorization checks.

## Manage the workspace

### Browser workspace and registration

Every platform account has an owner-assisted **Browser workspace** on its selected
executor host. It opens a dedicated Chrome/Edge profile for login, registration,
inbox navigation, supported publishing pages or a validated public post URL for
comments. These assisted navigation workflows are separate from connecting an
automated browser recipe. WhatsApp and Telegram registration is completed through
their native clients; their Web login links an existing account. YouTube has no
general private-message inbox.

The owner starts or cancels work from Accounts. Passwords, Google account
selection, verification codes and challenges are completed in the browser.
LinkedIn Company Page creation has a separate owner review of the exact
administrator, form fields and Page Terms before its final submission; other
binding signup steps remain in the platform window. The host retains up to 20
ordinary workflow metadata records per account and tracks
queued, awaiting-owner, closed, cancelled, expired, interrupted and failed states.
Closing a window never establishes successful registration, authenticated identity
or delivery. A host restart marks unfinished work interrupted and does not reopen
registration automatically. Work expires after 20 minutes. Switching executor
cancels active assisted work and pauses the account. Disconnecting also removes
this host's saved browser profile. Entered fields, cookies, target post URLs and
page content are not included in workflow records. Complete passwords, verification
codes, age/identity checks, challenges and terms directly in the platform window;
do not supply credentials through a conversation or session tool.

Final LinkedIn Page creation uses owner-only `social.browser.registration.review`
and `social.browser.registration.submit`. Reviews expire after two minutes and
bind the observed administrator, fields, agreement state and terms. The attempt
is persisted before accepting the agreement or clicking Create. Changed forms,
expired reviews and duplicate submissions are rejected. Unknown results preserve
the inspection window and a durable hold across cancellation, pruning and
restart; they are never automatically resubmitted. Creation receipts are retained
separately from ordinary workflow history and do not connect the Page to Social.
A selected signup logo requires manual handling; the separate profile editor can
apply the logo after creation. For new attempts, the owner can use
`social.browser.registration.reconcile` with the existing numeric Page ID to
verify the same administrator, name and public username against the persisted
expected-resource digest. This read-only recovery works after restart and never
repeats Create, accepts terms or connects the Page implicitly. Legacy attempts
without that digest still require manual inspection; there is no force-clear or
automatic retry.

After login or registration, use **Manage browser connection** to verify the saved
identity and connect that platform's browser recipe. X uses its existing
`social/x-browser/<accountId>` profile; the other platforms use
`social/browser-profiles/<accountId>`. Assisted work, verification, reads and sends
share the account's serialization lock. Assisted work must finish before connection
verification starts. Opening or closing a web page alone grants no API permission,
browser capability or external-send authority. A different identity requires a
separate local account rather than silently replacing an existing connection.

Generic signup is not brand provisioning. A Facebook signup does not create a
Page; Instagram API access needs a professional account; a Google account does not
create a YouTube channel; and Snapchat Public Profile setup is separate. A LinkedIn
organization uses a Company Page administered through a real person's account,
not a company name entered as a member identity. Newly created Pages, channels and
organizations still need their eligible account type, current admin access and
selected acting identity verified. Registration automation prepares supported
nonsecret fields; it does not infer birth dates or create a company as a personal
LinkedIn/Facebook member. Generic registration, channel creation and professional
account conversion remain unavailable without a verified current form contract.

Owner-device RPC methods are `social.browser.workflow.begin` (`accountId`,
`intent`, optional `targetUrl` or signup `registration`, `acknowledgeRisk: true`),
`social.browser.workflow.status` (`accountId`) and
`social.browser.workflow.cancel` (`accountId`). Session social tools cannot use
these owner-only methods or gain send permission through them.

For automated signup, the owner supplies only nonsecret profile fields. The
supported TikTok flow navigates to email signup and fills the supplied email and
actual birth date using current visible selectors. The personal LinkedIn flow
fills explicit real names/email; brand LinkedIn follows an observed Company Page
link and prepares verified Page name, public username and exact industry controls.
Organization size/type and the authority/terms checkbox remain explicit owner
choices. YouTube starts at the existing-account channel list instead of creating
a second Google account, follows its visible create-channel link and requires
verification of the intended administrator. Facebook brand setup opens Page creation and
fills the supplied Page name and exact category where the current form matches.
Optional marketing preferences and existing owner fields are preserved. Password,
verification, agreement, challenge and unknown-layout steps stop with a specific
reason; there is no automatic final signup or Page-create click.

`social.browser.registration.advance` takes `accountId`, `workflowId`,
`expectedUpdatedAt` and the nonsecret `registration` profile. It resumes that same
active window, rechecks owner authority and rejects stale revisions, another
executor, expired/cancelled work or a now-connected account. Supported nonbinding
navigation is bounded; each mutation rechecks current lifecycle/authority. Supplied
field values remain ephemeral and are not stored in workflow history. Status
inspection does not perform a signup action. Closing or redirecting a window never
proves registration; a restart never resumes registration automatically. Existing
plain X/Google login remains separate from the headed automated signup session.

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

The same owner profile transport supports LinkedIn organization name, tagline
and logo (`UPDATE_LINKEDIN_PROFILE`), Facebook Page logo only
(`UPDATE_FACEBOOK_PROFILE`), and Instagram bio and independent profile photo
(`UPDATE_INSTAGRAM_PROFILE`). Unsupported fields are rejected. Facebook profile
photos are public and saving may create a Page post. Instagram photos synchronized
with another account are held before any profile write; this editor does not
change sync preferences or mobile-only website links. Every supported update
rechecks the actor and reads persisted state back. A partial or uncertain update
requires inspection instead of automatic repetition.

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

The web recipes have source and synthetic adapter/host-loop coverage. This does
not establish live authenticated acceptance for the current version of every
platform website, including X Chat. Credentials, verification challenges and
account creation/terms approval remain separate from routine background operation.

### API and isolated browser modes

Accounts can use an official API connection or a verified isolated browser session
for each of the nine platforms. Browser mode does not require a developer API token
or a paid API product. It uses the ordinary signed-in website, so platform account
eligibility, challenges, restrictions and available website controls still apply.
New account forms default to Browser connection and offer an explicit API/browser
choice with matching account types. Saving an entry leaves it disconnected with
read/draft project access only. An uncertain API send is never retried through the
browser as an automatic fallback.

The following matrix describes implemented contracts, not live delivery proof.
Reads are bounded recent snapshots or saved-post scans; they are not complete
historical inbox exports. Browser media uses owner-uploaded files, with up to four
images or one video for supported publishing, and one attachment in the supported
WhatsApp/Telegram conversation paths. Unsupported file shapes are rejected before
dispatch.

| Platform | Official API path | Isolated browser path |
| --- | --- | --- |
| X | User OAuth posts/media, comments/replies, mentions and permitted DM reads/sends | Posts/images/video, mentions and saved-post comments, legacy DM text, owner profile/follow controls; encrypted Chat and DM attachments unavailable |
| Instagram | Professional account; HTTPS image, single video as a Reel in the feed, or ordered mixed carousel (up to four assets), owned-media comments and permitted text inbox replies | Image/carousel or one video publishing, saved-post comments/replies and recognized legacy direct-inbox text replies in an existing bound thread; no cold/new DM or message attachments |
| Facebook | Managed Page text/link or up to four HTTPS images with alt text; explicitly selected uploaded-video Reels with durable publication verification; eligible comments and Messenger text replies | Selected personal/Page actor; text/media publishing, saved-post comments/replies and recognized existing-thread Messenger text replies; unrecognized/encrypted layouts unavailable |
| LinkedIn | Member text; organization text/one to four uploaded images with alt text/readiness verification; eligible comments; no general DM adapter | Verified member/organization text/images/video or one titled PDF; single-image alt text, saved-post comments/replies, existing personal chats and free first-degree member initiation; no organization inbox/InMail |
| YouTube | Verified channel video upload with durable processing completion and comments/replies | Studio video upload with metadata, visibility and audience declarations, saved-video comments/replies; no Community publishing or general DM |
| TikTok | Direct Post of one video or up to four photo URLs on a verified domain, with creator settings, previews, explicit consent and completion polling | One local video through Studio with explicit privacy/content choices, saved-video comments/replies; no verified photo or DM/inbox recipe |
| Snapchat | Allowlisted Public Profile API app; encrypted Spotlight MP4 upload with explicit locale and exact ID/status tracking until LIVE; no Story/comment/messaging adapter | Member existing-chat text paths; separate Public Profile upload with explicit Spotlight or 24-hour Story target, exactly one selected profile and one MP4. Current uploader acceptance lacks a durable Snap ID and remains review-required; new DM and chat media are not implemented |
| WhatsApp | Business Cloud API phone, signed incoming text and text or one uploaded image/video reply within the supported window | A signed-in personal Web session, bounded visible chats and eligible text/one-image-or-video sends; no Status/Channels publishing |
| Telegram | Bot token, bounded text polling and eligible text or one uploaded image/video sends; separate reviewed channel connection with verified administrator bot for text or one uploaded image/video publication | A signed-in personal Web session, bounded visible chats and eligible text/one-image-or-video sends; no channel publishing or bot provisioning |

WhatsApp and Telegram personal browser accounts use the **member** type; their API
connections remain **business** and **bot** respectively. Instagram/Facebook
personal browser types do not grant professional/Page API access. Browser scopes
are recorded separately from OAuth scopes and cannot grant an unsupported API
operation. Snapchat **member** browser accounts connect at `web.snapchat.com` for
personal chat. Spotlight publishing uses a separate eligible **public_profile**
connection at `my.snapchat.com`, with exactly one selected uploader profile verified
as the actor. These connections have distinct saved identities and do not inherit
each other's operations. LinkedIn organization browser accounts do not inherit a
member inbox.

Before each final browser submission, the host rechecks the connected account,
executor, project grants, exact approval, consent, policy and Stop state. Recipes
verify the signed-in actor and exact target, then mark the irreversible submission
boundary. Any exception after that boundary becomes an uncertain outcome held for
review, including failed persistence/identity checks after a click. A transient
composer, optimistic bubble or closed dialog is not sufficient acknowledgement;
the recipe requires a recognized platform response or persisted exact resource.
Missing/changed/encrypted read layouts fail closed and report unavailable or
partial coverage rather than an empty healthy inbox. Per-account profile locks
serialize browser work, and durable account/executor job locks prevent concurrent
dispatch through the shared queue.

### Platform connections

Accounts supports X, Instagram, Facebook, LinkedIn, YouTube, TikTok, Snapchat,
WhatsApp and Telegram. Capabilities reflect the implemented adapter, independently
of a successful account connection. Project grants and external-send approval still apply.

- TikTok: OAuth identity and Direct Post video/photo publishing through `user.info.basic`
  and `video.publish`. Use the TikTok client
  key as `BYCODA_SOCIAL_TIKTOK_CLIENT_ID`, and configure the matching
  `_CLIENT_SECRET`, `_REDIRECT_URI` and `_APPROVED=1` variables. Callback:
  `/social/oauth/tiktok/callback`. Existing profile-only accounts must reconnect to
  grant `video.publish`. The campaign editor loads current creator settings, offers
  only the returned privacy choices without a default, previews the selected media
  and requires explicit music/content consent. The adapter uses one HTTPS video or
  one to four HTTPS photos on a verified domain or URL prefix (`PULL_FROM_URL`).
  Photo mode records a cover index, optional title and explicit recommended-music
  choice. A failed preview blocks consent; editing clears the previous consent.
  Local API uploads are not implemented. Processing keeps a durable publish ID,
  never initializes the same job twice, and reports success only at `PUBLISH_COMPLETE`.
  An accepted post cannot be recalled through the queue. App audit/access restrictions
  still apply; an unaudited client is limited to TikTok's private-account/private-viewing
  test rules. The integration does not establish that bycoda has obtained an app audit.
  Personal/creator Login and Content Posting do not provide general comment/DM
  management. Those require separately eligible TikTok for Business/Organic products;
  no communication adapter for them is currently installed.
- Snapchat API: Public Profile OAuth with `snapchat-profile-api`. Configure
  `BYCODA_SOCIAL_SNAPCHAT_CLIENT_ID`, `_CLIENT_SECRET`, `_REDIRECT_URI`,
  `_APPROVED=1`. Callback: `/social/oauth/snapchat/callback`. An eligible Public
  Profile and a Snap-allowlisted Business Dashboard API app are required. The host
  verifies `my_profile` and the API Public Profile UUID separately from browser
  identities. Spotlight accepts one owner-uploaded 6–60 second MP4 of at least
  540×960 pixels and an explicit language/country locale. Encrypted multipart
  preparation keeps no key/IV in job metadata. The exact returned Spotlight ID is
  saved before status polling; only the same profile/ID with `LIVE` succeeds.
  `SUBMITTED` retries perform a status read, and accepted posts cannot be recalled
  through queue cancellation. Story acknowledgements lack a verified upload-to-Snap
  correlation; Story, comments and messaging remain unsupported in this API adapter.
- Telegram: configure `BYCODA_SOCIAL_TELEGRAM_TOKEN` and
  `BYCODA_SOCIAL_TELEGRAM_APPROVED=1` on the selected host, then choose **Host hesabını
  bağla**. The host verifies the bot with `getMe`. Text messages are read using
  `getUpdates` with a durable offset and sent with `sendMessage`. Existing webhooks
  disable polling; bycoda never deletes them. Bots cannot contact arbitrary users:
  the chat must already be accessible, and outbound initiation requires recorded
  consent. Attachments use `sendPhoto`/`sendVideo` with one owner-uploaded PNG/JPEG
  (up to 5 MiB at the Host) or MP4 (up to 50 MiB). Captions including links fit
  1024 UTF-16 characters; an empty caption is allowed. Returned chat, message and
  media IDs must match the exact request. This bot DM adapter does not publish to
  channels or represent personal-user sessions; both use separate account assets.
- Telegram channel API: choose the channel account type and inspect its numeric ID
  or public username. The owner reviews the resolved channel and configured bot
  before connecting. `getMe`, `getChat` and `getChatMember` must confirm the bot,
  channel type and administrator `can_post_messages` permission; those checks run
  again before publication. Reviews expire after two minutes and are invalidated
  by account, executor, token or disconnect changes. The connection binds the
  canonical channel ID and bot ID, with `channel.publish` only. Text fits 4096
  UTF-16 units; one uploaded PNG/JPEG up to 5 MiB or MP4 up to 50 MiB accepts an
  optional caption of 1024 UTF-16 units, including links. Returned channel,
  message and media receipts must match. Channel assets never consume the bot's
  global `getUpdates` stream, replace webhooks or inherit DM consent. Channel
  monitoring and personal browser channel publishing are not implemented.
  Create the channel with an existing Telegram user account and add the bot as
  an administrator separately; connecting in bycoda does not grant those rights.
- WhatsApp API: Business Cloud API. Configure `BYCODA_SOCIAL_WHATSAPP_TOKEN`,
  `BYCODA_SOCIAL_WHATSAPP_PHONE_NUMBER_ID`, `_APPROVED=1`, `_CLIENT_SECRET`
  (the Meta app secret) and `_WEBHOOK_VERIFY_TOKEN`. The host verifies the phone
  identity before connection. Register `/social/webhooks/whatsapp` and subscribe the
  Business Account to `messages`. Signed text-message events populate Inbox and
  permit text or single-image/video replies within 24 hours of the inbound timestamp.
  Attachments accept an owner-uploaded PNG/JPEG up to 5 MiB or MP4 up to 16 MiB,
  with optional captions fitting 1024 UTF-16 characters. Upload preparation is
  checkpointed before the final send guard. Replayed events are deduplicated.
  Personal accounts, historical inbox polling, templates,
  Channels/Status publishing and outbound initiation are not implemented by the API
  adapter. Personal Web sessions use the separate browser member type.

Token configuration currently selects one bot/phone identity per platform per host.
Secrets stay in host configuration and the existing OS-protected social credential
store; they are never returned in account snapshots or supplied to session tools.
Connecting or preparing a draft does not send anything. Real-account authorization,
platform reviews and webhook subscriptions require deployment-specific setup.

### Messaging and comments

These are the official API paths and the existing X browser contract. The other
browser paths and their narrower supported layouts are listed in the mode matrix
above; API restrictions do not automatically describe the website recipe.

| Connection                   | Comment reads/replies                                                                                 | Private messages                                                                                              |
| ---------------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| X OAuth/API                  | Mentions/replies through permitted reads; replies to post IDs                                         | Read/reply/send with DM scopes, enabled API product and recipient eligibility                                 |
| X browser session            | Bounded recent mentions/replies from recognized web responses; replies to exact post IDs | Legacy web inbox and verified numeric-conversation text sends; encrypted Chat unavailable |
| Instagram professional OAuth | Read/reply on owned media                                                                             | Read and reply to user-initiated conversations within the supported response window; no cold initiation       |
| Facebook Page OAuth          | Read/reply to eligible Page content                                                                   | Read and reply to user-initiated Page conversations within the supported response window; no cold initiation  |
| LinkedIn OAuth               | Comments on known published posts; organization discovery additionally requires Posts API read access | Not implemented; LinkedIn Messages API is a restricted partner product, not enabled by ordinary sharing OAuth |

Select the intended capabilities before OAuth. On mixed-inbox API platforms,
selecting polling requests comment and message read permissions together. An existing account with only one
authorized read channel can still synchronize that channel; polling does not
require unrelated Page comment permissions for Messenger-only accounts. X DM sends
request `dm.write`, `dm.read`, `tweet.read` and `users.read`. Reconnecting to add
scopes never grants project send permission or turns on external sending.
LinkedIn organization polling requests `r_organization_social_feed` together with
the `r_organization_social` author-discovery permission. Legacy feed-only tokens
can read known saved posts, but a connection with no known posts and no discovery
permission is unavailable rather than a successful empty inbox.

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

Use an existing local or paired bycoda Host. Choose **API connection** or **Browser
connection** in Accounts. Browser connection uses a dedicated saved web session and
does not require the API configuration below. Choose the matching personal, Page,
channel, organization, professional, business or bot type; a personal browser account
does not gain API access by changing its displayed label.

For an official API connection, configure the host service environment with the
relevant platform app settings; do not place them in provider environments,
frontend storage, project files or prompts.

For each platform, replace `PLATFORM` with `X`, `INSTAGRAM`, `FACEBOOK`, `LINKEDIN` or `YOUTUBE`:

- `BYCODA_SOCIAL_PLATFORM_CLIENT_ID`
- `BYCODA_SOCIAL_PLATFORM_CLIENT_SECRET` (required for Meta/LinkedIn/Google; optional for a public X PKCE client)
- `BYCODA_SOCIAL_PLATFORM_REDIRECT_URI`, pointing to `/social/oauth/<platform>/callback` on this host
- `BYCODA_SOCIAL_PLATFORM_APPROVED=1` only after checking the app's actual product access/review

Public callbacks must use HTTPS. Loopback HTTP callbacks are accepted for local development only when the platform app permits them. Default Graph API version is `v25.0`; `BYCODA_SOCIAL_GRAPH_VERSION` selects another valid version. LinkedIn defaults to `202609`; `BYCODA_SOCIAL_LINKEDIN_VERSION` selects a supported monthly version.

In Accounts, add the correct account type and related projects, choose the operations whose permissions should be requested, then connect through OAuth. Choose the identity returned by the platform; scopes requested by the app are not assumed granted. Facebook requires an eligible managed Page; Instagram uses a professional Business/Creator account with Instagram Login. LinkedIn organization connections require an organization ID and verified administrative access.

Access and refresh tokens stay in a host-only encrypted vault. Its encryption key
is protected by Windows DPAPI CurrentUser, macOS Keychain or Linux Secret Service.
There is no plaintext fallback. A locked or missing key preserves existing encrypted
credentials and fails the operation. X, YouTube, TikTok and Snapchat connections
with valid refresh tokens renew through the host OAuth integration without changing
scopes. Instagram Login exchanges the returned short-lived token for a long-lived
token before identity selection, then renews that still-valid access token near
expiry without a separate refresh token. Failed exchanges are not connected;
expired, revoked or scope-changed connections require owner reconnection. Token
requests, query secrets and provider error bodies remain host-only and are not
returned in connection status.

LinkedIn organization browser setup requires the owner to supply the intended
Company Page ID or URL name. The host opens that Page's admin surface and verifies
its selected actor; it never derives an organization identity from the account's
display label. Reconnecting must preserve the saved verified identity. A fresh
Company Page or Facebook Page still needs current administrative/acting access;
generic member signup and a closed browser window do not establish that access.

## X browser-session mode

X accounts can alternatively connect through the owner's own logged-in X web session instead of the paid X API. This mode is unofficial: it automates x.com, can break when the site changes, and X may restrict or suspend accounts it considers automated. The owner must explicitly accept that risk for each connection.

The host launches system Microsoft Edge or Google Chrome (`BYCODA_SOCIAL_BROWSER` selects another Chromium executable) with a dedicated profile under the host's `social/x-browser/<accountId>` directory. No browser is downloaded. **Sign in to X in the browser** opens a plain, non-automated window on the executor host (Google and X block sign-in in debugger-controlled browsers). The owner logs in, including with Google, and closes the window; bycoda never receives the password. The host then opens the profile in the background and completes login only when the `auth_token` and `twid` cookies exist. The `twid` user ID becomes the account identity, and reconnecting with a different X account is rejected. The profile is the credential: cookies stay in the profile (encrypted by the browser), the vault stores only a marker, and nothing reaches the renderer, session tools or logs. Disconnecting deletes the profile.

Sends use the same approval, queue and policy checks as OAuth accounts. Each send launches the profile in a minimized browser window (`BYCODA_SOCIAL_BROWSER_HEADED=1` shows the window for debugging), verifies the logged-in user ID matches the account, types the text, attaches up to four images or one video and clicks Post. The post ID comes from the X web `CreateTweet`/`CreateNoteTweet` response. If no response confirms the outcome after the click, the job goes to review and is never retried automatically. Operations on one profile are serialized and sends are spaced at least 30 seconds apart.

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

Owner-enabled polling uses the selected API or browser adapter with durable
pagination/rotation cursors and platform backoff. Historic coverage still depends
on platform access, retention and recognized web layouts. The UI can request a
manual account sync. Incoming text is untrusted data and cannot alter account
grants, secrets or send approval. A pause, disconnect, executor or connection-epoch
change during a read prevents the stale result from being ingested or clearing the
account's monitoring state.

The host owns the durable queue. Jobs continue across UI/session closure, but do not execute while the host is offline. Account/campaign/global stops, opt-outs, consent and current project permissions are checked before dispatch, including after credential I/O. Parallel replies to the same inbound event produce one job.

Rate limits use Retry-After/reset headers; browser pacing supplements platform
limits. A dispatched timeout, crash or uncertain platform response goes to review
and is never blindly resent. Accepted TikTok publish IDs and YouTube video IDs
resume only read-only status checks for that exact resource. Other uncertain
outcomes do not use a title/text search or a second connection mode to guess
delivery. Only explicitly failed jobs can be retried; accepted-ID state is retained
so a retry cannot create another accepted video. Per-target results retain error
state, actual visibility and publication URL when returned. Media preparation
checkpoints survive retries.

WhatsApp Business API delivery receipts are separate from queue acceptance. A
successful send response records **accepted**; signed `sent`, `delivered`, `read`
and `failed` webhook statuses update the delivery record only when the account,
platform message ID and recipient match. Receipts received before the send result
are applied when that same result is recorded. Duplicate/out-of-order statuses do
not regress confirmed delivery/read evidence, and provider error text is not
stored. A later delivery failure does not turn an accepted send into a new unsent
job. Browser WhatsApp identity and delivery remain separate from Business Cloud
API receipts.

Source and browser-fixture checks verify the implementation and mocked workflow.
They do not prove that an installed app/host includes these changes, that an actual
platform account permits every operation, or that a real publication was delivered.
Use the shared [local update workflow](../local-update.md) for app/host installation;
verify installed versions and real account results separately. Scheduling a job or
activating a plan is not evidence that it has been sent.

### Facebook API Reels

An API Page campaign must explicitly select **Reel**. Ordinary Page feed images
remain a separate target; selecting a video never changes the destination silently.
The supported local envelope is one owner-uploaded MP4 up to 64 MiB, 4–60 seconds,
9:16, at least 540 × 960 pixels and 23 fps. Duration and dimensions come from the
selected preview; enter the actual file frame rate. The optional description,
including links, is bounded locally to 2200 UTF-16 units. These local bounds do not
claim every format or maximum supported by Meta.

The queue checkpoints the exact Page/content/video ID before transfer and final
publication. Fresh authorization follows each checkpoint immediately before its
network mutation. Uncertain transfers require positive upload completion for that
same ID; uncertain final publication is reconciled read-only. Neither a successful
finish response nor a ready video counts as publication: the receipt requires the
exact video and Page owner, published=true and a completed publishing phase.
Processing never creates another Reel or repeats the final publication request.
Ordinary Page `/videos` publishing and Stories remain separate implementation gaps.

Contract: [Meta Reels publishing collection](https://github.com/fbsamples/Facebook-Reels-Publishing-API-Postman-Collection).

## Current adapter boundaries

- X: text with up to four locally uploaded JPEG/PNG images (5 MiB each) or one MP4 video (64 MiB); mentions, saved-post browser comments and API direct messages. API messages accept one image/video attachment. Encrypted browser Chat is unavailable. External search is a documented product candidate, not an implemented discovery command.
- Instagram: the API supports HTTPS images, feed Reels and up-to-four-asset mixed carousels, owned-media comments and permitted
  professional text inbox replies. The browser adds local image/carousel/video
  publishing and recognized existing-thread text replies. Stories, new/cold DM,
  conversation attachments and follow management are not implemented. Browser bio and independent avatar updates are supported; synced profile photos require separate owner handling.
- Facebook: the API supports managed Page text/link, up to four HTTPS photos, explicitly selected uploaded-video Reels, eligible
  comments and standard-window text replies. Browser mode can use the verified
  selected personal/Page actor and local publishing media. Recognized existing
  conversations are required; arbitrary outreach and encrypted/unknown Messenger
  response formats are not treated as supported delivery.
- LinkedIn: the API supports member/organization text and one to four uploaded organization
  images with readiness verification, plus eligible comments. Browser publishing adds
  supported images/video, one local PDF up to the local 5 MiB limit with a reviewed
  title, and single-image alternative text. Persisted actor/text/document or image
  descriptions are rechecked after submission. Personal chat initiation requires
  an exact visibly first-degree member; InMail, invitations, upgrades, organization
  inbox and multi-image alternative text remain unavailable.
- YouTube: an OAuth-verified channel, one owner-selected MP4/WebM video up to 64 MiB
  per target, explicit title/description/privacy/audience/synthetic declarations and
  processing completion tracking. API comment replies use top-level comment IDs;
  comments on external videos resolve the target channel. Browser mode uses Studio
  and recognized comments UI. General DM, Community posts, external discovery and
  comment webhooks are not implemented.
- TikTok: the API uses one video or up to four photo URLs from a verified domain or prefix; browser
  mode uses one local video through Studio. Both preserve explicit visibility and
  content/music choices. Browser photos, DM/inbox handling and generic account/profile
  management are not implemented; browser comments cover recognized saved videos.
- Snapchat: the API is Public Profile identity only. Browser member connections use
  `web.snapchat.com` for bounded inbox reads and existing-conversation text replies.
  Public Profile connections use `my.snapchat.com` and the current Profile Manager
  UUID picker for one explicitly reviewed Spotlight or 24-hour Public Story video.
  The uploader's automatically selected Saved Story target is cleared. Public Story
  has no caption/link; videos must be 5–60 seconds and at least 540×960. Current
  `PostProfileMedia` acceptance contains no durable Snap ID, so it cannot produce
  success without independent exact persisted proof and is held for review. Old
  username identities are not silently remapped to a UUID. New DM/chat attachments
  remain unimplemented; current web chat redirects/layouts need live acceptance.
- WhatsApp and Telegram: personal browser sessions add eligible visible-chat text
  and one-image-or-video operations. Their business/bot APIs retain the narrower
  text-only paths above. Status, public channel publishing, arbitrary discovery,
  templates, bot provisioning and generic account registration are not implemented.

A contact record alone grants no communication permission. Manual/imported/API
contacts retain independent outbound consent, reply eligibility, comment eligibility,
exact platform identity, project tags and interaction history. Cross-platform
identities are not merged by similar names, and segments do not infer sensitive
traits. Browser availability does not mean every website layout, account class or
feature has live acceptance; unknown layouts and unsupported operations remain
visible failures rather than fabricated success.

## YouTube configuration and delivery

For the official API mode, enable YouTube Data API v3 in the Google Cloud project
and configure a Web Application OAuth client, consent screen, allowed users/access
approval and the exact `/social/oauth/youtube/callback` redirect on the central host.
Use `BYCODA_SOCIAL_YOUTUBE_CLIENT_ID`, `BYCODA_SOCIAL_YOUTUBE_CLIENT_SECRET`,
`BYCODA_SOCIAL_YOUTUBE_REDIRECT_URI` and `BYCODA_SOCIAL_YOUTUBE_APPROVED`. Review
actual app access before setting the approval flag. Publishing requests both
`youtube.upload` and `youtube.readonly`: the latter is needed for channel binding
and owner-only processing reads, not just optional inbox browsing. Comments/replies
use `youtube.force-ssl`. Existing upload-only connections need reconnection for the
additional read permission. Google account/Brand-channel selection happens in
Google's external authorization flow; ambiguous channel enumeration is rejected.
Tokens and upload-session URLs never reach the renderer, session tools or
transcripts. Browser mode instead connects the owner's isolated Studio session and
does not require this developer-app configuration.

Select a Channel account, upload a video to the host in 1 MiB chunks and choose its
metadata. Visibility defaults to **private**. The exact metadata is included in
the owner's campaign approval and passed through the same provider-independent
tool/queue contract. The API adapter verifies the current channel, initiates a
resumable upload and sends one final video PUT. As soon as YouTube returns a video
ID, the host durably checkpoints that ID and any returned visibility before making
another platform request. Subsequent attempts never upload the file again; they
read `videos.list` with `processingDetails,status,snippet` for the same video ID and
verify the owning channel. **Processing** remains queued with bounded read-only
backoff. Success requires completed processing and valid current visibility;
failed/rejected/deleted video states fail without discarding the accepted ID, while
missing, mismatched or terminated processing evidence is held for review. The
result reports actual returned privacy rather than assuming requested visibility.

This post-upload status continuation does not resume an interrupted binary upload
session. The upload-session URI is not persisted: an interruption before YouTube
returns a video ID remains uncertain and must be reviewed rather than starting
another upload. Host ingestion of an incomplete local file must be restarted;
completed files and jobs survive restart. Incomplete staging uploads expire after
30 minutes and are cleaned on subsequent uploads. Processing completion is API
evidence for that video; it is not a guarantee of unrestricted playback in every
country, embed or viewer account.

The 64 MiB limit is an explicit local adapter bound, not YouTube's maximum. Platform quotas, comments-disabled responses, OAuth expiry and processing/access restrictions still apply. Quota errors back off for six hours or the supplied Retry-After; the effective Google Cloud quota must be checked externally. Owner-enabled polling reads at most four comment/reply pages per account sync with a durable cursor; channel-owner comments are skipped. A thread with `canReply=false` cannot be sent a reply through the shared service. Video-change push notifications do not supply comment/DM inbox events.

Official contracts: [OAuth](https://developers.google.com/youtube/v3/guides/auth/server-side-web-apps), [video insert](https://developers.google.com/youtube/v3/docs/videos/insert), [video processing states](https://developers.google.com/youtube/data/reference/rest/v3/videos#processingDetails), [video status reads](https://developers.google.com/youtube/data/reference/rest/v3/videos/list), [upload protocol](https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol), [comment threads](https://developers.google.com/youtube/v3/docs/commentThreads/list), [comment replies](https://developers.google.com/youtube/v3/docs/comments/insert), [new video comments](https://developers.google.com/youtube/v3/docs/commentThreads/insert), [push notifications](https://developers.google.com/youtube/v3/guides/push_notifications).
