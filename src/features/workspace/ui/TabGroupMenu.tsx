import { Divider } from "../../../shared/ui/Divider";
import { Text } from "../../../shared/ui/Text";
import { Alert } from "../../../shared/ui/Alert";
import { TextField } from "../../../shared/ui/TextField";
import { Button } from "../../../shared/ui/Button";
import { StatusDot } from "../../../shared/ui/StatusDot";
import { t, useLocale } from "../../../shared/i18n";
import {
  AppWindow,
  ImagePlus,
  Pencil,
  SquarePlus,
  Trash2,
  Ungroup,
  X,
  type IconComponent,
} from "../../../shared/ui/icons";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { normalizeHex } from "../../../shared/lib/colorUtils";
import { projectKey } from "../../../shared/lib/paths";
import { clearProjectLogo, pickAndSetProjectLogo } from "../../projects/model/projectLogos";
import { TAB_GROUP_COLORS } from "../model/tabGroups";
import { ColorPickerPopover, ColorSwatchRow } from "../../../shared/ui/ColorPickerPopover";
import {
  DropdownMenu,
  type DropdownMenuAction,
  type DropdownMenuItem,
} from "../../../shared/ui/DropdownMenu";
import { SectionLabel } from "../../../shared/ui/SectionLabel";
import { MenuRow as SharedMenuRow } from "../../../shared/ui/MenuRow";
import { ProjectLogoIcon } from "../../projects/ui/ProjectLogoIcon";
import { ProjectIconPicker } from "../../projects/ui/ProjectIconPicker";
import { RailBackgroundControls } from "../../projects/ui/RailBackgroundControls";
import type { RailBackgrounds } from "../model/tabGroups";
import { MOD } from "../../../platform/tauri/platform";
import type { ContextMenuItem } from "../../../shared/ui/ContextMenu";

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
  /** A status dot on the icon's corner; `label` names it for assistive tech. */
  badge?: { tone: "success" | "warning" | "danger"; label: string };
  danger?: boolean;
  sepBefore?: boolean;
  disabled?: boolean;
  submenu?: ContextMenuItem[];
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
  /** Name field caption and accessible name; "Group name" unless the menu is for a project. */
  nameLabel?: string;
  /** Read-only line under the name, such as the project's Git changes. */
  info?: ReactNode;
  railBackgrounds?: RailBackgrounds;
  onRailBackgroundChange?: (value: RailBackgrounds) => void;
  groupBackground?: boolean;
  compactAppearance?: boolean;
  /** Project appearance actions share the compact appearance flyout. */
  appearanceItems?: Pick<TabGroupMenuExtraItem, "id" | "label" | "icon" | "disabled" | "danger">[];
};

