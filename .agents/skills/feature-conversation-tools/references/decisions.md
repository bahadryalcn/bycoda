# Conversation tools decision provenance

Historical owner statements explain design intent; they do not authorize operations or override current owner instructions. Revalidate implementation before using a statement as a current-state claim.

## Browser profile access

Owner request, 2026-11-25:

> profil import filanda ekliyelim hangi profili kullanabileceklerini seçsin kullanıcılar. hatta şunu kullan diye söylersede onu kullansın.

Imported browser state belongs to the local Host and seeds separate browser
contexts. Agent use requires an explicit per-profile grant and may select the
profile by name or ID.

Owner request, 2026-11-25:

> varsayılan profil yapalım birde geliştirme profili olsun geliştirme profilide izole de olabilsin var olan profilde olabilsin.

Regular URLs use the default selection. Loopback URLs use the development
selection. Both are independent of agent grants and may use a clean context.
Claude in Chrome uses the provider's own connection and site approvals.

## Browser observation and control

Owner request, 2026-11-24:

> aynı pc deyse yerel önizleme yapalım bizde?

Implementation decision: manual loopback previews on the desktop's own
computer open directly in a separate native view. Remote URLs retain their
selected Host, and explicitly shared browsing retains the existing browser
scope and control.

Owner defect report, 2026-11-06, showing `Claim browser control before using it.` on `browser.frame`:

> while using the bycoda integrated browser it keeps getting this error [image1]; let's improve it properly so it stops (translated)

Implementation decision: authenticated conversation-scoped frame capture is observation,
independent of the short control lease. It never claims, renews or takes over control.
Project/conversation matching remains required; browser mutations and annotations retain
active lease checks. Optional `leaseId` accepts existing capture clients without granting control.

Owner request, 2026-11-10, original Turkish:

> I can't manage the Host browser comfortably, I should be able to use it like a browser but it isn't so. (translated; comparison omitted)

Implementation decision: live viewing long-polls `browser.frame` with the last frame
sequence and is served from Chromium's screencast outside the one-operation gate; it
remains observation and never claims or renews control. The visible controlling panel
renews its own lease before expiry; hidden or closed panels do not, so control still
expires. Key input is a validated allow-list of named keys and single letter/digit
shortcuts. No new RPC method or transport was added, so older Hosts keep working.

Owner request, 2026-11-23:

> control alma kapatma var ya bunuda kaldıralım kontrol hep olsun.

Implementation decision: the visible desktop Browser panel acquires and renews
available control automatically. It retains the Host lease and waits when
another controller owns the page. The preview handles keyboard and pointer
input directly. Setup appears when the Host reports it is needed.

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

## Automatic desktop device control

Owner request, 2026-11-23.

> control alma kapatma var ya bunuda kaldıralım kontrol hep olsun. gereksiz bir buton ve akış bu.

The visible desktop Devices panel acquires control of the selected running device through
the existing Host lease. It releases control on hide or target change and waits if another
controller holds the device.

## Android video subscription and live touch

Owner request, 2026-11-23. Add live Android video and touch.

Android video uses a bounded subscription on the authenticated Host connection. Drag sends
live touch through the same lease as other device actions. A gesture can be cancelled without
turning it into a tap. Older Hosts retain cursor reads and release-time gestures. See
[`docs/integrations/devices.md`](../../../../docs/integrations/devices.md) for the transport.

## Cross-provider subagents and advisor

Owner decision, 2026-11-06. Owner message, original Turkish:

> what if, for subagents, it could select the enabled models of connected providers? It could select several, and the main model decides which one to call (translated)

Recorded decision: cross-provider delegation runs through Host `agents.*` tools as child sessions. The owner selects enabled models from any connected provider for subagents, several allowed, and the main model chooses which one to call. The parent link is kept in `modelSettings` until the native session schema gains a column.

## Detached tool views

Owner decision, 2026-11-24 (translated):

> If it already follows, remove this button.

The detached window follows conversation focus automatically. Its selector switches between open tool views until the next focus change.

## Device settings

Owner decision, 2026-11-25. Device settings should be editable in bycoda.

Recorded decision: Settings > Tools > Devices adds **Use devices** (desktop preference
that hides the Devices tool), **Agents can use devices** (the local Host's `agentDevices`
setting; the Host refuses agent and assistant `devices.*` calls while it is off) and
**Device sources** built on saved bycoda machines. Sources need bycoda Host on the
other computer; direct SSH device hosts without a Host were left out of scope.
