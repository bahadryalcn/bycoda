import { useCopyFeedback } from "../../../shared/hooks/useCopyFeedback";
import { useT } from "../../../shared/i18n";
import {
  FloatingButtonGroup,
  type FloatingButtonGroupAction,
} from "../../../shared/ui/FloatingButtonGroup";
import { Check, Copy, FilePlusCorner, RotateCcw } from "../../../shared/ui/icons";
import { copyMessage } from "../../../platform/tauri/clipboard";
import { playCue } from "../../settings/model/sounds";

/** How long a confirmed result stays on the action that produced it. */
export const MESSAGE_ACTION_CONFIRM_MS = 2000;

type Feedback = ReturnType<typeof useCopyFeedback>;

/**
 * One finished turn's actions under its answer. Copy and Save keep their own pending, success and failure state here; the
 * shared group only draws what it is given. Success is announced only after the clipboard or Notes write actually settled,
 * a failure keeps its reason next to the group and turns the same action into Retry, and a running action cannot start twice.
 * The group stays a fixed icon tray, so no state changes the width of the actions or of the row around them.
 */
export function TurnOutputActions({
  getText,
  onSave,
  extraItems = [],
}: {
  getText?: () => string;
  onSave?: (text: string) => void | Promise<void>;
  /** Model menus and metric details; they keep their own state and overlays. */
  extraItems?: FloatingButtonGroupAction[];
}) {
  const t = useT();
  // Both outcomes belong to the text they were raised for: new text clears them and ignores a late result.
  const copy = useCopyFeedback({ resetKeys: [getText], successMs: MESSAGE_ACTION_CONFIRM_MS });
  const save = useCopyFeedback({ resetKeys: [getText], successMs: MESSAGE_ACTION_CONFIRM_MS });

  const run = (feedback: Feedback, task: (text: string) => void | Promise<void>) => {
    if (!getText) return;
    feedback.copy(async () => {
      await task(getText());
      playCue("copy");
    });
  };

  const items: FloatingButtonGroupAction[] = [
    ...(getText
      ? [
          {
            id: "copy",
            label: copy.copied
              ? t("Copied")
              : copy.failed
                ? t("Retry copy")
                : t("Copy response"),
            icon: copy.copied ? <Check /> : copy.failed ? <RotateCcw /> : <Copy />,
            tone: copy.copied ? "success" : copy.failed ? "danger" : undefined,
            loading: copy.pending,
            onSelect: () => run(copy, (text) => copyMessage(text)),
          } satisfies FloatingButtonGroupAction,
        ]
      : []),
    ...(getText && onSave
      ? [
          {
            id: "save",
            label: save.copied
              ? t("Saved to Notes")
              : save.failed
                ? t("Retry save")
                : t("Save as note"),
            icon: save.copied ? <Check /> : save.failed ? <RotateCcw /> : <FilePlusCorner />,
            tone: save.copied ? "success" : save.failed ? "danger" : undefined,
            loading: save.pending,
            onSelect: () => run(save, onSave),
          } satisfies FloatingButtonGroupAction,
        ]
      : []),
    ...extraItems,
  ];
  if (items.length === 0) return null;

  const failures = [
    copy.failed ? t("Copy failed. ") + (copy.error ?? "") : null,
    save.failed ? t("Could not save note. ") + (save.error ?? "") : null,
  ].filter((message): message is string => message !== null);

  return (
    <div className="flex min-w-0 max-w-full flex-wrap items-center gap-1">
      <FloatingButtonGroup
        label={t("Message actions")}
        variant="floating"
        size="sm"
        iconOnly
        items={items}
      />
      {/* Result words are no longer drawn on the icon, so the spoken confirmation lives here. */}
      <span role="status" className="sr-only">
        {copy.copied ? t("Copied") : save.copied ? t("Saved to Notes") : ""}
      </span>
      {failures.map((message) => (
        <span
          key={message}
          role="alert"
          className="min-w-0 max-w-xs text-ui-caption break-words text-(--ui-tone-danger-fg)"
        >
          {message}
        </span>
      ))}
    </div>
  );
}
