# Social media accounts and drafts

Social Media keeps accounts on the selected computer. Choose the computer and project at the top before connecting an account, preparing content or reviewing activity. A saved account, an authenticated browser session and permission to send are separate states.

## Create a new account

For X, **Browser** is the default. Open **X actions** from the account for
profile edits, Creator Studio and X Live Studio. Complete verification on X.
To store a Live Studio stream key, paste it into **X stream key** and choose
**Save stream key**.

For paid API operations, choose the API connection and set **X API billing**
to Pay per use or Enterprise. Review the example prices, select permissions
and connect. Confirm the account, target and action before applying API changes.
In **Content**, select an X account for polls, Community posts and threads.
API quote posts require Enterprise. Review partial threads on X before
sending additional posts.

For a browser account on LinkedIn, TikTok, Instagram, Facebook, YouTube or Reddit, choose **Connect account**, then **Create a new account instead**. Bycoda saves the account, opens the platform's signup window and shows which steps you must finish there: password, verification code, terms or a security check. It asks only for non-secret details such as email, name, username or birth date, and never for a password or code. Bycoda does not solve security checks. When the signup window closes, choose **Continue to sign-in** to sign in and let the Host verify the identity. Closing the window does not prove the account was created. For YouTube, sign in to your Google account in the window, or enter your name and choose **Continue** to create a new Google account first; the channel is created after it.

## Accounts requested by a project

When a project's work needs a social account it does not have, the AI can ask for one. The request appears under **Waiting for you** on the Command screen with the platform and project; choose the info icon to read why it is needed. Choose **Create account** to open the platform's signup window (the steps above), **I already have one** to sign in to an account you already own, or **Dismiss** to decline. Nothing is created on a platform before you choose, and approving grants the project only read and draft access to the new account. When notifications are on, a new request, or a job that needs you (a security check, a verification code, a sign-in or an unexpected page), also appears in the notification history and as a desktop alert while the app is in the background; clicking it opens Command. The same applies when an account needs you to sign in again; clicking it opens Accounts on that account. While the desktop is away, a paired phone gets a push for each of these too if its "needs your input" setting is on. Muting the project or turning off "Needs your input" silences the desktop alert.

## Connect a browser account

In **Accounts & Settings**, connect an account using a supported browser account type. Choose the account and open its Connection section.

For a dedicated browser profile, choose **Sign in in the browser**. Complete passwords, verification and challenges in that window yourself. Close the dedicated sign-in window after finishing; the Host then verifies the saved identity. **Check connection** rechecks an existing connection. **Cancel sign-in** cancels the current sign-in attempt without removing the account's saved history.

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

Content lists and calendars can contain more records than one loaded page. **Load more** includes older posts; the partial-result notice remains until all available pages are loaded. Filters apply to the loaded records.

AI planning preserves text entered after a request started. Conflicting plan operations cannot overlap. Activity refreshes while Command is active and provides continuation and retry for older records. A navigation prompt can populate an empty request or be explicitly added to an existing one. Generated reports identify their actual period when the Day/Week selection changes.

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
after sending to see the actual outcome. The Instagram account tools show
insights and the available mentions, and open Instagram's own workflow for
professional conversion, Highlights, monetization and Live Producer.

In chat, ask the AI to draft an Instagram Story or a private reply, or to read
insights or observed mentions on a granted account. Review the exact send or
publication if your account requires approval.

## Reply uncertainty

An unconfirmed reply is not shown as definitely unsent. **Retry same reply** checks or resumes the original operation with its original identity rather than creating another reply. The draft and unresolved operation survive conversation switches and component remounts within the current app session. They are not a new disk-persistence guarantee across app reloads. Jobs that require review remain visible as requiring review.

For supported platforms, restrictions and Host/API contracts, see [Social integration](../integrations/social.md).

## Manage a YouTube channel

Open **Social > Accounts**, choose your YouTube channel and expand **YouTube management**. Connect through Google OAuth for videos, playlists, comment moderation, subscriptions, Analytics, earnings reports and Live. Use a verified browser connection for Studio profile fields, Community posts, comment reactions and the Studio Earn status.

- In **Content**, choose **Video** or **Short**. A Short must be square or vertical and up to three minutes. YouTube decides the final classification. Review the publication or schedule before sending.
- Use **Videos and playlists** to edit metadata and visibility, upload a thumbnail, organize playlist items or delete eligible content. Use **Comments** to moderate a comment. Read and reply to ordinary comments from the shared Inbox.
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
