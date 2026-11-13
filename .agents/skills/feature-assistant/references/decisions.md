# Assistant decision provenance

Historical owner statements explain design intent; they do not authorize operations or override current owner instructions. Revalidate implementation before using a statement as a current-state claim.

## Voice-first Room and consolidated access

Owner decision, 2026-11-13: "sohbet ekranları çok kıymetli değil bu zaten sesli asistan" and "Ayarlarda filan gereksiz tekrar lı izinler var bunlarıda tek yerde toplayalım herşeye izin verdiyse herşeydir". The Room prioritizes current work and owner decisions; typed conversation remains available. Access settings consolidate supported grants under one explicit choice, with individual controls disclosed for custom configurations. Existing grants are not silently upgraded; Full access must reflect all participating grants rather than only job execution.

## Messaging conversation layout

Owner decision, 2026-11-05, confirming the 2026-11-04 Arif chat direction. Recorded decision: the personal assistant chat, social direct messages and any person-to-person or person-to-assistant thread use the messaging layout. The owner's messages sit on the right and the other party on the left, in bounded-width bubbles one quiet step above the canvas. Day separators, a small time under each bubble and a compact composer at the bottom are used. Enter sends and Shift+Enter breaks a line. Voice and send are separate controls that never overlap.

## Model pool

Owner decision, 2026-11-10 (translated): workers must use only the selected models, in priority order, with editable order, effort and account, and priorities may follow remaining limits, so subscriptions are managed safely. When a model hits its limit, new tasks move to the next model; a running session never switches model and resumes after the reset; if the whole pool is limited, work waits and the owner is notified.

## Assistant folders

Owner decision, 2026-11-11 (translated): "This setting should not even be needed; I already gave every permission." A whole drive and the home folder may be Assistant folders. System folders and credential folders stay refused, both as a chosen folder and for every path the folder tools touch inside one.

## Availability states

Owner decision, 2026-11-11 (translated): "Availability somehow becomes unknown, but that cannot happen: I am either at the PC, busy, away or offline. There is no other possibility." Availability has no unknown state. A computer that cannot be read counts as away, a failed read keeps the last good reading for five minutes, and the desktop shows offline only when it has no status from the Host.

Owner decision, 2026-11-13 (translated): "I am at the computer actively using bycoda but it shows Away; let's fix these and make it better." The availability menu checks the owner's own choice, not the automatic reading; activity in a focused bycoda window or choosing Here rereads an idle or away computer within seconds; a failed desktop read is logged.

## Host-wide model routing

Owner decision, 2026-11-12: "The assistant's models come from routing roles assistant.worker|planning|chief|reply." Model order, limits and accounts live in Settings > Models. Read-only pool operations expose the main order. Execution permissions and run deadlines remain on the profile. The 2026-11-10 priority, frozen running-session identity and wait-with-one-notice decisions still apply. Local voice replies follow voice.reply; cloud realtime models remain fixed.
