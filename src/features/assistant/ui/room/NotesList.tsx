import { useState } from "react";
import { ContextMenu } from "../../../../shared/ui/ContextMenu";
import { Text } from "../../../../shared/ui/Text";
import type { AssistantNote } from "../../../../shared/model/host-contracts/assistant";
import { t } from "../../../../shared/i18n";
import { ActionHost, actionContentAttributes } from "../../../../shared/ui/ActionHost";
import { Badge } from "../../../../shared/ui/Badge";
import { Button } from "../../../../shared/ui/Button";
import { Checkbox } from "../../../../shared/ui/Checkbox";
import { Timestamp } from "../../../../shared/ui/Timestamp";
import { motionAttributes } from "../../../../shared/ui/Motion";
import { dailyNoteDay, notePreview } from "./assistantNoteDisplay";
import styles from "./NotesTab.module.css";

/**
 * Note rows: a selection checkbox (revealed on hover, focus or while any note is checked)
 * and the open-note button with title, age, one-line preview and a Daily badge.
 */
export function NotesList({
  notes,
  selectedId,
  onSelect,
  checked,
  onCheck,
  onEdit,
  onDelete,
}: {
  notes: readonly AssistantNote[];
  selectedId: string | undefined;
  onSelect: (id: string) => void;
  checked: ReadonlySet<string>;
  onCheck: (id: string, checked: boolean) => void;
  onEdit: (note: AssistantNote) => void;
  onDelete: (note: AssistantNote) => void;
}) {
  const selectionMode = checked.size > 0;
  const [menu, setMenu] = useState<{ note: AssistantNote; x: number; y: number } | null>(null);
  return (
    <>
      <ul className={styles.list} aria-label={t("Notes")}>
        {notes.map((note) => {
          const preview = notePreview(note.body);
          const isChecked = checked.has(note.id);
          return (
            <ActionHost
              as="li"
              key={note.id}
              className={styles.item}
              selected={note.id === selectedId || isChecked}
              onContextMenu={(event) => {
                event.preventDefault();
                setMenu({ note, x: event.clientX, y: event.clientY });
              }}
              onKeyDown={(event) => {
                if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
                event.preventDefault();
                const rect = event.currentTarget.getBoundingClientRect();
                setMenu({ note, x: rect.left, y: rect.bottom });
              }}
            >
              <Checkbox
                {...motionAttributes({ transition: "opacity", easing: "standard" })}
                {...actionContentAttributes(
                  {
                    phase: selectionMode || isChecked ? "always" : "interaction",
                    hide: "opacity",
                    focus: "within",
                  },
                  styles.check,
                )}
                data-action-inline=""
                data-visible={selectionMode || undefined}
                aria-label={t("Select {p0}", { p0: note.title })}
                checked={isChecked}
                onChange={(event) => onCheck(note.id, event.currentTarget.checked)}
              />
              <Button
                variant="item"
                aria-current={note.id === selectedId ? "true" : undefined}
                onClick={() => onSelect(note.id)}
              >
                <span className={styles.row}>
                  <span className={styles.rowTop}>
                    <Text
                      as="span"
                      size="body"
                      tone="inherit"
                      weight="medium"
                      leading="inherit"
                      truncate
                      className={styles.rowTitle}
                    >
                      {note.title}
                    </Text>
                    <Timestamp
                      className={styles.rowTime}
                      size="micro"
                      tone="muted"
                      leading="inherit"
                      value={note.updatedAt}
                      format="relative"
                      relativeStyle="narrow"
                    />
                  </span>
                  {preview && (
                    <Text
                      size="caption"
                      tone="secondary"
                      leading="inherit"
                      weight="regular"
                      truncate
                      className={styles.rowPreview}
                    >
                      {preview}
                    </Text>
                  )}
                  {dailyNoteDay(note) !== undefined && <Badge size="xs">{t("Daily")}</Badge>}
                </span>
              </Button>
            </ActionHost>
          );
        })}
      </ul>
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          ariaLabel={t("Note actions")}
          items={[
            { kind: "item", id: "open", label: t("Open") },
            { kind: "item", id: "edit", label: t("Edit") },
            {
              kind: "item",
              id: "select",
              label: checked.has(menu.note.id) ? t("Clear selection") : t("Select"),
            },
            { kind: "item", id: "delete", label: t("Delete"), danger: true },
          ]}
          onPick={(id) => {
            if (id === "open") onSelect(menu.note.id);
            if (id === "edit") onEdit(menu.note);
            if (id === "select") onCheck(menu.note.id, !checked.has(menu.note.id));
            if (id === "delete") onDelete(menu.note);
            setMenu(null);
          }}
          onClose={() => setMenu(null)}
        />
      )}
    </>
  );
}
