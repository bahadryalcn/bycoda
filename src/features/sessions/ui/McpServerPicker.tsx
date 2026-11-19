import { Text } from "../../../shared/ui/Text";
import { Button } from "../../../shared/ui/Button";
import { useT } from "../../../shared/i18n";
import { useState } from "react";
import { Settings } from "../../../shared/ui/icons";
import {
  PickerCloseButton,
  PickerFooter,
  PickerList,
  PopoverSearchHeader,
  usePickerList,
  type PickerOption,
} from "../../../shared/ui/picker";
import { HarnessIcon } from "./HarnessIcon";
import { MCP_PROVIDER_LABELS, scopeLabel, type McpConnection } from "../../settings/public/mcp";

import { mcpPickerServers } from "../model/mcpPicker";
import type { HarnessId } from "../model/session";

const serverKey = (server: McpConnection) =>
  `${server.provider}:${server.scope}:${server.configPath}:${server.name}`;

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
  const servers = mcpPickerServers(connections, harness, claudeStatus, query);
  const options: PickerOption[] =
    loading || error
      ? []
      : servers.map((server) => ({
          value: serverKey(server),
          title: server.name,
          description: `${MCP_PROVIDER_LABELS[server.provider]} · ${scopeLabel(server.scope)}`,
          icon: (
            <HarnessIcon
              harness={server.provider === "claude_desktop" ? "claude" : server.provider}
              className="icon-md"
            />
          ),
          trailing:
            server.availability === "available" ? undefined : (
              <Text
                size="micro"
                tone={server.availability === "authentication" ? "warning" : "secondary"}
                truncate
                className="max-w-32"
              >
                {server.availability === "authentication"
                  ? t("Needs authentication")
                  : server.detail}
              </Text>
            ),
          disabled: server.availability !== "available",
        }));
  // Navigation restarts on a new query or harness; a refreshed list that no longer has the chosen
  // row available falls back to the first selectable row.
  const list = usePickerList({
    options,
    loop: true,
    resetKey: `${harness} ${query}`,
    value: null,
    onChange: (key) => {
      const server = servers.find((item) => serverKey(item) === key);
      if (server) onPick(server);
    },
  });

  return (
    <div data-mcp-picker className="overflow-hidden">
      <PopoverSearchHeader
        label={t("Search MCP servers")}
        placeholder={t("Search MCP servers…")}
        value={query}
        onValueChange={setQuery}
        {...list.searchProps}
        trailing={
          <PickerCloseButton
            label={t("Close MCP picker")}
            tooltip={t("Back to the conversation")}
            shortcut="Esc"
            onClick={() => onDismiss("escape")}
          />
        }
      />
      <PickerList
        label={t("MCP servers")}
        controller={list}
        query={query}
        loading={loading}
        loadingLabel={t("Checking MCP servers…")}
        error={error || undefined}
        emptyLabel={query ? t("No matching MCP servers") : t("No MCP servers found")}
        listHeight="standard"
      />
      <PickerFooter align="start">
        <Button variant="ghost" size="sm" type="button" onClick={onManage}>
          <Settings className="icon-sm" />
          {t("Manage MCP Servers…")}
        </Button>
      </PickerFooter>
    </div>
  );
}
