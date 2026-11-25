import type { ComponentProps } from "react";
import { Badge, BADGE_COUNT_MAX } from "./Badge";
import { Button } from "./Button";
import { Motion } from "./Motion";
import { Bell, BellOff } from "./icons";

type Props = Pick<
  ComponentProps<typeof Button>,
  "ref" | "onClick" | "aria-expanded" | "aria-controls"
> & {
  label: string;
  count: number;
  countId: string;
  tone: "warning" | "accent";
  muted?: boolean;
  /** `sm` matches the workspace footer rhythm; `md` matches the sidebar Settings icon. */
  iconSize?: "sm" | "md";
};

/**
 * Notification trigger with a count at the bell's upper corner.
 * @group actions
 * @use Open the notification center and show its waiting or unread count.
 * @avoid Ordinary icon actions: Button. Static row counts: Badge.
 */
export function NotificationBell({
  label,
  count,
  countId,
  tone,
  muted,
  iconSize = "md",
  ...buttonProps
}: Props) {
  const Icon = muted ? BellOff : Bell;
  return (
    <Button
      {...buttonProps}
      iconOnly
      label={label}
      aria-describedby={count > 0 ? countId : undefined}
      variant="ghost"
      motion="none"
    >
      <span className="relative inline-flex shrink-0">
        <Icon className={iconSize === "sm" ? "icon-sm shrink-0" : "icon-md shrink-0"} aria-hidden />
        {count > 0 ? (
          <Motion
            as="span"
            key={Math.min(count, BADGE_COUNT_MAX + 1)}
            enter="rise"
            duration="standard"
            aria-hidden
            className={`pointer-events-none absolute -inset-bs-2 start-2.5 inline-flex items-center rounded-full px-0.5 ${
              tone === "warning" ? "bg-(--ui-tone-warning-subtle)" : "bg-(--ui-tone-accent-subtle)"
            }`}
          >
            <Badge variant="count" size="xs" leading="none" tone={tone} data-notification-badge="">
              {count}
            </Badge>
          </Motion>
        ) : null}
        {count > 0 ? (
          <span id={countId} data-notification-count="" className="sr-only">
            {count}
          </span>
        ) : null}
      </span>
    </Button>
  );
}
