/** Different job: Selection toolbar and comment editor act on transcript ranges; they are not a value picker. */
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
import { type TranscriptSelection } from "../model/transcriptSelection";
import {
  translationTargets,
  type TranslationTarget,
  type TextActionTarget,
} from "../model/translation";

type Props = {
  selection: TranscriptSelection | null;
  onAddToChat?: (text: string) => void;
  onAddToNotes?: (text: string) => void | Promise<void>;
  onDismiss: () => void;
  onTranslate?: (target: TextActionTarget) => void;
  sessionId?: string;
  allowReprompt?: boolean;
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
    const message = error instanceof Error ? error.message : String(error);
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
  onAddToChat,
  onAddToNotes,
  onDismiss,
  onTranslate,
  sessionId,
  allowReprompt = false,
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
  const selectionKey = selection
    ? JSON.stringify([
        sessionId,
        selection.responseId,
        selection.occurrence,
        selection.text,
        selection.responseText,
      ])
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

  // Scrolling or resizing moves the text out from under the menu, so the
  // selection it acts on is gone; drop it rather than chase the range.
  useEffect(() => {
    if (!selection) return;
    const dismiss = (event: Event) => {
      // Scrolling the action rail or comment must not discard its selection.
      if (
        event.target instanceof Element &&
        event.target.closest("[data-citation-comment], [data-selection-menu]")
      )
        return;
      setCitationDraft((current) => current && { ...current, open: false });
      dismissSelection();
    };
    window.addEventListener("scroll", dismiss, true);
    window.addEventListener("resize", dismiss);
    return () => {
      window.removeEventListener("scroll", dismiss, true);
      window.removeEventListener("resize", dismiss);
    };
  }, [selection]);

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
          await copyMessage(selection.text);
          setCopied(selectionKey);
        },
        false,
      ),
  });
  if (onAddToChat)
    items.push({
      ...action(
        "chat",
        sessionId && selection.responseId ? t("Add citation") : t("Add to chat"),
        <MessageSquarePlus />,
        () => onAddToChat(selection.text),
      ),
      onSelect: () => {
        if (!sessionId || !selection.responseId || !selection.responseText) {
          void run("chat", () => onAddToChat(selection.text));
          return;
        }
        setCitationDraft((current) => ({
          sessionId,
          selection,
          comment:
            current &&
            current.sessionId === sessionId &&
            current.selection.responseId === selection.responseId &&
            current.selection.text === selection.text &&
            current.selection.occurrence === selection.occurrence
              ? current.comment
              : "",
          open: true,
        }));
      },
    });
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
        anchor={selection.rect}
        side="bottom"
        align="start"
        width={336}
        kind="dialog"
        aria-label={t("Add citation")}
        flow="scroll"
        onDismiss={closeComment}
        className={styles.comment}
        data-citation-comment
      >
        <Text
          as="div"
          size="caption"
          tone="inherit"
          weight="medium"
          leading="inherit"
          className={styles.header}
        >
          <span>{t("Add citation")}</span>
          <Button variant="ghost" size="sm" iconOnly label={t("Close")} onClick={closeComment}>
            <X />
          </Button>
        </Text>
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
      </Popover>
    );
  }

  return (
    <Popover
      anchor={selection.rect}
      side="top"
      align="center"
      width={menuWidth}
      onDismiss={(reason) => {
        if (reason === "escape") window.getSelection()?.removeAllRanges();
        onDismiss();
      }}
      className={styles.menu}
      data-selection-menu
    >
      {/* Raised popup family: the Popover owns surface, elevation and radius; the
          rows are compact and calm. This wrapper is the one scroll owner on
          short viewports. */}
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
            <InlineError key={id} className="px-2 py-1">
              {id === "notes" ? t("Could not save note. ") : t("Could not complete this action. ")}
              {errors[id]}
            </InlineError>
          ) : null,
        )}
      </div>
    </Popover>
  );
}
