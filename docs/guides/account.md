# bycoda account

A bycoda account is optional and free. bycoda works the same without one: your sessions,
projects, drafts and settings stay on your computer either way, and nothing asks you to
sign in.

An account adds three things: a list of your devices, your active time across all of them,
and a notification center that decides what reaches which device.

## Sign in and out

On a first launch, the setup dialog opens with an optional Account step: sign in, or choose
**Continue as guest**. It is shown once; you can always sign in later from Settings → Account.

Choose **Sign in with browser** on the Account page. bycoda opens your default browser on
the sign-in page; pick Google, Facebook, Apple, GitHub or an emailed code. When the browser
says you are signed in, return to bycoda. Sign-in finishes within five minutes; press
**Cancel** to stop waiting.

- Your sign-in secret is kept in the system credential store (Windows Credential Manager,
  macOS Keychain or the Linux Secret Service), never in a file.
- **Sign out** removes the secret from this computer. Your local data is not touched.
- If your session ends (for example you signed this computer out from another device),
  bycoda says so and returns to the signed-out state.
- Offline, bycoda shows the account details it last confirmed for up to seven days.

## The account center

The account entry sits at the bottom of the Settings list: your avatar and name, or **Sign in**
when you use bycoda as a guest. Signed in, the Account page shows your picture, name, e-mail and plan
with **Sign out** at the top, and a side menu (a strip above the content in a
narrow window) with **Profile**, **Security**, **Devices**, **Active time**, **Notifications**,
**Privacy & data**, **Support** and **Account status**. Details saved earlier refresh on their own
when the window gets focus or the network returns. The side menu stays visible while
long account sections scroll; membership details live under **Profile**.

The **Daily summary** e-mail cell controls the daily digest. Its send-time field appears
when enabled. Active time uses one overview with a device-scope selector, rather than
repeating the same account totals and seven-day chart.
Signed out it is one sign-in panel plus a **Contact by e-mail** link; a guest stays fully local.

## Profile

Your display name (click it to change it), e-mail, plan and membership date, and the time zone
the account uses for daily summaries and active-time days. When it differs from this computer,
**Use …** switches it to this computer's zone.

## My devices

Every computer and phone signed in to your account. This computer is marked. Rename a device
by clicking its name. **Sign out** next to a device removes it from your account; it is signed
out the next time it connects. Signing out this computer from here also signs it out locally.

### Let phones find this computer

In Settings → Connections → Phone, **Let my signed-in phones find this computer**
(off by default) stores this computer's name, its Host environment id and its phone route
addresses (a private local-network address with its public key, and a Tailscale address) in
your account so your signed-in phones can ask to connect. These are new stored data: route
hints only, never sessions, prompts, code or credentials. The entry is removed when you turn the
switch off or remove the device, and every connection still needs your approval on the computer
([details](mobile-connections.md)).

## Activity on this computer

Sessions, agent run time, active time and cost for today or this week on this computer, with
charts and a table by project. It is local, needs no account and is also shown signed out. See
[Today](today.md).

## Active time on all devices

The time you actively used bycoda today, this week, this month and this year, summed across
all your devices, with the last seven days as bars. Active time never includes what you did.

The **Active time** and **Privacy & data** tabs retain their work when you switch account tabs. This includes summary results and the optional diagnostic note. Signing out clears this account screen state.

## Notifications

Choose, per event, which channels notify you: in the app, on the desktop, on your phone or by
email. A sign-in from a new device always notifies you and cannot be switched off. Quiet hours
silence other notifications during the hours you set: a push sent during quiet hours is
dropped, not deferred until they end. The server's duplicate suppression resets when it
restarts, so a rare repeat notification after a restart is possible. Phone notifications show no project or
session names unless you turn on **Show details in phone notifications**.

Changes apply immediately. **Saving…** remains visible until all queued notification changes finish; a failed save shows recovery feedback.

Below the settings, **News** lists recent announcements from bycoda. While you are signed in,
bycoda checks for announcements at start and every few hours (not while offline) and shows
unread ones as a small notice that never blocks your work. **Dismiss** hides one on this
computer for good; **Read more** opens its link in the browser. Guests see no announcements.

## Support

**Support** sends a request to the bycoda team: pick a category, write a subject and a message.
Nothing from your sessions, code, logs or file paths is attached, so describe the problem in
your own words and never paste passwords or tokens. After sending you see a reference number to
quote later. If sending fails or you hit the rate limit, your text stays in the form. **Contact
by e-mail** opens your mail app to info@bycoda.codes; it is the only support entry without an
account.

## Send feedback

