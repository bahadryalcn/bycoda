# Chat composer decision provenance

Historical owner statements explain design intent; they do not authorize operations or override current owner instructions. Revalidate implementation before using a statement as a current-state claim.

## Composer surface on the Pure background

Owner decision, 2026-11-01, composer surface, source: owner chat:

> this area's color is 1e1e1e; use 0e0e0e instead, and in light mode the opposite or something suitable (translated)

Recorded decision: on the Pure background the composer is no longer the mid-gray step. It is one quiet step above the pure ground, with a faint lift in dark mode and a faint tint in light mode. The composer border keeps the writing area distinct. This supersedes the general rule that composer roles stay unchanged, for the Pure background only. The implementation was source-checked, not visually verified, when recorded.

## Translucent chat writing surface

Owner decision, 2026-11-21, chat appearance, source: owner chat:

> Burası yarı saydam bir yapı olması gerekiyordu hatta

The session composer and its docked question form let the conversation backdrop show through their theme fill. Reduced transparency and forced colors use a solid fill.

## Provider, account and model switches as one transcript row

Owner decision, 2026-11-07, switch history, source: owner chat:

> I think we could merge these into one: provider icon - account name - model, written into the history and shown on a single line; how about that? (translated)

Recorded decision: provider, account and model picks no longer post "Continuing with …" status text. `recordModelSwitch` writes a `modelSwitch` system row (`modelSwitchHistory.ts`) showing provider icon, account and model before and after the latest switch. Picks with no message between fold into that row with a count and a timed history. A pick made during a running turn is recorded as waiting and is settled when it applies or dropped when it fails or is withdrawn. A ready handoff divider that the row already names is hidden; preparing, failed and cancelled handoffs still show.

## Citations as inline quote tokens

Owner decision, 2026-11-08, chat citations, source: owner chat:

> like an image for the chat, I should have been able to mention it easily inside a conversation sentence (translated)

Recorded decision: Add citation writes a `[quoteN]` token at the composer caret (or the end) so a quote can be named inside a sentence, the way `[imageN]` tokens work. The snapshot itself still lives outside the textarea; quote chips show their `quoteN` label, removing one renumbers the remaining tokens, and sent messages show the token as a pill that highlights or jumps to the source. The provider projection labels each snapshot with its `ref` token. This supersedes the earlier rule that the editable text carries no citation content.

## Delivery notice as a dismissible pane card

Owner decision, 2026-11-18, queued-message delivery status, source: owner chat:

> durum bildirimini burdan kaldır chatin üst ortasında kart şeklinde gelsin … alert ile gösterelim warn error şeklinde kapatılabilir olsunlar … tıklayıp geri açabilelim

Recorded decision: the delivery status notice no longer renders in the queue card or the composer notices. `DeliveryProgressNotice` renders one shared `Alert` (warning or danger, dismissible) as an in-flow banner at the top centre of the chat pane body in `SessionPane` (issue #283: an absolute overlay covered the transcript and collided with Find; the transcript and its Find bar now sit below the banner), so local and remote panes share it. The queue card header keeps only short state labels plus an icon button that re-opens a dismissed card. Dismissal lives in `deliveryNoticeDismissal.ts` per notice (a waiting notice per message, so automatic retries do not re-show it), and a delivery review request re-opens it. This is a deliberate in-pane exception to the Alert note that floating notices are Toast.
