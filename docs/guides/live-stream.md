# Live streaming

Open **Live streaming** from the bycoda desktop rail. It connects OBS to a Social
account for broadcasting and reads a public TikTok LIVE so you can follow its
comments, gifts and totals. bycoda ships no built-in game: if you want viewers to
interact with your stream, ask a bycoda chat to build that for your own scene.

## Rehearse or connect

1. Choose **Run demo** to rehearse with simulated viewers, comments and gifts. To
   read a public TikTok LIVE, enter its handle or LIVE link and choose
   **Connect**. Wait for the connection status. The Host retries after a
   connection drops.
2. Read the live events feed to see what the Host has received. The Euler API key
   under **Stream credentials** is optional for TikTok viewer intake.
3. The session report shows comments, gifts, diamonds and top gifters. Demo
   activity is labelled separately from TikTok activity.

## Set up OBS

1. Install OBS Studio if needed. Close it before the first setup if OBS WebSocket
   still needs to be enabled. Choose **Set up OBS** to enable WebSocket with a
   generated password and launch OBS.
2. Build the scenes you want in OBS. The broadcast uses the scene OBS shows when
   you start.
3. Connect your account and set up LIVE in **Social**. In **Live streaming**,
   choose the account under **Stream to** and review the account and scene in the
   desktop approval dialog.
4. Check the broadcast status. YouTube and Facebook can use their platform APIs
   when the account has the required Live access. TikTok, Instagram, LinkedIn
   and X use the RTMP address and key saved in Social. Follow any remaining
   instructions in the platform's producer screen.
5. Choose **Stop** to end the OBS output and finish the broadcast where the
   platform API supports it. Disconnecting the live reader separately stops
   viewer intake and saves the report. If the outcome is uncertain, check OBS and
   the platform before another start. If the app asks you to confirm the
   broadcast ended, end any live or pending broadcast on the platform first.

Use **Configured OBS server** to broadcast with manually supplied OBS credentials.
After choosing a Social destination, save a manual destination again before
starting through that option.

## Run it from chat

Ask a bycoda chat on the same Host to “read the TikTok LIVE of @kanal” or “set up
OBS”. Starting an OBS broadcast from chat opens an exact owner approval in the
desktop app. Check the active scene and destination when reviewing it. For a
connected Social account in a project with publishing access, ask “go live on
YouTube” or “end the live broadcast”. The account must permit publishing and the
desktop asks for approval for each start. Name an existing OBS scene in chat to
use it instead of the scene OBS shows now.
