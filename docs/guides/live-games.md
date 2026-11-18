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
3. Set the stream server and key in Live games. Paste private values into the
   credential fields. The Euler API key is optional for public TikTok intake.
4. Use the separate OBS start and stop controls for broadcasting. Disconnecting
   the game stops viewer intake and saves the report. Stop OBS to end a broadcast.

The report shows observed joins, top gifters and diamonds. Demo activity is
labelled separately from TikTok activity.

## Run Halay from chat

Ask a bycoda chat on the same Host to “start Halay on @kanal”, “set up OBS for
portrait” or “make the Rose gift trigger fireworks”. The AI uses the same Host
game state as the controls. Starting an OBS broadcast from chat opens an exact
owner approval in the desktop app. Check the active scene and destination when
reviewing it.
