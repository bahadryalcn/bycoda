# Voice decision provenance

These are historical owner inputs, not current install/operation authorization.
Source references identify the original card's provenance; they are not acceptance.

- 2026-10-27, voice visual styles brief, owner session `d0872f7e`, source
  `temp/local/voice-visual-styles/BRIEF.md`:

  > these are nice; at least let the user choose among them, let us do this and have users make the integration and choices appropriately (translated)

  Consequence: preserve user-selectable visuals, not literal prototype colors.

- 2026-10-31, owner chat during "Local voice could not start" investigation:

  > okay, let us do it; let the user choose by themselves too (translated)

  Recorded context: processing-device choice and GPU setup. Preserve the choice;
  this quote does not authorize installing packages in a later task.

- 2026-11-01, task `voice-cough-filter-20261101`:

  > Even if I cough, in the voice companion you respond as if I had said something new. (translated)

  Consequence: preserve speech admission/rejected-candidate recovery. Historical
  recordings, benchmark results and test totals do not prove current acoustic behavior.

- 2026-11-02, assistant planning thread
  `<thread://v2/15734b99-a80b-45f4-a843-7d4a6394daf7/aa57a631-84d9-4a94-aeb7-4e1c00709b07>`,
  approved implementation plan sections F0/F1a:

  > only the user turns on the microphone anyway (translated)

  Consequence: returning from sleep is ready with capture closed. Reconnecting
  an existing explicitly opened microphone is separate from opening a new one.

  > the voice assistant should not be usable without configuring certain key settings (translated)

  Consequence: mandatory Host identity and voice verification supersede the
  earlier first-launch persona Skip flow. Preserve legacy keys as migration
  backups; a persona reset does not clear completed Host identity.

  > let (the assistant) be able to start the conversation if wanted, and let us make this configurable in settings too (translated)

  Consequence: allowed proactive speech uses output only, respects quiet hours,
  presence and owner interruption rules, and never opens microphone capture.

- 2026-11-10, owner chat during the voice operator program (translated):

  > add it as a setting. When I come back it should call out to me; if I do not answer, the microphone must close after a while, show a warning on screen and send a notification, like "I called you but you didn't hear"

  Consequence: an opt-in, default-off "call me when I return" setting may open
  capture on return for a bounded window after speaking. No reply within the
  window closes capture, shows an on-screen notice and sends a notification.
  This setting supersedes the 2026-11-02 "return keeps the microphone closed"
  rule only while it is on; with it off, return stays Ready with capture closed.
