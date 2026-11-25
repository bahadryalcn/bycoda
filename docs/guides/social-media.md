# Social media accounts and drafts

For a Reddit post in **Content**, select the connected Reddit account, enter
the title and choose one subreddit. For your own profile with a browser
connection, enter `u/your_username`. The preview shows the exact destination
and title before you save or publish. Reddit accepts a text post or an HTTPS
link post. Schedule the post individually if you want it to run later.

Social Media keeps accounts on the selected computer. Choose the computer and project at the top before connecting an account, preparing content or reviewing activity. A saved account, an authenticated browser session and permission to send are separate states.

The editor keeps draft saving available when a project lacks publishing permission.
Open **Accounts & Settings** from the editor to grant the missing permission.

## Create a new account

When Reddit blocks the browser for network security, signup and connection checks show the
provider's access error. The signup can be stopped and started again when Reddit allows access.

When Reddit reports an email signup limit, the account dialog keeps the notice visible while
the signup form stays on the same step. Stop signup and return later when Reddit allows another try.

For X, **Browser** is the default. When X asks how to sign up, choose a method
in the X window and then select **Continue** in Bycoda. Open **X actions** from the account for
profile edits, Creator Studio and X Live Studio. Complete verification on X.
To store a Live Studio stream key, paste it into **X stream key** and choose
**Save stream key**.

From a connected X browser account, open **X actions**, select **Direct messages**
and choose **Open in browser**. Bycoda verifies the account in its saved browser
profile before opening X Chat. Enter any PIN and send messages in the X window.
The Bycoda window status tracks the browser workflow. Reopen the account's
**Direct messages** section to see or cancel a Chat window that is still open.

To delete a post from a connected X browser account, open **X actions** and find
**Delete post**. Choose a post from history or enter its ID, then review the
target. Bycoda checks the active account and owner controls on X before deleting.
If the result needs review, check the post on X before trying again.
If X returns to sign-in while preparing a post, reply or message, reconnect the
same account before retrying.
If the X new-post dialog stays empty, Bycoda can use the verified home timeline's
inline composer before submitting. A reply stays on its original post.

For paid API operations, choose the API connection and set **X API billing**
to Pay per use or Enterprise. Review the example prices, select permissions
and connect. Confirm the account, target and action before applying API changes.
In **Content**, select an X account for polls, Community posts and threads.
API quote posts require Enterprise. Review partial threads on X before
sending additional posts.

For a browser account on X, LinkedIn, TikTok, Instagram, Facebook, YouTube or Reddit, choose **Connect account**, then **Create a new account instead**. Bycoda saves the account, opens the platform's signup window and shows which steps you must finish there: password, verification code, terms or a security check. It asks only for non-secret details such as email, name, username or birth date, and never for a password or code. Bycoda does not solve security checks. When the signup window closes, choose **Continue to sign-in** to sign in and let the Host verify the identity. Closing the window does not prove the account was created. For YouTube, sign in to your Google account in the window, or enter your name and choose **Continue** to create a new Google account first; the channel is created after it.

If Google shows a verification QR code, scan it with your phone and finish
verification in Google. If the session expires, choose **Try again** in the
Google window before continuing in Bycoda. If Instagram asks for a mobile
number, enter it and confirm the SMS or WhatsApp code in Instagram.

Follow the actions shown for the current step in the provider window. If X
reports that signup could not continue, check the message in X before continuing
in Bycoda. Use **Stop signup** to end a signup that is still open.
If X shows **Pick your interests**, finish or skip the welcome steps in X.
Close the window and choose **Continue to sign-in** in Bycoda to verify the account.

After email verification, X may ask for the account administrator's birth
date. Enter the real date in Bycoda and select **Continue** to prepare empty
date fields. Review any date already displayed and confirm the correct date
in the X window.
Review the final email discovery preference in X. If X reports an error after
submission, the signup panel keeps the session available for review.

Google's last name field is optional during YouTube signup. On Instagram's
recognized Meta Account form, Bycoda prepares the email, full name and username.
Finish the birthday, password, verification and final submission in Instagram.
For TikTok email signup, Bycoda selects the birth date you provide and preserves
any different date choices already entered in TikTok.
If TikTok reaches its signup attempt limit, the panel shows the provider's
request to wait and hides Continue while the warning is visible.
If Reddit limits email signup, the panel keeps the wait message after the
notice in Reddit disappears. The email verification step replaces the message
when Reddit accepts a later attempt.

