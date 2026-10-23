import type { KeyboardEvent, MouseEvent } from "react";
import { t } from "../../../shared/i18n";
import { Badge } from "../../../shared/ui/Badge";
import { Button } from "../../../shared/ui/Button";
import { Server, Star } from "../../../shared/ui/icons";
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
  accent,
  canConnect,
  onSelect,
  onConnect,
  onMenu,
}: ServerItemProps) {
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
    onMenu({ x: event.clientX, y: event.clientY });
  };
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
      event.preventDefault();
      event.stopPropagation();
      onMenu(event.currentTarget);
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
        cards ? "min-w-0 overflow-hidden rounded-lg border border-stroke" : "min-w-0 rounded-md"
      }
    >
      <Button
        variant="item"
        selected={selected}
        aria-pressed={selected}
        data-server-row={server.id}
        aria-keyshortcuts={canConnect ? "Enter" : undefined}
        aria-description={
          canConnect
            ? t("Double-click or press Enter to connect via SSH. Space shows details.")
            : undefined
        }
        className={
          cards
            ? "h-auto w-full flex-col items-stretch gap-0 p-0 text-left"
            : "h-auto min-h-10 w-full items-center gap-3 px-2.5 py-1.5 text-left"
        }
        onClick={onSelect}
        onContextMenu={onContextMenu}
        onDoubleClick={(event) => {
          if (
            !canConnect ||
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
            <span className="min-w-0 flex-1 @min-[36rem]/servers:flex @min-[36rem]/servers:items-center @min-[36rem]/servers:gap-3">
              <span
                title={server.name}
                className="block min-w-0 truncate font-medium @min-[36rem]/servers:max-w-[40%]"
              >
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
                className="hidden max-w-40 min-w-0 truncate text-xs text-(--ui-text-muted) @min-[36rem]/servers:block"
              >
                {groupTags}
              </span>
            ) : null}
            <span className="flex shrink-0 items-center gap-2">
              {favorite}
              {status}
            </span>
          </>
        )}
      </Button>
    </li>
  );
}
