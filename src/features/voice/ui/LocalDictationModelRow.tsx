import { useRef, useState } from "react";
import { t } from "../../../shared/i18n";
import { Badge } from "../../../shared/ui/Badge";
import { Button } from "../../../shared/ui/Button";
import { DropdownMenu, type DropdownMenuItem } from "../../../shared/ui/DropdownMenu";
import { MoreHorizontal } from "../../../shared/ui/icons";
import { Progress } from "../../../shared/ui/Progress";
import { StatusText } from "../../../shared/ui/StatusText";
import type { LocalDictationModel, LocalModelJob } from "../model/localDictationModels";
import { VoicePreferenceRow as Row } from "./VoicePreferenceRow";

export type ModelCancelState = "requesting" | "requested" | null;

/** Cancels the running model job; the label follows the request until the Host reports a terminal state. */
export function ModelCancelButton({
  state,
  onCancel,
}: {
  state: ModelCancelState;
  onCancel: () => void;
}) {
  return (
    <Button
      variant="secondary"
      size="sm"
      disabled={state !== null}
      disabledReason={t("Cancellation was already requested.")}
      loading={state === "requesting"}
      loadingLabel={t("Requesting cancellation…")}
      onClick={onCancel}
    >
      {state === "requested" ? t("Cancellation requested") : t("Cancel")}
    </Button>
  );
}

/**
 * One model in the manager list: name, one muted meta line, and one action slot that keeps its place.
 * Not installed: Download. Working: progress and Cancel. Installed: status and an overflow menu.
 */
export function LocalDictationModelRow({
  model,
  selected,
  busy,
  working,
  pendingAction,
  progressText,
  progressValue,
  meta,
  cancelState,
  onDownload,
  onSelect,
  onTest,
  onDelete,
  onCancel,
}: {
  model: LocalDictationModel;
  selected: boolean;
  /** Some model job is starting or running, so every action is blocked. */
  busy: boolean;
  /** This model is the target of the running job, started by someone else or resumed. */
  working: boolean;
  /** This model's action is being started by this screen. */
  pendingAction: NonNullable<LocalModelJob["action"]> | null;
  /** Replaces the meta line while this model's job runs. */
  progressText: string;
  /** Bytes fraction 0-1 when the Host reports one, otherwise the bar is indeterminate. */
  progressValue: number | undefined;
  meta: string;
  cancelState: ModelCancelState;
  onDownload: () => void;
  onSelect: () => void;
  onTest: () => void;
  onDelete: () => void;
  onCancel: () => void;
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const unavailable = model.available === false;
  const items: DropdownMenuItem[] = [
    {
      kind: "item",
      id: "select",
      label: t("Select"),
      disabled: selected || unavailable,
      disabledReason: selected ? t("This model is already selected.") : undefined,
    },
    { kind: "item", id: "test", label: t("Test model load"), disabled: unavailable },
    { kind: "sep" },
    { kind: "item", id: "delete", label: t("Delete"), danger: true },
  ];
  const label = (
    <span className="inline-flex items-center gap-2">
      {model.label}
      {model.recommended ? <Badge size="xs">{t("Recommended")}</Badge> : null}
    </span>
  );
  return (
    <Row
      id={`dictation-local-${model.id}`}
      label={label}
      descriptionVisible
      description={working || pendingAction ? progressText : meta}
    >
      {pendingAction === "download" || (!working && !model.installed) ? (
        <Button
          variant="secondary"
          size="sm"
          disabled={busy || unavailable}
          disabledReason={unavailable ? t("Unavailable on this platform") : undefined}
          loading={pendingAction === "download"}
          loadingLabel={t("Downloading…")}
          onClick={onDownload}
        >
          {t("Download")}
        </Button>
      ) : working ? (
        <div className="flex items-center gap-2">
          <Progress compact className="min-w-0 flex-1" value={progressValue} max={1} />
          <ModelCancelButton state={cancelState} onCancel={onCancel} />
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <StatusText tone="done">{selected ? t("Selected") : t("Installed")}</StatusText>
          <Button
            ref={trigger}
            variant="ghost"
            size="sm"
            iconOnly
            label={t("Actions for {p0}", { p0: model.label })}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            disabled={busy}
            loading={pendingAction !== null}
            onClick={() => setMenuOpen(true)}
          >
            <MoreHorizontal className="icon-sm" aria-hidden />
          </Button>
          {menuOpen ? (
            <DropdownMenu
              anchor={trigger}
              returnFocusRef={trigger}
              label={t("Actions for {p0}", { p0: model.label })}
              items={items}
              side="bottom"
              align="end"
              size="sm"
              onClose={() => setMenuOpen(false)}
              onPick={(id) => {
                if (id === "select") onSelect();
                else if (id === "test") onTest();
                else if (id === "delete") onDelete();
              }}
            />
          ) : null}
        </div>
      )}
    </Row>
  );
}
