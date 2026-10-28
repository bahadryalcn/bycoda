import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import {
  attachmentsFromFiles,
  attachmentsFromPaths,
  filesFromClipboard,
  MAX_ATTACHMENTS,
  pickAttachments,
  retainAttachmentPickerSelection,
  revokeAttachment,
  MAX_EMBED_BYTES,
} from "../../sessions/model/attachments";
import { harnessSupportsAttachments, type Attachment } from "../../sessions/model/session";
import {
  isFileReferenceText,
  nativeClipboardAttachments,
  readClipboardFilePaths,
  readClipboardImage,
} from "../../../platform/tauri/clipboard";
import { storeQuickAttachments } from "../model/quickAttachments";
import type { QuickComposerOwner, QuickPreparation } from "../model/quickComposerClosure";
import { captureDraft, dropPastedText, insertRestoredText } from "../../../shared/lib/draftRestore";

async function releaseCaptures(files: Attachment[]) {
  const paths = files.flatMap((file) => (file.path ? [file.path] : []));
  if (paths.length) await invoke("quick_composer_release_capture", { paths });
}
function localPreparation(): QuickPreparation {
  const values = new Map<string, unknown>();
  const captured = new Map<string, Promise<unknown>>();
  return {
    apply: (operation) => operation(),
    fail: (error) => {
      throw error;
    },
    async stage(key, operation) {
      if (values.has(key)) return values.get(key) as never;
      const value = await operation();
      values.set(key, value);
      return value;
    },
    once(key, operation) {
      if (!captured.has(key)) captured.set(key, operation());
      return captured.get(key) as never;
    },
  };
}

