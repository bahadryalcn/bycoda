import { t, useLocale } from "../../../shared/i18n";
import {
  AppWindow,
  ChevronRight,
  ImagePlus,
  SquarePlus,
  Trash2,
  Ungroup,
  X,
  type IconComponent,
} from "../../../shared/ui/icons";
import {
  Fragment,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { normalizeHex } from "../../../shared/lib/colorUtils";
import { projectKey } from "../../../shared/lib/paths";
import { clearProjectLogo, pickAndSetProjectLogo } from "../../projects/model/projectLogos";
import { TAB_GROUP_COLORS } from "../model/tabGroups";
import { ColorPickerPopover, ColorSwatchRow } from "../../../shared/ui/ColorPickerPopover";
import { Popover } from "../../../shared/ui/Popover";
import {
  ContextMenuRow,
  contextMenuRowClassName,
} from "../../../shared/ui/arc/context-menu/context-menu";
import { ProjectLogoIcon } from "../../projects/ui/ProjectLogoIcon";
import { ProjectIconPicker } from "../../projects/ui/ProjectIconPicker";
import { RailBackgroundControls } from "../../projects/ui/RailBackgroundControls";
import type { RailBackgrounds } from "../model/tabGroups";
import { MOD } from "../../../platform/tauri/platform";
import { ExplorerMenu, type ExplorerMenuItem } from "../../files/ui/ExplorerMenu";

export type TabGroupMenuAction =
  | "new-tab"
  | "new-window"
  | "close-group"
  | "ungroup"
  | "delete-group";

export type TabGroupMenuExtraItem = {
  id: string;
  label: string;
  description?: string;
  icon: IconComponent;
  danger?: boolean;
  sepBefore?: boolean;
  disabled?: boolean;
  submenu?: ExplorerMenuItem[];
};

type Props = {
  x: number;
  y: number;
  groupId: string;
  label: string;
  colorIndex: number | null;
  customColor: string | null;
  currentColor: string;
  logoPath: string | null;
  /** Original project directory for the logo picker. */
  logoProject?: string | null;
  /** Explicit mascot pick; null means the one hashed from `mascotProject`. */
  mascotName: string | null;
  /** Key the fallback mascot is hashed from — same one the icon uses. */
  mascotProject: string;
  onRename: (groupId: string, label: string) => void;
  /** Why a changed name cannot be saved, or null. A rejected name is not saved and keeps the menu open. */
  validateName?: (name: string) => string | null;
  onColorChange: (groupId: string, colorIndex: number | null) => void;
  onCustomColorChange: (groupId: string, color: string) => void;
  onMascotChange: (groupId: string, name: string | null) => void;
  onLogoChange: () => void;
  onPick: (action: TabGroupMenuAction) => void;
  onClose: () => void;
  ariaLabel?: string;
  /** When false, only name / logo / color controls are shown. */
  showActions?: boolean;
  /** Active state action shown before the name and appearance controls. */
  leadingAction?: Pick<TabGroupMenuExtraItem, "id" | "label" | "description" | "icon">;
  extraItems?: TabGroupMenuExtraItem[];
  /** Return false to keep the menu open after validation or persistence errors. */
  onExtraPick?: (id: string) => void | boolean;
  footer?: ReactNode;
  railBackgrounds?: RailBackgrounds;
  onRailBackgroundChange?: (value: RailBackgrounds) => void;
  groupBackground?: boolean;
  compactAppearance?: boolean;
};

const MENU_WIDTH = 260;

type MenuItem = {
  id: string;
  label: string;
  shortcut?: string;
  danger?: boolean;
  icon: IconComponent;
};

const ITEMS: MenuItem[] = [
  {
    id: "new-tab",
    get label() {
      return t("New tab in group");
    },
    shortcut: `${MOD}T`,
    icon: SquarePlus,
  },
  {
    id: "new-window",
    get label() {
      return t("Move group to new window");
    },
    icon: AppWindow,
  },
  {
    id: "close-group",
    get label() {
      return t("Close group");
    },
    shortcut: `${MOD}W`,
    icon: X,
  },
  {
    id: "ungroup",
    get label() {
      return t("Ungroup");
    },
    icon: Ungroup,
  },
  {
    id: "delete-group",
    get label() {
      return t("Delete group");
    },
    danger: true,
    icon: Trash2,
  },
];

export function TabGroupMenu({
  x,
  y,
  groupId,
  label,
  colorIndex,
  customColor,
  currentColor,
  logoPath,
  logoProject,
  mascotName,
  mascotProject,
  onRename,
  validateName,
  onColorChange,
  onCustomColorChange,
  onMascotChange,
  onLogoChange,
  onPick,
  onClose,
  ariaLabel = "Tab group actions",
  showActions = true,
  leadingAction,
  extraItems,
  onExtraPick,
  footer,
  railBackgrounds,
  onRailBackgroundChange,
  groupBackground = false,
  compactAppearance = false,
}: Props) {
  useLocale();
  const menuId = useId();
  const [submenu, setSubmenu] = useState<{
    item: TabGroupMenuExtraItem;
    anchor: HTMLButtonElement;
  } | null>(null);
  const submenuCloseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelSubmenuClose = () => {
    if (submenuCloseTimer.current != null) clearTimeout(submenuCloseTimer.current);
    submenuCloseTimer.current = null;
  };
  const closeSubmenu = () => {
    cancelSubmenuClose();
    submenu?.anchor.focus();
    setSubmenu(null);
  };
  const scheduleSubmenuClose = () => {
    cancelSubmenuClose();
    if (submenu) submenuCloseTimer.current = setTimeout(closeSubmenu, 180);
  };
  useEffect(() => cancelSubmenuClose, [submenu]);
  const pickExtra = (id: string) => {
    if (onExtraPick?.(id) !== false) onClose();
  };
  const input = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(label);
  const [customPickerOpen, setCustomPickerOpen] = useState(false);
  const [appearanceAnchor, setAppearanceAnchor] = useState<HTMLButtonElement | null>(null);

  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);

  const trimmedName = name.trim();
  const nameError = validateName && trimmedName !== label.trim() ? validateName(trimmedName) : null;

  const commitName = () => {
    if (nameError) return false;
    onRename(groupId, trimmedName);
    return true;
  };

  const onMenuKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Enter" && e.target === input.current) {
      e.preventDefault();
      if (commitName()) onClose();
    }
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) {
      const rows = [
        ...e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)'),
      ];
      if (!rows.length) return;
      e.preventDefault();
      const index = rows.indexOf(document.activeElement as HTMLButtonElement);
      const next =
        e.key === "Home"
          ? 0
          : e.key === "End"
            ? rows.length - 1
            : (index + (e.key === "ArrowUp" ? -1 : 1) + rows.length) % rows.length;
      rows[next]?.focus();
    }
  };

  const appearance = (
    <>
      {logoProject ? (
        <div className="mb-2 flex items-center gap-2 px-0.5">
          <button
            type="button"
            title={logoPath ? t("Change project logo") : t("Add project logo")}
            aria-label={logoPath ? t("Change project logo") : t("Add project logo")}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              void (async () => {
                try {
                  const path = await pickAndSetProjectLogo(logoProject);
                  if (path) onLogoChange();
                } catch (error) {
                  console.error("Failed to save project logo:", error);
                } finally {
                  onClose();
                }
              })();
            }}
            className="grid size-9 shrink-0 place-items-center rounded-lg border border-content/10 bg-content/5 hover:bg-content/10"
          >
            <ProjectLogoIcon
              path={logoPath}
              className="size-5"
              imageClassName="size-5"
              fallback={ImagePlus}
              fallbackStrokeWidth={1.75}
            />
          </button>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] text-content/50">{t("Project logo")}</p>
            <p className="truncate text-[12px] text-content/70">
              {logoPath ? t("Shown in tabs and composer") : t("Optional — replaces folder icon")}
            </p>
          </div>
          {logoPath ? (
            <button
              type="button"
              title={t("Remove project logo")}
              aria-label={t("Remove project logo")}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                void clearProjectLogo(projectKey(logoProject)).then(onLogoChange);
              }}
              className="grid size-7 shrink-0 place-items-center rounded-md text-content/50 hover:bg-content/10 hover:text-content"
            >
              <Trash2 className="size-3.5" strokeWidth={1.75} />
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="mb-2">
        <ColorSwatchRow
          colors={TAB_GROUP_COLORS}
          colorIndex={colorIndex}
          customColor={customColor}
          customPickerOpen={customPickerOpen}
          onPickIndex={(index) => {
            setCustomPickerOpen(false);
            onColorChange(groupId, index === 0 ? null : index);
          }}
          onToggleCustom={() => setCustomPickerOpen((open) => !open)}
        />
      </div>

      {customPickerOpen ? (
        <ColorPickerPopover
          value={customColor ?? normalizeHex(currentColor)}
          onChange={(color) => onCustomColorChange(groupId, color)}
        />
      ) : null}

      <ProjectIconPicker
        project={mascotProject}
        name={mascotName}
        color={currentColor}
        onPick={(name) => onMascotChange(groupId, name)}
      />

      {railBackgrounds && onRailBackgroundChange ? (
        <RailBackgroundControls
          value={railBackgrounds}
          color={normalizeHex(currentColor)}
          group={groupBackground}
          onChange={onRailBackgroundChange}
        />
      ) : null}
    </>
  );

  return (
    <>
      <Popover
        anchor={{ x, y }}
        side="right"
        gap={0}
        width={MENU_WIDTH}
        constrainHeight
        onDismiss={(reason) => {
          if (reason === "escape" && appearanceAnchor) {
            appearanceAnchor.focus();
            setAppearanceAnchor(null);
          } else if (reason === "escape" && submenu) closeSubmenu();
          else onClose();
        }}
        ignore={`[data-menu-owner="${menuId}"]`}
        data-menu-owner={menuId}
        role="menu"
        tabIndex={-1}
        aria-label={ariaLabel}
        onKeyDown={onMenuKey}
        onContextMenu={(e) => e.preventDefault()}
        onMouseEnter={cancelSubmenuClose}
        onMouseLeave={scheduleSubmenuClose}
        className="bycoda-arc overflow-y-auto overscroll-contain p-2"
      >
        {leadingAction ? (
          <>
            <MenuRow
              item={leadingAction}
              onHover={() => setSubmenu(null)}
              onPick={() => pickExtra(leadingAction.id)}
            />
            <div role="separator" className="my-1 h-px bg-content/10" />
          </>
        ) : null}
        <input
          ref={input}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => void commitName()}
          aria-label={t("Group name")}
          aria-invalid={nameError ? true : undefined}
          className="mb-2 w-full rounded-lg border border-content/10 bg-content/5 px-2.5 py-1.5 text-[13px] text-content outline-none ring-accent/40 focus:ring-1"
        />
        {nameError ? (
          <p role="alert" className="-mt-1 mb-2 px-0.5 text-xs leading-snug text-danger">
            {nameError}
          </p>
        ) : null}

        {compactAppearance ? (
          <MenuRow
            item={{ id: "appearance", label: t("Appearance"), icon: ImagePlus, submenu: [] }}
            expanded={appearanceAnchor != null}
            onHover={(anchor) => {
              setSubmenu(null);
              setAppearanceAnchor(anchor);
            }}
            onPick={(anchor) => {
              setSubmenu(null);
              setAppearanceAnchor(anchor);
            }}
          />
        ) : (
          appearance
        )}

        {showActions ? (
          <>
            <div className="my-1 h-px bg-content/10" />

            {ITEMS.slice(0, 2).map((item) => (
              <MenuRow
                key={item.id}
                item={item}
                onHover={() => setSubmenu(null)}
                onPick={() => onPick(item.id as TabGroupMenuAction)}
              />
            ))}

            <div className="my-1 h-px bg-content/10" />

            {ITEMS.slice(2, 4).map((item) => (
              <MenuRow
                key={item.id}
                item={item}
                onHover={() => setSubmenu(null)}
                onPick={() => onPick(item.id as TabGroupMenuAction)}
              />
            ))}

            <div className="my-1 h-px bg-content/10" />

            {ITEMS.slice(4).map((item) => (
              <MenuRow
                key={item.id}
                item={item}
                onHover={() => setSubmenu(null)}
                onPick={() => onPick(item.id as TabGroupMenuAction)}
              />
            ))}
          </>
        ) : null}

        {extraItems && extraItems.length > 0 ? (
          <>
            <div className="my-1 h-px bg-content/10" />
            {extraItems.map((item) => (
              <Fragment key={item.id}>
                {item.sepBefore ? (
                  <div role="separator" className="my-1 h-px bg-content/10" />
                ) : null}
                <MenuRow
                  item={item}
                  expanded={submenu?.item.id === item.id}
                  onHover={(anchor) => {
                    setAppearanceAnchor(null);
                    setSubmenu(item.submenu && !item.disabled ? { item, anchor } : null);
                  }}
                  onPick={(anchor) => {
                    setAppearanceAnchor(null);
                    if (item.submenu) setSubmenu({ item, anchor });
                    else pickExtra(item.id);
                  }}
                />
              </Fragment>
            ))}
          </>
        ) : null}
        {footer}
      </Popover>
      {compactAppearance && appearanceAnchor ? (
        <Popover
          anchor={appearanceAnchor}
          side="right"
          align="start"
          gap={4}
          width={MENU_WIDTH}
          constrainHeight
          role="dialog"
          tabIndex={-1}
          autoFocus
          aria-label={t("Appearance")}
          data-menu-owner={menuId}
          ignore={`[data-menu-owner="${menuId}"]`}
          onDismiss={(reason) => {
            if (reason === "outside") onClose();
            else {
              appearanceAnchor.focus();
              setAppearanceAnchor(null);
            }
          }}
          className="bycoda-arc overflow-y-auto overscroll-contain p-2"
        >
          {appearance}
        </Popover>
      ) : null}
      {submenu?.item.submenu ? (
        <ExplorerMenu
          className="bycoda-arc"
          rowClassName={contextMenuRowClassName}
          anchor={submenu.anchor}
          ownerId={menuId}
          ariaLabel={submenu.item.label}
          items={submenu.item.submenu}
          onPick={pickExtra}
          onBack={closeSubmenu}
          onClose={closeSubmenu}
          onMouseEnter={cancelSubmenuClose}
          onMouseLeave={scheduleSubmenuClose}
        />
      ) : null}
    </>
  );
}