const MENU_WIDTH = 260;
const APPEARANCE_WIDTH = 296;

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
  nameLabel,
  info,
  railBackgrounds,
  onRailBackgroundChange,
  groupBackground = false,
  compactAppearance = false,
  appearanceItems,
}: Props) {
  useLocale();
  const pickExtra = (id: string) => {
    if (onExtraPick?.(id) !== false) onClose();
  };
  const nameCaption = nameLabel ?? t("Group name");
  const input = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(label);
  const [customPickerOpen, setCustomPickerOpen] = useState(false);
  const [logoError, setLogoError] = useState<string | null>(null);
  const [logoBusy, setLogoBusy] = useState(false);
  const logoOperation = useRef(false);

  useEffect(() => {
    const focusName = () => {
      input.current?.focus();
      input.current?.select();
    };
    focusName();
    // The menu moves focus to its first row once placed; the name field takes it back after that.
    const frame = requestAnimationFrame(focusName);
    return () => cancelAnimationFrame(frame);
  }, []);

  const trimmedName = name.trim();
  const nameError = validateName && trimmedName !== label.trim() ? validateName(trimmedName) : null;

  const commitName = () => {
    if (nameError) return false;
    onRename(groupId, trimmedName);
    return true;
  };

  const appearance = (
    <>
      {logoProject ? (
        <div className="mb-2 flex items-center gap-2 px-0.5">
          <Button
            iconOnly
            label={logoPath ? t("Change project logo") : t("Add project logo")}
            variant="ghost"
            motion="none"
            type="button"
            aria-label={logoPath ? t("Change project logo") : t("Add project logo")}
            loading={logoBusy}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              if (logoOperation.current) return;
              logoOperation.current = true;
              setLogoBusy(true);
              setLogoError(null);
              void (async () => {
                try {
                  const path = await pickAndSetProjectLogo(logoProject);
                  if (path) {
                    onLogoChange();
                    onClose();
                  }
                } catch (error) {
                  setLogoError(error instanceof Error ? error.message : String(error));
                } finally {
                  logoOperation.current = false;
                  setLogoBusy(false);
                }
              })();
            }}
            className="grid shrink-0 place-items-center"
          >
            <ProjectLogoIcon
              path={logoPath}
              className="size-5"
              imageClassName="size-5"
              fallback={ImagePlus}
              fallbackStrokeWidth={1.75}
            />
          </Button>
          <div className="min-w-0 flex-1">
            <Text as="p" size="caption" tone="muted">
              {t("Project logo")}
            </Text>
            <Text as="p" size="secondary" tone="secondary" truncate>
              {logoPath
                ? t("Shown in tabs and composer")
                : t("Optional. Replaces the folder icon.")}
            </Text>
          </div>
          {logoPath ? (
            <Button
              iconOnly
              label={t("Remove project logo")}
              variant="ghost"
              motion="none"
              type="button"
              aria-label={t("Remove project logo")}
              disabled={logoBusy}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                if (logoOperation.current) return;
                logoOperation.current = true;
                setLogoBusy(true);
                setLogoError(null);
                void clearProjectLogo(projectKey(logoProject))
                  .then(onLogoChange, (error) => {
                    setLogoError(error instanceof Error ? error.message : String(error));
                  })
                  .finally(() => {
                    logoOperation.current = false;
                    setLogoBusy(false);
                  });
              }}
              className="grid shrink-0 place-items-center"
            >
              <Trash2 className="icon-sm" strokeWidth={1.75} />
            </Button>
          ) : null}
        </div>
      ) : null}
      {logoError ? <Alert tone="danger">{logoError}</Alert> : null}

      <SectionLabel as="div" className="mb-1.5">
        {t("Color")}
      </SectionLabel>
      <div className="mb-3">
        <ColorSwatchRow
          className="grid grid-cols-5 justify-items-center gap-1"
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
        <div className="mb-3">
          <ColorPickerPopover
            value={customColor ?? normalizeHex(currentColor)}
            onChange={(color) => onCustomColorChange(groupId, color)}
          />
        </div>
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
      {appearanceItems?.length ? (
        <>
          <Divider className="my-1" />
          {appearanceItems.map((item) => (
            <MenuRow key={item.id} item={item} onPick={() => pickExtra(item.id)} />
          ))}
        </>
      ) : null}
    </>
  );

  const action = (
    item: Pick<
      TabGroupMenuExtraItem,
      "id" | "label" | "icon" | "description" | "danger" | "disabled" | "badge"
    >,
    extra: Partial<DropdownMenuAction> = {},
  ): DropdownMenuAction => {
    const Icon = item.icon;
    return {
      kind: "item",
      id: item.id,
      label: item.label,
      description: item.description,
      danger: item.danger,
      disabled: item.disabled,
      icon: item.badge ? (
        <span className="relative grid shrink-0 place-items-center">
          <Icon className="icon-sm" strokeWidth={1.75} />
          <StatusDot
            label={item.badge.label}
            tone={item.badge.tone}
            className="absolute -right-0.5 -bottom-0.5"
          />
        </span>
      ) : (
        <Icon className="icon-sm" strokeWidth={1.75} />
      ),
      ...extra,
    };
  };
  const SEP: DropdownMenuItem = { kind: "sep" };
  const items: DropdownMenuItem[] = [
    ...(leadingAction ? [action(leadingAction), SEP] : []),
    {
      kind: "content",
      id: "name",
      node: (
        <>
          <TextField
            fieldClassName="mb-2 min-w-0 flex-1"
            label={nameCaption}
            startAdornment={<Pencil className="icon-sm" strokeWidth={1.75} />}
            ref={input}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => void commitName()}
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              e.preventDefault();
              if (commitName()) onClose();
            }}
            aria-label={nameCaption}
            aria-invalid={nameError ? true : undefined}
          />
          {nameError ? <Alert tone="danger">{nameError}</Alert> : null}
        </>
      ),
    },
    ...(info ? [{ kind: "content", id: "info", node: info } as const] : []),
    compactAppearance
      ? action(
          { id: "appearance", label: t("Appearance"), icon: ImagePlus },
          { panel: appearance, submenuWidth: APPEARANCE_WIDTH },
        )
      : { kind: "content", id: "appearance-form", node: appearance },
    ...(showActions
      ? [
          SEP,
          ...ITEMS.slice(0, 2).map((item) => action(item, { shortcut: item.shortcut })),
          SEP,
          ...ITEMS.slice(2, 4).map((item) => action(item, { shortcut: item.shortcut })),
          SEP,
          ...ITEMS.slice(4).map((item) => action(item, { shortcut: item.shortcut })),
        ]
      : []),
    ...(extraItems?.length
      ? [
          SEP,
          ...extraItems.flatMap((item): DropdownMenuItem[] => [
            ...(item.sepBefore ? [SEP] : []),
            action(item, item.submenu ? { submenu: item.submenu } : {}),
          ]),
        ]
      : []),
    ...(footer ? [{ kind: "content", id: "footer", node: footer } as const] : []),
  ];
  const standard = new Set(ITEMS.map((item) => item.id));
  return (
    <DropdownMenu
      anchor={{ x, y }}
      side="right"
      align="start"
      gap={0}
      width={MENU_WIDTH}
      label={ariaLabel}
      items={items}
      // Standard actions are closed by the caller; extras close unless onExtraPick vetoes.
      closeOnSelect={false}
      onPick={(id) => (standard.has(id) ? onPick(id as TabGroupMenuAction) : pickExtra(id))}
      onClose={onClose}
    />
  );
}

function MenuRow({
  item,
  onPick,
}: {
  item: Pick<TabGroupMenuExtraItem, "id" | "label" | "icon" | "disabled" | "danger">;
  onPick: () => void;
}) {
  useLocale();
  const Icon = item.icon;
  return (
    <SharedMenuRow
      destructive={item.danger}
      type="button"
      role="menuitem"
      disabled={item.disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onPick}
    >
      <Icon className="icon-sm shrink-0" strokeWidth={1.75} />
      <Text
        as="span"
        size="inherit"
        tone="inherit"
        leading="snug"
        truncate
        className="min-w-0 flex-1"
      >
        {item.label}
      </Text>
    </SharedMenuRow>
  );
}
