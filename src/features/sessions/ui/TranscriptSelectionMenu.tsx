import { t, useLocale } from "../../../shared/i18n";
import { FilePlusCorner, MessageSquarePlus } from "../../../shared/ui/icons";
import { useEffect, useRef, useState } from "react";
import { Popover } from "../../../shared/ui/Popover";
import {
  FloatingButtonGroup,
  type FloatingButtonGroupAction,
} from "../../../shared/ui/FloatingButtonGroup";
import { type TranscriptSelection } from "../model/transcriptSelection";
import { translationTargets, type TranslationTarget } from "../model/translation";

type Props = {
  selection: TranscriptSelection | null;
  onAddToChat?: (text: string) => void;
  onAddToNotes?: (text: string) => void | Promise<void>;
  onDismiss: () => void;
  onTranslate?: (target: TranslationTarget) => void;
};

export function TranscriptSelectionMenu({
  selection,
  onAddToChat,
  onAddToNotes,
  onDismiss,
  onTranslate,
}: Props) {
  useLocale();
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
  useEffect(() => {
    if (selection) return;
    generation.current += 1;
    running.current.clear();
    setPending({});
    setErrors({});
  }, [selection]);

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
      width={248}
      onDismiss={(reason) => {
        if (reason === "escape") window.getSelection()?.removeAllRanges();
        onDismiss();
      }}
      className="p-1.5"
    >
      <FloatingButtonGroup
        label={t("Selected text actions")}
        items={items}
        orientation="vertical"
        preserveSelection
      />
      {items.map(({ id }) =>
        errors[id] ? (
          <span
            key={id}
            role="alert"
            className="min-w-0 px-3 py-1 text-xs text-(--ui-text-secondary) break-words"
          >
            {t("Could not save note. ")}
            {errors[id]}
          </span>
        ) : null,
      )}
    </Popover>
  );
}
