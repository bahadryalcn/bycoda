# Social media accounts and drafts

Social Media keeps accounts on the selected computer. Choose the computer and project at the top before connecting an account, preparing content or reviewing activity. A saved account, an authenticated browser session and permission to send are separate states.

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

## Reply uncertainty

An unconfirmed reply is not shown as definitely unsent. **Retry same reply** checks or resumes the original operation with its original identity rather than creating another reply. The draft and unresolved operation survive conversation switches and component remounts within the current app session. They are not a new disk-persistence guarantee across app reloads. Jobs that require review remain visible as requiring review.

For supported platforms, restrictions and Host/API contracts, see [Social integration](../integrations/social.md).
