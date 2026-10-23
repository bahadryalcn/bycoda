import { Alert } from "../../../shared/ui/Alert";
import { Button } from "../../../shared/ui/Button";
import { SearchInput } from "../../../shared/ui/SearchInput";
import { useT } from "../../../shared/i18n";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ChevronDown, Search, Settings } from "../../../shared/ui/icons";
import { useLockOverscroll } from "../../../shared/hooks/useLockOverscroll";
import { HarnessIcon } from "./HarnessIcon";
import { MCP_PROVIDER_LABELS, type McpConnection } from "../../settings/model/mcp";
import { mcpPickerServers } from "../model/mcpPicker";
import type { HarnessId } from "../model/session";

export function McpServerPicker({
  connections,
  harness,
  claudeStatus,
  loading,
  error,
  onPick,
  onManage,
  onDismiss,
}: {
  connections: McpConnection[];
  harness: HarnessId;
  claudeStatus: ReadonlyMap<string, string>;
  loading: boolean;
  error: string;
  onPick: (server: McpConnection) => void;
  onManage: () => void;
  onDismiss: (reason: "escape" | "outside") => void;
}) {
  const t = useT();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listboxId = `mcp-server-picker-${useId()}`;
  const search = useRef<HTMLInputElement>(null);
  const picker = useRef<HTMLDivElement>(null);
  const activeOption = useRef<HTMLButtonElement>(null);
  const lockOverscroll = useLockOverscroll<HTMLDivElement>();
  const servers = useMemo(
    () => mcpPickerServers(connections, harness, claudeStatus, query),
    [connections, harness, claudeStatus, query],
  );
  const selectable = servers.flatMap((server, index) =>
    server.availability === "available" ? [index] : [],
  );

  useEffect(() => {
    search.current?.focus();
  }, []);
  useEffect(() => {
    setActive(selectable[0] ?? 0);
  }, [query, connections, harness, claudeStatus]);
  useEffect(() => {
    activeOption.current?.scrollIntoView?.({ block: "nearest" });
  }, [active]);
  useEffect(() => {
    const dismissOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !picker.current?.contains(event.target)) {
        onDismiss("outside");
      }
    };
    document.addEventListener("pointerdown", dismissOutside);
    return () => document.removeEventListener("pointerdown", dismissOutside);
  }, [onDismiss]);

  return (
    <div
      ref={picker}
      data-mcp-picker
      role="dialog"
      aria-label={t("Choose an MCP server")}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing) return;
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          onDismiss("escape");
        }
      }}
      className="overflow-hidden rounded-lg border border-(--ui-tone-neutral-border) bg-(--ui-surface-raised) shadow-(--ui-elevation-floating)"
    >
      <div className="flex items-center gap-2 border-b border-(--ui-tone-neutral-border) px-3 py-2">
        <Search className="size-3.5 shrink-0 text-(--ui-text-secondary)" />
        <SearchInput
          ref={search}
          role="combobox"
          aria-controls={listboxId}
          aria-expanded="true"
          aria-activedescendant={
            servers[active]?.availability === "available"
              ? `${listboxId}-option-${active}`
              : undefined
          }
          aria-label={t("Search MCP servers")}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              if (selectable.length === 0) return;
              const index = selectable.indexOf(active);
              const offset = event.key === "ArrowDown" ? 1 : -1;
              setActive(selectable[(index + offset + selectable.length) % selectable.length]);
            }
            if (event.key === "Enter") {
              event.preventDefault();
              const server = servers[active];
              if (server?.availability === "available") onPick(server);
            }
          }}
          className="min-w-0 flex-1 bg-transparent text-ui-secondary text-(--ui-tone-neutral-fg) outline-none placeholder:text-(--ui-text-secondary)"
          placeholder={t("Search MCP servers…")}
        />
        <Button
          iconOnly
          label={t("Close MCP picker")}
          variant="ghost"
          type="button"
          aria-label={t("Close MCP picker")}
          title={t("Back to the conversation (Esc)")}
          onClick={() => onDismiss("escape")}
          className="shrink-0"
        >
          <ChevronDown className="size-4" strokeWidth={1.75} />
        </Button>
      </div>
      <div
        ref={lockOverscroll}
        id={listboxId}
        role="listbox"
        aria-label={t("MCP servers")}
        className="max-h-[min(184px,45vh)] overflow-y-auto overscroll-none p-1"
      >
        {loading ? (
          <p className="px-2 py-2 text-ui-caption text-(--ui-text-secondary)">
            {t("Checking MCP servers…")}
          </p>
        ) : error ? (
          <Alert tone="danger" role="alert">
            {error}
          </Alert>
        ) : servers.length === 0 ? (
          <p className="px-2 py-2 text-ui-caption text-(--ui-text-secondary)">
            {query ? t("No matching MCP servers") : t("No MCP servers found")}
          </p>
        ) : (
          servers.map((server, index) => {
            const available = server.availability === "available";
            return (
              <Button
                className="w-full text-left"
                fullWidth
                selected={index === active}
                variant="item"
                key={`${server.provider}:${server.scope}:${server.configPath}:${server.name}`}
                id={`${listboxId}-option-${index}`}
                ref={available && active === index ? activeOption : undefined}
                type="button"
                role="option"
                aria-selected={available && active === index}
                aria-disabled={!available}
                disabled={!available}
                onFocus={() => {
                  if (available) setActive(index);
                }}
                onMouseEnter={() => {
                  if (available) setActive(index);
                }}
                onClick={() => onPick(server)}
              >
                <HarnessIcon
                  harness={server.provider === "claude_desktop" ? "claude" : server.provider}
                  className="size-4 shrink-0"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-ui-secondary">{server.name}</span>
                  <span className="block truncate text-ui-micro text-(--ui-text-secondary)">
                    {MCP_PROVIDER_LABELS[server.provider]} · {server.scope}
                  </span>
                </span>
                <span
                  className={`max-w-[40%] shrink-0 truncate text-ui-micro ${server.availability === "authentication" ? "text-(--ui-tone-warning-fg)" : "text-(--ui-text-secondary)"}`}
                >
                  {server.availability === "authentication"
                    ? t("Needs authentication")
                    : server.availability === "unavailable"
                      ? server.detail
                      : t("Available")}
                </span>
              </Button>
            );
          })
        )}
      </div>
      <Button
        fullWidth
        variant="item"
        type="button"
        onClick={onManage}
        className="w-full text-left"
      >
        <Settings className="size-3.5" />
        {t("Manage MCP Servers…")}
      </Button>
    </div>
  );
}
