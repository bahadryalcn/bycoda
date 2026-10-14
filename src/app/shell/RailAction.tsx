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
  ariaLabel?: string;
};

export function RailAction({
  label,
  icon: Icon,
  onClick,
  onOpenContextMenu,
  active = false,
  badge,
  dot = false,
  shortcut,
  ariaLabel,
}: Props) {
  return (
    <button
      type="button"
      onClick={onClick}
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
      title={ariaLabel ?? label}
      className={`relative flex w-full items-center gap-2 rounded-md px-2 h-8  text-left @max-[140px]/rail:justify-center @max-[140px]/rail:px-0 ${
        active
          ? "bg-accent/12 text-content ring-1 ring-inset ring-accent/25"
          : "text-content/80 hover:bg-content/8 hover:text-content"
      } focus-visible:outline-2 focus-visible:outline-accent focus-visible:-outline-offset-2 disabled:cursor-default disabled:opacity-40`}
    >
      {badge != null ? (
        <span
          aria-hidden
          className="absolute left-1 top-1/2 grid min-w-4 -translate-y-1/2 place-items-center rounded-full bg-accent px-1 text-[10px] font-semibold leading-none text-on-solid tabular-nums"
        >
          {badge > 99 ? "99+" : badge}
        </span>
      ) : null}
      <Icon
        className={`size-4 shrink-0 ${active ? "text-accent" : "text-content/65"} ${badge != null ? "ml-4" : ""}`}
        strokeWidth={1.75}
      />
      <span className="min-w-0 flex-1 truncate text-sm font-medium leading-tight @max-[140px]/rail:hidden">
        {label}
      </span>
      {dot ? (
        <span
          aria-hidden
          className="size-2 shrink-0 rounded-full bg-accent @max-[140px]/rail:absolute @max-[140px]/rail:right-2 @max-[140px]/rail:top-1.5 @max-[140px]/rail:size-1.5"
        />
      ) : shortcut ? (
        <span aria-hidden className="shrink-0 text-[11px] text-content/40 @max-[200px]/rail:hidden">
          {shortcut}
        </span>
      ) : null}
    </button>
  );
}

export function RailSearch({
  label,
  icon: Icon,
  onClick,
  active = false,
  shortcut,
  ariaLabel,
}: {
  label: string;
  icon: IconComponent;
  onClick?: () => void;
  active?: boolean;
  shortcut?: string;
  ariaLabel?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      aria-label={ariaLabel ?? label}
      title={ariaLabel ?? label}
      className={`relative flex w-full items-center gap-2 rounded-md border border-content/8 px-1.5 shadow-sm h-8 text-left @max-[140px]/rail:justify-center @max-[140px]/rail:px-0 ${
        active
          ? "bg-accent/12 text-content ring-1 ring-inset ring-accent/25"
          : "bg-content/3 text-content/75 hover:bg-content/8 hover:text-content"
      } disabled:cursor-default disabled:opacity-40`}
    >
      <Icon className="size-4 shrink-0 opacity-70" strokeWidth={1.75} />
      <span className="min-w-0 flex-1 truncate text-sm font-medium leading-tight @max-[140px]/rail:hidden">
        {label}
      </span>
      {shortcut ? (
        <span aria-hidden className="shrink-0 text-[11px] text-content/40 @max-[200px]/rail:hidden">
          {shortcut}
        </span>
      ) : null}
    </button>
  );
}
