# Conversation tools decision provenance

Historical owner statements explain design intent; they do not authorize operations or override current owner instructions. Revalidate implementation before using a statement as a current-state claim.

## Cross-provider subagents and advisor

Owner decision, 2026-11-06. Owner message, original Turkish:

> subagent için bağlı providerların modellerinin açık olanlarını seçebilse? Birden fazlada seçebilse ve ana model hangisini çağıracağına kendi karar versin

Recorded decision: cross-provider delegation runs through Host `agents.*` tools as child sessions. The owner selects enabled models from any connected provider for subagents, several allowed, and the main model chooses which one to call. The parent link is kept in `modelSettings` until the native session schema gains a column.
