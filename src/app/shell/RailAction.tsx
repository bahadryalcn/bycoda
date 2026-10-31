import { Badge } from "../../shared/ui/Badge";
import { Button } from "../../shared/ui/Button";
import { useKeybindingShortcut } from "../../features/settings/model/useKeybindingShortcut";
import type { IconComponent } from "../../shared/ui/icons";

type Props = {
  label: string;
  icon: IconComponent;
  onClick?: () => void;
  onOpenContextMenu?: (x: number, y: number) => void;
  active?: boolean;
  badge?: number;
  dot?: boolean;
  shortcut?: string;
  command?: string;
  ariaLabel?: string;
  /** Guide spotlight target name (`data-usage-guide`). */
  guide?: string;
};

export function RailAction({
  label,
  icon: Icon,
  onClick,
  onOpenContextMenu,
  active = false,
  badge,
  dot = false,
  shortcut: fallbackShortcut,
  command,
  ariaLabel,
  guide,
}: Props) {
  const currentShortcut = useKeybindingShortcut(command ?? "");
  const shortcut = command ? currentShortcut : fallbackShortcut;
  // The Button's own shared tooltip: the name plus the live binding as key caps, right of
  // the rail. No wrapper and no `title=""` workaround.
  return (
    <Button
      tooltip={ariaLabel ?? label}
      shortcut={shortcut}
      tooltipSide="right"
      selected={active}
      variant="item"
      motion="none"
      type="button"
      onClick={onClick}
      data-usage-guide={guide}
      onContextMenu={
        onOpenContextMenu
          ? (event) => {
              event.preventDefault();
              event.stopPropagation();
              onOpenContextMenu(event.clientX, event.clientY);
            }
          : undefined
      }
      onKeyDown={
        onOpenContextMenu
          ? (event) => {
              if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
              event.preventDefault();
              event.stopPropagation();
              const rect = event.currentTarget.getBoundingClientRect();
              onOpenContextMenu(rect.left, rect.bottom);
            }
          : undefined
      }
      disabled={!onClick}
      aria-label={ariaLabel ?? label}
      className={`relative flex w-full items-center gap-2 @max-[140px]/rail:justify-center`}
    >
      {badge != null ? (
        <Badge
          variant="count"
          size="sm"
          max={99}
          aria-hidden
          className="absolute left-1 top-1/2 -translate-y-1/2"
        >
          {badge}
        </Badge>
      ) : null}
      <Icon
        className={`icon-sm shrink-0 ${active ? "text-content" : "text-(--ui-text-secondary)"} ${badge != null ? "ml-4" : ""}`}
        strokeWidth={1.75}
      />
      <span className="min-w-0 flex-1 truncate text-ui-caption font-medium leading-tight @max-[140px]/rail:hidden">
        {label}
      </span>
      {dot ? (
        <span
          aria-hidden
          className="size-2 shrink-0 rounded-full bg-accent @max-[140px]/rail:absolute @max-[140px]/rail:right-2 @max-[140px]/rail:top-1.5 @max-[140px]/rail:size-1.5"
        />
      ) : shortcut ? (
        <span
          aria-hidden
          className="shrink-0 text-ui-caption text-(--ui-text-secondary) @max-[200px]/rail:hidden"
        >
          {shortcut}
        </span>
      ) : null}
    </Button>
  );
}

export function RailSearch({
  label,
  icon: Icon,
  onClick,
  active = false,
  shortcut: fallbackShortcut,
  command,
  ariaLabel,
}: {
  label: string;
  icon: IconComponent;
  onClick?: () => void;
  active?: boolean;
  shortcut?: string;
  command?: string;
  ariaLabel?: string;
}) {
  const currentShortcut = useKeybindingShortcut(command ?? "");
  const shortcut = command ? currentShortcut : fallbackShortcut;
  return (
    <Button
      tooltip={ariaLabel ?? label}
      shortcut={shortcut}
      tooltipSide="right"
      data-rail-search
      selected={active}
      variant="item"
      motion="none"
      type="button"
      onClick={onClick}
      disabled={!onClick}
      aria-label={ariaLabel ?? label}
      className={`relative flex w-full items-center gap-2 @max-[140px]/rail:justify-center`}
    >
      <Icon className="icon-sm shrink-0 text-(--ui-text-secondary)" strokeWidth={1.75} />
      <span
        data-rail-search-label
        className="min-w-0 flex-1 truncate text-ui-caption font-medium leading-tight @max-[140px]/rail:hidden"
      >
        {label}
      </span>
      {shortcut ? (
        <span
          data-rail-search-shortcut
          aria-hidden
          className="shrink-0 text-ui-caption text-(--ui-text-secondary) @max-[200px]/rail:hidden"
        >
          {shortcut}
        </span>
      ) : null}
    </Button>
  );
}
