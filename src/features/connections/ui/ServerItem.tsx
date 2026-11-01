import { useEffect, useRef, type KeyboardEvent, type MouseEvent } from "react";
import { t } from "../../../shared/i18n";
import { Badge } from "../../../shared/ui/Badge";
import { Button } from "../../../shared/ui/Button";
import { ActionHost, InlineMoreAction } from "../../../shared/ui/ActionHost";
import { Checkbox } from "../../../shared/ui/Checkbox";
import { Surface } from "../../../shared/ui/Surface";
import { OverflowTooltip } from "../../../shared/ui/Tooltip";
import { Server, Star, Terminal } from "../../../shared/ui/icons";
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

/** One inventory entry with an explicit details target and shared inline actions. */
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
  // Kind (machine vs plain SSH endpoint) is identity and always shows in the same
  // place; the status slot only ever carries live connection state.
  const kind = server.machine ? "Host" : "SSH";
  const status = server.machine ? (
    <MachineStatus machine={server.machine} compact={!cards} />
  ) : null;
  const favorite = server.metadata.favorite ? (
    <Star aria-label={t("Favorite")} className="icon-xs shrink-0 text-(--ui-text-muted)" />
  ) : null;
  // The group color is a small identity dot beside the name, not an edge stripe.
  const accentDot = accent ? (
    <span
      aria-hidden
      className="size-2 shrink-0 rounded-full"
      style={{ background: accent }}
    />
  ) : null;

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

  const rootProps = {
    "data-checked": checked || undefined,
    "data-selection-mode": selectionMode || undefined,
  };
  const content = (
    <>
      <ActionHost selected={selectionMode ? checked : selected} className="w-full min-w-0 flex-wrap">
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
              ? "server-identity h-auto min-w-0 basis-48 flex-1 flex-col items-stretch gap-0 p-0 text-left"
              : "server-identity h-auto min-w-0 flex-1 items-center gap-3 px-2 py-1 text-left"
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
              <span className="flex min-w-0 flex-col gap-2 p-3">
                <span className="flex min-w-0 items-center gap-2">
                  <Server aria-hidden className="icon-sm shrink-0 text-(--ui-text-muted)" />
                  <OverflowTooltip label={server.name}>
                    <span className="min-w-0 flex-1 truncate font-medium">{server.name}</span>
                  </OverflowTooltip>
                  {accentDot}
                  {favorite}
                </span>
                <OverflowTooltip label={address}>
                  <span
                    className={`text-ui-caption text-(--ui-text-secondary) ${selected ? "break-all whitespace-normal" : "truncate"}`}
                  >
                    <span className="text-(--ui-text-muted)">{kind} · </span>
                    {address}
                  </span>
                </OverflowTooltip>
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
                  {status ? <span className="flex shrink-0 items-center">{status}</span> : null}
                </span>
              </span>
            </>
          ) : (
            <>
              <span className="min-w-0 flex-1">
                <span className="flex min-w-0 items-center gap-2">
                  <OverflowTooltip label={server.name}>
                    <span className="block min-w-0 truncate text-ui-body font-medium">
                      {server.name}
                    </span>
                  </OverflowTooltip>
                  {accentDot}
                </span>
                <OverflowTooltip label={groupTags ? `${address} · ${groupTags}` : address}>
                  <span
                    className={`block min-w-0 flex-1 text-ui-caption text-(--ui-text-secondary) ${selected ? "break-all whitespace-normal" : "truncate"}`}
                  >
                    <span className="text-(--ui-text-muted)">{kind} · </span>
                    {address}
                    {groupTags ? (
                      <span className="text-(--ui-text-muted)"> · {groupTags}</span>
                    ) : null}
                  </span>
                </OverflowTooltip>
              </span>
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
              startIcon={<Terminal aria-hidden className="icon-sm" />}
              aria-label={t("Connect to {p0}", { p0: server.name })}
              onClick={onConnect}
            >
              {t("Connect")}
            </Button>
          ) : null}
          <InlineMoreAction
            reveal="always"
            disabled={busy}
            label={t("Actions for {p0}", { p0: server.name })}
            onOpen={onMenu}
          />
        </div>
      </ActionHost>
    </>
  );
  return cards ? (
    <Surface
      as="li"
      variant="outline"
      padding="none"
      className="server-card min-w-0 overflow-hidden"
      {...rootProps}
    >
      {content}
    </Surface>
  ) : (
    <li className="server-list-row" {...rootProps}>
      {content}
    </li>
  );
}