function MenuRow({
  item,
  onPick,
  onHover,
  expanded,
}: {
  item: MenuItem & Pick<TabGroupMenuExtraItem, "disabled" | "submenu" | "description">;
  onPick: (anchor: HTMLButtonElement) => void;
  onHover?: (anchor: HTMLButtonElement) => void;
  expanded?: boolean;
}) {
  useLocale();
  const Icon = item.icon;
  return (
    <ContextMenuRow
      destructive={item.danger}
      branchWidth={item.id === "appearance" ? MENU_WIDTH : 228}
      type="button"
      role="menuitem"
      disabled={item.disabled}
      aria-haspopup={item.submenu ? "menu" : undefined}
      aria-expanded={item.submenu ? expanded : undefined}
      aria-label={item.description ? item.label : undefined}
      aria-description={item.description}
      onMouseDown={(e) => e.preventDefault()}
      onMouseEnter={(e) => onHover?.(e.currentTarget)}
      onClick={(e) => onPick(e.currentTarget)}
      onKeyDown={(e) => {
        if (item.submenu && e.key === "ArrowRight") {
          e.preventDefault();
          onPick(e.currentTarget);
        }
      }}
    >
      <Icon className="size-3.5 shrink-0 text-content/55" strokeWidth={1.75} />
      <span className={`min-w-0 flex-1 leading-label ${item.description ? "py-2" : "truncate"}`}>
        {item.label}
        {item.description ? (
          <span className="mt-1 block text-[11px] leading-snug text-content/60">
            {item.description}
          </span>
        ) : null}
      </span>
      {item.submenu ? (
        <ChevronRight
          data-branch-indicator
          className="size-3.5 shrink-0 text-content/50"
          strokeWidth={1.75}
        />
      ) : null}
      {item.shortcut ? (
        <span className="shrink-0 text-[11px] text-content/40">{item.shortcut}</span>
      ) : null}
    </ContextMenuRow>
  );
}