## Accounts requested by a project

When a project's work needs a social account it does not have, the AI can ask for one. The request appears under **Waiting for you** on the Command screen with the platform and project; choose the info icon to read why it is needed. Choose **Create account** to open the platform's signup window (the steps above), **I already have one** to sign in to an account you already own, or **Dismiss** to decline. Nothing is created on a platform before you choose, and approving grants the project only read and draft access to the new account. When notifications are on, a new request, or a job that needs you (a security check, a verification code, a sign-in or an unexpected page), also appears in the notification history and as a desktop alert while the app is in the background; clicking it opens Command. The same applies when an account needs you to sign in again; clicking it opens Accounts on that account. While the desktop is away, a paired phone gets a push for each of these too if its "needs your input" setting is on. Muting the project or turning off "Needs your input" silences the desktop alert.

## Connect a browser account

In **Accounts & Settings**, connect an account using a supported browser account type. Choose the account and open its Connection section.

For a dedicated browser profile, choose **Sign in in the browser**. Complete passwords, verification and challenges in that window yourself. Close the window after finishing. The account screen updates when the Host verifies the saved identity or reports a problem. **Check connection** refreshes the status on demand. **Stop** cancels the current sign-in attempt and preserves the account's saved history.

A new LinkedIn organization browser account requires its Page ID or company URL. Reconnecting preserves the previously verified platform identity.

## Use an existing Chrome session

Choose **Use existing Chrome session** to use a social account already signed in to ordinary Chrome on the account's executor computer. Chrome 144 or newer is required.

1. In Chrome, open `chrome://inspect/#remote-debugging` and enable remote debugging.
2. Read the profile-access description and enable **Allow access to my Chrome profile** in Bycoda.
3. Choose **Find Chrome tabs** and approve Chrome's connection dialog.
4. Select a tab for the account's platform. Choose **Connect selected Chrome account**.

Chrome's debugger permission covers more than Social: it can expose other tabs and profile data. Bycoda uses this connection for the selected account and does not import saved passwords. Only matching platform tabs appear in the selection. The Host verifies the observed account identity before connecting; an existing account cannot silently change to another signed-in identity.

Bycoda uses an owned temporary tab in the selected tab's browser context. It leaves the selected tab and the Chrome window open when the connection closes. If Chrome restarts, the selected tab closes, or permission is revoked, reopen the platform and select its tab again. Dedicated-profile sign-in remains available as the alternative connection method. Account removal clears Bycoda's binding and pauses its work; it does not sign out the ordinary Chrome profile.

Connecting does not authorize publication. Existing project grants, account autonomy, approvals, suppression and global stops still apply. Captchas, passwords and verification remain owner actions.

## Connection health

Accounts refresh their metadata while the screen is active and show when that snapshot was last checked. Project-list and attention-check failures have their own retry feedback. An unknown check is not a healthy connection. Browser connection checks report waiting, checking, connected, failed or not checked separately.

## Content and AI plans

Unsaved content belongs to its original computer and project. Switching projects preserves that project's in-memory work. Editing a saved post and closing the editor retains the changes for **Resume draft**; discarding them requires confirmation. Pending saves and publishes protect the submitted revision and attachments.

The Content calendar (Week and Month) asks the Host for the posts scheduled in the days it shows, whenever they were created, so moving to another week or month always loads that range and never needs **Load more**. The Content list can contain more records than one loaded page. **Load more** includes older posts; the partial-result notice remains until all available pages are loaded. Filters apply to the loaded records.

AI planning preserves text entered after a request started. Conflicting plan operations cannot overlap. Activity refreshes while Command is active and provides continuation and retry for older records. A navigation prompt can populate an empty request or be explicitly added to an existing one. Generated reports identify their actual period when the Day/Week selection changes.

## What you can ask the AI, by platform

The AI works through the same accounts and permissions you granted. Where a change
edits your account or deletes something, the AI only queues a request. You approve
the exact request on the account before anything happens. Passwords, captchas and
verification always stay with you.

