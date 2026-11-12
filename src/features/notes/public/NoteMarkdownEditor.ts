/** Public notes editor contract; runtime exports stay explicit to preserve load isolation. */
export { NoteMarkdownEditor, runMarkdownCommand } from "../ui/NoteMarkdownEditor";
export type { NoteEditorViewRef } from "../ui/NoteMarkdownEditor";
export type { MarkdownCommand } from "../markdownCommands";
