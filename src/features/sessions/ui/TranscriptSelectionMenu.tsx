import { useT } from "../../../shared/i18n";
import { FilePlusCorner, MessageSquarePlus, Sparkles } from "../../../shared/ui/icons";
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
};

type Operations = {
  text: string | null;
  /** Bumped whenever the selected text changes; an operation only settles into its own epoch. */
  epoch: number;
  pending: Record<string, boolean>;
  errors: Record<string, string>;
};

export function TranscriptSelectionMenu({
  selection,
  onAddToChat,
  onAddToNotes,
  onDismiss,
  onTranslate,
}: Props) {
  const t = useT();
  const dismissSelection = useEffectEvent(() => onDismiss());

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
    const dismiss = () => dismissSelection();
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
  const selectionText = selection?.text ?? null;
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
  const running = useRef(new Set<string>());
  const epoch = useRef(operations.epoch);
  useLayoutEffect(() => {
    epoch.current = operations.epoch;
    running.current.clear();
  }, [operations.epoch]);

  if (!selection) return null;

  const run = async (id: string, onSelect: () => void | Promise<void>) => {
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
    try {
      const result = onSelect();
      if (result) await result;
      if (owner !== epoch.current) return;
      window.getSelection()?.removeAllRanges();
      onDismiss();
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
  };
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
  if (onTranslate) {
    items.push(action("reprompt", t("Reprompt"), <Sparkles />, () => onTranslate("reprompt")));
    for (const target of targets?.text === selection.text ? targets.values : []) {
      items.push(
        action(
          `translate-${target}`,
          target === "en" ? t("Translate to English") : t("Translate to Chinese"),
          <span className="text-xs">{target === "en" ? "EN" : "中"}</span>,
          () => onTranslate(target),
        ),
      );
    }
  }
  if (onAddToChat)
    items.push(
      action("chat", t("Add to chat"), <MessageSquarePlus />, () => onAddToChat(selection.text)),
    );
  if (onAddToNotes)
    items.push(
      action("notes", t("Add to notes"), <FilePlusCorner />, () => onAddToNotes(selection.text)),
    );

  return (
    <Popover
      anchor={selection.rect}
      side="top"
      align="center"
      width={232}
      onDismiss={(reason) => {
        if (reason === "escape") window.getSelection()?.removeAllRanges();
        onDismiss();
      }}
      className="p-1"
    >
      {/* Raised popup family: the Popover owns surface, elevation and radius; the
          rows are compact and calm. This wrapper is the one scroll owner on
          short viewports. */}
      <div className="max-h-[min(20rem,60vh)] overflow-y-auto overscroll-contain">
        <FloatingButtonGroup
          label={t("Selected text actions")}
          items={items}
          orientation="vertical"
          size="sm"
          preserveSelection
        />
        {items.map(({ id }) =>
          errors[id] ? (
            <span
              key={id}
              role="alert"
              className="block min-w-0 px-2 py-1 text-ui-caption text-(--ui-tone-danger-fg) break-words"
            >
              {id === "notes" ? t("Could not save note. ") : t("Could not complete this action. ")}
              {errors[id]}
            </span>
          ) : null,
        )}
      </div>
    </Popover>
  );
}
