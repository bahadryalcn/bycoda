import { Button } from "../../shared/ui/Button";
import { useLocale, useT } from "../../shared/i18n";
import { useEffect, useRef, type KeyboardEvent } from "react";
import {
  Archive,
  ArrowLeft,
  AudioLines,
  Bot,
  CircleDot,
  Folder,
  GitBranch,
  Inbox,
  Globe,
  Internet,
  Keyboard,
  KeyRound,
  Link2,
  UserRound,
  Lock,
  MessageSquare,
  Palette,
  SlidersHorizontal,
  Sparkles,
  Terminal,
  UsageIcon,
  type IconComponent,
} from "../../shared/ui/icons";
import { AccountRailRow } from "../../features/account";
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
  voice: AudioLines,
  providers: Bot,
  crews: Bot,
  usage: UsageIcon,
  limits: SlidersHorizontal,
  mcp: Globe,
  skills: Sparkles,
  inbox: Inbox,
  integrations: Link2,
  account: UserRound,
  secrets: KeyRound,
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
  const t = useT();
  const lockOverscroll = useLockOverscroll<HTMLDivElement>();
  const rows = useRef(new Map<SettingsSectionId, HTMLButtonElement>());
  // Account is not a list group: it is the avatar row under the list.
  const groups = settingsSectionsByGroup().filter((group) => group.id !== "account");
  const sections = groups.flatMap((group) => group.sections);
  // The account row sits outside the list; keep one list row tabbable while it is active.
  const stop = sections.some((item) => item.id === section) ? section : sections[0]?.id;
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
            <div className="px-2 pb-1 text-ui-caption font-medium text-(--ui-text-secondary) @max-[140px]/rail:hidden">
              {group.label}
            </div>
            {group.sections.map((item) => (
              <NavRow
                key={item.id}
                label={item.label}
                icon={SETTINGS_SECTION_ICONS[item.id]}
                active={item.id === section}
                tabIndex={item.id === stop ? 0 : -1}
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
        <AccountRailRow active={section === "account"} onSelect={() => onSelect("account")} />
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
      tooltip={label}
      tooltipWhen="overflow"
      tooltipSide="right"
      aria-label={label}
      aria-current={active ? "true" : undefined}
      className={`flex w-full items-center gap-2 @max-[140px]/rail:justify-center `}
    >
      <Icon
        aria-hidden="true"
        className={`icon-sm shrink-0 ${active ? "" : "text-(--ui-text-secondary)"}`}
        strokeWidth={1.75}
      />
      <span className="min-w-0 flex-1 truncate text-ui-body font-medium leading-tight @max-[140px]/rail:hidden">
        {label}
      </span>
    </Button>
  );
}
