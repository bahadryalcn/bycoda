# Sessions sidebar contracts

Read only the section needed for the change. Source owners remain in [the surface map](surfaces.md).

## Identity and lifecycle

- Project identity, selected session and execution workspace are distinct. Use existing adoption/navigation routing for remote records; never fabricate IDs.

- Archive, delete, stop, close and dismiss recovery are different operations. Recheck locks/permissions and use existing confirmation and recovery owners.

- Keep pin/order/filter/search/paging persistence and sibling update behavior. A filtered subset is not the entire collection for bulk operations or counts.

- Working summarizes the open project's running rows while keeping global header counts and other-project paging. Attention/finished rows stay available; Last Sessions retains the complete list. Compare canonical project keys, including remote machine identity, rather than display names or execution-folder prefixes.

- Preserve title drafts, focus, drag targets and native tree/menu semantics.

- Pending/error row actions retain their initiating control and recovery path. Reading the list does not transfer execution or operation authority.

- Confirmed conversation deletion clears progress on clean success without a separate success banner. Preserve failures, skipped records and cleanup warnings.

## Row presentation

- Standard/detailed rows show saved project identity above the title, status at the top right, and branch/provider history below. Reuse the rail label, logo or mascot. Local rows keep neutral grounds; branch omits repo prefix equal to project. Noncompact rows keep pin/archive/delete in the project header and reclaim their hidden space through shared ActionHost slots. Pin replaces the project mark in the same leading slot on interaction; pinned rows keep the pin visible. Footer uses plain branch text and 16px provider icons; title and footer do not shift on hover. Hover/focus collapses status words to icons, preserving accessible names and Working elapsed time. Resting rows retain their normal status labels. Last Sessions combines the last seven days across allowed projects; only that list applies project colors/grounds, preserving ActionHost interaction states. Global New first requires an explicit visible project choice; cancellation must create nothing. Recheck the chosen project’s current visibility/lock gate and create with that project’s defaults/checkout, never a stale active-project closure. Selecting a global row keeps the list open and routes by exact project/session identity; Explorer/Git follow its execution checkout, not a virtual path. Keep direct pin actions outside the selection button and routed through existing local/remote pin owners. Compact density retains its one-line layout.

- Provider history comes from submitted turn provenance, not the next composer choice. Preserve optional summary metadata through native, Host and remote lists; previous providers are muted and only the last active provider retains its color.

- Inline rename occupies the existing card title slot, retaining project/status and footer context. Regenerate title follows Rename in the single-row menu; keep pending/error/retry on that row and prevent duplicate generation.

- Keep Draft presentation on shared warning roles, and running/Working presentation on existing shared status controls. Narrow rows may hide text without hiding accessible state, elapsed time or its activity mark.

- Session detail hints cancel both pending and open previews when an ancestor scrolls, the window resizes or loses focus; unrelated pane scrolling does not dismiss them. Show the full locale-formatted activity date/time using `lastActivityAt`, with `updatedAt` as the legacy fallback. Dismissal must not restore focus to a row that moved out of view.

## Titles and drafts

- Title regeneration uses `src/features/sessions/model/regenerateSessionTitle.ts` and Chat's `titlePreferences.ts`; preserve original owner, command receipt, concurrent title checks and existing locks. It never submits a conversation turn.

- Unsent text or attachments use the existing composer-draft subscription, including disk-restored drafts. Do not mark the session currently being typed in as an inactive draft; retain existing saved-draft/status precedence.

## Activity and snapshots

- Keep interrupted warnings in local/global/recent lists through partial history loading until continuation. Order/time filters use `lastActivityAt`, falling back to `updatedAt` for old summaries. Quit/recovery preserves activity while `updatedAt` still advances for Host synchronization and conflict checks.

- Last Sessions reads seven-day Native history in bounded revision-fenced pages. Keep the previous complete result during refresh, retry a changed snapshot, and recheck Host ownership before publishing the assembled list. Metadata-only updates keep the active history stream.

- Owner Stop is not interruption: `Stopped by you.` notices retain their transcript bytes but do not set the list interruption flag. Keep the TypeScript classifier and native summary projection consistent.

## Footer state

- Keep update/footer state tied to the displayed version and confirmed package status. Dismissing an old notice must not clear a newer marker.

- Repository and update notices may coexist. Repository dismissal is app-version scoped; the next version reveals it again and an available-update action remains usable. Reading release notes does not dismiss the installed-update notice; only explicit dismissal removes the displayed version's marker.
