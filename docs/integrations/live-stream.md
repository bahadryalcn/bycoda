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

| Method                      | Contract                                                                         |
| --------------------------- | -------------------------------------------------------------------------------- |
| `liveStream.status`         | Return connection, OBS state, session totals and a bounded event feed.           |
| `liveStream.start`          | Connect to the public TikTok LIVE identified by `channel`.                       |
| `liveStream.stop`           | Disconnect the current connector and cancel reconnects.                          |
| `liveStream.demo`           | Run the simulated connector.                                                     |
| `liveStream.report`         | Read the current or latest report, or null when no report exists.                |
| `liveStream.obsSetup`       | Enable authenticated local OBS control, launching OBS when it is closed.         |
| `liveStream.obsStream`      | Start or stop the configured OBS broadcast.                                      |
| `liveStream.obsCredentials` | Apply the owner-supplied server and key to OBS.                                  |
| `liveStream.eulerKey`       | Save or clear the optional Euler API key.                                        |
| `liveStream.live.accounts`  | List available Social destinations as account ID, label and platform.            |
| `liveStream.live.status`    | Read the managed broadcast: overall state and one entry per destination.         |
| `liveStream.live.start`     | Start an approved broadcast for `accountIds` (1 to 6, unique), optional `scene`. |
| `liveStream.live.stop`      | Cancel a pending start or stop OBS, the relays and every platform broadcast.     |

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

## Several accounts at once

`liveStream.live.start` takes one to six unique Social accounts. TikTok and
Instagram are vertical and go out on the Aitum Vertical canvas; YouTube,
Facebook, LinkedIn and X are horizontal and use the main OBS canvas. The Host
acquires every ingest first and ends the ones it created if any acquisition
fails. Then it starts the relays and the OBS outputs, and only then asks each
platform to go live. Stop reverses the order: OBS outputs, relays, platform
broadcasts, then the owner's OBS stream service is restored.

- One account on a canvas goes straight from OBS to the platform.
- Several accounts on a canvas share a local `ffmpeg` relay (`host/live-stream/relay.ts`):
  `ffmpeg -listen 1` on `127.0.0.1` with a random path token copies the stream
  with the `tee` muxer and `onfail=ignore`, so one failing platform never stops
  the others. ffmpeg must be on PATH, otherwise the start fails with
  `RELAY_UNAVAILABLE`. Stream keys are in the ffmpeg command line, readable by
  other processes of the same Windows user. Host code redacts every ingest URL
  and key from relay output; a lost destination shows as `RELAY_FAILED` in its
  status entry. A relay accepts one OBS connection and does not outlive it.
- Aitum's output 0 must already exist in the Vertical settings; the Host sets its
  server and key over the `aitum-vertical-canvas` obs-websocket vendor and
  starts it with `start_streaming`. Aitum's previous server and key cannot be
  read back, so they are overwritten and, after Stop, parked on
  `rtmp://127.0.0.1/off`. A missing plugin (vendor answers code 600), a missing
  canvas or an output that never streams fails with `VERTICAL_CANVAS_UNAVAILABLE`
  before or right after start, and the main canvas is stopped again.
- Status lists each destination as `starting`, `streaming`, `failed` or `ended`
  with its orientation and reason. If every destination failed the overall
  state is `uncertain` and Stop stays available.
- Budget upload as each canvas bitrate times its destinations, summed over both
  canvases, and keep it under about 75% of the available upload.
- The native approval for `liveStream.goLive` lists every account and the scene.

## Credentials

OBS WebSocket is configured locally. The Host stores the generated OBS password,
Euler API key and optional stream key in its credential store. OBS manages its
local server authentication and streaming destination. The TikTok connector
reads public events with `tiktok-live-connector@2.5.0`. The integration supplies
no TikTok cookies and leaves WebSocket authentication disabled. Review the
connector's AGPL-3.0 license before distributing a build.
