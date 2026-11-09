# Privacy policy

Last updated: 9 November 2026

## Scope and contact

This policy describes the bycoda desktop application, the optional bycoda account (including the account portal at account.bycoda.codes), the bycoda.codes website and the self-hosted companion host, independently maintained by [bahadryalcn](https://github.com/bahadryalcn).

Controller: the independent developer who maintains bycoda (GitHub: [bahadryalcn](https://github.com/bahadryalcn)) is the data controller under the Turkish Personal Data Protection Law No. 6698 (KVKK) and the controller under the EU General Data Protection Regulation (GDPR) for the data this policy says reaches the maintainer. Contact: [info@bycoda.codes](mailto:info@bycoda.codes). For formal applications, the controller's full name and postal address are provided on request to that address.

For privacy questions or requests, email [info@bycoda.codes](mailto:info@bycoda.codes). GitHub may be used for general questions; do not post personal information, credentials, private code or conversation logs in public issues.

## What bycoda collects, and what it does not

You can use bycoda without a bycoda account. Without an account, the application does not send your projects, conversations, credentials or usage history to the maintainer, and it includes no advertising, behavioral tracking or automatic crash-report uploads. The only thing it can send without an account is the optional anonymous statistics signal described below, which is off by default.

If you create a bycoda account, the maintainer does receive and store the limited account data described in the sections below: your account profile, your devices, how many minutes per day each device was active, and your notification settings.

Never collected, with or without an account: session content, prompts, model responses, code, file contents, file paths, project names, repository names, what is shown on your screen, credentials, or the contents of your email and chat messages. We do not sell your data, use it for advertising, or use your content to train models.

This does not mean the application stores no data or never uses the network. Data is processed on your devices and, when a connected feature runs, by the providers and hosts you use.

## Your bycoda account

An account is optional and free. You can sign in with Google, GitHub or an email code; there is no password (see "Signing in with Google, GitHub or an email code" below). Sign-in is handled by our identity provider, Clerk, which acts as our processor. When you sign in with Google or GitHub, that provider tells Clerk the profile details you allow it to share. To protect accounts, Clerk, as our identity processor, records your sign-in sessions with the IP address, approximate location and browser or device, and shows them to you under Security → Active devices. bycoda's own database does not store IP addresses. For account security and aggregate statistics, our servers store only the country of each sign-in and device registration, derived from the IP address by our network provider Cloudflare; the IP address itself is not stored. This country is kept for 180 days; the Security activity page in the account portal shows you the last 90 days.

We store a user identifier, your email address, your display name, a profile picture address when the sign-in provider supplies one, the sign-in methods linked to the account, the language and time zone you choose, when the account was created, and your notification preferences. The bycoda apps keep your sign-in tokens in the operating system's secure credential storage, not in plain files.

Purpose: to let you sign in on several devices, see and sign out those devices, view your active time, receive the notifications you ask for, and keep the service secure and working.

## Signing in with Google, GitHub or an email code

You can sign in with Google, GitHub or a one-time code sent to your email address. (Apple or Facebook sign-in may also be offered where enabled; the same rules apply.) There is no password to create or store.

- Google or GitHub: when you choose one of them, that provider authenticates you and tells Clerk the profile details you allow it to share: your name, email address, profile picture and the provider's account identifier. We receive these through Clerk and store only what is listed in "Your bycoda account" above. We never see your Google or GitHub password. Sign-in does not give us access to your Google or GitHub content, repositories, contacts or mail; it only proves who you are.
- Email code: you give Clerk your email address and Clerk sends a one-time code to it. Only your email address is processed.
- Google and GitHub act under their own privacy policies and terms for their side of the sign-in.
- Disconnect: in the account portal at account.bycoda.codes, open Security to see your linked sign-in methods and remove one (keep at least one). You can also revoke bycoda's access in your Google account permissions or in GitHub under Settings, Applications. Deleting your bycoda account removes the link on our side.

## Your devices

For each device where you sign in, we store a device name, operating system and version, application version, release channel, a push token if you enable push notifications, when the device was first registered and when it was last seen. You can see this list in the app and in the account portal and sign a device out remotely.

## Active time

To show you how long you use bycoda, the app records on your device which minutes of each day it was actively used. When you are signed in, this is uploaded as one compact record per device per day: a map of 1,440 on/off values, one for each minute of the day, plus the date and time zone. It contains no information about what you did. What is on your screen, which project or session was open, and what you typed are never recorded. Without an account, active time stays on your device.

We use these records to show you your totals (day, week, month, year) and, in aggregate, to understand how much bycoda is used and to plan capacity. Staff access to individual records is limited to operating and supporting the service.

## Deactivating and reactivating your account

You can deactivate your account in the app or the portal instead of deleting it. Deactivation keeps your data, signs all your devices out and stops notifications and uploads. You can add an optional reason, which we store with the account. Reactivating restores the account. Deactivation is not deletion: the retention rules below apply as for any active account, and you can still request deletion at any time.

## Support requests

If you send a support request from the portal, we store its subject, message and category, its status, the date, and the replies and internal notes our staff add. Staff use it only to answer you. A request is kept while your account exists and is deleted with the account. Do not put passwords, code or other secrets in a request.

## Feedback

If you send feedback from the app, we store its type (idea, problem, praise, other), your message, the optional 1–5 rating and the date. Only if you tick "Include app version and system" do we also store the app version, operating system and its version, and release channel. Signed in, the feedback is linked to your account and deleted with it. Without an account it is stored with no account, device, install id or IP address. Staff use feedback only to improve bycoda. Feedback is deleted after 365 days. Do not put passwords, code or other secrets in feedback.

## Audit records

To keep the service secure and accountable, we record important account events and every action our staff take on accounts (who, what, when, the reason given and a hashed form of the IP address). After your account is deleted these records are kept, linked only to a pseudonymous internal identifier and no longer to your name or email address. The hashed IP address is dropped after 180 days.

## Optional anonymous statistics

Anonymous statistics are optional and off by default, with or without an account. The app asks you once (during first-run setup, or once in the app if you were never asked) and only sends anything if you choose to share; you can change your choice in Settings at any time. When on, the app sends at most one small signal per day containing a random installation identifier, the application version, the operating system, the release channel and the date. The identifier is not derived from your hardware, name or email and is not linked to any account. Turning the setting off stops the signal.

## Website statistics

The bycoda.codes website counts page views with Umami, a self-hosted, cookieless analytics tool run by the maintainer. It sets no cookies, stores no IP address and honours the browser Do Not Track setting. It records the page, the referring site, the browser, the operating system, the device type and the country derived at request time, only in aggregate. Nothing from the website is shared with a third-party analytics provider.

## Account portal statistics

The account portal (account.bycoda.codes) uses Cloudflare Web Analytics, a cookieless tool. It does not use cookies, local storage or fingerprinting, and records only aggregated page views and page-performance metrics. Cloudflare already processes traffic to our domains as our network provider (see the service providers list below). The admin area does not load it. The bycoda apps and the bycoda.codes website do not use Cloudflare Web Analytics.

## Notifications

If you enable push notifications, the mobile push token is sent to Expo's push service, which delivers notifications to your device through Apple or Google. Emails we send (for example an account deletion confirmation, or a digest you opted in to) go through a transactional email provider, Resend; if Resend is unavailable they are sent by our own mail server (Mailu, running on our Hostinger server). Your in-app notification feed keeps items for 90 days. Sign-in codes and verification emails are sent by Clerk. Notifications contain generic text and a link, not session content. Digest emails are sent only if you opt in, and each one has an unsubscribe link. You can change channels and categories in the app or the portal.

## Service providers (recipients)

We use the following providers to run the account service. They process data on our instructions, except where they act as independent controllers under their own policies. Their privacy policies are linked in the "Third-party services and data controls" notice. We do not sell personal data and do not share it for advertising.

- Clerk (United States): identity, sign-in, verification emails and sessions. Processor.
- Cloudflare (United States, global network): DNS, network, security, traffic protection and, on the account portal only, aggregate web analytics. Processor.
- Hostinger (virtual server located in the European Union): hosting of the account service, its database and our own mail server. Processor.
- Expo (United States): delivery of mobile push notifications, which are passed on through Apple or Google. Processor.
- Resend (US company; we use its EU sending region): delivery of transactional and opt-in digest emails (first choice). Processor.
- Our own mail server (Mailu, on our Hostinger server in the EU): fallback delivery of the same emails when Resend is unavailable, and receipt of mail sent to our bycoda.codes addresses.
- Sign-in providers you choose (Google, GitHub and, where offered, Apple or Facebook; United States): they authenticate you under their own policies.
- Public authorities, courts or other third parties, only where the law requires it.

Providers may be added or replaced; this page is updated when that happens. The maintainer can access the data to operate and support the service.

## Transfers abroad

Our database and servers are in the European Union. Several providers above (Clerk, Cloudflare, Expo, Resend and the sign-in providers) are companies based in, or able to access data from, the United States and other countries, so personal data can be processed outside Turkey, outside the European Economic Area and outside your country.

- Under Article 9 of the KVKK (as amended by Law No. 7499 in 2024) these transfers rely on the standard contractual terms and data-processing terms that the providers offer, together with the safeguards described in this policy. We do not rely on an adequacy decision for any provider. Where a transfer is incidental and not repetitive, it may instead rest on your explicit consent or another exception in Article 9.
- Under the GDPR, transfers outside the European Economic Area rely on the providers' standard contractual clauses or an applicable adequacy decision (for example the EU-US Data Privacy Framework where the provider is certified).
- You can ask for information about the safeguards by writing to [info@bycoda.codes](mailto:info@bycoda.codes).

## Account retention, export and deletion

- Account data (profile, devices, notification settings) is kept while the account exists.
- Sign-in events: the country of sign-ins and device registrations (no IP address) is kept for 180 days; the portal shows the last 90 days as Security activity.
- Notification feed items are kept for 90 days.
- Support requests are kept while the account exists and deleted with it.
- Feedback is deleted after 365 days, or with the account if you sent it signed in.
- Audit records are kept after account deletion with a pseudonymous internal identifier; the hashed IP address in them is dropped after 180 days.
- A deactivated account keeps its data under the same rules until you reactivate or delete it.
- Active-time records are kept while the account exists so your history stays available.
- Server logs are kept for 14 to 30 days. They exclude session content and personal data; they may contain technical identifiers needed for security and troubleshooting.
- Anonymous statistics signals are not linked to a person and are kept for 400 days.
- Backups: database backups are rolled so that deleted data leaves them within 30 days (the last 30 daily backups are kept).
- Export: you can request a machine-readable export of your account data (profile, devices, active-time records, notification preferences) from the app or the portal. The export file is available for 7 days and is then deleted.
- Deletion: you can request account deletion from the app or the portal. Your data is deleted 14 days after the request unless you cancel it during that period. Then your account data, devices and active-time records are permanently deleted and push tokens are removed. We keep only records that the law requires us to keep, if any, and the pseudonymous audit records described above.
- Removing a device deletes its push token and stops its uploads.

## Purposes and legal bases

- Creating and running your account, sign-in, devices, active time, support requests, and notifications you request: performance of the service you asked for (GDPR Art. 6(1)(b); KVKK Art. 5(2)(c)).
- Push notifications, digest emails and optional anonymous statistics: your consent, which you can withdraw at any time in the app or portal without affecting earlier processing (GDPR Art. 6(1)(a); KVKK Art. 5(1), explicit consent).
- Security, abuse prevention, audit records, sign-in country, server logs, reliability, aggregate usage statistics and capacity planning, website and portal statistics, feedback: our legitimate interests, which do not override your rights (GDPR Art. 6(1)(f); KVKK Art. 5(2)(f)).
- Legal obligations and the establishment, exercise or defence of legal claims (GDPR Art. 6(1)(c) and (f); KVKK Art. 5(2)(a), (ç) and (e)).

Providing an email address is necessary to create an account; everything else you send is optional. We do not make decisions about you based solely on automated processing.

## Your rights

Under the GDPR you can ask for access to your data (Art. 15), correction (Art. 16), deletion (Art. 17), restriction (Art. 18), notification of these actions to recipients (Art. 19), portability (Art. 20) and objection (Art. 21); you can withdraw consent at any time (Art. 7); and you are not subject to decisions based solely on automated processing (Art. 22). Your rights under Article 11 of the KVKK are listed in the Turkish notice below. Access, export and deletion are also available in the app and portal.

How to apply: email [info@bycoda.codes](mailto:info@bycoda.codes) with your request. To protect your data we may ask you to verify your identity, for example by writing from the email address of your account. We reply within one month under the GDPR and within 30 days at the latest under the KVKK, free of charge; if the answer needs a written reply of more than ten pages, the fee set by the Personal Data Protection Board tariff may be charged.

Complaints: if you are in Turkey you can complain to the Personal Data Protection Board (kvkk.gov.tr) after applying to us. If you are in the EU or EEA you can complain to your local data-protection supervisory authority. You can contact us first, and we will try to solve the matter.

## Turkish data-protection notice (KVKK aydınlatma metni)

This section follows Article 10 of the Turkish Personal Data Protection Law No. 6698 (KVKK) and the Communiqué on the Procedures and Principles to be Followed in Fulfilling the Obligation to Inform. The Turkish text is published at bycoda.codes/kvkk and in the app's Turkish language; for residents of Turkey, the Turkish text applies where they differ.

- Data controller: the independent developer who maintains bycoda ([bahadryalcn](https://github.com/bahadryalcn) on GitHub). Contact: [info@bycoda.codes](mailto:info@bycoda.codes). The controller's full name and postal address are provided on request to that address for formal applications.
- Data processed: identity and contact data (name, email, profile picture, sign-in provider account identifier), device and technical data (device name, operating system, application version, push token, sign-in country), usage data (active-minute records, anonymous statistics), support requests, feedback and transaction security data (logs, audit records). No special categories of personal data are requested.
- Purposes: creating and running your account, signing in, managing devices, showing your active time, sending requested notifications, support, security and abuse prevention, service planning and legal obligations.
- Legal bases (Article 5): performance of a contract, the controller's legitimate interest, legal obligations, the establishment, exercise or protection of a right and, for optional features (anonymous statistics, push and digest notifications), your explicit consent, which you can withdraw at any time.
- Collection method: electronically, through the app, the portal, the website and the sign-in providers you choose.
- Recipients: the service providers listed above and, where the law requires, authorised public bodies.
- Transfer abroad: personal data is transferred to the providers listed above, some of which process data abroad, based on the providers' standard contractual terms under Article 9 of the KVKK, or on your explicit consent for incidental transfers.
- Your rights (Article 11): to learn whether your data is processed and request information; to learn the purpose and whether it is used accordingly; to learn the third parties to whom data is transferred in Turkey or abroad; to request correction of incomplete or inaccurate data; to request deletion or destruction; to request that these actions be notified to recipients; to object to a result against you produced solely by automated analysis; and to claim compensation for loss caused by unlawful processing.
- How to apply: send a written request that includes your name, signature, identity information, a notification address and the subject of your request to [info@bycoda.codes](mailto:info@bycoda.codes), from the email address registered to your account, or by registered electronic mail, secure electronic signature, notary or post as the Communiqué on Application Procedures and Principles allows (the postal address is given on request). We answer within 30 days at the latest. If the answer is insufficient or late, you can complain to the Personal Data Protection Board within 30 days of our reply and in any case within 60 days of your application.

## Children

bycoda and the bycoda account are not directed at children under 16, and we do not knowingly collect their personal data. If you are under 18 you need the permission of your parent or legal guardian to create an account. If we learn that we hold an account of a person under 16, we delete it. A parent or guardian who believes this has happened can write to [info@bycoda.codes](mailto:info@bycoda.codes).

## Security

We protect account data with measures appropriate to the risk: encrypted connections (HTTPS) between the apps, the portal, the website and our servers; no passwords (sign-in through Clerk with Google, GitHub or one-time codes); sign-in tokens kept in the operating system's secure credential storage; access to the admin area restricted to named staff behind an access gateway and recorded in audit records; IP addresses not stored in our database and hashed in audit records; server logs that exclude request bodies, tokens, email addresses and raw IP addresses; and regular database backups. No system is perfectly secure. If a breach that puts your rights at risk occurs, we will notify the competent authority and affected people as the law requires. Report vulnerabilities privately to [info@bycoda.codes](mailto:info@bycoda.codes).

## Cookies and local storage

The bycoda.codes website sets no cookies and uses cookieless Umami statistics. The account portal uses only the cookies and storage that Clerk needs to keep you signed in and to remember your language and theme; it also uses Cloudflare Web Analytics, which sets no cookies. The bycoda apps keep preferences and drafts in local storage on your device and sign-in tokens in the secure credential storage. We do not use advertising or cross-site tracking cookies.

## Data on your devices

To provide the workspace, bycoda reads files and folders available under the permissions you grant. It stores settings, project paths, conversations, session status, notes, usage counters, integration metadata and diagnostic information locally. Agent tools can read or modify files and run commands within their permissions. Provider CLIs may also keep their own history, logs and authentication files.

Application history is held in the application data directory, including the local bycoda.db database; preferences may also be held in webview local storage. Connected hosts keep their own databases and logs. Credentials are handled by the applicable integration, provider CLI or local credential storage. Social integration tokens are stored in a locally encrypted vault with an operating-system-protected key. This is not a promise that every local file, log or database is encrypted.

## Network access and third parties

AI agents and provider CLIs send prompts, selected context, attachments, code and tool results to the provider or endpoint configured for that session. Their retention, training, telemetry, billing and privacy rules are controlled by that provider and your account settings, not by bycoda.

Connected Git, inbox, MCP, browser and social features exchange the data necessary for their work with the services you configure. Depending on permissions, this can include repository information, issues, messages, account identifiers, posts, comments and media. Connected services may be polled in the background; authorized scheduled tasks may run later. Remote access and synchronization exchange workspace/session data with your paired devices or configured hosts. Those hosts are under your control or the control of their operator, not the maintainer.

In builds where updates are enabled, update checks and downloads contact GitHub release infrastructure. If you use a bycoda account, the app also contacts the bycoda account service. Registry discovery, installation, external links and remote images may contact their respective services. These services receive ordinary connection information such as your IP address and request metadata and apply their own privacy policies. Reading the bundled policies does not require a network request. See the in-app third-party and data controls notice for provider links.

## Optional social and YouTube features

Connecting a social account allows supported API operations within the permissions you grant: reading account/channel details and comments or messages, uploading media, publishing posts, or replying. Data used for these features is held on your device or chosen host and exchanged with the platform. It is not sent to the maintainer for analytics or advertising.

The optional YouTube integration uses YouTube API Services. [Google's Privacy Policy](https://policies.google.com/privacy) applies to Google's processing. You can revoke authorization through [Google account permissions](https://security.google.com/settings/security/permissions). Using YouTube features is also subject to the [YouTube Terms of Service](https://www.youtube.com/t/terms).

## Optional email and Slack messaging

Connecting an email account (Gmail through Google sign-in or an app password, or any IMAP/SMTP server) or a Slack workspace lets bycoda list your conversations, show messages in the Messages view and send a reply when you press Send. Sign-in happens in your browser; the resulting tokens or passwords are stored in local application data on your device and are never shown in the interface. Messages, contacts and tokens are exchanged directly between your device and Google, Slack or your mail server. They are not sent to the maintainer or to any bycoda server, including when you use a bycoda account. bycoda does not mark email as read.

bycoda's use and transfer of information received from Google APIs adheres to the [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy), including the Limited Use requirements. Gmail data is used only to provide the Messages feature you request; it is not used for advertising, not sold or transferred to others, not read by people, and not used to train AI models.

Slack sign-in returns through `https://bycoda.codes/oauth/slack/`, a static page that only forwards the one-time sign-in code to the bycoda app on your device. It stores nothing, and the code cannot be used without a secret held only by the app.

Remove an account under Settings > Integrations to delete its stored credentials from your device. You can also revoke access in [Google account permissions](https://myaccount.google.com/permissions) or in your Slack workspace's app settings.

## Retention, deletion and control on your devices

Local data remains until you remove it through the available controls or remove the relevant application/provider/host storage. There is no universal automatic expiration period. Archiving or hiding a project is not deletion. Removing a workspace entry does not necessarily remove project files, provider history, backups or remote copies. Uninstalling may leave application data behind.

Disconnect unused accounts, stop scheduled/background work, revoke access at the provider, and remove unneeded data from each device and host. Social account disconnection deletes its local stored token and pauses the account, but retains account metadata and previously stored social records. The Audience screen can export or delete one person's social records; deletion keeps a minimal suppression record. It does not delete published posts or data held by the platform. For a complete local reset, stop the app and host, back up anything you want to keep, and remove their application data and relevant provider storage. This is destructive and affects more than one account. Use the platform's own controls to delete content held there.

The maintainer cannot inspect or remotely delete your local workspace. Email the contact above for guidance or for requests about information you voluntarily sent to the maintainer; bycoda account data is covered by the account retention section above. Requests concerning a connected provider's records should also be directed to that provider. Applicable data-protection rights, including access, correction, deletion, objection and complaints to a competent authority where available, are not removed by this policy.

## Voluntary contact and changes

If you send an email, issue, diagnostic file or other support material, the maintainer receives what you choose to provide and uses it to address the request. Email and GitHub operate under their own policies. Such correspondence is kept only as needed to handle the request and maintain necessary security or project records. Send the minimum information needed and remove secrets before sharing logs.

We may update this policy, for example when providers or features change. Changes are dated at the top and published in the repository, on bycoda.codes and in subsequent app versions; for material changes affecting account holders we also post a notice in the app or portal. This notice describes bycoda; it does not override the policies of services you connect.
