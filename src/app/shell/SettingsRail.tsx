import { t, useLocale } from "../../shared/i18n";
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

  return (
    <>
      <div
        ref={lockOverscroll}
        aria-label={t("Settings")}
        className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto overscroll-none px-2 py-3"
      >
        {settingsSectionsByGroup().map((group) => (
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
}: {
  label: string;
  icon: IconComponent;
  active?: boolean;
  onClick: () => void;
}) {
  useLocale();
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-current={active ? "true" : undefined}
      className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left @max-[140px]/rail:justify-center @max-[140px]/rail:px-0 ${
        active
          ? "bg-selection text-content"
          : "text-content/50 hover:bg-content/5 hover:text-content"
      }`}
    >
      <Icon className="size-4 shrink-0 opacity-70" strokeWidth={1.75} />
      <span className="min-w-0 flex-1 truncate text-sm font-medium leading-tight @max-[140px]/rail:hidden">
        {label}
      </span>
    </button>
  );
}