| Platform  | Ask the AI to                                                                                                                                     | You do                                                                                                            |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| YouTube   | Plan uploads and Shorts, read Analytics and earnings, run Live, queue a channel update or a video, playlist, comment or Community delete.         | Approve queued changes in **Review**. Complete Google verification for sensitive scopes.                          |
| TikTok    | Plan video and photo posts, read insights and earnings, queue follow, comment like, hide, pin and reply, LIVE reply, profile, privacy and delete. | Approve queued changes in **TikTok changes**. Replying to comments on a non-Business account opens TikTok Studio. |
| Instagram | Plan images, Reels, carousels and Stories, read insights, mentions and earnings, queue post edit or delete, profile, Highlight and DM draft.      | Approve queued changes on the account. Cold DMs are not possible.                                                 |
| Facebook  | Plan posts, photos, Reels and Stories, schedule, read insights and earnings, queue Page, post, moderation and Live changes.                       | Approve queued changes in **Facebook requests**. A browser-connected Page opens the Story composer for you.       |
| Snapchat  | Plan Spotlight and Story videos, read insights and earnings, queue profile changes and sign-up.                                                   | Approve profile changes and sign-up. Snapchat has no comments or Live.                                            |
| X         | Plan posts, read mentions, comments and insights.                                                                                                 | Profile, earnings and sign-up open the X page for you. X API use needs your billing opt-in.                       |
| LinkedIn  | Plan posts, polls and articles, read analytics, prepare profile and Live work.                                                                    | Newsletters, Page messaging and profile edits open LinkedIn for you.                                              |

Say "go live on YouTube with this scene" in a chat to start a broadcast on
YouTube, Facebook, Instagram, TikTok, LinkedIn or X. You approve each go-live request.
Everything the AI can do is limited by what the platform allows. See
[Social integrations](../integrations/social.md) for exact operations per platform.

## Instagram

In **Accounts**, connect an Instagram professional account with Instagram Login
for publishing, Inbox and insights. Select the operations you need before
connecting so the OAuth flow requests the relevant permissions. Keep a verified
browser connection for owner-managed profile, follower and post actions.

In **Content**, choose the Instagram format. A feed post can use one image or
video or a carousel with up to 20 images and videos. Story publishing uses one
image or video and needs an eligible Business account. Schedule in bycoda to
let its Host publish at the selected time.

In **Inbox**, open an Instagram comment to reply publicly, send an eligible
private reply or open its moderation actions. Existing API DMs can send an
image or video at an HTTPS URL separately from the text. Check **Activity**
after sending to see the actual outcome. For an uncertain browser deletion,
check the original post in Instagram before recording the result in **Review**.
The Instagram account tools show
insights and the available mentions, and open Instagram's own workflow for
professional conversion, Highlights, monetization and Live Producer.

In chat, ask the AI to draft an Instagram Story or a private reply, or to read
insights or observed mentions on a granted account. Review the exact send or
publication if your account requires approval.

To ask chat to hide, show or delete an Instagram comment, point it to the Inbox
conversation. Open **Instagram comment actions**, then **Review Instagram
moderation requests** to approve the exact comment and action or dismiss it.

Existing Instagram Login DMs can send image, video, audio and PDF attachments.
Choose a public HTTPS attachment or upload a local file when the Host has a
public HTTPS media origin. Send the attachment separately from text.

In **Accounts**, a verified browser account can read available Instagram
earnings, manage Highlights and open a private Live Producer window. In that
window, select **Live video** and reveal the stream credentials before using
**Capture Instagram stream credentials**. Connect your external encoder and
read the Live status before starting. End the broadcast before closing the
window from bycoda. The saved credentials can be removed in Accounts.

To remove an owned Instagram post from a verified browser account, open
**Instagram tools**, then **Content** and **Posts**, and paste its permalink.
After you confirm the deletion, Bycoda checks whether the exact post became
unavailable. An uncertain result appears as **Needs review** in Posts and on
matching **Requests** after reopening the account. Open the post to check it
in Instagram. Dismissing the request removes it from the list. The deletion
status stays with the account and post and prevents another submission.

## Telegram channel comments

Connect a Telegram **Bot** account that can see messages in the channel's linked
discussion group. When Telegram automatically forwards a new channel post to the
group, refresh **Inbox** or let the configured webhook deliver it.

Open the entry for that post, draft a reply, then approve and send it. Telegram
shows it under the channel post as a comment. Bycoda requires the linked group
and the original discussion message for this send.

