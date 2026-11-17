import { useRef, useState, type ReactNode } from "react";
import { useT } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { DropdownMenu, type DropdownMenuItem } from "../../../shared/ui/DropdownMenu";
import { MoreHorizontal } from "../../../shared/ui/icons";
import styles from "./WorkspaceToolbar.module.css";

/** Keeps workspace actions inline until the pane needs its compact menu. */
export function WorkspaceToolbar({
  children,
  newAction,
  active,
  items,
  onPick,
}: {
  children: ReactNode;
  newAction: ReactNode;
  active: boolean;
  items: DropdownMenuItem[];
  onPick: (id: string, anchor: HTMLButtonElement) => void;
}) {
  const t = useT();
  const anchor = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <div className={styles.toolbar} data-session-selection-keep data-tauri-drag-region="false">
      <div className={styles.inline}>
        {children}
        <div className={styles.newAction}>{newAction}</div>
      </div>
      {items.length > 0 ? (
        <div className={styles.overflow}>
          <Button
            ref={anchor}
            iconOnly
            label={t("More actions")}
            variant="ghost"
            motion="none"
            selected={open || active}
            aria-haspopup="menu"
            aria-expanded={open}
            onClick={() => setOpen(!open)}
          >
            <MoreHorizontal className="icon-sm" />
          </Button>
          {open ? (
            <DropdownMenu
              anchor={anchor}
              label={t("More actions")}
              items={items}
              closeOnSelect
              onClose={() => setOpen(false)}
              onPick={(id) => {
                if (anchor.current) onPick(id, anchor.current);
              }}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
