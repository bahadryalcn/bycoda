import {
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type ComponentPropsWithoutRef,
} from "react";
import { createNote, noteTitle } from "../../notes";
import { loadNotesEnabled, subscribeNotesEnabled } from "../../settings/model/settings";
import { useTranscriptSelection } from "../hooks/useTranscriptSelection";
import { textareaSelectionRect } from "../model/textareaSelectionRect";
import type { TranscriptSelection } from "../model/transcriptSelection";
import { requestAddToChat } from "../model/quoteDraft";
import { TranscriptSelectionMenu } from "./TranscriptSelectionMenu";

type Props = ComponentPropsWithoutRef<"div"> & {
  active?: boolean;
  context?: string;
  contentVersion?: unknown;
  cwd?: string;
  sessionId?: string;
  allowNotes?: boolean;
};

/** Selection actions for readable surfaces, including native textarea selections. */
export function SurfaceSelection({
  children,
  active = true,
  context,
  contentVersion,
  cwd,
  sessionId,
  allowNotes = true,
  ...props
}: Props) {
  const id = useId();
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  const { selection: rangeSelection, dismissSelection: dismissRange } = useTranscriptSelection(
    root,
    active,
  );
  const [fieldSelection, setFieldSelection] = useState<TranscriptSelection | null>(null);
  const frame = useRef(0);
  const notesEnabled = useSyncExternalStore(subscribeNotesEnabled, loadNotesEnabled, () => true);
  const dismiss = () => {
    cancelAnimationFrame(frame.current);
    dismissRange();
    setFieldSelection(null);
  };
  useEffect(() => {
    cancelAnimationFrame(frame.current);
    dismissRange();
    setFieldSelection(null);
  }, [active, contentVersion, context, dismissRange]);
  useEffect(() => {
    if (!root || !active) return;
    let selecting = false;
    let field: HTMLTextAreaElement | null = null;
    let point: { x: number; y: number } | null = null;
    const report = () => {
      frame.current = 0;
      if (selecting || !field || document.activeElement !== field || !root.contains(field)) return;
      const text = field.value.slice(field.selectionStart, field.selectionEnd).trim();
      let rect: DOMRect | null = null;
      if (text) {
        try {
          rect = textareaSelectionRect(field, field.selectionStart, field.selectionEnd);
        } catch {
          /* Selection geometry can be unavailable during layout. */
        }
        if (!rect) {
          const bounds = field.getBoundingClientRect();
          if (bounds.width > 0 && bounds.height > 0)
            rect = new DOMRect(
              Math.max(bounds.left, Math.min(bounds.right, point?.x ?? bounds.left)),
              Math.max(bounds.top, Math.min(bounds.bottom, point?.y ?? bounds.top)),
              1,
              1,
            );
        }
      }
      dismissRange();
      setFieldSelection(rect ? { text, rect } : null);
    };
    const schedule = (event?: Event) => {
      if (event?.target instanceof HTMLTextAreaElement) field = event.target;
      cancelAnimationFrame(frame.current);
      frame.current = requestAnimationFrame(report);
    };
    const down = (event: PointerEvent) => {
      if (!(event.target instanceof HTMLTextAreaElement)) return;
      field = event.target;
      selecting = true;
      cancelAnimationFrame(frame.current);
      setFieldSelection(null);
    };
    const up = (event: PointerEvent) => {
      if (!selecting) return;
      selecting = false;
      point = { x: event.clientX, y: event.clientY };
      schedule();
    };
    const cancel = () => {
      selecting = false;
      cancelAnimationFrame(frame.current);
      setFieldSelection(null);
    };
    const keyup = (event: KeyboardEvent) => {
      if (
        event.key === "Shift" ||
        event.key.startsWith("Arrow") ||
        ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a")
      )
        schedule(event);
    };
    const outside = (event: PointerEvent) => {
      if (
        event.target instanceof Element &&
        !root.contains(event.target) &&
        !event.target.closest('[role="toolbar"]')
      )
        cancel();
    };
    root.addEventListener("select", schedule, true);
    root.addEventListener("keyup", keyup);
    root.addEventListener("pointerdown", down);
    root.addEventListener("input", cancel);
    document.addEventListener("pointerdown", outside);
    document.addEventListener("pointerup", up);
    document.addEventListener("pointercancel", cancel);
    return () => {
      cancelAnimationFrame(frame.current);
      root.removeEventListener("select", schedule, true);
      root.removeEventListener("keyup", keyup);
      root.removeEventListener("pointerdown", down);
      root.removeEventListener("input", cancel);
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("pointerup", up);
      document.removeEventListener("pointercancel", cancel);
    };
  }, [root, active, dismissRange]);

  const selection = active ? (fieldSelection ?? rangeSelection) : null;
  useEffect(() => {
    if (!root || !selection) return;
    const checkVisibility = () => {
      if (root.closest('[hidden], [aria-hidden="true"], .hidden, .invisible')) {
        dismissRange();
        setFieldSelection(null);
      }
    };
    const observer = new MutationObserver(checkVisibility);
    for (let node: HTMLElement | null = root; node; node = node.parentElement)
      observer.observe(node, {
        attributes: true,
        attributeFilter: ["class", "hidden", "aria-hidden", "style"],
      });
    checkVisibility();
    return () => observer.disconnect();
  }, [root, selection, dismissRange]);

  return (
    <div
      {...props}
      ref={setRoot}
      data-selectable-agent-response={id}
      onInputCapture={(event) => {
        props.onInputCapture?.(event);
        dismiss();
      }}
    >
      {children}
      <TranscriptSelectionMenu
        selection={selection}
        onDismiss={dismiss}
        onAddToChat={(text) => requestAddToChat(context ? `${context}\n\n${text}` : text, "quote")}
        onAddToNotes={
          allowNotes && notesEnabled
            ? async (text) => {
                await createNote({
                  title: noteTitle(text),
                  body: context ? `${context}\n\n${text}` : text,
                  ...(cwd ? { sourceCwd: cwd } : {}),
                  ...(sessionId ? { sourceSessionId: sessionId } : {}),
                });
              }
            : undefined
        }
      />
    </div>
  );
}