export function useQuickAttachments(
  supported: boolean,
  onError: (message: string | null) => void,
  onAdded?: (added: Attachment[], previous: Attachment[]) => void,
  owner?: QuickComposerOwner,
) {
  const [files, setFiles] = useState<Attachment[]>(() => owner?.draft().attachments ?? []);
  const [loading, setLoading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const filesRef = useRef(files);
  const queueRef = useRef(
    owner?.queue ?? { tail: Promise.resolve(), pending: 0, screenshot: false },
  );
  const alive = useRef(true);
  const nativeDropAt = useRef(0);
  const supportedRef = useRef(supported);
  const onAddedRef = useRef(onAdded);
  useLayoutEffect(() => {
    supportedRef.current = supported;
    onAddedRef.current = onAdded;
  }, [supported, onAdded]);
  const currentFiles = () => owner?.draft().attachments ?? filesRef.current;
  const updateFiles = (next: Attachment[]) => {
    filesRef.current = next;
    if (owner) owner.update((draft) => ({ ...draft, attachments: next }));
    if (alive.current) setFiles(next);
  };

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      // The actual QuickComposer window owner retains raw draft/captures and
      // admitted jobs across view unmount/HMR. A view is not Native destruction.
      if (!owner) {
        filesRef.current.forEach(revokeAttachment);
        void releaseCaptures(filesRef.current).catch(() => {});
      }
    };
  }, [owner]);

  const canMutate = () => !owner || owner.canMutate();
  const isSupported = useCallback(
    () =>
      owner
        ? harnessSupportsAttachments(owner.draft().choice.harness) && !owner.launching
        : supportedRef.current,
    [owner],
  );
  const canCollect = useCallback(
    () => isSupported() && queueRef.current.pending === 0 && (!owner || owner.canMutate()),
    [owner, isSupported],
  );

  const collect = useCallback(
    (
      read: (accepted: QuickPreparation) => Promise<Attachment[]>,
      captureEarly = false,
    ): Promise<void> => {
      const queue = queueRef.current;
      if (
        !isSupported() ||
        (owner && !owner.canMutate()) ||
        (!captureEarly && queue.pending > 0) ||
        (captureEarly && queue.screenshot)
      )
        return Promise.resolve();
      if (captureEarly) queue.screenshot = true;
      const previous = queue.tail;
      queue.pending++;
      owner?.touch();
      if (alive.current) {
        setLoading(true);
        onError(null);
      }
      let incoming: Attachment[] = [];
      const operation = async (accepted: QuickPreparation) => {
        // Capture the queued clipboard NOW, after its own admission. Observe a
        // rejection immediately even while an earlier spill is still pending.
        const early = captureEarly
          ? read(accepted).then(
              (value) => ({ value }),
              (error: unknown) => ({ error }),
            )
          : undefined;
        await previous;
        incoming = await accepted.stage("incoming", async () => {
          if (!early) return read(accepted);
          const result = await early;
          if ("error" in result) throw result.error;
          return result.value;
        });
        if ((!alive.current && !owner) || !isSupported()) {
          if (owner)
            throw new Error(
              "The attachment's provider changed; its accepted selection is retained.",
            );
          incoming.forEach(revokeAttachment);
          return;
        }
        const selected = await accepted.stage("accepted", async () => {
          const before = currentFiles();
          const picked: Attachment[] = [];
          for (const file of incoming) {
            if (
              before.length + picked.length >= MAX_ATTACHMENTS ||
              [...before, ...picked].some(
                (item) => item.id === file.id || (item.path && item.path === file.path),
              )
            ) {
              revokeAttachment(file);
              continue;
            }
            picked.push(file);
          }
          if (
            incoming.length > picked.length &&
            before.length + picked.length >= MAX_ATTACHMENTS &&
            alive.current
          )
            onError(`You can attach up to ${MAX_ATTACHMENTS} files.`);
          return picked;
        });
        const stored = await accepted.stage("stored", () =>
          storeQuickAttachments(selected, accepted.stage),
        );
        if ((!alive.current && !owner) || !isSupported()) {
          if (owner)
            throw new Error("The attachment's provider changed; its accepted bytes are retained.");
          stored.forEach(revokeAttachment);
          return;
        }
        accepted.apply(() => {
          const before = currentFiles();
          const additions = stored.filter(
            (file) =>
              !before.some((item) => item.id === file.id || (item.path && item.path === file.path)),
          );
          updateFiles([...before, ...additions]);
          if (additions.length) onAddedRef.current?.(additions, before);
        });
      };
      const actual = owner ? owner.prepare(operation) : operation(localPreparation());
      const settled = actual.then(
        () => undefined,
        (reason: unknown) => {
          if (!owner) incoming.forEach(revokeAttachment);
          if (alive.current) onError(reason instanceof Error ? reason.message : String(reason));
        },
      );
      queue.tail = settled;
      void settled.then(() => {
        queue.pending--;
        if (captureEarly) queue.screenshot = false;
        owner?.touch();
        if (alive.current) setLoading(queue.pending > 0);
      });
      return settled;
    },
    [owner, isSupported, onError],
  );

  useEffect(() => {
    let disposed = false;
    let stop: (() => void) | undefined;
    void getCurrentWebview()
      .onDragDropEvent(({ payload }) => {
        if (payload.type === "leave") {
          setDragging(false);
          return;
        }
        if (payload.type === "drop") {
          setDragging(false);
          nativeDropAt.current = Date.now();
          const paths = [...payload.paths];
          void collect(() => attachmentsFromPaths(paths));
        } else setDragging(canCollect());
      })
      .then((unlisten) => {
        if (disposed) unlisten();
        else stop = unlisten;
      })
      .catch(() => {});
    return () => {
      disposed = true;
      stop?.();
    };
  }, [collect, canCollect]);

  const readFiles = (input: File[], accepted: QuickPreparation, overflow = false) => {
    const selected = input.slice(0, MAX_ATTACHMENTS);
    return Promise.allSettled(
      selected.map((file, index) =>
        accepted.stage(`file:${index}`, () => attachmentsFromFiles([file])),
      ),
    ).then((results) => {
      const failed = results.find((result) => result.status === "rejected");
      if (failed?.status === "rejected") throw failed.reason;
      if (overflow && alive.current) onError(`You can attach up to ${MAX_ATTACHMENTS} files.`);
      return results.flatMap((result) => (result as PromiseFulfilledResult<Attachment[]>).value);
    });
  };
  const clipboard = async (text: string, accepted: QuickPreparation) => {
    if (!owner) return nativeClipboardAttachments(text);
    const paths = await accepted.once("clipboard-paths", async () => {
      const selected = await readClipboardFilePaths();
      if (
        selected.length > 4096 ||
        selected.reduce((size, path) => size + path.length * 2, 0) > 1024 * 1024
      )
        throw new Error("The clipboard selection exceeds retained attachment capacity.");
      return Object.freeze([...selected]);
    });
    if (paths.length) {
      const chosen = paths.slice(0, MAX_ATTACHMENTS);
      const files = await attachmentsFromPaths(chosen);
      if (!files.length)
        throw new Error(
          "Nothing to attach from that path — the file may have been moved, renamed, or deleted.",
        );
      return {
        files,
        ...(chosen.length < paths.length
          ? {
              warning: `Attached ${files.length} of ${paths.length} copied files. A turn carries up to ${MAX_ATTACHMENTS}.`,
            }
          : {}),
      };
    }
    if (text) return { files: [] };
    try {
      const file = await accepted.once("clipboard-image", async () => {
        const selected = await readClipboardImage();
        if (selected.size > MAX_EMBED_BYTES)
          throw new Error("The clipboard image exceeds retained attachment capacity.");
        return selected;
      });
      return { files: await readFiles([file], accepted) };
    } catch (error) {
      if (error instanceof Error && error.message === "The clipboard does not contain an image.")
        return { files: [] };
      throw error;
    }
  };
  const onPaste = (event: ClipboardEvent) => {
    if (!canMutate()) {
      event.preventDefault();
      return;
    }
    const pasted = filesFromClipboard(event.clipboardData);
    if (pasted.length) {
      if (!supported) return;
      event.preventDefault();
      const selected = pasted.slice(0, MAX_ATTACHMENTS);
      const overflow = selected.length < pasted.length;
      void collect((accepted) => readFiles(selected, accepted, overflow));
      return;
    }
    if (!supported) return;
    const text = event.clipboardData.getData("text/plain");
    if (text && !isFileReferenceText(text)) return;
    if (!canCollect()) {
      if (!text) {
        event.preventDefault();
        void collect(async (accepted) => {
          const result = await clipboard("", accepted);
          if (result.warning && alive.current) onError(result.warning);
          return result.files;
        }, true);
      }
      return;
    }
    event.preventDefault();
    const captured = isFileReferenceText(text) ? captureDraft(event.target) : null;
    void collect(async (accepted) => {
      const result = await clipboard(text, accepted);
      accepted.apply(() => {
        if (result.warning && alive.current) onError(result.warning);
        if (result.files.length) {
          if (captured) dropPastedText(captured, text);
        } else if (captured) insertRestoredText(captured, text);
      });
      return result.files;
    });
  };
  const remove = (id: string): void => {
    if (!canMutate()) return;
    const removed = currentFiles().filter((file) => file.id === id);
    const operation = async (accepted: QuickPreparation) => {
      accepted.apply(() => {
        removed.forEach(revokeAttachment);
        updateFiles(currentFiles().filter((file) => file.id !== id));
      });
      await releaseCaptures(removed);
    };
    const actual = owner ? owner.prepare(operation) : operation(localPreparation());
    void actual.catch(() => {});
  };
  const clearAfterHandoff = (covered?: readonly { id: string; path?: string }[]): Promise<void> => {
    if (!canMutate()) return Promise.resolve();
    if (owner && !owner.admitted)
      return Promise.reject(new Error("Quick attachment cleanup requires its accepted owner."));
    const before = currentFiles().filter(
      (file) => !covered || covered.some((sent) => sent.id === file.id && sent.path === file.path),
    );
    before.forEach(revokeAttachment);
    const removed = new Set(before);
    updateFiles(currentFiles().filter((file) => !removed.has(file)));
    return releaseCaptures(before).catch(() => {
      owner?.unknown();
    });
  };
  return {
    files: owner?.draft().attachments ?? files,
    loading: owner ? owner.attachmentPending > 0 : loading,
    dragging,
    remove,
    clear: () => {
      if (!canMutate()) return;
      if (owner)
        void owner
          .prepare(async (accepted) => {
            const release = accepted.apply(clearAfterHandoff);
            await release;
          })
          .catch(() => {});
      else void clearAfterHandoff();
    },
    clearAfterHandoff,
    onPaste,
    onDragOver: (event: DragEvent) => {
      if (!Array.from(event.dataTransfer.types).includes("Files")) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = canCollect() ? "copy" : "none";
      setDragging(canCollect());
    },
    onDragLeave: (event: DragEvent) => {
      if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget))
        return;
      setDragging(false);
    },
    onDrop: (event: DragEvent) => {
      event.preventDefault();
      setDragging(false);
      if (Date.now() - nativeDropAt.current < 250) return;
      const input = Array.from(event.dataTransfer.files).slice(0, MAX_ATTACHMENTS);
      const overflow = event.dataTransfer.files.length > input.length;
      if (input.length) void collect((accepted) => readFiles(input, accepted, overflow));
    },
    chooseFiles: () => {
      const selection = retainAttachmentPickerSelection();
      return collect((accepted) =>
        pickAttachments({ read: () => accepted.once("picker-selection", selection.read) }),
      );
    },
    takeScreenshot: () => {
      let captured: string | null = null;
      return collect(async (accepted) => {
        captured = await accepted.once("screen-selection", () =>
          invoke<string | null>("quick_composer_capture"),
        );
        return captured ? attachmentsFromPaths([captured]) : [];
      }).then(async () => {
        if (!owner && captured && !currentFiles().some((file) => file.path === captured))
          await releaseCaptures([{ path: captured } as Attachment]).catch(() => {});
      });
    },
  };
}