To remove a publication, open the connected Telegram **Channel** account,
expand **Posts**, and choose a post published from Bycoda. Confirm **Delete
post**. Telegram allows Bot API deletion within 48 hours, and the administrator
bot needs delete permission. A result in review keeps the message link so you
can inspect the post in Telegram.

## Reddit Chat

Open a connected Reddit browser account in **Accounts**. Under **Tools**, expand
**Direct messages** and choose **Open in browser**. Bycoda verifies the selected
account, then opens Reddit Chat in its saved browser profile. Choose the recipient
and send the message in Reddit. Reopen **Direct messages** to see or cancel a
Chat window that is still open.

## Reddit published posts

Open the connected Reddit account, expand **Posts**, and load its Bycoda
publications. Pick the post and confirm **Delete post**. The Host checks the
original post and the current Reddit author. A result that needs review remains
visible and cannot be submitted again from this list.

## Inbox search

The inbox filters loaded conversations as you type, then searches the selected account scope on the Host when you pause. If the selected conversation still matches, its history and reply draft stay in place. Adding or removing a tag updates the conversation after the Host confirms the change.

## Reply uncertainty

Bycoda verifies a new Reddit comment by reopening its permalink and matching
the author, thread and text. Check that permalink on Reddit if the comment
appears in Review.

An unconfirmed reply is not shown as definitely unsent. **Retry same reply** checks or resumes the original operation with its original identity rather than creating another reply. The draft and unresolved operation survive conversation switches and component remounts within the current app session. They are not a new disk-persistence guarantee across app reloads. Jobs that require review remain visible as requiring review.

## LinkedIn

In **Content**, a LinkedIn API account provides **Post format**. Choose **Poll** for a question
and up to four options, or **Article link** to share an existing article. Attach images, one
MP4, or one titled PDF to a regular post. Schedule it with **When**.

In **Accounts**, use **Analytics** to load metrics for the selected LinkedIn account.
**Manage LinkedIn posts** provides reviews for edits or deletions of bycoda publications.
If chat prepares a change, load its review ID there and inspect the action before confirming.

For a scheduled LinkedIn Live event, open **Live Studio** and check eligibility for the
selected Page or profile. Copy the destination into **LinkedIn Live** for encrypted storage on
the account's Host. Start and end the broadcast in LinkedIn Studio with a compatible encoder.

For an OAuth Company Page with Event Management and Community Management access, enable
**LinkedIn Live comments** in the connection permissions and reconnect. In the **LinkedIn Live**
panel, enter the event ID and load comments. With reply permission, choose **Reply**,
write the response, and review the exact change before sending.

For supported platforms, restrictions and Host/API contracts, see [Social integration](../integrations/social.md).

## Manage a YouTube channel

Open **Social > Accounts**, choose your YouTube channel and expand **YouTube management**. Connect through Google OAuth for videos, playlists, comment moderation, subscriptions, Analytics, earnings reports and Live. Use a verified browser connection for Studio profile fields, Community posts, comment reactions and the Studio Earn status.

- In **Content**, choose **Video** or **Short**. A Short must be square or vertical and up to three minutes. YouTube decides the final classification. Review the publication or schedule before sending.
- Select a YouTube API account before attaching an MP4 or WebM larger than 64 MiB. The API path accepts up to 256 GiB and resumes the same YouTube upload when the Host restarts with a valid session. Browser video uploads use the 64 MiB limit.
- Use **Videos and playlists** to edit metadata and visibility, upload a thumbnail, organize playlist items or delete eligible content. Use **Comments** to moderate a comment. Read and reply to ordinary comments from the shared Inbox.
- In **Community posts** on a browser-connected channel, choose a publish time to schedule a post. Use the published or scheduled list to select an owned post, edit its text or confirm deletion. If the link was already unavailable before deletion, check the result on YouTube and record it in **Review**.
- In **Videos** on a browser-connected channel, choose **Load** to read the first Studio page for videos, Shorts and live recordings. Select the exact owned item and confirm **Delete video**. An uncertain result can be checked and recorded in **Review** before another attempt.
- Select **Analytics** for channel activity, traffic sources and estimated earnings. If a report requests more permission, reconnect the channel and select the matching report permission. Google must make the report available to the channel.
- Select **Live broadcasts** to create and bind a broadcast and stream, view chat and Super Chats, and transition the broadcast after an encoder starts sending. The creation result displays the RTMP URL and credential reference. The stream key stays in the Host vault.
- Select **Review** for YouTube operations pending owner approval. Verify uncertain outcomes on YouTube, then record the result before resubmitting.

