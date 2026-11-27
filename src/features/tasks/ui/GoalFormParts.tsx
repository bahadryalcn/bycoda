import { useState, type ReactNode } from "react";
import { t } from "../../../shared/i18n";
import { Disclosure } from "../../../shared/ui/Disclosure";
import { InfoPopover } from "../../../shared/ui/InfoPopover";
import { NumberField } from "../../../shared/ui/NumberField";
import { Text } from "../../../shared/ui/Text";
import type { RemoteMachine } from "../../connections";
import type { GoalDraft } from "../model/goalClient";
import { TaskFormRow, TaskFormSwitch } from "./TaskFormFields";
import {
  INITIAL_WORKSPACE_CHECKS,
  isWorkspaceValid,
  taskWorkspaceScope,
  type WorkspaceChecks,
} from "./TaskWorkspacePicker";

/** Each selected project must validate its own checkout on the selected Host. */
export function goalWorkspacesValid(
  draft: Pick<GoalDraft, "cwds" | "workspaces">,
  machine: RemoteMachine | undefined,
  checks: Readonly<Record<string, WorkspaceChecks>>,
): boolean {
  return draft.cwds.every((cwd) => {
    const scope = taskWorkspaceScope(machine, cwd);
    return isWorkspaceValid(
      draft.workspaces?.[cwd],
      checks[scope] ?? INITIAL_WORKSPACE_CHECKS,
      scope,
    );
  });
}

export function TaskMoreOptions({
  summary,
  children,
}: {
  summary: readonly (string | false | undefined)[];
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const hint = summary.filter(Boolean).join(" · ");
  return (
    <Disclosure
      variant="compact"
      open={open}
      onOpenChange={setOpen}
      summary={
        <>
          {t("More options")}
          {!open && hint ? (
            <Text truncate size="caption" tone="muted" className="task-form-summary-hint">
              · {hint}
            </Text>
          ) : null}
        </>
      }
    >
      <div className="task-more-options">{children}</div>
    </Disclosure>
  );
}

export function GoalContinueSwitch({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <TaskFormSwitch
      label={t("Keep fixing until done")}
      help={t("Keeps correcting while progress is made; asks for input when needed.")}
      checked={checked}
      onChange={onChange}
    />
  );
}

/** Zero uses the machine limit. Keep incomplete input while retaining the last valid value. */
export function GoalConcurrencyOption({
  value,
  onChange,
  onValidityChange,
}: {
  value: number;
  onChange: (value: number) => void;
  onValidityChange: (valid: boolean) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const label = t("Concurrent tasks in this epic");
  return (
    <TaskFormRow
      label={
        <span className="inline-flex items-center gap-1">
          {label}
          <InfoPopover>{t("0 = use machine limit")}</InfoPopover>
        </span>
      }
    >
      <NumberField
        hideLabel
        label={label}
        fieldVariant="compact"
        fieldClassName="w-24"
        min={0}
        step={1}
        value={draft ?? String(value)}
        aria-invalid={draft !== null || undefined}
        onChange={(event) => {
          const text = event.currentTarget.value;
          const count = Number(text);
          const valid = text.trim() !== "" && Number.isSafeInteger(count) && count >= 0;
          setDraft(valid ? null : text);
          onValidityChange(valid);
          if (valid) onChange(count);
        }}
      />
    </TaskFormRow>
  );
}