**Send feedback** (the account menu, Settings > General > Setup and help, and the
Account Support tab) opens a short form: pick a kind (idea, problem, praise, other), write a
message of up to 2000 characters and optionally rate bycoda from 1 to 5. It works signed in
(the feedback is linked to your account) and as a guest (it is stored with no user, device
or install id). Tick **Include app version and system** to add the app version, platform,
OS version and release channel; it is off by default and nothing else is ever attached. If
sending fails or you hit the rate limit, your text stays in the form; after sending you see a
reference number. **Attach diagnostic logs** (ticked by default only when you chose automatic
sharing, see Diagnostic logs below) uploads redacted logs linked to the feedback after it was
received; if only the logs fail, the thank-you screen says so. In builds without the account platform the dialog offers **Open an issue
on GitHub** and the e-mail link instead.

## Security

- **Sign-in**: your e-mail and the methods you sign in with (Google, GitHub, Apple, Facebook or
  an e-mail code). Password and two-step verification belong to the sign-in provider; when the
  build has an account portal, **Open account page** opens them in the browser.
- **Sessions**: how many devices are signed in, **Review devices**, and **Sign out others**,
  which keeps this computer signed in.
- **Recent activity**: sign-ins, new and signed-out devices, deactivation, export and deletion
  requests of the last 90 days, with device, app and country. IP addresses are never kept.

## Privacy and data

Shows, one row per category, what bycoda stores about your account (profile, devices, phone
route hints if you turned on phone connect, active-time days, notification items, support
requests) and how long it is kept, and never your sessions, prompts, code or file names.
**Request export** prepares a JSON copy of your account in the background; when it is ready,
**Save file** downloads it. Statistics and diagnostic logs below are choices of this computer.

**Share anonymous usage statistics** is off by default and needs no account. bycoda asks
once: in the first-run setup, or for existing installations in a small notice that never
blocks your work (if you ignore it, it comes back on the next launch, three times at most,
and statistics stay off). When on, bycoda sends at most once a day a random install id, the
app version, operating system, release channel and date, and nothing else. Without an account
the same switch is in Settings → Privacy. Turning it off stops sending immediately.

### Diagnostic logs

**Share diagnostic logs** (Account → Privacy and data, and Settings → Privacy) has three
choices: **Off**, **Ask me** (also what you get until you choose) and **Send automatically**.
Logs are the app, Host and interface logs of this computer. They are redacted here before
they leave it (secrets, tokens, e-mail addresses and your user name are removed) and again on
the server, never include your conversations, prompts or code, and are kept 90 days.

- After bycoda closed unexpectedly, **Ask me** shows a notice with **Send**, **Always send**
  (switches to automatic) and **Don't send**. **Send automatically** uploads the crash report
  silently and **Off** discards it.
  Notice answers use the full card width below the message and wrap on narrow windows.
- In automatic mode bycoda also sends a report at most once every seven days.
- Logs of connected remote computers (their bycoda Host) are included, redacted the same way.
- **Send logs now** uploads a report once, with an optional note, whatever the choice is.
- Signed in, reports are linked to your account; as a guest they carry no user, device or
  install id. Without the account platform nothing can be sent.

## Account status

- **Deactivate account** keeps all your data, signs every device out and silences
  notifications. You can add an optional reason. A deactivated account shows only Profile,
  Privacy & data and Account status; **Reactivate account** restores it and this computer
  registers again.
- **Delete account…** asks for confirmation and schedules the deletion with a 14-day grace
  period. Until then the page shows the date and **Keep my account** undoes it; afterwards your
  account data is removed. Sessions, projects and files on your computers are never touched.

bycoda never sends session content, prompts, code, file paths or project names to the
account service.

## Configure a build

No account service address is built into the source. A build that sets none of the variables
below has no account: the account screen and menu stay hidden and the app runs as a guest.
Forks therefore build without the maintainer's sign-in service, and can point at their own.

| Variable                                                                                          | Purpose                                                                                              |
| ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `BYCODA_CLERK_ISSUER`, `BYCODA_CLERK_CLIENT_ID`, `BYCODA_ACCOUNT_API_URL`                         | Production OAuth issuer, public client id and account API origin                                     |
| `BYCODA_STAGING_CLERK_ISSUER`, `BYCODA_STAGING_CLERK_CLIENT_ID`, `BYCODA_STAGING_ACCOUNT_API_URL` | The same for staging                                                                                 |
| `BYCODA_ACCOUNT_ENV`                                                                              | `production` (default) or `staging`; the one selector a release build also reads at run time         |
| `VITE_BYCODA_ACCOUNT_PORTAL_URL`                                                                  | Account web portal origin for the security, export and delete links; the links are hidden when unset |

Set them as environment variables when you build (`.env.example` lists them; cargo does not
read dotenv files, so export them in the shell). All values are public. Endpoints must be
HTTPS, or HTTP on a loopback address. Release builds ignore run-time endpoint overrides;
debug builds accept the same variable names at run time. In this repository's release
workflow they come from GitHub repository variables of the same names. Content-Security-Policy
hosts in `src-tauri/tauri.conf.json` are static: a fork with its own API origin adds it to
`connect-src`.
