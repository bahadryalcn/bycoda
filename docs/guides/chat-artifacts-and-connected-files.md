# Inspect chat output and connected-machine files

Tool rows keep the conversation compact. Use **Changes** beside an edit or the output chevron beside a command to inspect its saved code, patch, or result. Expanded text can be selected and copied. A failed call shows its error before any earlier output.

Subagent rows show status, elapsed time and step counts beside the name, before the disclosure arrow. Failed-step counts appear in red; a failed step does not mean the entire run failed.

## Image attachments

Image attachments show small previews in the conversation, including saved images
from earlier messages. Previews load as their cards approach the visible area.
Click a preview to open it full screen; Escape returns to the conversation.
If loading fails, click the image icon to retry. Missing files stay marked as missing.

Pasted images are saved before they are accepted as attachments, so their file
reference survives closing and reopening the app. If an older message saved only
image metadata without a file reference, attach the original image again; its
name and size cannot restore the missing picture.

## Visual explanations

The assistant can include a diagram, comparison or interactive example directly
in its reply when it helps explain the answer. Each visual has a short subject
title and one compact toolbar. The icons show the original **Source**, **Reload
preview**, **Open in panel** and **Expand**; hover or focus an icon for its label.
The side panel can be resized while you continue using the conversation. Close
it or press Escape to return to the inline view. Switching to source and back
keeps the current preview running; reloading starts the example again.

Visuals are saved with the conversation. They cannot access your files, the
network or application actions. A visual is an explanation or prototype, not an
implemented change to your project. Unsupported clients retain the source result.

## Quote and translate selected text

Select text in a message to open actions beside the selection. **Copy** copies the excerpt. **Reprompt** is available only for your own messages; translation remains available on replies too.

Selection actions stay on one row. In a narrow window, scroll the action row horizontally or use its arrow keys to reach the remaining actions.

Use **Add citation** to attach the excerpt to your next message, with an optional comment. The reference appears above the writing area without replacing your draft. Reference labels show the first six words, with an ellipsis for longer text; unusually long words are also shortened. The full quote remains available in its tooltip and details. You can edit its comment, copy the excerpt, or remove the reference. Draft recovery keeps the quote and comment together. Sending includes the literal excerpt, your comment, and the source message identity as read-only context.

Hover or focus a reference to briefly highlight its exact source without scrolling. Click it to return to the source in the current conversation. If the source has changed or is unavailable, the saved quote remains readable; an equal phrase in another message is never substituted. The information control on a sent reference shows its full excerpt and comment.

Translation previews keep model selection, cancellation and retry. After applying a translation, the compact **Original text / Translation** control switches the displayed version. **Copy** copies that version. **Close translation** dismisses the control without deleting the translation or changing saved message text.

These details describe the tool call at that point in the conversation. They do not reread the current file and present it as historical output. New code details are bounded to keep long conversations responsive; subagent history has a shared retention budget. When only an older shortened preview remains, the viewer says so.

## Working and follow-up messages

While a turn is open, **Queue message** or **Shift+Tab** saves your message for
after that turn finishes, including while the AI waits for background commands.
**Steer** sends a follow-up to the current turn instead. If a server or watcher
keeps the turn open, queued messages keep waiting; use the queued row's **Steer**
action to send one immediately.

When the AI asks a question with a free-text answer, use **Attach files**, paste copied files or images, or drop files onto the question card. Attached items appear below the answer; remove an item before sending if needed. You can send files without adding text. Unfinished attachments stay with that question when you leave and return, and failed delivery keeps them for retry.

Question attachments are saved as files on the computer running the conversation. The AI receives file references and reads them with its tools. Structured forms that require exact typed values do not accept attachments in those fields.

Sending a follow-up while the agent is working keeps the current execution's
subagents and background commands in **Working**, including their progress and
original elapsed time. It does not start a separate activity list. Their rows
continue to reflect provider updates; a genuinely new execution starts its own list.

The lead agent finishing its reply does not finish the session while its subagents
are still running. **Working** keeps their rows and progress visible and shows the
remaining work. You can send another message to the same conversation or use
**Stop all**. A child is finished only when its provider reports a terminal outcome;
an interrupted or failed child is not shown as successfully completed.

Failed step counts appear in red in the activity list and agent details. A failed
step does not mean the whole agent failed: running agents keep their active status,
completed agents use green, and stopped or interrupted agents use warning colors.

## Earlier conversation after a provider or model change

