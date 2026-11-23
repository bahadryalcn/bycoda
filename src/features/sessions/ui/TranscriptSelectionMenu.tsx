/** Different job: Selection toolbar and comment editor act on transcript ranges; they are not a value picker. */
import { errorText } from "../../../shared/lib/errors";
import { Text } from "../../../shared/ui/Text";
import { surfaceAttributes } from "../../../shared/ui/Surface";
import { InlineError } from "../../../shared/ui/InlineError";
import { useT } from "../../../shared/i18n";
import {
  Check,
  Copy,
  FilePlusCorner,
  MessageSquarePlus,
  Sparkles,
  X,
} from "../../../shared/ui/icons";
import { Button } from "../../../shared/ui/Button";
import { TextareaField } from "../../../shared/ui/TextareaField";
import { copyMessage } from "../../../platform/tauri/clipboard";
import { serializeChatCitation } from "../model/chatCitation";
import styles from "./TranscriptSelectionMenu.module.css";
import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from "react";
import { Popover } from "../../../shared/ui/Popover";
import {
  FloatingButtonGroup,
  type FloatingButtonGroupAction,
} from "../../../shared/ui/FloatingButtonGroup";
import { resolveTranscriptSelection, type TranscriptSelection } from "../model/transcriptSelection";
import { sameRect } from "../model/selectionGeometry";
import {
  translationTargets,
  type TranslationTarget,
  type TextActionTarget,
} from "../model/translation";

type Props = {
  selection: TranscriptSelection | null;
  onCopy?: () => Promise<void>;
  onAddToChat?: (text: string) => void | Promise<void>;
  addToChatLabel?: string;
  onAddToNotes?: (text: string) => void | Promise<void>;
  onDismiss: () => void;
  onTranslate?: (target: TextActionTarget) => void;
  sessionId?: string;
  allowReprompt?: boolean;
  extraActions?: {
    id: string;
    label: string;
    icon: FloatingButtonGroupAction["icon"];
    onSelect: (text: string) => void | Promise<void>;
  }[];
};

type Operations = {
  text: string | null;
  /** Bumped whenever the selected text changes; an operation only settles into its own epoch. */
  epoch: number;
  pending: Record<string, boolean>;
  errors: Record<string, string>;
};

type OperationSettle = {
  id: string;
  owner: number;
  epoch: React.RefObject<number>;
  running: React.RefObject<Set<string>>;
  update: (patch: (current: Operations) => Operations) => void;
  onSelect: () => void | Promise<void>;
  dismiss: boolean;
  onSuccess: () => void;
};

// Module-level so the try/finally stays out of the hook the React Compiler compiles.
async function settleSelectionOperation({
  id,
  owner,
  epoch,
  running,
  update,
  onSelect,
  dismiss,
  onSuccess,
}: OperationSettle) {
  try {
    const result = onSelect();
    if (result) await result;
    if (owner !== epoch.current) return;
    if (dismiss) {
      onSuccess();
    }
  } catch (error) {
    if (owner !== epoch.current) return;
    const message = errorText(error);
    update((current) => ({ ...current, errors: { ...current.errors, [id]: message } }));
  } finally {
    if (owner === epoch.current) {
      running.current.delete(id);
      update((current) => ({ ...current, pending: { ...current.pending, [id]: false } }));
    }
  }
}

function useSelectionOperationRunner(
  operationEpoch: number,
  setOperations: React.Dispatch<React.SetStateAction<Operations>>,
  onSuccess: () => void,
) {
  const running = useRef(new Set<string>());
  const epoch = useRef(operationEpoch);
  useLayoutEffect(() => {
    epoch.current = operationEpoch;
    running.current.clear();
  }, [operationEpoch]);

  const run = async (id: string, onSelect: () => void | Promise<void>, dismiss = true) => {
    if (running.current.has(id)) return;
    running.current.add(id);
    const owner = epoch.current;
    const update = (patch: (current: Operations) => Operations) =>
      setOperations((current) => (current.epoch === owner ? patch(current) : current));
    update((current) => ({
      ...current,
      pending: { ...current.pending, [id]: true },
      errors: { ...current.errors, [id]: "" },
    }));
    await settleSelectionOperation({
      id,
      owner,
      epoch,
      running,
      update,
      onSelect,
      dismiss,
      onSuccess,
    });
  };
  return run;
}

