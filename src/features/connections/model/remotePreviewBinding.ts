import type { HostSession } from "./protocol";
export function canApplyRemotePreview(
  current: HostSession | undefined,
  preview: HostSession,
): boolean {
  return (
    !!current &&
    current.session.id === preview.session.id &&
    current.revision === preview.revision &&
    current.history?.before === preview.history?.before &&
    current.session.blocks.length === preview.session.blocks.length &&
    current.session.blocks.every((block, index) => {
      const candidate = preview.session.blocks[index];
      return (
        !!candidate &&
        block.id === candidate.id &&
        !(block.remoteContent === undefined && candidate.remoteContent !== undefined)
      );
    }) &&
    !!current.historyLoading === !!preview.historyLoading
  );
}
