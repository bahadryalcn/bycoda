import { useT } from "../../../shared/i18n";
import { FilePlusCorner, MessageSquarePlus, Sparkles } from "../../../shared/ui/icons";
import { useEffect, useRef, useState } from "react";
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

export function TranscriptSelectionMenu({
  selection,
  onAddToChat,
  onAddToNotes,
  onDismiss,
  onTranslate,
}: Props) {
  const t = useT();
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;

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
    const dismiss = () => onDismissRef.current();
    window.addEventListener("scroll", dismiss, true);
    window.addEventListener("resize", dismiss);
    return () => {
      window.removeEventListener("scroll", dismiss, true);
      window.removeEventListener("resize", dismiss);
    };
  }, [selection]);

  const [pending, setPending] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const running = useRef(new Set<string>());
  const generation = useRef(0);
  // Operation state belongs to the text it was started for: a selection that
  // goes away or is replaced directly by another drops pending/error state, and
  // a late result of the old one is ignored. An already started save continues.
  const selectionText = selection?.text ?? null;
  useEffect(() => {
    generation.current += 1;
    running.current.clear();
    setPending({});
    setErrors({});
  }, [selectionText]);

  if (!selection) return null;

  const run = async (id: string, onSelect: () => void | Promise<void>) => {
    if (running.current.has(id)) return;
    running.current.add(id);
    const requestGeneration = generation.current;
    setPending((current) => ({ ...current, [id]: true }));
    setErrors((current) => ({ ...current, [id]: "" }));
    try {
      const result = onSelect();
      if (result) await result;
      if (requestGeneration !== generation.current) return;
      window.getSelection()?.removeAllRanges();
      onDismiss();
    } catch (error) {
      if (requestGeneration !== generation.current) return;
      setErrors((current) => ({
        ...current,
        [id]: error instanceof Error ? error.message : String(error),
      }));
    } finally {
      if (requestGeneration === generation.current) {
        running.current.delete(id);
        setPending((current) => ({ ...current, [id]: false }));
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
