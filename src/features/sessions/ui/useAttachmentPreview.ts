import { useEffect, useRef, useState } from "react";
import { readBinaryFile } from "../../../platform/tauri/fs";
import { attachmentPreviewSrc } from "../model/attachments";
import type { Attachment } from "../model/session";

type PreviewState = { loadedPreview?: string; open: boolean; loading: boolean; error: boolean };
type PreviewOwner = Pick<Attachment, "id" | "path" | "loadPreview" | "missing"> & {
  preview: string | undefined;
};

const IDLE: PreviewState = { open: false, loading: false, error: false };

function sameOwner(a: PreviewOwner, b: PreviewOwner): boolean {
  return (
    a.id === b.id &&
    a.path === b.path &&
    a.loadPreview === b.loadPreview &&
    a.preview === b.preview &&
    a.missing === b.missing
  );
}

/** Load historical images only when requested, and retain bytes only while open. */
export function useAttachmentPreview(attachment: Attachment) {
  const preview = attachmentPreviewSrc(attachment);
  const owner: PreviewOwner = {
    id: attachment.id,
    path: attachment.path,
    loadPreview: attachment.loadPreview,
    missing: attachment.missing,
    preview,
  };
  // The state belongs to the attachment it was produced for; a different attachment reads as idle.
  const [held, setHeld] = useState<{ owner: PreviewOwner; state: PreviewState } | null>(null);
  const { loadedPreview, open, loading, error } =
    held && sameOwner(held.owner, owner) ? held.state : IDLE;
  const update = (patch: Partial<PreviewState>) =>
    setHeld((previous) => ({
      owner,
      state: { ...(previous && sameOwner(previous.owner, owner) ? previous.state : IDLE), ...patch },
    }));
  const request = useRef(0);
  const pending = useRef(false);
  const ownedUrl = useRef<string | undefined>(undefined);
  // Remote images within this limit receive a host reader during hydration.
  // Never use a bare host path for images rejected by that preview budget.
  const canReadPath =
    Boolean(attachment.path) &&
    Number.isSafeInteger(attachment.size) &&
    attachment.size >= 0 &&
    attachment.size <= 25 * 1024 * 1024;
  const canOpen =
    attachment.kind === "image" &&
    !attachment.missing &&
    Boolean(preview || attachment.loadPreview || canReadPath);

  const release = () => {
    if (ownedUrl.current) URL.revokeObjectURL(ownedUrl.current);
    ownedUrl.current = undefined;
  };

  // Identity change or unmount: invalidate in-flight loads and release the blob URL.
  useEffect(() => {
    return () => {
      request.current++;
      pending.current = false;
      release();
    };
  }, [attachment.id, attachment.path, attachment.loadPreview, preview, attachment.missing]);

  const close = () => {
    request.current++;
    pending.current = false;
    release();
    update({ loadedPreview: undefined, open: false, loading: false });
  };

  const show = async () => {
    if (!canOpen || pending.current) return;
    if (preview) {
      update({ error: false, open: true });
      return;
    }
    const generation = ++request.current;
    pending.current = true;
    update({ error: false, loading: true });
    try {
      let src: string;
      // The owning host's reader always takes precedence over a disk path.
      if (attachment.loadPreview) {
        const data = await attachment.loadPreview();
        if (!data) throw new Error("Empty image preview");
        src = `data:${attachment.mimeType};base64,${data}`;
      } else {
        const bytes = await readBinaryFile(attachment.path!);
        if (generation !== request.current) return;
        if (!bytes.byteLength) throw new Error("Empty image preview");
        src = URL.createObjectURL(new Blob([bytes], { type: attachment.mimeType }));
        ownedUrl.current = src;
      }
      if (generation !== request.current) return;
      update({ loadedPreview: src, open: true });
    } catch {
      if (generation === request.current) update({ error: true });
    } finally {
      if (generation === request.current) {
        pending.current = false;
        update({ loading: false });
      }
    }
  };

  return { src: loadedPreview ?? preview, canOpen, open, loading, error, show, close };
}