export function TranscriptSelectionMenu({
  selection: liveSelection,
  onCopy,
  onAddToChat,
  addToChatLabel,
  onAddToNotes,
  onDismiss,
  onTranslate,
  sessionId,
  allowReprompt = false,
  extraActions,
}: Props) {
  const t = useT();
  const dismissSelection = useEffectEvent(() => onDismiss());
  const [citationDraft, setCitationDraft] = useState<{
    sessionId: string | undefined;
    selection: TranscriptSelection;
    comment: string;
    open: boolean;
  } | null>(null);
  // Focusing the comment field collapses the browser range. Keep the exact
  // captured selection, not a fresh reading of the now-collapsed DOM range.
  const selection =
    citationDraft?.open && citationDraft.sessionId === sessionId
      ? citationDraft.selection
      : liveSelection;
  const [copied, setCopied] = useState<string | null>(null);
  // Identity only: response text would make every render serialize the whole reply.
  const selectionKey = selection
    ? JSON.stringify([sessionId, selection.responseId, selection.text])
    : null;

  const rail = useRef<HTMLDivElement>(null);
  const [menuWidth, setMenuWidth] = useState<number>();
  useLayoutEffect(() => {
    const toolbar = rail.current?.firstElementChild;
    if (!(toolbar instanceof HTMLElement)) return;
    // Targets arrive asynchronously. Measure the intrinsic tray, not the already
    // viewport-clamped popup. Include menu padding (8) and frame border (2).
    const measure = () => setMenuWidth(toolbar.offsetWidth + 10);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(toolbar);
    return () => observer.disconnect();
  }, [selectionKey, citationDraft?.open]);

  const [targets, setTargets] = useState<{ text: string; values: TranslationTarget[] } | null>(
    null,
  );
  useEffect(() => {
    if (!selection || !onTranslate) return;
    let cancelled = false;
    void translationTargets(selection.text).then(
      (values) => {
        if (!cancelled) setTargets({ text: selection.text, values });
      },
      () => {
        if (!cancelled) setTargets({ text: selection.text, values: ["en", "zh"] });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [selection?.text, Boolean(onTranslate)]);

  // Scrolling (also auto-scroll while a reply streams) or resizing moves the text under the menu.
  // Follow the live range instead of dropping the selection; only the loss of the selected text
  // dismisses. A selection that cannot be re-measured would keep a stale rect, so it is dismissed.
  const [geometry, setGeometry] = useState<{
    selection: TranscriptSelection;
    rect: DOMRect;
    visible: boolean;
  } | null>(null);
  const commentOpen = Boolean(citationDraft?.open && citationDraft.sessionId === sessionId);
  useEffect(() => {
    if (!selection) return;
    let frame = 0;
    const dismiss = () => {
      setCitationDraft((current) => current && { ...current, open: false });
      dismissSelection();
    };
    const refresh = () => {
      frame = 0;
      const next = selection.measure?.();
      if (!next) {
        // An open comment keeps the user's draft and its frozen source; only the anchor is lost.
        if (!commentOpen) dismiss();
        return;
      }
      setGeometry((current) =>
        current?.selection === selection &&
        current.visible === next.visible &&
        sameRect(current.rect, next.rect)
          ? current
          : { selection, ...next },
      );
    };
    const onMove = (event: Event) => {
      // Scrolling the action rail or comment must not move or discard its selection.
      if (
        event.target instanceof Element &&
        event.target.closest("[data-citation-comment], [data-selection-menu]")
      )
        return;
      if (!selection.measure) return dismiss();
      if (!frame) frame = requestAnimationFrame(refresh);
    };
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
    };
  }, [selection, commentOpen]);

  // Operation state belongs to the text it was started for: a selection that
  // goes away or is replaced directly by another drops pending/error state, and
  // a late result of the old one is ignored. An already started save continues.
  const selectionText = selectionKey;
  const [operations, setOperations] = useState<Operations>(() => ({
    text: selectionText,
    epoch: 0,
    pending: {},
    errors: {},
  }));
  if (operations.text !== selectionText) {
    setOperations({ text: selectionText, epoch: operations.epoch + 1, pending: {}, errors: {} });
  }
  const { pending, errors } = operations;
  const run = useSelectionOperationRunner(operations.epoch, setOperations, () => {
    setCitationDraft((current) => current && { ...current, open: false });
    window.getSelection()?.removeAllRanges();
    onDismiss();
  });
  if (!selection) return null;
  // A measurement belongs to the selection it was read for; a new selection starts from its own rect.
  const live = geometry?.selection === selection ? geometry : null;
  const anchor = live?.rect ?? selection.rect;
  // Scrolled out of view the toolbar is hidden, not discarded; it returns with the text. An open
  // comment stays, anchored at the nearest edge.
  if (live && !live.visible && !commentOpen) return null;

  const action = (
    id: string,
    label: string,
    icon: FloatingButtonGroupAction["icon"],
    onSelect: () => void | Promise<void>,
  ): FloatingButtonGroupAction => ({
    id,
    label,
    icon,
    loading: pending[id],
    onSelect: () => {
      void run(id, onSelect);
    },
  });
  const items: FloatingButtonGroupAction[] = [];
  items.push({
    ...action(
      "copy",
      copied === selectionKey ? t("Copied") : t("Copy"),
      copied === selectionKey ? <Check /> : <Copy />,
      () => {},
    ),
    onSelect: () =>
      void run(
        "copy",
        async () => {
          await (onCopy ? onCopy() : copyMessage(selection.text));
          setCopied(selectionKey);
        },
        false,
      ),
  });
  if (onAddToChat)
    items.push({
      ...action(
        "chat",
        addToChatLabel ??
          (sessionId && selection.responseId ? t("Add citation") : t("Add to chat")),
        <MessageSquarePlus />,
        () => onAddToChat(selection.text),
      ),
      onSelect: () => {
        // Read the occurrence now, while the live selection still exists; the draft keeps it.
        const resolved = resolveTranscriptSelection(selection);
        if (!sessionId || !selection.responseId || !resolved?.responseText) {
          void run("chat", () => onAddToChat(selection.text));
          return;
        }
        setCitationDraft((current) => ({
          sessionId,
          selection: resolved,
          comment:
            current &&
            current.sessionId === sessionId &&
            current.selection.responseId === resolved.responseId &&
            current.selection.text === resolved.text &&
            current.selection.occurrence === resolved.occurrence
              ? current.comment
              : "",
          open: true,
        }));
      },
    });
  for (const extra of extraActions ?? [])
    items.push(action(extra.id, extra.label, extra.icon, () => extra.onSelect(selection.text)));
  if (onTranslate) {
    if (allowReprompt)
      items.push(action("reprompt", t("Reprompt"), <Sparkles />, () => onTranslate("reprompt")));
    for (const target of targets?.text === selection.text ? targets.values : []) {
      items.push(
        action(
          `translate-${target}`,
          target === "en" ? t("Translate to English") : t("Translate to Chinese"),
          <Text size="caption" tone="inherit">
            {target === "en" ? "EN" : "中"}
          </Text>,
          () => onTranslate(target),
        ),
      );
    }
  }
  if (onAddToNotes)
    items.push(
      action("notes", t("Add to notes"), <FilePlusCorner />, () => onAddToNotes(selection.text)),
    );

  if (citationDraft?.open && citationDraft.sessionId === sessionId) {
    const closeComment = () => {
      setCitationDraft((current) => current && { ...current, open: false });
      onDismiss();
    };
    return (
      <Popover
        anchor={anchor}
        side="bottom"
        align="start"
        width={336}
        kind="dialog"
        aria-label={t("Add citation")}
        flow="scroll"
        onDismiss={closeComment}
        variant="panel"
        data-citation-comment
      >
        <div className={styles.comment}>
        <div className={styles.header}>
          <Text as="span" size="caption" tone="inherit" weight="medium" leading="inherit">
            {t("Add citation")}
          </Text>
          <Button variant="ghost" size="sm" iconOnly label={t("Close")} onClick={closeComment}>
            <X />
          </Button>
        </div>
        <Text as="div" size="caption" tone="secondary" leading="relaxed">
          <blockquote {...surfaceAttributes({ frame: "pane", edge: "inline-start" }, styles.quote)}>
            {selection.text}
          </blockquote>
        </Text>
        <TextareaField
          label={t("Comment")}
          placeholder={t("Add an optional comment…")}
          fieldSize="sm"
          minRows={2}
          maxRows={5}
          autosize
          value={citationDraft.comment}
          onChange={(event) =>
            setCitationDraft((current) => current && { ...current, comment: event.target.value })
          }
        />
        <div className={styles.footer}>
          <Button variant="ghost" size="sm" onClick={closeComment}>
            {t("Cancel")}
          </Button>
          <Button
            size="sm"
            loading={pending.chat}
            onClick={() =>
              void run("chat", () => {
                if (!sessionId || !selection.responseId || !selection.responseText || !onAddToChat)
                  return;
                onAddToChat(
                  serializeChatCitation({
                    version: 1,
                    id: crypto.randomUUID(),
                    sessionId,
                    blockId: selection.responseId,
                    text: selection.text,
                    sourceText: selection.responseText,
                    occurrence: selection.occurrence ?? 0,
                    comment: citationDraft.comment,
                  }),
                );
              })
            }
          >
            {t("Add to chat")}
          </Button>
        </div>
        {errors.chat ? <InlineError>{errors.chat}</InlineError> : null}
        </div>
      </Popover>
    );
  }

  return (
    <Popover
      anchor={anchor}
      side="top"
      align="center"
      width={menuWidth}
      onDismiss={(reason) => {
        if (reason === "escape") window.getSelection()?.removeAllRanges();
        onDismiss();
      }}
      variant="compact"
      data-selection-menu
    >
      {/* The rail owns scrolling on short viewports. */}
      <div ref={rail} className={styles.rail}>
        <FloatingButtonGroup
          label={t("Selected text actions")}
          items={items}
          orientation="horizontal"
          size="sm"
          preserveSelection
          className={styles.toolbar}
        />
        {items.map(({ id }) =>
          errors[id] ? (
            <InlineError key={id} inset="row">
              {id === "notes" ? t("Could not save note. ") : t("Could not complete this action. ")}
              {errors[id]}
            </InlineError>
          ) : null,
        )}
      </div>
    </Popover>
  );
}
