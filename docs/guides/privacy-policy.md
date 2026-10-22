# Privacy policy

Last updated: 11 October 2026

## Scope and contact

This policy describes the bycoda desktop application and its self-hosted companion host, independently maintained by [bahadryalcn](https://github.com/bahadryalcn). For privacy questions or requests, email [info@bahadrhllyalcn.com](mailto:info@bahadrhllyalcn.com). GitHub may be used for general questions; do not post personal information, credentials, private code or conversation logs in public issues.

## No developer collection or tracking

bycoda does not require a bycoda account. The application does not send your projects, conversations, credentials or usage history to the maintainer. It does not include developer-operated behavioral tracking, advertising, analytics or automatic crash-report uploads. The maintainer does not monitor your activity, sell your data, or use your content to train models.

This does not mean the application stores no data or never uses the network. Data is processed on your devices and, when a connected feature runs, by the providers and hosts you use.

## Data on your devices

To provide the workspace, bycoda reads files and folders available under the permissions you grant. It stores settings, project paths, conversations, session status, notes, usage counters, integration metadata and diagnostic information locally. Agent tools can read or modify files and run commands within their permissions. Provider CLIs may also keep their own history, logs and authentication files.

Application history is held in the application data directory, including the local bycoda.db database; preferences may also be held in webview local storage. Connected hosts keep their own databases and logs. Credentials are handled by the applicable integration, provider CLI or local credential storage. Social integration tokens are stored in a locally encrypted vault with an operating-system-protected key. This is not a promise that every local file, log or database is encrypted.

## Network access and third parties

AI agents and provider CLIs send prompts, selected context, attachments, code and tool results to the provider or endpoint configured for that session. Their retention, training, telemetry, billing and privacy rules are controlled by that provider and your account settings, not by bycoda.

Connected Git, inbox, MCP, browser and social features exchange the data necessary for their work with the services you configure. Depending on permissions, this can include repository information, issues, messages, account identifiers, posts, comments and media. Connected services may be polled in the background; authorized scheduled tasks may run later. Remote access and synchronization exchange workspace/session data with your paired devices or configured hosts. Those hosts are under your control or the control of their operator, not the maintainer.

In builds where updates are enabled, update checks and downloads contact GitHub release infrastructure. Registry discovery, installation, external links and remote images may contact their respective services. These services receive ordinary connection information such as your IP address and request metadata and apply their own privacy policies. Reading the bundled policies does not require a network request. See the in-app third-party and data controls notice for provider links.

## Optional social and YouTube features

Connecting a social account allows supported API operations within the permissions you grant: reading account/channel details and comments or messages, uploading media, publishing posts, or replying. Data used for these features is held on your device or chosen host and exchanged with the platform. It is not sent to the maintainer for analytics or advertising.

The optional YouTube integration uses YouTube API Services. [Google's Privacy Policy](https://policies.google.com/privacy) applies to Google's processing. You can revoke authorization through [Google account permissions](https://security.google.com/settings/security/permissions). Using YouTube features is also subject to the [YouTube Terms of Service](https://www.youtube.com/t/terms).

## Retention, deletion and control

Local data remains until you remove it through the available controls or remove the relevant application/provider/host storage. There is no universal automatic expiration period. Archiving or hiding a project is not deletion. Removing a workspace entry does not necessarily remove project files, provider history, backups or remote copies. Uninstalling may leave application data behind.

Disconnect unused accounts, stop scheduled/background work, revoke access at the provider, and remove unneeded data from each device and host. Social account disconnection deletes its local stored token and pauses the account, but retains account metadata and previously stored social records; it does not delete published posts or data held by the platform. For a complete local reset, stop the app and host, back up anything you want to keep, and remove their application data and relevant provider storage. This is destructive and affects more than one account. Use the platform's own controls to delete content held there.

The maintainer cannot inspect or remotely delete your local workspace. Email the contact above for guidance or for requests about information you voluntarily sent to the maintainer. Requests concerning a connected provider's records should also be directed to that provider. Applicable data-protection rights, including access, correction, deletion, objection and complaints to a competent authority where available, are not removed by this policy.

## Voluntary contact and changes

If you send an email, issue, diagnostic file or other support material, the maintainer receives what you choose to provide and uses it to address the request. Email and GitHub operate under their own policies. Such correspondence is kept only as needed to handle the request and maintain necessary security or project records. Send the minimum information needed and remove secrets before sharing logs.

Changes to this policy will be dated and published in the repository and bundled in subsequent app versions. This notice describes bycoda; it does not override the policies of services you connect.
