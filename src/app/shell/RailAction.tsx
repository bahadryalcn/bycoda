import { Text } from "../../shared/ui/Text";
import { Badge } from "../../shared/ui/Badge";
import { StatusDot } from "../../shared/ui/StatusDot";
import { useT } from "../../shared/i18n";
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
  const t = useT();
  const currentShortcut = useKeybindingShortcut(command ?? "");
  const shortcut = command ? currentShortcut : fallbackShortcut;
  // The Button's own shared tooltip: the name plus the live binding as key caps, right of
  // the rail. No wrapper and no `title=""` workaround.
  return (
    <Button
      tooltip={ariaLabel ?? label}
      tooltipWhen={ariaLabel && ariaLabel !== label ? "always" : "overflow"}
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
      disabledReason={!onClick ? t("Not available yet.") : undefined}
      aria-label={ariaLabel ?? label}
      className="relative flex w-full items-center gap-2 @max-[140px]/rail:justify-center"
      trailing={
        badge != null || dot || shortcut ? (
          <span className="inline-flex items-center gap-2">
            {badge != null ? (
              <Badge
                variant="count"
                size="sm"
                max={99}
                aria-hidden
                className="shrink-0 @max-[140px]/rail:absolute @max-[140px]/rail:right-1 @max-[140px]/rail:top-1"
              >
                {badge}
              </Badge>
            ) : null}
            {dot ? (
              <StatusDot
                aria-hidden
                className="shrink-0 @max-[140px]/rail:absolute @max-[140px]/rail:right-2 @max-[140px]/rail:top-1.5"
              />
            ) : shortcut ? (
              <Text
                data-tooltip-shortcut=""
                aria-hidden
                size="caption"
                tone="secondary"
                className="shrink-0 @max-[200px]/rail:hidden"
              >
                {shortcut}
              </Text>
            ) : null}
          </span>
        ) : undefined
      }
    >
      <Icon
        className="icon-sm shrink-0"
        tone={active ? "primary" : "secondary"}
        strokeWidth={1.75}
      />
      <Text
        size="caption"
        tone="inherit"
        weight="medium"
        leading="tight"
        truncate
        className="min-w-0 flex-1 @max-[140px]/rail:hidden"
      >
        {label}
      </Text>
    </Button>
  );
}