Claude advisor menus in chat and provider Settings show compatible versions from
the enabled model catalog, such as **Opus 5.5** and **Fable 5.1**. Moving aliases
use their catalog-reported target version. Saved advisor choices remain visible
when unavailable; changing the main model does not silently replace them.

With decorative motion enabled, selecting a provider or model briefly shows its
provider icon beside “Ready to work together”. Reduced motion hides this acknowledgment.

When a switch needs a conversation handoff, bycoda saves the earlier messages on
the conversation's owning computer. It includes as much history and recap as the
target model's context budget allows, followed by a reference to the saved history.

If even the reference cannot fit, your message still sends. An information row
explains that the earlier conversation was not transferred and shows the saved
history path. The current message is preserved in full; the provider may still
reject a request that exceeds its actual limit. Native reasoning and tool state
are not transferred.

Previous attachment names, file references and owning computers are retained in the saved history, including messages containing only an attachment. A pasted item without a saved file reference is identified as retained in the conversation; the archive does not silently reload its bytes or grant another computer file access. Recovered conversation context is saved with the archive rather than replayed twice.

If a provider switch fails or is cancelled, its divider shows that result instead of remaining on Preparing. You can select another provider and use Retry with the preserved request and attachments. A retry still waits for the original provider to close safely; an unresolved cleanup error does not send a duplicate request to the new provider.

## Documents, tables, and media

Pasted and selected attachments show their filename, type and size in a bordered
card. Images include a thumbnail; audio, video, PDF, Markdown and other files use
their own icons. Reference labels connect each card to the highlighted reference
in your draft and message. Removing a card retains the existing reference-removal
behavior. In the composer and queue editor, caret movement and selections treat a
resolved reference as a whole. A missing or unavailable preview never removes the
attachment.

Click a chat attachment or a generated file link to open it. PDF, Word, Excel, CSV, and TSV use document/table viewers. Video and audio use native playback controls. Codec support depends on the operating system; the default-app action is available when a file path can be opened on this computer.

CSV and TSV file tabs offer **Preview** and **Source**. Switching views retains source edits. The preview displays the saved file; unsaved changes remain in Source. Delimited values are displayed as text, without evaluating formulas.

Document previews are limited to 25 MiB. Connected project files are checked before downloading. Large media uses a local authorized file or an on-demand disk copy instead of keeping the whole video in JavaScript memory. Session attachment previews use the session's authorized reader and have a 25 MiB limit.

## Files on another computer

Every connected path retains its owning machine. Windows drive paths, macOS/Linux paths, and network paths are never interpreted as a local path merely because they have the same spelling.

- **Open local copy** downloads a snapshot and opens it on this computer. Changes to that copy do not sync to the connected machine.
- Existing shared or mounted folders can be configured under **Shared folder settings**. The mapping is local to the viewing computer and applies to subfolders. Opening a mapped file accesses that shared original.
- **Open live folder (read-only)** uses the saved bycoda connection to expose a temporary folder to this computer's file manager. It supports browsing and opening; writes are rejected. The OS must provide its WebDAV client. An unavailable OS client produces an actionable error and leaves the shared-folder and copy alternatives available.

Only folders and files inside projects/worktrees already authorized on the owning host can be read through bycoda. Browsing metadata outside those roots does not grant file access. Temporary native-folder access is private to loopback, expires, and does not publish a share or change OS services.

Local downloads are limited to 1 GiB per file and four simultaneous transfers. The cache is bounded to 4 GiB. Unchanged cached snapshots can be reused; edited copies are preserved. A file changing during transfer causes a retryable failure rather than opening inconsistent bytes.

## Open a remote development website

Use **Open in this computer's browser** in Development servers, or click a matching development URL in the remote conversation. bycoda resolves the conversation's machine and project, finds the registered running server, and verifies its process identity before creating a private local browser address. Refresh Development servers when a process restarts.

HTTP requests and WebSocket connections use the paired host connection. No public tunnel is created. Remote HTTPS sites open in the owning host's browser preview. Ordinary public URLs continue to open normally.

The HTTP bridge accepts fixed-length request bodies; streaming/chunked request bodies are rejected. Custom private DNS names are not automatically classified from arbitrary chat links; choose the registered endpoint in Development servers. Opening a file or server never silently falls back to a different machine.

## Notes with question choices

For ordinary questions that accept custom text, select a suggested answer and add an optional note below the choices. The note stays separate from the selected option, survives navigation and remounts with the question draft, and is sent with the answer. Notes do not answer an unselected question. Typed forms and providers that require exact option values keep their original inputs. Answered question actions appear below the answer so Copy and other actions do not cover another question.
