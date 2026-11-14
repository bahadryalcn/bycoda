/** Attachment byte size label (B/KB/MB). Dependency-free so the mobile app can share it. */
export function formatAttachmentSize(size: number): string | null {
  if (!Number.isFinite(size) || size <= 0) return null;
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}
