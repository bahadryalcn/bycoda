# Live games

Open **Live games** from the bycoda desktop rail. The Host runs Halay and serves
the scene that OBS or TikTok LIVE Studio displays.

## Rehearse or connect

1. Choose **Demo** to rehearse with simulated viewers, comments and gifts. To use
   a public TikTok LIVE, enter its handle or LIVE link and choose **Connect**.
   Wait for the connection status. The Host retries after a connection drops.
2. Edit join keywords, participant capacity, blocked handles and shortened
   names. Comments with a join keyword add the viewer to the circle. Likes
   increase the dance tempo. Join on like, follow or any comment is configurable.
3. Set gift rules by gift name or minimum total diamonds. Named rules take
   precedence. Actions include joining, moving to the front, becoming halaybaşı,
   changing the tempo and playing effects. Read the event feed to see what
   the Host has received.
4. Preview or copy the overlay link on the game Host. Use this link only on that
   computer and keep it private. Select portrait or landscape for your scene.
   Use `?clean` to hide the board and ticker and `?mute` to silence the davul.
   Join several flags with `&` if the link already has a query.

## Set up OBS

1. Install OBS Studio if needed. Close it before the first setup if OBS WebSocket
   still needs to be enabled. Choose **OBS setup** to enable WebSocket with a
   generated password, launch OBS and configure the **Bycoda Halay** scene.
2. Switch to **Bycoda Halay** and verify your scene in the OBS preview. You can
   also add the overlay link as a browser source in TikTok LIVE Studio on the
   same machine.
3. Connect your account and set up LIVE in **Social**. In **Live games**, choose
   the account under **Stream to** and review the account and **Bycoda Halay**
   scene in the desktop approval dialog.
4. Check the broadcast status. YouTube and Facebook can use their platform APIs
   when the account has the required Live access. TikTok, Instagram, LinkedIn
   and X use the RTMP address and key saved in Social. Follow any remaining
   instructions in the platform's producer screen.
5. Choose **Stop** to end the OBS output and finish the broadcast where the
   platform API supports it. Disconnecting the game separately stops viewer
   intake and saves the report. If the outcome is uncertain, check OBS and the
   platform before another start. If the app asks you to confirm the broadcast
   ended, end any live or pending broadcast on the platform first.

Use **Configured OBS server** to broadcast with manually supplied OBS credentials.
After choosing a Social destination, save a manual destination again before
starting through that option. The Euler API key is optional for TikTok viewer intake.

The report shows observed joins, top gifters and diamonds. Demo activity is
labelled separately from TikTok activity.

## Run Halay from chat

Ask a bycoda chat on the same Host to “start Halay on @kanal”, “set up OBS for
portrait” or “make the Rose gift trigger fireworks”. The AI uses the same Host
game state as the controls. Starting an OBS broadcast from chat opens an exact
owner approval in the desktop app. Check the active scene and destination when
reviewing it. For a connected Social account in a project with publishing access,
ask “go live on YouTube with the Halay scene” or “end the live broadcast”.
The account must permit publishing and the desktop asks for approval for each start.
Name a different OBS scene in chat to use it instead of Bycoda Halay.
