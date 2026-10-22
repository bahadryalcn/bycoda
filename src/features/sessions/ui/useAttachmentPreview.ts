import { useEffect, useRef, useState } from "react";
import { readBinaryFile } from "../../../platform/tauri/fs";
import { attachmentPreviewSrc } from "../model/attachments";
import type { Attachment } from "../model/session";

/** Load historical images only when requested, and retain bytes only while open. */
export function useAttachmentPreview(attachment: Attachment) {
  const [loadedPreview, setLoadedPreview] = useState<string>();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const request = useRef(0);
  const pending = useRef(false);
  const ownedUrl = useRef<string | undefined>(undefined);
  const preview = attachmentPreviewSrc(attachment);
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

  useEffect(() => {
    setLoadedPreview(undefined);
    setOpen(false);
    setLoading(false);
    setError(false);
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
    setLoadedPreview(undefined);
    setOpen(false);
    setLoading(false);
  };

  const show = async () => {
    if (!canOpen || pending.current) return;
    setError(false);
    if (preview) {
      setOpen(true);
      return;
    }
    const generation = ++request.current;
    pending.current = true;
    setLoading(true);
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
      setLoadedPreview(src);
      setOpen(true);
    } catch {
      if (generation === request.current) setError(true);
    } finally {
      if (generation === request.current) {
        pending.current = false;
        setLoading(false);
      }
    }
  };

  return { src: loadedPreview ?? preview, canOpen, open, loading, error, show, close };
}
