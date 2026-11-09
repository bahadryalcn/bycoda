import type { RefObject } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { MessageMultiple, Plus } from "../../../shared/ui/icons";
import { Tab, TabList, Tabs } from "../../../shared/ui/Tabs";
import { INBOX_SOURCE_LABELS, type InboxSource } from "../model/inboxFilters";
import { InboxProviderMark } from "./InboxProviderMark";

/** Tab value of the messaging source; never an InboxSource name. */
const MESSAGES_TAB = "messages";

function InboxSourceTab({
  source,
  selected,
  onSelect,
}: {
  source: InboxSource;
  selected: boolean;
  onSelect: (source: InboxSource) => void;
}) {
  useLocale();
  const label = INBOX_SOURCE_LABELS[source];
  return (
    <Tab
      value={source}
      // Choosing the current source again still returns to its list (clears the open item).
      onClick={() => {
        if (selected) onSelect(source);
      }}
    >
      <span className="flex items-center gap-1.5">
        <InboxProviderMark provider={source} className="block icon-sm shrink-0" />
        <span className="leading-none">{label}</span>
      </span>
    </Tab>
  );
}

/** Source tabs (provider sources plus Messages) and the connect button above every Inbox list. */
export function InboxSourceRow({
  sources,
  source,
  messages,
  messagesSelected,
  onSelect,
  onSelectMessages,
  connectable,
  connectOpen,
  connectButtonRef,
  onToggleConnect,
}: {
  sources: readonly InboxSource[];
  source: InboxSource;
  /** Shows the Messages tab (at least one messaging account exists). */
  messages: boolean;
  messagesSelected: boolean;
  onSelect: (source: InboxSource) => void;
  onSelectMessages: () => void;
  connectable: boolean;
  connectOpen: boolean;
  connectButtonRef: RefObject<HTMLButtonElement | null>;
  onToggleConnect: () => void;
}) {
  useLocale();
  const tabCount = sources.length + (messages ? 1 : 0);
  return (
    <div className="flex h-9 shrink-0 items-center gap-px px-2">
      {tabCount > 0 ? (
        <Tabs
          value={messagesSelected ? MESSAGES_TAB : source}
          onValueChange={(next) => {
            if (next === MESSAGES_TAB) onSelectMessages();
            else {
              const picked = sources.find((option) => option === next);
              if (picked) onSelect(picked);
            }
          }}
          panels="none"
        >
          <TabList
            label={t("Inbox source")}
            className="min-w-0 basis-0"
            style={{ flexGrow: tabCount }}
          >
            {sources.map((option) => (
              <InboxSourceTab
                key={option}
                source={option}
                selected={!messagesSelected && source === option}
                onSelect={onSelect}
              />
            ))}
            {messages ? (
              <Tab value={MESSAGES_TAB}>
                <span className="flex items-center gap-1.5">
                  <MessageMultiple className="block icon-sm shrink-0" strokeWidth={1.75} />
                  <span className="leading-none">{t("Messages")}</span>
                </span>
              </Tab>
            ) : null}
          </TabList>
        </Tabs>
      ) : null}
      {connectable ? (
        <Button
          iconOnly
          label={t("Connect an inbox source")}
          variant="ghost"
          ref={connectButtonRef}
          type="button"
          aria-label={t("Connect an inbox source")}
          aria-haspopup="menu"
          aria-expanded={connectOpen}
          onClick={onToggleConnect}
        >
          <Plus className="icon-sm" strokeWidth={1.75} aria-hidden="true" />
        </Button>
      ) : null}
    </div>
  );
}
