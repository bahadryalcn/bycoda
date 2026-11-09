# Conversation tools decision provenance

Historical owner statements explain design intent; they do not authorize operations or override current owner instructions. Revalidate implementation before using a statement as a current-state claim.

## Browser observation and control

Owner defect report, 2026-11-06, showing `Claim browser control before using it.` on `browser.frame`:

> while using the bycoda integrated browser it keeps getting this error [image1]; let's improve it properly so it stops (translated)

Implementation decision: authenticated conversation-scoped frame capture is observation,
independent of the short control lease. It never claims, renews or takes over control.
Project/conversation matching remains required; browser mutations and annotations retain
active lease checks. Optional `leaseId` accepts existing capture clients without granting control.

## Cross-provider subagents and advisor

Owner decision, 2026-11-06. Owner message, original Turkish:

> what if, for subagents, it could select the enabled models of connected providers? It could select several, and the main model decides which one to call (translated)

Recorded decision: cross-provider delegation runs through Host `agents.*` tools as child sessions. The owner selects enabled models from any connected provider for subagents, several allowed, and the main model chooses which one to call. The parent link is kept in `modelSettings` until the native session schema gains a column.
