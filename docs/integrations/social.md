# Social Media host integration

Social Media connects ten platforms (X, LinkedIn, Facebook, WhatsApp, Telegram, Reddit,
Instagram, YouTube, TikTok, Snapchat) to one Host-owned workflow: audience discovery,
people and lists, direct messages, comments, email, and publishing. The Host owns the
durable queue, credentials, policy and every external action. The UI, session tools
and host CLI call the same operations through one `social.request` RPC.

Accounts belong to a Host authority. Campaigns, rules and conversations refer to
projects. Credentials are host-only: the vault syncs its encrypted state before
replacement and creates Windows vault keys exclusively after a completed file sync.
Invalid or undecryptable vault state stays intact and blocks mutation. No read failure
creates a blank vault; repair storage or restore the correct key before retrying.

## Screens

The Social workspace has five screens. The shell keeps the AI stop control and the
connection/project filters visible on each of them.

| Screen   | Purpose                                                                                                                                                                  |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Command  | Attention queue, "Waiting for you" items that need the owner (browser checkpoints, approvals), activity feed, AI stop and resume.                                        |
| Content  | Drafts and approved content for each account, with a Repeat control for recurring publication and AI programs.                                                           |
| Audience | People, lists, segments, capture rules, sequences and enrollments, the person panel (handles, interactions, consent record, delete and export), and import.              |
| Inbox    | Unified conversations and comments across accounts, with status, timeline, reply options and auto-refresh.                                                               |
| Accounts | Connections, account type and driver, per-account permissions, the autonomy policy, the browser section (visibility, live view, NEEDS_HUMAN), and the AI model settings. |

Screen state is retained across navigation. Drafts, forms and per-conversation reply
text are independent. Switching hosts clears that host's private data. A failed refresh
keeps the last data and shows a retry action.

## Account modes and driver selection

Each account has one connection mode per platform: **API** (official developer app
credentials and OAuth) or **Browser** (an isolated, signed-in web profile on the
selected executor host). The account type (personal, Page, channel, organization,
professional, business, bot, public profile, and so on) is part of the saved identity.
A personal browser account never gains API access by changing its label.

Every operation chooses a driver with these rules:

1. A free official API that supports the operation is the default driver.
2. If no free API supports the operation, the browser driver is used, when the account
   has a verified browser connection for that platform.
3. Fallback from API to browser is allowed only before a send is submitted. A send
   whose API result is uncertain is never retried through the browser, and vice versa.
4. Paid API products are never selected automatically.

Audience collection follows the same rule. It uses the API where one exists. Where no
API exists, browser collection is on by default for public data, rate-limited, and can
be turned off per account.

## Capabilities and reason codes

Capability answers are computed per operation from: platform support, configured
connection, verified account identity, project access, sending enablement, the autonomy
level and the approval state. These facts are distinct. A verified connection does not
imply send permission, and an enabled platform does not imply that a specific account
type supports the operation.

Each unavailable capability carries a stable reason code, for example `browser.ready`,
`browser.reconnect`, `browser.no_recipe`, `x.publish.api_required`,
`reddit.media_unsupported`, `reddit.one_subreddit`, `reddit.audience_unsupported`,
`whatsapp.window_closed_template_required`, `meta.window_closed` and
`audience.collect.not_implemented`. The UI maps codes to localized text. Reason codes
never contain page text, field values, cookies or URLs.

## Platform support

The matrices below describe implemented contracts from source and mocked tests. They
are not proof of live platform acceptance. Live verification for each platform is still
required on real accounts. Platform terms, app review, quotas and account eligibility
continue to apply.

### Support matrix

