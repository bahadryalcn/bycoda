import { useState, type ReactNode } from "react";
import { t, useLocale } from "../../../shared/i18n/git";
import { Button } from "../../../shared/ui/Button";
import { DropdownMenu, type DropdownMenuItem } from "../../../shared/ui/DropdownMenu";
import { Text } from "../../../shared/ui/Text";
import {
  ChevronDown,
  ChevronRight,
  FolderTree,
  ListBullet,
  MoreHorizontal,
} from "../../../shared/ui/icons";
import type { ChangesView } from "../../settings";
import styles from "./CheckoutHeader.module.css";

export function FileSection({
  title,
  count,
  countLabel,
  open,
  onToggle,
  view,
  onToggleView,
  headerActions,
  headerExtra,
  children,
}: {
  title: string;
  count: number;
  countLabel?: string;
  open: boolean;
  onToggle: () => void;
  /** Without these there is no list/tree toggle: the section is always a list. */
  view?: ChangesView;
  onToggleView?: () => void;
  headerActions: {
    title: string;
    icon?: ReactNode;
    /** Short text shown instead of an icon. */
    label?: string;
    /** Secondary action: lives in the overflow menu instead of the header. */
    overflow?: boolean;
    /** Destructive action, set apart in the overflow menu. */
    danger?: boolean;
    onClick: () => void;
  }[];
  headerExtra?: ReactNode;
  children: ReactNode;
}) {
  useLocale();
  const [moreAnchor, setMoreAnchor] = useState<HTMLElement | null>(null);
  const overflow = headerActions.filter((action) => action.overflow);
  const direct = headerActions.filter((action) => !action.overflow);
  const toItem = (action: (typeof headerActions)[number]): DropdownMenuItem => ({
    kind: "item",
    id: action.title,
    label: action.title,
    icon: action.icon,
    danger: action.danger,
  });
  const normal = overflow.filter((action) => !action.danger).map(toItem);
  const danger = overflow.filter((action) => action.danger).map(toItem);
  const overflowItems: DropdownMenuItem[] = [
    ...normal,
    ...(normal.length && danger.length ? ([{ kind: "sep" }] as DropdownMenuItem[]) : []),
    ...danger,
  ];
  return (
    <div>
      {/* In a narrow pane the icon group wraps under the title instead of squeezing the title to
          nothing and overlapping the count (the title keeps a readable floor). */}
      <div className={styles.sectionHeader}>
        <Button
          size="sm"
          variant="item"
          motion="none"
          type="button"
          aria-expanded={open}
          tooltip={title}
          tooltipWhen="overflow"
          onClick={onToggle}
          className="flex min-w-28 flex-1 basis-28 items-center gap-1 text-left"
        >
          {open ? (
            <ChevronDown className="icon-sm shrink-0" tone="secondary" strokeWidth={1.75} />
          ) : (
            <ChevronRight className="icon-sm shrink-0" tone="secondary" strokeWidth={1.75} />
          )}
          <Text
            data-file-section-title
            size="caption"
            tone="secondary"
            weight="medium"
            truncate
            className="min-w-0"
          >
            {title}
          </Text>
          <Text size="caption" tone="secondary" className="ml-1 shrink-0 tabular-nums">
            {countLabel ?? count}
          </Text>
        </Button>
        <div className={styles.actionSlots}>
          <div className={styles.actionSlot}>{headerExtra}</div>
          <div className={styles.actionSlot}>
            {view && onToggleView ? (
              <Button
                size="sm"
                variant="ghost"
                motion="none"
                iconOnly
                label={view === "tree" ? t("View as List") : t("View as Tree")}
                onClick={onToggleView}
              >
                {view === "tree" ? (
                  <ListBullet className="icon-sm" strokeWidth={1.75} />
                ) : (
                  <FolderTree className="icon-sm" strokeWidth={1.75} />
                )}
              </Button>
            ) : null}
          </div>
          <div className={styles.actionSlot}>
            {overflow.length ? (
              <Button
                size="sm"
                variant="ghost"
                motion="none"
                iconOnly
                label={t("More actions")}
                onClick={(event) => setMoreAnchor(moreAnchor ? null : event.currentTarget)}
                aria-haspopup="menu"
                aria-expanded={!!moreAnchor}
              >
                <MoreHorizontal className="icon-sm" strokeWidth={1.75} />
              </Button>
            ) : null}
          </div>
          <div className={styles.actionSlot}>
            {direct.map((action) =>
              action.label ? (
                <Button
                  size="sm"
                  variant="ghost"
                  motion="none"
                  key={action.title}
                  type="button"
                  tooltip={action.title === action.label ? undefined : action.title}
                  aria-label={action.title}
                  onClick={action.onClick}
                  className="shrink-0"
                >
                  {action.label}
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="ghost"
                  motion="none"
                  iconOnly
                  key={action.title}
                  label={action.title}
                  onClick={action.onClick}
                >
                  {action.icon}
                </Button>
              ),
            )}
          </div>
        </div>
      </div>
      {moreAnchor ? (
        <DropdownMenu
          anchor={moreAnchor}
          label={t("More actions")}
          items={overflowItems}
          onPick={(id) => overflow.find((action) => action.title === id)?.onClick()}
          onClose={() => setMoreAnchor(null)}
        />
      ) : null}
      {open ? <ul>{children}</ul> : null}
    </div>
  );
}
