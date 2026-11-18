# Live games integration

The Host owns one Halay session per environment. The TikTok and demo connectors
publish normalized events to the reducer. The desktop and overlay render Host
snapshots. Reconnects retain game state. An explicit stop cancels reconnects and
saves the session report. Disconnecting game intake and stopping OBS are separate
operations.

## Owner RPC

The shared `liveGames.v1` schemas and result types live in
[`live-games.ts`](../../src/shared/model/host-contracts/live-games.ts).
All arguments are validated at the Host boundary.

| Method                     | Contract                                                                                         |
| -------------------------- | ------------------------------------------------------------------------------------------------ |
| `liveGames.status`         | Return connection, settings, OBS state, overlay URL and a bounded event snapshot.                |
| `liveGames.start`          | Connect to the public TikTok LIVE identified by `channel`.                                       |
| `liveGames.stop`           | Disconnect the current connector and cancel reconnects.                                          |
| `liveGames.demo`           | Run the simulated connector.                                                                     |
| `liveGames.setRules`       | Replace gift rules with `rules`.                                                                 |
| `liveGames.setConfig`      | Patch only the supplied settings in `patch`.                                                     |
| `liveGames.report`         | Read the current or latest report, or null when no report exists.                                |
| `liveGames.obsSetup`       | Configure the installed OBS and the Halay scene, using the requested aspect and overlay options. |
| `liveGames.obsScene`       | Switch OBS to Bycoda Halay.                                                                      |
| `liveGames.obsStream`      | Start or stop the configured OBS broadcast.                                                      |
| `liveGames.obsCredentials` | Apply the owner-supplied server and key to OBS.                                                  |
| `liveGames.eulerKey`       | Save or clear the optional Euler API key.                                                        |

Conversation Tools reuse the schemas for the finite game and OBS operations.
A session or Room thread must still be authorized. Room writes need Host-wide
permission. The AI results omit the
overlay token and avatar URLs. The two credential methods are owner RPC only.
Starting a broadcast from chat uses a separate exact native approval.

## Local overlay and credentials

The HTTP overlay requires loopback access and a bearer token. The Canvas2D and
WebAudio bundle loads from the Host so a browser source can render without
frontend credentials or network assets. A server-sent event connection sends an
initial snapshot and then game snapshots and one-time effect cues. Use the
Host-provided URL and keep it out of transcripts and shared logs.

OBS WebSocket is configured locally. The Host stores the generated OBS password,
Euler API key and optional stream key in its credential store. OBS manages its
local server authentication and streaming destination. The TikTok connector
reads public events with `tiktok-live-connector@2.5.0`. The integration supplies
no TikTok cookies and leaves WebSocket authentication disabled. Review the
connector's AGPL-3.0 license before distributing a build.
