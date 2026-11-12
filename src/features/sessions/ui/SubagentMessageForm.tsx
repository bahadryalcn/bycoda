import { Text } from "../../../shared/ui/Text";
import { ScrollArea } from "../../../shared/ui/ScrollArea";
import { useT } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { InfoPopover } from "../../../shared/ui/InfoPopover";
import { TextareaField } from "../../../shared/ui/TextareaField";
import styles from "./SubagentSheet.module.css";

export type SubagentRelay = {
  /** `relay` routes the message through the main agent; `direct` sends it to the child session. */
  mode?: "relay" | "direct";
  draft: string;
  status?: "accepted" | "rejected";
  blockedReason?: string;
  setDraft: (draft: string) => void;
  send: () => void;
  onOpenConversation?: () => void;
  /** Why opening the conversation failed; the sheet stays open. */
  openError?: string;
};

/** The message box under a subagent's trail. Its copy follows `relay.mode`. */
export function SubagentMessageForm({ name, relay }: { name: string; relay: SubagentRelay }) {
  const t = useT();
  const direct = relay.mode === "direct";
  const canSend = !relay.blockedReason && !!relay.draft.trim();
  return (
    <ScrollArea
      as="form"
      gutter="stable"
      className={`${styles.composer} flex shrink-0 flex-col gap-2 border-t border-(--ui-pane-border) px-4 py-3`}
      onSubmit={(event) => {
        event.preventDefault();
        if (canSend) relay.send();
      }}
    >
      <TextareaField
        className={styles.message}
        label={t("Message for {p0}", { p0: name })}
        rows={2}
        value={relay.draft}
        onChange={(event) => relay.setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (
            event.key === "Enter" &&
            (event.ctrlKey || event.metaKey) &&
            !event.nativeEvent.isComposing
          ) {
            event.preventDefault();
            if (canSend) relay.send();
          }
        }}
      />
      {relay.openError ? (
        <Text as="p" size="caption" tone="danger">
          {relay.openError}
        </Text>
      ) : null}
      {relay.blockedReason ? (
        <Text as="p" size="caption" tone="secondary">
          {relay.blockedReason}
        </Text>
      ) : null}
      <Text
        role="status"
        as="p"
        size="caption"
        tone={relay.status === "rejected" ? "danger" : "secondary"}
        className={` empty:hidden `}
      >
        {relay.status === "accepted"
          ? direct
            ? t("Message accepted. It goes to this agent as its next input.")
            : t("Request added to the main conversation. Delivery is not yet confirmed.")
          : relay.status === "rejected"
            ? t("Request was not accepted. Your message is kept here; try again.")
            : null}
      </Text>
      <div className="flex flex-wrap items-center justify-end gap-2">
        <InfoPopover className="mr-auto" label={t("How messaging works")}>
          <Text as="p" size="secondary" tone="inherit">
            {direct
              ? t(
                  "Sent straight to this agent. While it runs, the message steers it; once it has finished, the message starts a new turn.",
                )
              : t(
                  "Via the main agent. Delivery depends on provider support; replies appear in the main conversation.",
                )}
          </Text>
        </InfoPopover>
        {relay.onOpenConversation ? (
          <Button variant="ghost" onClick={relay.onOpenConversation}>
            {direct ? t("Open conversation") : t("Open main conversation")}
          </Button>
        ) : null}
        <Button type="submit" variant="primary" disabled={!canSend}>
          {direct ? t("Send") : t("Relay via main agent")}
        </Button>
      </div>
    </ScrollArea>
  );
}
