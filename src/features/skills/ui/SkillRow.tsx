import { surfaceAttributes } from "../../../shared/ui/Surface";
import { Text } from "../../../shared/ui/Text";
import type { ReactNode } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { OverflowTooltip } from "../../../shared/ui/Tooltip";
import { Check, CloudUpload, MoreHorizontal } from "../../../shared/ui/icons";
import type { SkillEntry, SkillMachine, SkillPresence } from "../model/skillLibrary";
import styles from "./SkillsPage.module.css";

/** One column per machine: this computer first, then each connected machine. */
export type SkillMachineCell = { machine: SkillMachine | null; name: string; state: SkillPresence };

/** Column headings aligned with the machine cells of every row. */
export function SkillMachineColumns({ names }: { names: string[] }): ReactNode {
  useLocale();
  return (
    <Text
      as="div"
      size="caption"
      tone="secondary"
      leading="inherit"
      {...surfaceAttributes(
        { variant: "workspace-panel", frame: "pane", edge: "block-end" },
        styles.columns,
      )}
      aria-hidden="true"
    >
      <span className={styles.columnsName}>{t("Skill")}</span>
      {names.map((name) => (
        <OverflowTooltip key={name} label={name}>
          <Text as="span" size="inherit" tone="inherit" truncate className={styles.cell}>
            {name}
          </Text>
        </OverflowTooltip>
      ))}
      <span className={styles.menuSlot} />
    </Text>
  );
}

/** One library row: name, draft and preference marks, a cell per machine and the actions menu. */
export function SkillRow({
  entry,
  selected,
  modified,
  off,
  busy,
  cells,
  previewId,
  previewOpen,
  disabled,
  actionsOpen,
  nameRef,
  onOpen,
  onActions,
  copy,
}: {
  entry: SkillEntry;
  selected: boolean;
  modified: boolean;
  off: boolean;
  busy: boolean;
  cells: SkillMachineCell[] | null;
  previewId: string;
  previewOpen: boolean;
  disabled: boolean;
  actionsOpen: boolean;
  nameRef: (button: HTMLButtonElement | null) => void;
  onOpen: () => void;
  onActions: (anchor: HTMLElement) => void;
  /** A missing cell offers a copy only when the skill can be transferred. */
  copy: {
    transferable: boolean;
    blocked: string | null;
    loading: boolean;
    disabled: boolean;
    onCopy: (target: SkillMachine | null) => void;
  };
}): ReactNode {
  useLocale();
  const { skill } = entry.primary;
  return (
    <div
      className={styles.row}
      data-selected={selected || undefined}
      data-off={off || undefined}
      aria-busy={busy}
    >
      <Button
        variant="item"
        selected={selected}
        className={styles.name}
        aria-label={entry.name}
        ref={nameRef}
        aria-controls={previewOpen ? previewId : undefined}
        aria-expanded={selected}
        tooltip={skill.description || entry.name}
        tooltipWhen={skill.description && skill.description !== entry.name ? "always" : "overflow"}
        disabled={disabled}
        onClick={onOpen}
      >
        <Text
          as="span"
          size="inherit"
          tone={off ? "secondary" : "inherit"}
          truncate
          className={styles.skillName}
        >
          {entry.name}
        </Text>
        {modified ? <span title={t("Draft")}>·</span> : null}
      </Button>
      {off ? (
        <Text size="caption" tone="secondary" leading="inherit" className={styles.offLabel}>
          {t("Off")}
        </Text>
      ) : null}
      {cells?.map((cell) => {
        const key = cell.machine?.environmentId ?? "local";
        if (cell.state === "missing" && copy.transferable) {
          const label = t("Copy {p0} to {p1}", { p0: entry.name, p1: cell.name });
          return (
            <span key={key} className={styles.cell}>
              <Button
                variant="ghost"
                iconOnly
                size="sm"
                label={label}
                loading={copy.loading}
                disabled={copy.disabled || !!copy.blocked}
                disabledReason={copy.blocked ?? undefined}
                onClick={() => copy.onCopy(cell.machine)}
              >
                <CloudUpload className="icon-sm" aria-hidden="true" />
              </Button>
            </span>
          );
        }
        const label =
          cell.state === "present"
            ? t("On {p0}", { p0: cell.name })
            : cell.state === "missing"
              ? t("Missing on {p0}", { p0: cell.name })
              : t("Checking {p0}", { p0: cell.name });
        return (
          <Text
            as="span"
            size="inherit"
            tone={cell.state === "missing" || cell.state === "unknown" ? "secondary" : "inherit"}
            key={key}
            className={styles.cell}
            data-state={cell.state}
            role="img"
            aria-label={label}
            title={label}
          >
            {cell.state === "present" ? <Check className="icon-sm" aria-hidden="true" /> : "–"}
          </Text>
        );
      })}
      <Button
        variant="ghost"
        iconOnly
        size="sm"
        className={styles.rowMenu}
        label={t("Actions for {p0}", { p0: entry.name })}
        aria-haspopup="menu"
        aria-expanded={actionsOpen}
        onClick={(event) => onActions(event.currentTarget)}
      >
        <MoreHorizontal className="icon-sm" aria-hidden="true" />
      </Button>
    </div>
  );
}