| Platform  | Official API (free where listed)                                                                                                                                                                                                                            | Browser connection                                                                                                                                                                                           | Deferred or not implemented                                                                                                                                                               |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| X         | OAuth posts, text plus up to four JPEG/PNG images or one MP4, replies, delete, mentions and comments on own posts, profile read, metrics, rate-limit pause. DM read and reply with DM scopes. Likes/reposts are adapter functions without an operation row. | Posts, images or one video, mentions and saved-post comments, legacy web DM text, owner profile and follow controls.                                                                                         | Threads (not implemented), quote posts and polls (no model field, not reachable), encrypted Chat, DM attachments, search-based discovery on the API (product tier dependent).             |
| Instagram | Professional account: HTTPS image, feed Reel, mixed carousel up to four assets, owned-media comments and replies, text inbox replies in the supported window.                                                                                               | Image, carousel or one video publishing, saved-post comments and replies, recognized existing-thread text replies.                                                                                           | Stories, cold or new DMs, DM attachments, hashtag discovery (author field unverified), post delete (no path found).                                                                       |
| Facebook  | Managed Page text/link, up to four HTTPS photos, Reels from an uploaded MP4 with durable verification, comments, Messenger text replies in the response window.                                                                                             | Personal or Page actor, text and media publishing, saved-post comments, recognized existing-thread Messenger replies.                                                                                        | Ordinary Page video publishing, Stories, Page post edit, comment hide/delete through the host (helper only).                                                                              |
| LinkedIn  | Member text, Page text, Page images (one to four, alt text, readiness verification), Page PDF documents, comments on known posts, token refresh hook. Single-image Page uploads verify byte content.                                                        | Verified member or organization text, images or video, one titled PDF, comments and replies, existing personal chats, first-degree connection requests and acceptance (exports exist; no operation row yet). | Organization inbox, InMail, video through the API (multipart ETag handling is blocked), carousel, polls, analytics, groups and newsletters.                                               |
| YouTube   | Verified channel upload with resumable upload and processing checks, comments and replies, analytics, profile and health checks, owner-video and keyword commenter collection (search costs quota).                                                         | Studio upload with metadata and declarations, saved-video comments and replies.                                                                                                                              | Community posts, Shorts settings, live chat, captions, thumbnail/playlist/moderation (adapter functions without operation rows).                                                          |
| TikTok    | Direct Post of one video or up to four photo URLs on a verified domain, inbox (draft) upload, creator settings, status polling to completion, video list, metrics, health check.                                                                            | Studio upload of one local video, saved-video comments and replies, commenter collection on own videos.                                                                                                      | Comment management through Business API, browser comment delete, hashtag and keyword search (research API), browser inbox, scheduling, DM, Live.                                          |
| Snapchat  | Public Profile API: encrypted Spotlight MP4 upload with exact Spotlight ID tracking until LIVE, health check.                                                                                                                                               | Member chat text replies in existing chats; Public Profile uploader for Spotlight or 24-hour Story video. Current Story acceptance lacks a durable Snap ID and is held for review.                           | Public Story through the API, Marketing API, Creative Kit, metrics, Story interactions, API audience collection.                                                                          |
| WhatsApp  | Business Cloud API: signed incoming text, text or one image/video reply within the 24-hour window, delivery receipts. Business-initiated free text is refused before I/O.                                                                                   | Personal Web session: bounded visible direct chats, text and one image or video per send. Audience collection from chat senders is not offered (no sender reader is wired).                                  | Templates and interactive messages (exported, not reachable from jobs), catalog, Status and Channels, group messages, bulk messaging for personal accounts, auto-reply, quality webhooks. |
| Telegram  | Bot token: bounded text polling, text and one image or video send, webhook parser, bot-sender collection. Channel: administrator bot publishing with receipts.                                                                                              | Personal Web session: direct chats only, stable cursor, text and one image or video per send.                                                                                                                | Polls, inline buttons, edit and pin (functions only, no host path), webhook route, moderation, MTProto, stories, channel settings.                                                        |
| Reddit    | Script or web app OAuth, text and link posts to one subreddit per item, subreddit rules and required flair, comments and replies, inbox polling, private message start and reply, keyword search, own-post commenters, delete.                              | No browser recipe (`browser.no_recipe`).                                                                                                                                                                     | Image, video and gallery posts; edit; account commenters; moderation and chat; upvote and save.                                                                                           |

Which operations are free depends on each platform's current pricing, which this document
does not verify. The rule is fixed in the Host: the free official API is the default driver,
and paid products are never selected automatically.

### Platform connection setup

Configure platform app values only in the host service environment or the existing
credential store. Never place them in frontend storage, project files, prompts or
provider environments. For each platform `PLATFORM` (`X`, `INSTAGRAM`, `FACEBOOK`,
`LINKEDIN`, `YOUTUBE`, `TIKTOK`, `SNAPCHAT`, `REDDIT`):

- `BYCODA_SOCIAL_PLATFORM_CLIENT_ID`
- `BYCODA_SOCIAL_PLATFORM_CLIENT_SECRET` (required for Meta, LinkedIn and Google; optional for a public X PKCE client)
- `BYCODA_SOCIAL_PLATFORM_REDIRECT_URI`, pointing to `/social/oauth/<platform>/callback` on this host
- `BYCODA_SOCIAL_PLATFORM_APPROVED=1`, only after the app's real product access and review are confirmed

Public callbacks must use HTTPS. Loopback HTTP is accepted for local development only
where the platform app allows it. The default Graph API version is `v25.0`
(`BYCODA_SOCIAL_GRAPH_VERSION`). LinkedIn defaults to `202609`
(`BYCODA_SOCIAL_LINKEDIN_VERSION`). Select the operations whose permissions should be
requested before OAuth. Choose the identity returned by the platform; requested scopes
are not assumed granted. Reconnecting to add scopes never grants project send
permission or turns on external sending.

