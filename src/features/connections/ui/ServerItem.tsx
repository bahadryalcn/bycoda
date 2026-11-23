import { Text } from "../../../shared/ui/Text";
import { useEffect, useRef, type KeyboardEvent, type MouseEvent, type PointerEvent } from "react";
import { t } from "../../../shared/i18n";
import { BadgeList } from "../../../shared/ui/BadgeList";
import { Button } from "../../../shared/ui/Button";
import { ActionHost, InlineAction, InlineMoreAction } from "../../../shared/ui/ActionHost";
import { CollectionRow } from "../../../shared/ui/CollectionRow";
import { Checkbox } from "../../../shared/ui/Checkbox";
import { Surface } from "../../../shared/ui/Surface";
import { OverflowTooltip } from "../../../shared/ui/Tooltip";
import { Star, Terminal } from "../../../shared/ui/icons";
import { ServerIdentity } from "./ServerIdentity";
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
  onSelect: (event: MouseEvent<HTMLButtonElement>) => void;
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
  const selectionClick = useRef(false);
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
  const groupTags = [group, ...tags].filter(Boolean).join(", ");
  const badges = [
    ...(group ? [{ id: `group:${group}`, label: group }] : []),
    ...tags.map((tag, index) => ({ id: `tag:${index}:${tag}`, label: tag })),
  ];
  // Kind (machine vs plain SSH endpoint) is identity: it rides on the glyph, never a text tag;
  // the status slot only ever carries live connection state.
  const status = server.machine ? (
    <MachineStatus machine={server.machine} quiet />
  ) : null;
  const favorite = server.metadata.favorite ? (
    <Star aria-label={t("Favorite")} className="icon-xs shrink-0" tone="muted" />
  ) : null;
  // The user-chosen color identifies the server; it never implies connection health.
  const identityIcon = <ServerIdentity accent={accent} kind={server.machine ? "host" : "ssh"} />;

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
  const onClick = (event: MouseEvent<HTMLButtonElement>) => {
    if (held.current && event.detail !== 0) {
      selectionClick.current = true;
      held.current = false;
      return;
    }
    if (selectionMode) {
      selectionClick.current = true;
      onCheck?.(!checked);
    } else {
      if (event.detail < 2) selectionClick.current = false;
      onSelect(event);
    }
  };
  // Shared by both layouts: row click selects, double-click connects, long-press checks.
  const rowProps = {
    "aria-pressed": selectionMode ? checked : selected,
    disabled: busy,
    "data-server-row": server.id,
    "aria-keyshortcuts": canConnect && !selectionMode ? "Enter" : undefined,
    "aria-description":
      canConnect && !selectionMode
        ? t("Double-click or press Enter to connect via SSH. Space shows details.")
        : undefined,
    onPointerDown: (event: PointerEvent<HTMLButtonElement>) => {
      cancelPress();
      held.current = false;
      if (event.button !== 0 || !event.isPrimary || busy || !onCheck) return;
      origin.current = { x: event.clientX, y: event.clientY };
      press.current = setTimeout(() => {
        held.current = true;
        check.current?.(true);
      }, 500);
    },
    onPointerMove: (event: PointerEvent<HTMLButtonElement>) => {
      if (Math.hypot(event.clientX - origin.current.x, event.clientY - origin.current.y) > 8)
        cancelPress();
    },
    onPointerUp: cancelPress,
    onPointerCancel: cancelPress,
    onPointerLeave: cancelPress,
    onDragStart: cancelPress,
    onContextMenu,
    onDoubleClick: (event: MouseEvent<HTMLButtonElement>) => {
      if (
        !canConnect ||
        selectionMode ||
        selectionClick.current ||
        held.current ||
        event.button !== 0 ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        event.shiftKey
      )
        return;
      onConnect();
    },
    onKeyDown,
  };
  const checkbox =
    onCheck && selectionMode ? (
      <Checkbox
        aria-label={t("Select {p0}", { p0: server.name })}
        checked={checked}
        disabled={busy}
        onChange={(event) => onCheck(event.target.checked)}
        className={
          cards
            ? "flex shrink-0 basis-8 cursor-pointer items-start justify-center self-stretch pt-3 pointer-coarse:min-h-11"
            : "server-selection"
        }
      />
    ) : null;
  const moreAction = (
    <InlineMoreAction
      reveal="always"
      disabled={busy}
      label={t("Actions for {p0}", { p0: server.name })}
      onOpen={onMenu}
    />
  );

  if (!cards) {
    // The more-menu already carries Connect, so it is the row's one action; Enter, double-click
    // and long-press stay on the row button.
    return (
      <CollectionRow
        as="li"
        {...rootProps}
        className="server-list-row"
        selected={selectionMode ? checked : selected}
        before={checkbox}
        leading={identityIcon}
        title={server.name}
        secondary={groupTags ? `${address}, ${groupTags}` : address}
        trailing={
          <>
            {favorite}
            {status}
          </>
        }
        action={moreAction}
        primary={rowProps}
        onOpen={onClick}
      />
    );
  }

  // The badges hold their own "+N" button, which cannot sit inside the identity button: on a
  // card they are a sibling laid over its bottom line (the status moves with them; clicks outside
  // the badges fall through to the identity button) and the button keeps the line's height.
  const identityButton = (
    <Button
      data-action-primary=""
      variant="item"
      selected={selectionMode ? checked : selected}
      motion="none"
      controlHeight="auto"
      padding={{ inline: "none", block: "none" }}
      className="server-identity min-w-0 flex-1 flex-col items-stretch gap-0 text-left"
      {...rowProps}
      onClick={onClick}
    >
      <span className="flex min-w-0 flex-col gap-2 p-3">
        <span className="flex min-w-0 items-center gap-2 pe-12">
          {identityIcon}
          <OverflowTooltip label={server.name}>
            <Text as="span" size="body" tone="inherit" weight="medium" truncate>
              {server.name}
            </Text>
          </OverflowTooltip>
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
    </Button>
  );
  return (
    <Surface
      as="li"
      variant="card"
      padding="none"
      className="flex min-w-0 overflow-hidden"
      {...rootProps}
    >
      <ActionHost
        selected={selectionMode ? checked : selected}
        className="w-full min-w-0 items-stretch self-stretch"
      >
        {checkbox}
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
        <div className="absolute end-2 top-3 flex items-center gap-1 @max-[37.5rem]/server-catalog:gap-0">
          {canConnect ? (
            <InlineAction
              reveal="always"
              disabled={busy}
              label={t("Connect to {p0}", { p0: server.name })}
              tooltip={t("Connect")}
              onClick={onConnect}
            >
              <Terminal aria-hidden className="icon-sm" />
            </InlineAction>
          ) : null}
          {moreAction}
        </div>
      </ActionHost>
    </Surface>
  );
}
