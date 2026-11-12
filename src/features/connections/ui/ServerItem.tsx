import { Text } from "../../../shared/ui/Text";
import { useEffect, useRef, type KeyboardEvent, type MouseEvent } from "react";
import { t } from "../../../shared/i18n";
import { BadgeList } from "../../../shared/ui/BadgeList";
import { Button } from "../../../shared/ui/Button";
import { ActionHost, InlineAction, InlineMoreAction } from "../../../shared/ui/ActionHost";
import { Checkbox } from "../../../shared/ui/Checkbox";
import { Surface, surfaceAttributes } from "../../../shared/ui/Surface";
import { OverflowTooltip } from "../../../shared/ui/Tooltip";
import { Star, Terminal } from "../../../shared/ui/icons";
import type { ServerRecord } from "../model/serverInventory";
import type { ServersLayout } from "./serversLayout";
import { MachineStatus } from "./ServerStatus";

/** Where a server menu opens: at pointer coordinates, or anchored to the focused control. */
export type ServerMenuAt = HTMLElement | { x: number; y: number };

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
  const badges = [
    ...(group ? [{ id: `group:${group}`, label: group }] : []),
    ...tags.map((tag, index) => ({ id: `tag:${index}:${tag}`, label: tag })),
  ];
  // Kind (machine vs plain SSH endpoint) is identity and always shows in the same
  // place; the status slot only ever carries live connection state.
  const kind = server.machine ? "Host" : "SSH";
  const status = server.machine ? (
    <MachineStatus machine={server.machine} compact={!cards} />
  ) : null;
  const favorite = server.metadata.favorite ? (
    <Star aria-label={t("Favorite")} className="icon-xs shrink-0" tone="muted" />
  ) : null;
  // The group color is a small identity dot beside the name, not an edge stripe.
  const accentDot = accent ? (
    <span
      aria-hidden
      {...surfaceAttributes({ radius: "pill" }, "size-2 shrink-0")}
      style={{ background: accent }}
    />
  ) : null;

  const onContextMenu = (event: MouseEvent<HTMLElement>) => {
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
  // The badges hold their own "+N" button, which cannot sit inside the identity button: on a
  // card they are a sibling laid over its bottom line (the status moves with them; clicks outside
  // the badges fall through to the identity button) and the button keeps the line's height.
  const identityButton = (
    <Button
      data-action-primary=""
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
        <span className="flex min-w-0 flex-col gap-1 p-3">
          <span className="server-card-head flex min-w-0 items-center gap-2">
            <OverflowTooltip label={server.name}>
              <Text as="span" size="inherit" tone="inherit" weight="medium" truncate>
                {server.name}
              </Text>
            </OverflowTooltip>
            {accentDot}
            {favorite}
          </span>
          <OverflowTooltip label={address}>
            <Text
              as="span"
              size="caption"
              tone="secondary"
              truncate={!selected}
              className={selected ? "break-all whitespace-normal" : undefined}
            >
              <Text size="inherit" tone="muted">
                {kind} ·{" "}
              </Text>
              {address}
            </Text>
          </OverflowTooltip>
          {badges.length > 0 ? (
            <span aria-hidden="true" className={`mbs-1 block ${status ? "h-5" : "h-4"}`} />
          ) : status ? (
            <span className="mbs-1 flex min-w-0 items-center justify-end">
              <span className="flex shrink-0 items-center">{status}</span>
            </span>
          ) : null}
        </span>
      ) : (
        <>
          <span className="min-w-0 flex-1">
            <span className="flex min-w-0 items-center gap-2">
              <OverflowTooltip label={server.name}>
                <Text
                  as="span"
                  size="body"
                  tone="inherit"
                  weight="medium"
                  truncate
                  className="block"
                >
                  {server.name}
                </Text>
              </OverflowTooltip>
              {accentDot}
            </span>
            <OverflowTooltip label={groupTags ? `${address} · ${groupTags}` : address}>
              <Text
                as="span"
                size="caption"
                tone="secondary"
                truncate={!selected}
                className={
                  selected
                    ? "block min-w-0 flex-1 break-all whitespace-normal"
                    : "block min-w-0 flex-1"
                }
              >
                <Text size="inherit" tone="muted">
                  {kind} ·{" "}
                </Text>
                {address}
                {groupTags ? (
                  <Text size="inherit" tone="muted">
                    {" "}
                    · {groupTags}
                  </Text>
                ) : null}
              </Text>
            </OverflowTooltip>
          </span>
          <span className="server-row-status flex shrink-0 items-center gap-2">
            {favorite}
            {status}
          </span>
        </>
      )}
    </Button>
  );
  const content = (
    <>
      <ActionHost
        selected={selectionMode ? checked : selected}
        className={cards ? "w-full min-w-0" : "w-full min-w-0 flex-wrap"}
      >
        {onCheck && selectionMode ? (
          <Checkbox
            aria-label={t("Select {p0}", { p0: server.name })}
            checked={checked}
            disabled={busy}
            onChange={(event) => onCheck(event.target.checked)}
            className="server-selection"
          />
        ) : null}
        {cards ? (
          <div className="relative flex min-w-0 flex-1">
            {identityButton}
            {badges.length > 0 ? (
              <div className="pointer-events-none absolute inset-x-3 bottom-3 flex items-center justify-between gap-2">
                <span className="pointer-events-auto min-w-0" onContextMenu={onContextMenu}>
                  <BadgeList label={t("Tags")} size="xs" items={badges} />
                </span>
                {status ? <span className="flex shrink-0 items-center">{status}</span> : null}
              </div>
            ) : null}
          </div>
        ) : (
          identityButton
        )}
        <div className="server-row-actions">
          {canConnect ? (
            cards ? (
              <InlineAction
                reveal="always"
                disabled={busy}
                label={t("Connect to {p0}", { p0: server.name })}
                tooltip={t("Connect")}
                onClick={onConnect}
              >
                <Terminal aria-hidden className="icon-sm" />
              </InlineAction>
            ) : (
              <Button
                variant="secondary"
                disabled={busy}
                startIcon={<Terminal aria-hidden className="icon-sm" />}
                aria-label={t("Connect to {p0}", { p0: server.name })}
                onClick={onConnect}
              >
                {t("Connect")}
              </Button>
            )
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
    <li {...surfaceAttributes({ radius: "control" }, "server-list-row")} {...rootProps}>
      {content}
    </li>
  );
}