Access and refresh tokens stay in a host-only vault. Its key is protected by Windows
DPAPI (CurrentUser), macOS Keychain or Linux Secret Service. There is no plaintext
fallback. A locked or missing key preserves existing credentials and fails the
operation. Renewal runs for X, YouTube, TikTok and Snapchat with a valid refresh token,
without changing scopes. Instagram Login exchanges its short-lived token for a
long-lived token and renews it near expiry. LinkedIn and Facebook token refresh and
Reddit refresh are present in source but not all are scheduled by the Host (see Open
questions). Expired, revoked or scope-changed connections require reconnection.

#### X

- Browser mode uses the owner's own X web session and automates x.com. It is unofficial,
  can break when the site changes, and X may restrict accounts it considers automated.
  The owner accepts that risk per connection.
- The host launches system Microsoft Edge or Google Chrome (`BYCODA_SOCIAL_BROWSER`
  selects another Chromium executable) with a dedicated profile under
  `social/x-browser/<accountId>`. **Sign in to X in the browser** opens a plain window on
  the executor host. The owner logs in, including with Google, and closes the window.
  bycoda never receives the password. Login completes only when the `auth_token` and
  `twid` cookies exist. The `twid` user ID becomes the account identity. Reconnecting
  with a different X account is rejected. Cookies stay in the profile; the vault stores
  only a marker. Disconnecting deletes the profile.
- Sends verify the logged-in user ID, type the text, attach images or one video and
  click Post. The post ID comes from the `CreateTweet`/`CreateNoteTweet` response. If no
  response confirms the outcome after the click, the job goes to review. Operations on
  one profile are serialized and sends are spaced at least 30 seconds apart.
  `BYCODA_SOCIAL_BROWSER_HEADED=1` shows the window for debugging.
- Legacy browser DM sends require an exact numeric recipient, an observed conversation
  with that recipient and a matching delivery acknowledgement. Missing evidence goes to
  review. Encrypted X Chat and browser DM attachments are unavailable.
- A missing mentions response counts as empty only when the authenticated page shows the
  mentions tab and its known empty state. Redirects into `/i/chat` report unsupported
  encrypted Chat, not an empty inbox.

#### Instagram, Facebook and Meta

- Professional Instagram accounts use Instagram Login. The short-lived token is exchanged
  for a long-lived token before identity selection. Facebook requires an eligible managed
  Page. A personal browser account does not grant professional or Page API access.
- Meta webhook receivers are `/social/webhooks/instagram` and `/social/webhooks/facebook`.
  Configure `BYCODA_SOCIAL_PLATFORM_WEBHOOK_VERIFY_TOKEN` and the client secret, verify the
  callback in the platform dashboard and create the account subscription. The receiver
  checks the raw HMAC signature before parsing and deduplicates event IDs. Presence of
  the receiver alone does not prove the external subscription works.
