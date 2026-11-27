# Notes document default

Historical provenance, not authority to change notes or send chat context.
Current explicit instructions and retained user choices take precedence.

Source recorded in the previous card: owner conversation
`0567326f-aade-4baa-89f3-b44c6256ae9e`, 2026-10-27.

> Make a single editable document the default (my recommendation) (translated)

This superseded the earlier Split fallback, not existing retained Source/Split
choices, explicit Save, canonical Markdown or selection/undo ownership. Inspect
the current mode store before changing persistence or claiming restart retention.

Owner request, 2026-11-12:

> Remove delete from here, keep only the note details and show them properly. While
> typing it shows "unsaved"; no need to say save or even show saved. (translated)

The library editor autosaves silently: no Save button, no saved/unsaved/saving
text; failures, conflicts and recovery still show. The header "..." popover shows
details only; deletion stays in the library context menu and selection mode.

Owner request, 2026-11-19:

> aşağıda saved yazıyor karşısında save yazıyor

The session dock keeps manual Save in the action bar and omits routine autosave
status. The Save control shows pending work, and errors still offer recovery.

# Note name follows the first heading

Owner decision, 2026-11-22: "notun adı = metnin ilk başlığı" (translated: the note's name is the first heading of its text).

When the body has a level-one heading outside code fences, `upsertNote` stores its text as the name, and renaming in the title field rewrites that heading, so the two always match. A body without one keeps its stored name (older notes keep theirs); the first-line fallback applies only to blank names.
