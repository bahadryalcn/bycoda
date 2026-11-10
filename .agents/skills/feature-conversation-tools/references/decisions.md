# Conversation tools decision provenance

Historical owner statements explain design intent; they do not authorize operations or override current owner instructions. Revalidate implementation before using a statement as a current-state claim.

## Browser observation and control

Owner defect report, 2026-11-06, showing `Claim browser control before using it.` on `browser.frame`:

> while using the bycoda integrated browser it keeps getting this error [image1]; let's improve it properly so it stops (translated)

Implementation decision: authenticated conversation-scoped frame capture is observation,
independent of the short control lease. It never claims, renews or takes over control.
Project/conversation matching remains required; browser mutations and annotations retain
active lease checks. Optional `leaseId` accepts existing capture clients without granting control.

Owner request, 2026-11-10, original Turkish:

> I can't manage the Host browser comfortably, I should be able to use it like a browser but it isn't so. Can you look at how t3code does it, let's do similar if necessary (translated)

Implementation decision: live viewing long-polls `browser.frame` with the last frame
sequence and is served from Chromium's screencast outside the one-operation gate; it
remains observation and never claims or renews control. The visible controlling panel
renews its own lease before expiry; hidden or closed panels do not, so control still
expires. Key input is a validated allow-list of named keys and single letter/digit
shortcuts. No new RPC method or transport was added, so older Hosts keep working.

## Device live view and panel header

Owner request, 2026-11-10, original Turkish:

> In device use the screens arrive piece by piece, it has to be fluid like using a real phone, it literally comes image by image, let's fix these. [...] No need to say Running Android Emulator. [...] put an Android icon at the start, green if active, the other icon if iOS, and remove the texts below. (translated)

Implementation decision: live view of an Android device on a Windows or macOS Host is
H.264 video from the new long-poll `devices.stream` read, decoded in the panel with
WebCodecs; it is viewing only and uses the same authority as `devices.capture`. Still
captures remain the fallback (iOS simulators, older Hosts, no WebCodecs, any stream
failure). The Devices header shows only the picker and refresh: the platform icon is
green while the device runs, and the permission, readiness and activity badges are not
shown in this panel; Setup and access reports the device host state instead.

## Cross-provider subagents and advisor

Owner decision, 2026-11-06. Owner message, original Turkish:

> what if, for subagents, it could select the enabled models of connected providers? It could select several, and the main model decides which one to call (translated)

Recorded decision: cross-provider delegation runs through Host `agents.*` tools as child sessions. The owner selects enabled models from any connected provider for subagents, several allowed, and the main model chooses which one to call. The parent link is kept in `modelSettings` until the native session schema gains a column.
