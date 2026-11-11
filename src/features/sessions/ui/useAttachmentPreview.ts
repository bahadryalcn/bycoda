import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStableCallback } from "../../../shared/hooks/useStableCallback";
import { readBinaryFile } from "../../../platform/tauri/fs";
import { attachmentPreviewSrc } from "../model/attachments";
import type { Attachment } from "../model/session";

type PreviewState = {
  loadedPreview?: string;
  open: boolean;
  loading: boolean;
  error: boolean;
};
type PreviewOwner = Pick<
  Attachment,
  "id" | "path" | "loadPreview" | "missing" | "mimeType" | "size" | "kind"
> & {
  preview: string | undefined;
};

const IDLE: PreviewState = { open: false, loading: false, error: false };

function sameOwner(a: PreviewOwner, b: PreviewOwner): boolean {
  return (
    a.id === b.id &&
    a.path === b.path &&
    a.loadPreview === b.loadPreview &&
    a.preview === b.preview &&
    a.mimeType === b.mimeType &&
    a.size === b.size &&
    a.kind === b.kind &&
    a.missing === b.missing
  );
}

type PreviewRead = {
  attachment: Attachment;
  generation: number;
  openPreview: boolean;
  request: { current: number };
  pending: { current: boolean };
  ownedUrl: { current: string | undefined };
  update: (patch: Partial<PreviewState>) => void;
};

// Module-level so the try/finally stays out of the hook the React Compiler compiles.
async function readPreview({
  attachment,
  generation,
  openPreview,
  request,
  pending,
  ownedUrl,
  update,
}: PreviewRead) {
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
    update({ loadedPreview: src, open: openPreview });
  } catch {
    if (generation === request.current) update({ error: true });
  } finally {
    if (generation === request.current) {
      pending.current = false;
      update({ loading: false });
    }
  }
}

/** Cards preload near the viewport; text tokens load only when opened. */
export function useAttachmentPreview(attachment: Attachment, preload = false) {
  const preview = attachmentPreviewSrc(attachment);
  const owner: PreviewOwner = useMemo(
    () => ({
      id: attachment.id,
      path: attachment.path,
      loadPreview: attachment.loadPreview,
      missing: attachment.missing,
      preview,
      mimeType: attachment.mimeType,
      size: attachment.size,
      kind: attachment.kind,
    }),
    [
      attachment.id,
      attachment.path,
      attachment.loadPreview,
      attachment.missing,
      attachment.mimeType,
      attachment.size,
      attachment.kind,
      preview,
    ],
  );
  // The state belongs to the attachment it was produced for; a different attachment reads as idle.
  const [held, setHeld] = useState<{
    owner: PreviewOwner;
    state: PreviewState;
  } | null>(null);
  const { loadedPreview, open, loading, error } =
    held && sameOwner(held.owner, owner) ? held.state : IDLE;
  const update = useCallback(
    (patch: Partial<PreviewState>) =>
      setHeld((previous) => ({
        owner,
        state: {
          ...(previous && sameOwner(previous.owner, owner) ? previous.state : IDLE),
          ...patch,
        },
      })),
    [owner],
  );
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

  const release = useCallback(() => {
    if (ownedUrl.current) URL.revokeObjectURL(ownedUrl.current);
    ownedUrl.current = undefined;
  }, []);

  // Identity change or unmount: invalidate in-flight loads and release the blob URL.
  useEffect(() => {
    return () => {
      request.current++;
      pending.current = false;
      release();
    };
  }, [owner, release]);

  const close = () => {
    if (preload) {
      request.current++;
      pending.current = false;
      update({ open: false, loading: false });
      return;
    }
    request.current++;
    pending.current = false;
    release();
    update({ loadedPreview: undefined, open: false, loading: false });
  };

  const load = useStableCallback(async (openPreview: boolean, reload = false) => {
    if (!canOpen || pending.current) return;
    if ((preview || loadedPreview) && (!reload || (!attachment.loadPreview && !canReadPath))) {
      if (openPreview) update({ error: false, open: true });
      return;
    }
    const generation = ++request.current;
    pending.current = true;
    if (reload) release();
    update({
      error: false,
      loading: true,
      ...(reload ? { loadedPreview: undefined, open: openPreview } : {}),
    });
    await readPreview({ attachment, generation, openPreview, request, pending, ownedUrl, update });
  });

  useEffect(() => {
    if (!preload || !canOpen || preview || loadedPreview) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) void load(false).catch(() => update({ error: true, loading: false }));
    });
    return () => {
      cancelled = true;
    };
  }, [preload, canOpen, preview, loadedPreview, load, update]);

  const show = () => load(true);
  const retry = () => {
    void load(true, true).catch(() => update({ error: true, loading: false }));
  };
  // A carried URL can go stale (a composer blob URL is revoked after send). The first broken
  // carried URL reloads once from the reader; a broken reader result is a real failure.
  // `quiet` (a card thumbnail) leaves a final failure to the card's file icon.
  const recover = (brokenSrc: string, quiet = false) => {
    const hasReader = Boolean(attachment.loadPreview) || canReadPath;
    if (!hasReader || brokenSrc === loadedPreview) {
      if (!quiet) update({ error: true, loading: false });
      return;
    }
    void load(open, true).catch(() => update({ error: true, loading: false }));
  };

  return {
    src: loadedPreview ?? preview,
    canOpen,
    open,
    loading,
    error,
    show,
    retry,
    recover,
    close,
  };
}
