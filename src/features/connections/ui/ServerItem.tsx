import { useEffect, useRef, type KeyboardEvent, type MouseEvent } from "react";
import { t } from "../../../shared/i18n";
import { Badge } from "../../../shared/ui/Badge";
import { Button } from "../../../shared/ui/Button";
import { Checkbox } from "../../../shared/ui/Checkbox";
import { MoreHorizontal, Server, Star, Terminal } from "../../../shared/ui/icons";
import type { ServerRecord } from "../model/serverInventory";
import type { ServersLayout } from "./serversLayout";
import { MachineStatus } from "./ServerStatus";

/** Where a server menu opens: at pointer coordinates, or anchored to the focused control. */
export type ServerMenuAt = HTMLElement | { x: number; y: number };

const MAX_CARD_TAGS = 3;

type ServerItemProps = {
  server: ServerRecord;
  address: string;
  layout: ServersLayout;
  selected: boolean;
  checked?: boolean;
  selectionMode?: boolean;
  busy?: boolean;
  onCheck?: (checked: boolean) => void;
  /** Resolved palette or custom color; undefined means the server has no color. */
  accent?: string;
  canConnect: boolean;
  onSelect: () => void;
  onConnect: () => void;
  onMenu: (at: ServerMenuAt) => void;
};

/** One inventory entry, rendered as a dense list row or a card. The whole entry is one button. */
export function ServerItem({
  server,
  address,
  layout,
  selected,
  checked,
  selectionMode = false,
  busy,
  onCheck,
  accent,
  canConnect,
  onSelect,
  onConnect,
  onMenu,
}: ServerItemProps) {
  const press = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const origin = useRef({ x: 0, y: 0 });
  const held = useRef(false);
  const check = useRef(onCheck);
  check.current = onCheck;
  const cancelPress = () => {
    clearTimeout(press.current);
    press.current = undefined;
  };
  useEffect(() => {
    if (busy) cancelPress();
    return cancelPress;
  }, [busy]);
  const cards = layout === "cards";
  const group = server.metadata.group ?? "";
  const tags = server.metadata.tags;
  const groupTags = [group, ...tags].filter(Boolean).join(" · ");
  const status = server.machine ? (
    <MachineStatus machine={server.machine} compact={!cards} />
  ) : (
    <Badge size="sm">SSH</Badge>
  );
  const favorite = server.metadata.favorite ? (
    <Star aria-label={t("Favorite")} className="icon-xs shrink-0 text-(--ui-text-muted)" />
  ) : null;
  // Color is a stripe on the leading edge of a row or the top edge of a card. No color keeps the same space.
  const accentBar = (
    <span
      aria-hidden
      className={cards ? "block h-1 w-full shrink-0" : "w-0.5 shrink-0 self-stretch"}
      style={accent ? { background: accent } : undefined}
    />
  );

  const onContextMenu = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    cancelPress();
    if (held.current) return;
    onMenu({ x: event.clientX, y: event.clientY });
  };
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
      event.preventDefault();
      event.stopPropagation();
      onMenu(event.currentTarget);
      return;
    }
    if (selectionMode && event.key === "Enter") {
      event.preventDefault();
      if (!event.repeat && !event.nativeEvent.isComposing) onCheck?.(!checked);
      return;
    }
    if (event.key !== "Enter" || !canConnect || event.nativeEvent.isComposing) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.repeat || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
    onConnect();
  };

  return (
    <li
      className={
        cards
          ? "server-card min-w-0 overflow-hidden rounded-lg border border-stroke"
          : "server-list-row"
      }
      data-checked={checked || undefined}
      data-selection-mode={selectionMode || undefined}
    >
      {onCheck && selectionMode ? (
        <label className="server-selection">
          <Checkbox
            aria-label={t("Select {p0}", { p0: server.name })}
            checked={checked}
            disabled={busy}
            onChange={(event) => onCheck(event.target.checked)}
          />
        </label>
      ) : null}
      <Button
        variant="item"
        selected={selectionMode ? checked : selected}
        aria-pressed={selectionMode ? checked : selected}
        disabled={busy}
        motion="none"
        data-server-row={server.id}
        aria-keyshortcuts={canConnect && !selectionMode ? "Enter" : undefined}
        aria-description={
          canConnect && !selectionMode
            ? t("Double-click or press Enter to connect via SSH. Space shows details.")
            : undefined
        }
        className={
          cards
            ? "server-identity h-auto min-w-0 flex-1 flex-col items-stretch gap-0 p-0 text-left"
            : "server-identity h-auto min-w-0 flex-1 items-center gap-3 px-2 py-2 text-left"
        }
        onPointerDown={(event) => {
          cancelPress();
          held.current = false;
          if (event.button !== 0 || !event.isPrimary || busy || !onCheck) return;
          origin.current = { x: event.clientX, y: event.clientY };
          press.current = setTimeout(() => {
            held.current = true;
            check.current?.(true);
          }, 500);
        }}
        onPointerMove={(event) => {
          if (Math.hypot(event.clientX - origin.current.x, event.clientY - origin.current.y) > 8)
            cancelPress();
        }}
        onPointerUp={cancelPress}
        onPointerCancel={cancelPress}
        onPointerLeave={cancelPress}
        onDragStart={cancelPress}
        onClick={(event) => {
          if (held.current && event.detail !== 0) {
            held.current = false;
            return;
          }
          if (selectionMode) onCheck?.(!checked);
          else onSelect();
        }}
        onContextMenu={onContextMenu}
        onDoubleClick={(event) => {
          if (
            !canConnect ||
            selectionMode ||
            held.current ||
            event.button !== 0 ||
            event.ctrlKey ||
            event.metaKey ||
            event.altKey ||
            event.shiftKey
          )
            return;
          onConnect();
        }}
        onKeyDown={onKeyDown}
      >
        {cards ? (
          <>
            {accentBar}
            <span className="flex min-w-0 flex-col gap-2 p-3">
              <span className="flex min-w-0 items-center gap-2">
                <Server aria-hidden className="icon-md shrink-0 text-(--ui-text-muted)" />
                <span title={server.name} className="min-w-0 flex-1 truncate font-medium">
                  {server.name}
                </span>
                {favorite}
              </span>
              <span
                title={address}
                className={`text-xs text-(--ui-text-muted) ${selected ? "break-all whitespace-normal" : "truncate"}`}
              >
                {address}
              </span>
              <span className="flex min-w-0 items-center justify-between gap-2">
                <span className="flex min-w-0 flex-wrap gap-1">
                  {group ? <Badge size="sm">{group}</Badge> : null}
                  {tags.slice(0, MAX_CARD_TAGS).map((tag) => (
                    <Badge key={tag} size="sm">
                      {tag}
                    </Badge>
                  ))}
                  {tags.length > MAX_CARD_TAGS ? (
                    <Badge size="sm">+{tags.length - MAX_CARD_TAGS}</Badge>
                  ) : null}
                </span>
                <span className="flex shrink-0 items-center">{status}</span>
              </span>
            </span>
          </>
        ) : (
          <>
            {accentBar}
            <span className="min-w-0 flex-1">
              <span title={server.name} className="block min-w-0 truncate text-sm font-medium">
                {server.name}
              </span>
              <span
                title={address}
                className={`block min-w-0 flex-1 text-xs text-(--ui-text-secondary) ${selected ? "break-all whitespace-normal" : "truncate"}`}
              >
                {address}
              </span>
            </span>
            {groupTags ? (
              <span
                title={groupTags}
                className="server-group min-w-0 truncate text-xs text-(--ui-text-muted)"
              >
                {groupTags}
              </span>
            ) : null}
            <span className="server-row-status flex shrink-0 items-center gap-2">
              {favorite}
              {status}
            </span>
          </>
        )}
      </Button>
      <div className="server-row-actions">
        {canConnect ? (
          <Button
            variant="secondary"
            disabled={busy}
            iconOnly
            label={t("Connect to {p0}", { p0: server.name })}
            onClick={onConnect}
          >
            <Terminal aria-hidden className="icon-sm" />
          </Button>
        ) : null}
        <Button
          variant="ghost"
          disabled={busy}
          iconOnly
          label={t("Actions for {p0}", { p0: server.name })}
          onClick={(event) => onMenu(event.currentTarget)}
        >
          <MoreHorizontal aria-hidden className="icon-sm" />
        </Button>
      </div>
    </li>
  );
}
