# Live streaming integration

The Host owns one live session per environment. The TikTok and demo connectors
publish normalized events to a counter that keeps totals, viewers and top
gifters. Reconnects retain those numbers. An explicit stop cancels reconnects and
saves the session report. Disconnecting the live reader and stopping OBS are
separate operations.

## Owner RPC

The shared `liveStream.v1` schemas and result types live in
[`live-stream.ts`](../../src/shared/model/host-contracts/live-stream.ts).
All arguments are validated at the Host boundary.

| Method                      | Contract                                                                      |
| --------------------------- | ----------------------------------------------------------------------------- |
| `liveStream.status`         | Return connection, OBS state, session totals and a bounded event feed.        |
| `liveStream.start`          | Connect to the public TikTok LIVE identified by `channel`.                    |
| `liveStream.stop`           | Disconnect the current connector and cancel reconnects.                       |
| `liveStream.demo`           | Run the simulated connector.                                                  |
| `liveStream.report`         | Read the current or latest report, or null when no report exists.             |
| `liveStream.obsSetup`       | Enable authenticated local OBS control, launching OBS when it is closed.      |
| `liveStream.obsStream`      | Start or stop the configured OBS broadcast.                                   |
| `liveStream.obsCredentials` | Apply the owner-supplied server and key to OBS.                               |
| `liveStream.eulerKey`       | Save or clear the optional Euler API key.                                     |
| `liveStream.live.accounts`  | List available Social destinations as account ID, label and platform.         |
| `liveStream.live.status`    | Read the active or last managed broadcast and the OBS output when available.  |
| `liveStream.live.start`     | Start an approved local broadcast for `accountId` with optional `scene`.      |
| `liveStream.live.stop`      | Cancel a pending start or stop the OBS output and end the platform broadcast. |

Conversation Tools reuse the schemas for the finite live and OBS operations.
A session or Room thread must still be authorized. Room writes need Host-wide
permission. The AI results omit avatar URLs. The two credential methods are owner
RPC only. Starting a broadcast from chat uses a separate exact native approval.

## Social broadcast

Live streaming checks OBS setup and the requested scene before provisioning an
ingest. `scene` names an existing OBS scene; without it the scene OBS shows when
the request arrives is used. Social checks the current account, project
publishing grant, autonomy and global stops at the relevant dispatch points.
Desktop chat approval binds the account and effective scene to the current
request. The owner desktop path uses the same approval dialog as configured OBS
broadcasts. Only Host code handles the ingest address and key. The Host passes
both to authenticated local OBS and exposes only status and reason codes.

On YouTube, the Host binds an eligible broadcast to its RTMP stream, starts OBS
and waits for ingest readiness before requesting the live transition. On
Facebook it creates a Page Live video and supplies the returned ingest to OBS.
New broadcasts use the chosen scene name as their title.
Stop checks OBS output, then completes or ends the known provider broadcast.
For copied credentials, the owner handles any publish or finish step in the
producer screen. TikTok viewer intake is independent of these operations.

The Host saves a recovery record without credentials before dispatching an OBS
start or a provider write. Read status after lost responses. An unconfirmed
start is never automatically retried. Stop acts on the known broadcast ID and
asks the owner to inspect the platform if the ID could not be recovered. Once
the owner has ended any pending or live broadcast in the producer screen,
**Confirm broadcast ended** clears the recovery record. Manual
OBS controls require a newly saved manual destination after managed credentials
were applied. That prevents restarting a Social broadcast through the manual
path.

## Credentials

OBS WebSocket is configured locally. The Host stores the generated OBS password,
Euler API key and optional stream key in its credential store. OBS manages its
local server authentication and streaming destination. The TikTok connector
reads public events with `tiktok-live-connector@2.5.0`. The integration supplies
no TikTok cookies and leaves WebSocket authentication disabled. Review the
connector's AGPL-3.0 license before distributing a build.
