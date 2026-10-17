import { Button } from "../../shared/ui/Button";
import { t, useLocale } from "../../shared/i18n";
import { useEffect, useRef, type KeyboardEvent } from "react";
import {
  Archive,
  ArrowLeft,
  Bot,
  CircleDot,
  Folder,
  GitBranch,
  Inbox,
  Globe,
  Internet,
  Keyboard,
  Lock,
  MessageSquare,
  Palette,
  SlidersHorizontal,
  Sparkles,
  Terminal,
  type IconComponent,
} from "../../shared/ui/icons";
import { UsageIcon } from "./WorkspaceControls";
import { useLockOverscroll } from "../../shared/hooks/useLockOverscroll";
import {
  settingsSectionsByGroup,
  type SettingsSectionId,
} from "../../features/settings/model/settings";

export const SETTINGS_SECTION_ICONS: Record<SettingsSectionId, IconComponent> = {
  general: SlidersHorizontal,
  policies: Lock,
  notifications: CircleDot,
  workspace: Folder,
  connections: Internet,
  appearance: Palette,
  keybindings: Keyboard,
  terminal: Terminal,
  chat: MessageSquare,
  providers: Bot,
  usage: UsageIcon as IconComponent,
  mcp: Globe,
  skills: Sparkles,
  inbox: Inbox,
  worktrees: GitBranch,
  groupLock: Lock,
  archive: Archive,
};

type Props = {
  section: SettingsSectionId;
  onSelect: (section: SettingsSectionId) => void;
  onClose: () => void;
};

/** Body of the project rail while settings are open. */
export function SettingsNav({ section, onSelect, onClose }: Props) {
  useLocale();
  const lockOverscroll = useLockOverscroll<HTMLDivElement>();
  const rows = useRef(new Map<SettingsSectionId, HTMLButtonElement>());
  const groups = settingsSectionsByGroup();
  const sections = groups.flatMap((group) => group.sections);
  useEffect(() => {
    rows.current.get(section)?.scrollIntoView?.({ block: "nearest" });
  }, [section]);

  return (
    <>
      <div
        ref={lockOverscroll}
        aria-label={t("Settings")}
        role="navigation"
        className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto overscroll-none px-2 py-3"
      >
        {groups.map((group) => (
          <div key={group.id} className="flex flex-col gap-px">
            <div className="px-2 pb-1 text-xs font-semibold text-content/35 @max-[140px]/rail:hidden">
              {group.label}
            </div>
            {group.sections.map((item) => (
              <NavRow
                key={item.id}
                label={item.label}
                icon={SETTINGS_SECTION_ICONS[item.id]}
                active={item.id === section}
                tabIndex={item.id === section ? 0 : -1}
                buttonRef={(element) => {
                  if (element) rows.current.set(item.id, element);
                  else rows.current.delete(item.id);
                }}
                onKeyDown={(event) => {
                  const index = sections.findIndex((candidate) => candidate.id === item.id);
                  let next = index;
                  if (event.key === "ArrowDown" || event.key === "ArrowRight")
                    next = (index + 1) % sections.length;
                  else if (event.key === "ArrowUp" || event.key === "ArrowLeft")
                    next = (index - 1 + sections.length) % sections.length;
                  else if (event.key === "Home") next = 0;
                  else if (event.key === "End") next = sections.length - 1;
                  else return;
                  event.preventDefault();
                  event.stopPropagation();
                  const target = sections[next]!;
                  rows.current.get(target.id)?.focus();
                  onSelect(target.id);
                }}
                onClick={() => onSelect(item.id)}
              />
            ))}
          </div>
        ))}
      </div>
      <div className="flex shrink-0 flex-col gap-px p-2">
        <NavRow label={t("Back")} icon={ArrowLeft} onClick={onClose} />
      </div>
    </>
  );
}

function NavRow({
  label,
  icon: Icon,
  active = false,
  onClick,
  tabIndex,
  buttonRef,
  onKeyDown,
}: {
  label: string;
  icon: IconComponent;
  active?: boolean;
  onClick: () => void;
  tabIndex?: number;
  buttonRef?: (element: HTMLButtonElement | null) => void;
  onKeyDown?: (event: KeyboardEvent<HTMLButtonElement>) => void;
}) {
  useLocale();
  return (
    <Button
      selected={active}
      variant="item"
      motion="none"
      type="button"
      onClick={onClick}
      ref={buttonRef}
      tabIndex={tabIndex}
      onKeyDown={onKeyDown}
      title={label}
      aria-label={label}
      aria-current={active ? "true" : undefined}
      className={`flex w-full items-center gap-2 @max-[140px]/rail:justify-center `}
    >
      <Icon aria-hidden="true" className="size-4 shrink-0 opacity-70" strokeWidth={1.75} />
      <span className="min-w-0 flex-1 truncate text-sm font-medium leading-tight @max-[140px]/rail:hidden">
        {label}
      </span>
    </Button>
  );
}
