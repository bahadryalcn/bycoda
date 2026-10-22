import { t, useLocale } from "../../../shared/i18n";
import { INBOX_SOURCE_LABELS, type ConnectableInboxSource } from "../model/inboxFilters";
import { InboxProviderMark } from "./InboxProviderMark";
import type { PopoverAnchor } from "../../../shared/ui/Popover";
import { DropdownMenu } from "../../../shared/ui/DropdownMenu";
export function InboxConnectMenu({
  anchor,
  sources,
  onConnect,
  onClose,
}: {
  anchor: PopoverAnchor;
  sources: ConnectableInboxSource[];
  onConnect: (source: ConnectableInboxSource) => void;
  onClose: () => void;
}) {
  useLocale();
  return (
    <DropdownMenu
      anchor={anchor}
      label={t("Connect an inbox source")}
      width={220}
      items={sources.map((source) => ({
        kind: "item",
        id: source,
        label: t("Connect ") + INBOX_SOURCE_LABELS[source],
        icon: <InboxProviderMark provider={source} className="block size-3.5 shrink-0" />,
      }))}
      onClose={onClose}
      onPick={(id) => {
        const source = sources.find((source) => source === id);
        if (source) onConnect(source);
      }}
    />
  );
}