- Facebook Reels: a Reel is an explicit destination. The local envelope is one uploaded
  MP4 up to 64 MiB, 4–60 seconds, 9:16, at least 540 × 960, with the frame rate entered
  by the owner. The description is bounded to 2200 UTF-16 units. The queue checkpoints
  the exact video ID before transfer and final publication. A ready video is not counted as
  published until the receipt shows the exact video, published=true and a completed
  publishing phase. Processing never creates another Reel. Contract:
  [Meta Reels publishing collection](https://github.com/fbsamples/Facebook-Reels-Publishing-API-Postman-Collection).
- Browser Messenger and Instagram DM reads cover recognized existing threads only. An
  unrecognized group thread is skipped and its coverage is reported as partial.

#### LinkedIn

- Member and organization connections use separate types. Organization connections need
  a numeric organization ID and verified administrative access. Browser organization setup
  requires the owner to supply the Company Page ID or URL name. The host verifies the
  selected actor and never derives it from the display label.
- Publishing limits are checked before submission: Page commentary (3000 units in source,
  not compared with current docs), images with byte checks, PDF documents through the
  Documents API (title 200, 100 MB API limit in source), and browser PDFs up to 5 MiB.
- Browser connection requests, acceptance and personal chat use the same verification and
  challenge handling as other browser recipes.
- **AI exclusion:** the current rule code still blocks LinkedIn inbound third-party
  content from automatic reply rules. See Autonomy policy and Open questions.

#### YouTube

For API mode, enable YouTube Data API v3 in the Google Cloud project, configure a Web
application OAuth client with the exact `/social/oauth/youtube/callback` redirect, and set
`BYCODA_SOCIAL_YOUTUBE_CLIENT_ID`, `BYCODA_SOCIAL_YOUTUBE_CLIENT_SECRET`,
`BYCODA_SOCIAL_YOUTUBE_REDIRECT_URI` and `BYCODA_SOCIAL_YOUTUBE_APPROVED`. Publishing
requests `youtube.upload` and `youtube.readonly` (channel binding and processing reads).
Comments and replies use `youtube.force-ssl`. Existing upload-only connections need
reconnection for the read permission. Google account and Brand-channel choice happens in
Google's flow; ambiguous channel enumeration is rejected.

Upload: the host receives the file in 1 MiB chunks, verifies the current channel, starts
a resumable upload and sends one final PUT. As soon as YouTube returns a video ID, the
host checkpoints that ID. Later attempts never upload the file again. They read
`videos.list` (`processingDetails,status,snippet`) for the same ID and verify the owning
channel. Success requires completed processing and the current visibility. Failed,
rejected or deleted states fail without discarding the ID. Missing or mismatched
evidence goes to review. The result reports the actual returned privacy. The local
64 MiB limit is an adapter bound, not YouTube's maximum. Quota errors back off for six
hours or the supplied Retry-After. The upload-session URI is not persisted, so an
interruption before a video ID exists is an uncertain outcome for review.

Polling reads at most four comment or reply pages per account sync with a durable cursor.
A thread with `canReply=false` cannot receive a reply. Video-change push notifications do
not supply comment or DM inbox events.

Contracts: [OAuth](https://developers.google.com/youtube/v3/guides/auth/server-side-web-apps),
[video insert](https://developers.google.com/youtube/v3/docs/videos/insert),
[processing states](https://developers.google.com/youtube/data/reference/rest/v3/videos#processingDetails),
[video status reads](https://developers.google.com/youtube/data/reference/rest/v3/videos/list),
[upload protocol](https://developers.google.com/youtube/v3/guides/using_resumable_upload_protocol),
[comment threads](https://developers.google.com/youtube/v3/docs/commentThreads/list),
[comment replies](https://developers.google.com/youtube/v3/docs/comments/insert),
[push notifications](https://developers.google.com/youtube/v3/guides/push_notifications).

#### TikTok

- API: OAuth identity (`user.info.basic`) and Direct Post (`video.publish`) with
  `BYCODA_SOCIAL_TIKTOK_CLIENT_ID`, `_CLIENT_SECRET`, `_REDIRECT_URI` and `_APPROVED=1`.
  Callback: `/social/oauth/tiktok/callback`. Existing profile-only accounts must reconnect.
  The campaign editor loads current creator settings and offers only the returned privacy
  choices, with no default. Explicit music and content consent is required; editing clears
  it. Media is one HTTPS video or one to four HTTPS photos on a verified domain
  (`PULL_FROM_URL`). Local API uploads are not implemented.
- Processing keeps the publish ID and reports success only at `PUBLISH_COMPLETE`. An
  accepted post cannot be recalled through the queue. Unaudited clients are limited to
  TikTok's private-viewing rules. This document does not establish that bycoda has an app
  audit.
- Comment management requires TikTok Business or Organic products. These are not installed.

#### Snapchat

- API: Public Profile OAuth (`snapchat-profile-api`) with `BYCODA_SOCIAL_SNAPCHAT_CLIENT_ID`,
  `_CLIENT_SECRET`, `_REDIRECT_URI` and `_APPROVED=1`. Callback:
  `/social/oauth/snapchat/callback`. The host verifies `my_profile` and the Public Profile
  UUID. Spotlight accepts one owner-uploaded 6–60 second MP4 of at least 540 × 960 with an
  explicit locale. The exact returned Spotlight ID is saved before status polling. Only the
  same profile and ID at `LIVE` succeeds. Snapchat Public Story has no caption or link and
  is not implemented through the API.
- Browser member connections use `web.snapchat.com` for bounded chat reads and existing
  conversation text replies. Public Profile connections use `my.snapchat.com`. The uploader's
  automatically selected Saved Story target is cleared. Current `PostProfileMedia`
  acceptance has no durable Snap ID and is held for review.

#### Telegram

- Bot API: set `BYCODA_SOCIAL_TELEGRAM_TOKEN` and `BYCODA_SOCIAL_TELEGRAM_APPROVED=1` on
  the selected host, then connect the bot from Accounts. The host verifies the bot with
  `getMe`. Text is read with `getUpdates` using a durable offset and sent with
  `sendMessage`. An existing webhook disables polling; bycoda never deletes it. Bots
  cannot start a conversation with an arbitrary user. The chat must already be accessible.
- Bot attachments use `sendPhoto` or `sendVideo` with one owner-uploaded PNG/JPEG up to
  **10 MiB** or one MP4 up to **50 MiB** (`adapters/messaging-shared.ts`). Captions fit
  1024 UTF-16 units. Returned chat, message and media IDs must match the request.
- Channel: choose the channel account type and inspect the numeric ID or public username.
  `getMe`, `getChat` and `getChatMember` confirm the bot, the channel type and the
  administrator `can_post_messages` permission. Those checks run again before publication.
  Text fits 4096 UTF-16 units; one PNG/JPEG up to 10 MiB or MP4 up to 50 MiB accepts a
  caption of 1024 units. Channel assets never consume the bot's `getUpdates` stream.
- Personal Web sessions use the member type. They read direct chats only, with a stable
  cursor. Groups are skipped and are not sent to.
- Bot token storage: the token module is vault-first, but the dispatcher has not been
  switched to it yet (see Open questions).

#### WhatsApp

- Business Cloud API: `BYCODA_SOCIAL_WHATSAPP_TOKEN`, `_PHONE_NUMBER_ID`, `_APPROVED=1`,
  `_CLIENT_SECRET` (the Meta app secret) and `_WEBHOOK_VERIFY_TOKEN`. Register
  `/social/webhooks/whatsapp` and subscribe the business account to `messages`. Signed text
  events populate the inbox. Replies within 24 hours of the inbound timestamp can be text or
  one PNG/JPEG (5 MiB) or MP4 (16 MiB) with an optional caption of 1024 units. Replayed events
  are deduplicated. Delivery statuses (`sent`, `delivered`, `read`, `failed`) update the
  delivery record only when account, message ID and recipient match. They never regress
  confirmed evidence. Provider error text is not stored.
- Personal Web session: bounded visible direct chats, text and one image or video per
  send. Identity checks, draft guards and persisted-send checks apply. Bulk-marked jobs are
  refused. A single message to a new number is still possible through the `send` route.
  This is an accepted gap against the earlier "existing chat only" limit. QR and link-device
  screens raise NEEDS_HUMAN and no QR image is read.

#### Reddit

- OAuth is a Reddit script or web app. The identity call uses `oauth.reddit.com/api/v1/me`.
  The host allowlist must include Reddit before runtime use; without it the connection is
  denied. Renewal is present, but Reddit is not yet in the host's due-refresh list.
- One subreddit per post item. Flair is required when the subreddit requires it, and the
  flair ID is sent. Text fits 300 characters (title), 10000 (body), 40000 (self text) and
  2048 (link). Images, video and gallery are not supported.
- Inbox polling reads `/message/inbox` with a `before` cursor and 100 items. Backlog beyond
  100 is an open limit. Private message start needs a subject (default "Message"). The
  adapter does not reconcile an uncertain start.
- Keyword capture uses search with a `r/<subreddit>` prefix. Subreddit capture as a
  separate source is not implemented.

## Audience, lists and capture rules

The Audience screen manages people, not just rows. A **person** groups one or more
platform handles, email addresses and interaction history. A **handle** belongs to one
account and platform. People are merged by suggestion first: same handle, linked profile
or email. The owner decided that automatic merge is allowed only on an exact email match. Similar
names never merge people.

- **Lists** are owner-named sets of people. Adding or removing members is a list operation,
  not a consent operation.
- **Segments** are saved filters over people fields and interactions. They do not infer
  sensitive traits.
- **Capture rules** (`captureRules.*`) collect people from public sources, for example
  keyword search or a post's commenters, into lists. Rules can be enabled or disabled.
  Browser capture covers public data only, as the owner decided.
- **Import** (`audience.import`) is owner-only. Imported labels never grant consent and never
  alter opt-outs.
- **People score** (`people.score`) is a ranking aid for the owner. It is not a send decision.

## Outreach, sequences and email

Outreach sends messages to people. Cold direct messages, WhatsApp and Telegram messages,
email and comments are allowed for any person who is not suppressed, when the account's
autonomy level for the action allows it. There is no per-contact consent gate. Consent
records remain informational data that the owner can read and edit.

- **Sequences** are ordered steps (message, email, comment) with waits between them.
  Enrollments hold the state for each person. `sequences.start`, `sequences.pause` and
  `sequences.stats` manage them. Each send step goes through the same gates as any other send.
- **Pacing** limits how fast a sequence advances per account and channel. Pacing does not
  override platform limits or daily limits.
- **Email** uses SMTP through `nodemailer` (`smtp-sender`), Resend and Postmark over HTTPS
  (`resend-sender`, `postmark-sender`). Credentials are host secrets. Every message has a
  visible unsubscribe link and a `List-Unsubscribe` header. A message without an HTTPS
  unsubscribe link cannot be built, and the email account must have one set.
- Email actions go through `email.send`. The design applies the same autonomy, suppression
  and limit checks as other channels. The live email path is not verified.

## Suppression and personal data

Suppression is the single send gate. Every outbound path (single, bulk, rules, AI tools,
sequences, execution) passes through the same check before anything leaves the Host. The
check resolves the target before comparing it with suppression records. A suppression
record covers one channel or `all`. An opt-out is a suppression with its source and reason.
Opt-out must reach the person, not one account handle.

- `suppressions.add` lets an owner or AI add a suppression. Removing one is owner-only.
- **Export** (`people.export`, owner-only) returns a JSON document for a person.
- **Delete** (`people.delete`, owner-only) removes the person, handles, interactions,
  thread text and enrollments. It keeps a minimal suppression record so that the person is
  never contacted again. Deleting one person does not
  delete published posts or messages on the platform.
- Disconnecting an account deletes its local token and pauses the account. It keeps account
  metadata and stored records. Use the delete action to remove person data.

## Unified inbox

The Inbox screen shows conversations and comments from every connected account and
platform in one list. Each thread has a status, a timeline of inbound and outbound items,
and reply options that respect the account's permission and the platform window.

- `inbox.unified` lists threads across accounts. `inbox.timeline` reads one thread. `inbox.setStatus` changes the status. `inbox.replyOptions` lists allowed reply
  types for the thread.
- **Auto-refresh is on by default.** Only an explicitly stored "false" turns it off. The
  account-level polling interval is stored with the inbox settings. Without an override an
  account polls every 60 seconds, a browser-session account every 5 minutes and an account
  with a live webhook every 15 minutes; overrides never go below 60 seconds. Every
  platform's cursor is durable, so a restart resumes from the last read item.
- Polling is bounded. Each platform reads a fixed page per cycle, and backlog continues
  on the next cycle. Coverage is reported per channel. A partial or blocked channel never
  reports an empty inbox.
- Inbound text is untrusted data. It cannot change grants, autonomy, suppression or secrets.

## Autonomy policy

Each account has an autonomy policy. It sets one level per action. The actions are
`publish`, `reply`, `comment`, `message`, `email`, `outreach`, `audience` and `contacts`.

| Level               | Meaning                                                                                         |
| ------------------- | ----------------------------------------------------------------------------------------------- |
| `suggest` (default) | AI proposes the item. The owner acts. Nothing is queued for sending.                            |
| `approve`           | AI queues the item. The owner approves each item before it is sent.                             |
| `autonomous`        | AI sends without per-item approval, within the limits below. Only the owner can set this level. |

Default daily limits per account and action (from `DEFAULT_AUTONOMY`): publish 10,
reply 100, comment 50, message 50, email 100, outreach 200, audience 2000, contacts 2000.
The owner can change them within 0–1,000,000. Working hours are optional: an IANA time
zone, weekdays and a start and end time, where an end before the start spans midnight.
Outside working hours, autonomous items are scheduled for the next open window, within
nine days.

Every autonomous send is re-checked at execution time. A changed policy, a stop or a
lowered level stops it. These checks always apply, at every level:

- platform limits and the account's connection and project access
- suppression and opt-out (see Suppression and personal data)
- working hours and daily limits
- the AI stop (`ai.stop`, `ai.resume`), the global send stop, and the external-sending switch
  (off until the owner enables it)

The owner principal never uses the autonomy path. Owner actions follow the owner's
normal approval flow. `autonomy.get` is available to AI and read-only. `autonomy.set` is
owner-only.

Decisions behind this policy: [decision provenance](../../.agents/skills/feature-social-media/references/decisions.md).

## Browser layers, NEEDS_HUMAN and live view

Browser actions run through a layered driver. It tries these layers in order:

1. **API** (the adapter, before the driver is involved)
2. **Recipe**: the platform's fixed selectors and steps
3. **Decision**: when a recipe step fails on an unexpected screen, a decision model
   classifies the visible screen (text summary only) and chooses one action from the
   candidates. Unsafe labels are filtered. The decision layer only acts on states it
   recognizes as actionable.
4. **Desktop**: the Host desktop control, only when every gate below passes.

Each layer's outcome is recorded with a fixed reason, never with page text, field values
or URLs.

**Desktop gate.** The desktop layer runs only when all of these hold: desktop control is
allowed for the account, a computer is selected, the step is explicitly not outreach,
presence is known, the computer is not locked, the owner is away (status away or idle for
at least ten minutes), and the owner's active screen is not the selected computer.
Otherwise the job becomes NEEDS_HUMAN.

**NEEDS_HUMAN.** A captcha, a verification step, a suspicious-login screen, a login prompt
or an unexpected screen stops automation for that account. The job waits as NEEDS_HUMAN
and the owner is notified. The Command screen lists these items with a live view and an
"I'm done" action. The owner is alerted through this list; the desktop notification
planned as a desktop notification is not verified. Automation never clicks, types or solves a captcha,
verification or suspicious-login screen. The decision layer treats these states as
human-only, and the desktop layer refuses them. A challenge is recognized and reported only.

**Visibility.** Browser windows are hidden by default (`visibility: hidden`), and the
owner can switch an account to visible. A hidden window stays rendered off every display;
on Windows it also has no taskbar or Alt+Tab entry. A live view streams frames while the
owner has it open. It is capped in frame rate and size and stops after idle. Pointer and key input from
the live view goes to the account's page.

## Accounts registration and browser workspace

Each account can have a browser workspace on its executor host: a dedicated Chrome or
Edge profile used for login, registration navigation, inbox reads and publishing pages.
The owner starts or cancels assisted work from Accounts. Passwords, verification codes,
challenges and terms are completed in the platform window. They are never supplied through
a conversation or a session tool.

- Workflow records are retained for up to 20 ordinary metadata entries per account.
  Records track queued, awaiting-owner, closed, cancelled, expired, interrupted and failed
  states. Work expires after 20 minutes. A host restart marks unfinished work interrupted.
  It does not reopen registration automatically.
- Closing a window never proves registration, identity or delivery.
- Switching executor cancels active assisted work and pauses the account. Disconnecting
  deletes this host's browser profile.
- Final LinkedIn Page creation uses owner-only review and submit methods, with a two-minute
  review bound to the observed administrator, fields and terms. Unknown results keep a
  durable hold and are never resubmitted automatically.
- Generic signup is not brand provisioning. A Facebook signup does not create a Page; a
  Google account does not create a YouTube channel; an Instagram API connection needs a
  professional account.

Owner RPC methods: `social.browser.workflow.begin` (`accountId`, `intent`, optional
`targetUrl` or signup `registration`, `acknowledgeRisk: true`),
`social.browser.workflow.status` and `social.browser.workflow.cancel`. Session tools cannot
call these methods.

Connected X browser accounts also expose an owner-only profile and follow section
(`social.browser.profile.read`, `.update` with `confirm: UPDATE_X_PROFILE`, `.follow` with
`confirm: FOLLOW_X_ACCOUNT`). LinkedIn organization name, tagline and logo, Facebook Page
logo and Instagram bio and profile photo use the same owner profile transport.
Unsupported fields are rejected. A partial or uncertain update requires inspection and is
never repeated automatically.

## Content, repeats and AI programs

The Content screen holds drafts and approved content. Each piece of content has exact text,
media, links and per-account variants. Editing content invalidates its approval. Queued or
dispatched content is not edited in place.

- **Repeat** (on the Content editor) schedules recurring publication of approved content.
  Interval, fixed-time and weekday schedules use IANA time zones. Each approved variant is
  published once per occurrence. A finite pool stops when exhausted and never invents new
  content. The former standalone publishing plans and program screen are folded into this
  control.
- **AI programs** generate content from a topic brief, verified public facts and brand
  voice, then schedule it. See [AI campaign programs](social-programs.md).
- Under the Publish autonomy level, a program's occurrences can dispatch without per-item
  approval. The dispatch check skips the approval-content check when the caller marks the
  dispatch as autonomous. Source supports this path. End-to-end use is not verified.
- LinkedIn program content still requires final publication review in the current code. This differs from the owner decision that LinkedIn follows the same autonomy policy. See Open questions.

## Session tools

AI tools are the registry actions marked for AI use. The MCP tool names use underscores
(`social_accounts_list`); the CLI and RPC keep dots. The list is the single source of truth
in the Social tool registry. Tools call the same Host operations as the UI, so every gate
applies to them.

```text
policy.get            accounts.list           capabilities.get
campaigns.create      campaigns.preview       campaigns.schedule     campaigns.status
inbox.list            inbox.unified           inbox.setStatus        inbox.timeline
inbox.replyOptions    thread.read             replies.draft          replies.send
drafts.read           drafts.update
contacts.upsert       contacts.search         segments.create
people.list           people.get              people.update         people.merge
people.matchSuggestions people.score
lists.list            lists.save              lists.delete           lists.addMembers
lists.removeMembers   audience.collect
captureRules.list     captureRules.save       captureRules.setEnabled captureRules.delete
sequences.list        sequences.save          sequences.start        sequences.pause
sequences.stats       enrollments.list        email.send             suppressions.add
messages.draft        messages.send           comments.draft         comments.send
automations.create    automations.pause       jobs.status            jobs.cancel
programs.list         programs.configure      programs.status        programs.generate
programs.preview-schedule
autonomy.get          ai.actions.list         ai.actions.undo        ai.stop
ai.summary            ai.report
browser.needsHuman.list browser.recipeSuggestions.list
```

Rules for every tool:

- A tool cannot exceed the account's autonomy level, suppression, limits, working hours,
  the AI stop or the global stop. Tools read these facts; they do not hold authority.
- A tool cannot change owner-only state. Owner-only operations, including `people.delete`,
  `people.export`, `audience.import`, `autonomy.set`, policy saves, program activation and
  browser workflow methods, are not tools.
- Write tools take an optional `requestId`. Retrying with the same ID is safe. An ID does
  not grant send authority.
- Every AI action is written to the AI actions log with its actor, account, status and an
  undo when one exists. `ai.actions.list` reads the log. `ai.actions.undo` reverts an undoable
  action.
- `ai.stop` is available to any principal. `ai.resume` is owner-only.
- Plans from `ai.command` are stored and run through their own plan operations. A step that
  needs approval runs only after owner approval.

The native and headless backends provide a memory-only session credential to the agent
process. The renderer receives executable metadata only. Running processes must restart
to receive newly connected authority. Run `social --help` for actions, or
`social <action> --input -` with JSON on stdin. The CLI does not accept actor, provider or
token claims in its JSON.

## Project access and authority

Account grants control reading, drafting, publishing, replies, outbound messages and
comments for each project. A session's project and provider come from the host session
registry, never from tool JSON. Private threads from another project cannot be read or
sent to. Unmatched conversations stay in owner review until assigned or reviewed.

Assistant access to an account is denied by default. The owner grants read and, separately,
draft access. Revoking or changing the grant invalidates existing access. Personal drafts use
no project facts and never authorize a send.

Pair hosts with the Connections workflow. Choose one central host for the account's
execution. Selecting a central authority suspends the source host's execution and polling.
Peer chains are rejected. The authority checks the source identity on calls and again before
queued sends. Connecting the same account independently on unrelated hosts does not create a
shared queue.

## Delivery, retries and uncertain outcomes

The Host owns the durable queue. Jobs survive closing the UI or the session. They do not run
while the host is offline.

Before each dispatch, the Host rechecks the connected account, executor, project grants,
approval, suppression, autonomy, limits and the AI and global stops. Recipes verify the
signed-in actor and exact target, then mark the submission boundary. Any failure after that
boundary becomes an uncertain outcome for review.

- A timeout, crash or uncertain platform response goes to review and is never resent
  blindly. Accepted TikTok publish IDs and YouTube video IDs resume read-only status checks
  for that exact resource.
- Only explicitly failed jobs can be retried. Accepted-ID state is kept, so a retry cannot
  create a second accepted post.
- Rate-limited jobs use Retry-After or reset headers. The owner decided that after
  eight attempts or 72 hours a job moves to review, never to automatic resend. Confirm the
  implemented cap in the Host queue before relying on it.
- Per-target results keep the error state, actual visibility and publication URL when the
  platform returns them.
- WhatsApp and Telegram receipts are separate from queue acceptance. A successful send
  records accepted. Later receipts update delivery state only when they match the account,
  message ID and recipient.

For bounded history, `jobs.status` and `campaigns.status` accept `page: true`, an optional
zero-based `offset` and a `limit` from 1 to 100. The response includes `jobs` and
`page: { offset, limit, total, nextOffset? }`. Legacy array responses fail rather than
truncate when more than 1,000 jobs match. Settled jobs older than the active window move to
readable cold storage in bounded batches, and full records remain available through
exact-ID reads. `jobs.archive-status` reports the counts. Archival is not deletion.

## Open questions

These points are known to differ between owner decisions, source and platform reality.
They are not verified as fixed.

- **LinkedIn AI exclusion.** The owner decided LinkedIn follows the same
  autonomy policy. Source still excludes LinkedIn inbound third-party content from automatic
  reply rules, and LinkedIn program content still requires review. This document describes
  the current source. It does not describe that decision as implemented.
- **Owner-run autonomous plan steps.** The owner principal never takes the autonomy path. A
  plan step that is autonomous and run by the owner is refused. The owner must choose how
  such steps are authorized.
- **Legacy consent gate.** The owner decided consent is informational only. Outreach
  actions do not check consent. The older eligibility check in the Host core has not been
  confirmed removed in every path.
- **Bot token storage (Telegram).** The token module is vault-first. The dispatcher still
  reads the host environment value.
- **Token refresh coverage.** LinkedIn, Facebook and Reddit refresh code exists, but these
  platforms are not all in the Host's due-refresh list.
- **Reddit allowlist and refresh wiring.** Reddit runs only after its host allowlist entry is
  configured, and refresh is not scheduled.
- **Session-agent and AI program activation.** The autonomous program dispatch path is in
  source. End-to-end use with an autonomous account is not verified.

## Verification status

This document describes source contracts and mocked tests. It was written from source
reading. No live platform account, real publication, real email send, real browser login or
live captcha page was checked. Installed host builds need the shared
[local update workflow](../local-update.md). Real acceptance for each platform, each driver
and each delivery path stays separate from source checks. Scheduling a job, activating a
plan or connecting an account is not evidence that it was sent.