## TikTok account tools

Open a connected TikTok account from **Accounts** and expand **TikTok tools**.
Choose the section for profile, privacy, comments, mentions, messages, followers,
analytics, earnings or LIVE. Browser lists cover the entries TikTok exposes to
that desktop session. Refresh supported inbox entries and assign a project before
asking AI to use them in a project chat.

Use **TikTok changes** to review the exact target and content of an account
change. Verify the result on TikTok before dismissing an uncertain change.
An eligible account can save its existing LIVE stream key to the Host vault.
Complete sign-in, verification and any required LIVE setup in TikTok.

In **Content**, choose a video or photo post. Browser photo uploads depend on
the Studio photo picker. API photos use URLs on a verified domain or URL prefix.
Choose direct publication or, with the required OAuth scope, send a draft to
the TikTok inbox. Scheduled work stays in Bycoda until its scheduled time.

## Snapchat

Choose **Snapchat** in **Accounts & Settings** to create or sign in to a member
account. Complete password, verification and terms in the browser. Connect a
Public Profile through the Public Profile API for publishing, publications and
insights. Connect its verified browser account to manage the profile and read
monetization status. To start a text chat, open **New Snapchat chat** in Inbox.
Read the visible friends list or enter the exact username. The Host verifies the
friend and the chat before sending.

Choose **Spotlight**, **Public Story**, or **Saved Story** in Content. For a
Saved Story, enter its title in the post field and attach media or enter source
IDs. Pick a date and time to schedule the post. Review uncertain publication
outcomes before publishing again. Delete a Spotlight or Saved Story from its
publications list after confirming the exact item.

Ask AI in bycoda chat for granted Snapchat insights, subscriber totals,
publications or earnings. AI can prepare campaigns and messages under the
account's existing autonomy settings. Signup requests appear in Command.
Profile changes and deletion requests appear on the Snapchat account for owner
review.

## Facebook Pages

Connect a managed Page in **Accounts and Settings** and select the permissions needed for
publishing, Inbox, Page insights, or Live. **Edit profile** reads the Page and its follower and
like counts. The saved Facebook browser connection supports owner-confirmed Page name and
username edits. Setup stops at Facebook's password, agreement and verification steps.

Choose **Feed**, **Video**, **Reel** or **Story** when composing for a Page. The optional
**Facebook publish time** on Feed and Video hands the accepted item to Facebook's scheduler.
The Bycoda schedule controls when the Host submits it. Stories use the attached photo or video.

Open a Facebook comment in **Inbox** to hide, restore, delete, like or unlike it. An eligible
comment can receive one private Messenger reply within seven days. Facebook opens the standard
conversation window when the recipient responds. Check **Activity** for uncertain outcomes.

The Page details also show posts, mentions, insights, applicable earnings estimates and
current Live controls. Copy encoder details from the owner controls to configure an encoder.
For a browser-connected Page, open **Posts**, paste the direct Facebook post link, and
confirm **Delete post**. The browser must be signed in as that Page. Bycoda checks the
post's author, then waits for Facebook to report deletion and reopens the same link.
The browser monetization overview can read visible Stars, in-stream ads and bonus status for
the verified Page. Facebook Groups and unsolicited Messenger conversations are unavailable.

In chat, ask AI to read a project's connected Facebook Page, find posts and mentions, check
insights and Graph earnings estimates, prepare a private reply, or draft a public Live reply.
AI can prepare and schedule Facebook campaigns through the existing campaign tools. Account
setup, Page edits, post moderation, the browser monetization overview and Live setup require the owner.
AI can file changes to the Page, posts, moderation and Live under **Facebook requests** on the
account. Review the exact request there before approving.

With a personal Facebook browser connection, open **Edit profile** to request a
name change, update the intro, or manage supported links and details. Use the
exact label Facebook displays to choose which detail appears in the intro. Use
**Facebook profile photos** to upload a profile picture or cover from your computer
for a connected personal profile or Page.

Set post edits or comment moderation to **Approve** in the Page's autonomy settings.
In **Facebook requests**, choose **Approve for chat**, then tell AI to apply the
request. Under **Autonomous**, AI can apply eligible post edits and reversible
moderation directly. Both modes obey the account's work hours and limits.
