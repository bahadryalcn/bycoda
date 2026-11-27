import { t, useLocale } from "../../../shared/i18n";
import { INBOX_SOURCE_LABELS, type ConnectableInboxSource } from "../model/inboxFilters";
import { InboxProviderMark } from "./InboxProviderMark";
import type { PopoverAnchor } from "../../../shared/ui/Popover";
import { DropdownMenu } from "../../../shared/ui/DropdownMenu";
import { MessageMultiple } from "../../../shared/ui/icons";
import { ENABLED_MESSAGING_PROVIDERS } from "../../messaging";

const MESSAGES_ID = "messages";

function messagingProviderLabel(provider: (typeof ENABLED_MESSAGING_PROVIDERS)[number]): string {
  switch (provider) {
    case "email":
      return t("Email");
    case "slack":
      return t("Slack");
    case "discord":
      return t("Discord");
    case "teams":
      return t("Microsoft Teams");
  }
}

export function InboxConnectMenu({
  anchor,
  sources,
  onConnect,
  onConnectMessages,
  onClose,
}: {
  anchor: PopoverAnchor;
  sources: ConnectableInboxSource[];
  onConnect: (source: ConnectableInboxSource) => void;
  /** Adds the messaging entry (the enabled messaging providers) when none is connected yet. */
  onConnectMessages?: () => void;
  onClose: () => void;
}) {
  useLocale();
  return (
    <DropdownMenu
      anchor={anchor}
      label={t("Connect an inbox source")}
      size="sm"
      items={[
        ...sources.map((source) => ({
          kind: "item" as const,
          id: source,
          label: INBOX_SOURCE_LABELS[source],
          icon: <InboxProviderMark provider={source} className="block icon-sm shrink-0" />,
        })),
        ...(onConnectMessages
          ? [
              {
                kind: "item" as const,
                id: MESSAGES_ID,
                label: t("Messages"),
                description: ENABLED_MESSAGING_PROVIDERS.map(messagingProviderLabel).join(", "),
                icon: <MessageMultiple className="block icon-sm shrink-0" strokeWidth={1.75} />,
              },
            ]
          : []),
      ]}
      onClose={onClose}
      onPick={(id) => {
        if (id === MESSAGES_ID) {
          onConnectMessages?.();
          return;
        }
        const source = sources.find((source) => source === id);
        if (source) onConnect(source);
      }}
    />
  );
}
