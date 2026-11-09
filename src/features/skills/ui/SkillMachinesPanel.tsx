import type { ReactNode } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { PRODUCT_IDENTITY } from "../../../shared/lib/productIdentity";
import { Button } from "../../../shared/ui/Button";
import { Spinner } from "../../../shared/ui/Spinner";
import { Switch } from "../../../shared/ui/Switch";
import type { DiscoveredSkill } from "../../../platform/tauri/fs";
import { canTransferSkill } from "../model/transferSkill";
import {
  copyOn,
  type MachineSkillList,
  type SkillCopy,
  type SkillMachine,
} from "../model/skillLibrary";
import styles from "./SkillsPage.module.css";

export type MachineListState = MachineSkillList & {
  error: string | null;
  policyKnown: boolean;
};

/**
 * Where the shown skill exists: each machine offers to view or toggle its own copy,
 * or to be replaced by the shown one with the transfer's native confirmation.
 * Copying to a machine that lacks the skill is the library row's cloud action.
 */
export function SkillMachinesPanel({
  shown,
  lists,
  isOff,
  policyTarget,
  busy,
  transferBlocked,
  onToggle,
  onView,
  onCopy,
}: {
  shown: SkillCopy;
  lists: MachineListState[];
  isOff: (copy: SkillCopy) => boolean;
  policyTarget: string | null;
  busy: boolean;
  /** Why the shown copy cannot be sent yet (an unsaved draft), if anything. */
  transferBlocked: string | null;
  onToggle: (copy: SkillCopy, enabled: boolean) => void;
  onView: (copy: SkillCopy) => void;
  onCopy: (to: SkillMachine | null) => void;
}): ReactNode {
  useLocale();
  const sendable = canTransferSkill(shown.skill);
  const shownOn = shown.machine?.environmentId ?? "local";
  return (
    <ul className={styles.machines} aria-label={t("Machines")}>
      {lists.map((list) => {
        const id = list.machine?.environmentId ?? "local";
        const name = list.machine?.name ?? t("This computer");
        const copy: DiscoveredSkill | null = copyOn(list, shown.skill);
        const entry = copy ? { skill: copy, machine: list.machine } : null;
        const here = id === shownOn;
        const saving = entry ? policyTarget === JSON.stringify([id, copy?.path]) : false;
        const status =
          list.skills === null
            ? (list.error ?? t("Loading skills…"))
            : !entry
              ? t("Not installed")
              : !list.policyKnown
                ? t("Installed")
                : isOff(entry)
                  ? t("Installed, off")
                  : t("Installed, enabled");
        return (
          <li key={id} className={styles.machineRow} data-current={here || undefined}>
            <div className={styles.machineText}>
              <span className={styles.machineName}>{name}</span>
              <span
                className={styles.machineStatus}
                data-error={(list.skills === null && !!list.error) || undefined}
              >
                {status}
                {here ? ` · ${t("Shown")}` : ""}
              </span>
            </div>
            <div className={styles.machineActions}>
              {saving ? <Spinner size="xs" label={t("Saving…")} /> : null}
              {entry && !here ? (
                <Button variant="ghost" size="sm" onClick={() => onView(entry)}>
                  {t("View")}
                </Button>
              ) : null}
              {sendable && entry && !here ? (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy || !!transferBlocked}
                  disabledReason={transferBlocked ?? undefined}
                  aria-label={t("Replace {p0} on {p1}", { p0: shown.skill.name, p1: name })}
                  onClick={() => onCopy(list.machine)}
                >
                  {t("Replace…")}
                </Button>
              ) : null}
              {entry && list.policyKnown ? (
                <Switch
                  aria-label={t("Enable {p0} on {p1} in {p2}", {
                    p0: copy!.name,
                    p1: name,
                    p2: PRODUCT_IDENTITY.displayName,
                  })}
                  checked={!isOff(entry)}
                  disabled={policyTarget !== null}
                  onCheckedChange={(enabled) => onToggle(entry, enabled)}
                />
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
