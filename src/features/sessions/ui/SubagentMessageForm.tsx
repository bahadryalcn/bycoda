import type { ComponentProps } from "react";
import { LiveText } from "../../../shared/ui/LiveText";
import { Text } from "../../../shared/ui/Text";
import { ScrollArea } from "../../../shared/ui/ScrollArea";
import { surfaceAttributes } from "../../../shared/ui/Surface";
import { useT } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { InfoTooltip } from "../../../shared/ui/InfoPopover";
import { TextareaField } from "../../../shared/ui/TextareaField";
import { sessionWorkCwd, type Session } from "../model/session";
import { setComposerDraft } from "../model/draftCache";
import { Composer } from "./Composer";
import { useSessionComposerDraft } from "./useSessionComposerDraft";
import styles from "./SubagentSheet.module.css";

type SubagentChatComposerProps = {
  name: string;
  session: Session;
  visible: boolean;
} & Pick<
  ComponentProps<typeof Composer>,
  | "parentSessionId"
  | "remoteSession"
  | "remoteFeatures"
  | "sendBlockedReason"
  | "sendHeldReason"
  | "onSubmit"
  | "onStop"
  | "onOpenFile"
  | "onDeleteQueuedMessage"
  | "onEditQueuedMessage"
  | "onQueuedMessageEditingChange"
  | "onReorderQueuedMessages"
  | "onSteerQueuedMessage"
  | "onResumeQueue"
>;

const ignore = () => {};

/** The ordinary conversation composer with the child's immutable execution identity. */
export function SubagentChatComposer({
  name,
  session,
  visible,
  ...controls
}: SubagentChatComposerProps) {
  const t = useT();
  const draft = useSessionComposerDraft(session.id);
  return (
    <div className="shrink-0 px-2 pb-2">
      <Composer
        {...controls}
        key={session.id}
        enabled={visible}
        focused={false}
        harness={session.harness}
        model={session.model}
        modelSettings={session.modelSettings}
        providerAccountId={session.providerAccountId}
        runtimeMode={session.runtimeMode}
        cwd={session.cwd}
        executionCwd={sessionWorkCwd(session)}
        sessionId={session.id}
        initialDraft={draft.initialDraft}
        onDraftChange={(text) => {
          draft.change(text);
          setComposerDraft(session.id, text);
        }}
        busy={!!session.busy || !!session.continuingElsewhere}
        runningModelTarget={session.runningModelTarget}
        queuedMessages={session.queuedMessages}
        queueStatus={session.queueStatus}
        hideProjectPicker
        hideBranchPicker
        hideTopBar
        hideIdentityControls
        placeholder={t("Message")}
        inputAriaLabel={t("Message for {p0}", { p0: name })}
        onFocus={ignore}
        onCwdChange={ignore}
        onModelChange={ignore}
        onRuntimeModeChange={ignore}
      />
    </div>
  );
}

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
    <div className={styles.composer}>
      <ScrollArea
        as="form"
        gutter="stable"
        data-chat-column
        {...surfaceAttributes(
          { frame: "pane", edge: "top" },
          "mx-auto flex min-h-0 w-full flex-1 flex-col gap-2 px-4 py-3",
        )}
        onSubmit={(event) => {
          event.preventDefault();
          if (canSend) relay.send();
        }}
      >
        <TextareaField
          label={t("Message for {p0}", { p0: name })}
          minRows={2}
          maxRows={5}
          value={relay.draft}
          aria-keyshortcuts="Control+Enter Meta+Enter"
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
        <LiveText
          size="caption"
          tone={relay.status === "rejected" ? "danger" : "secondary"}
          className="empty:hidden"
          text={
            relay.status === "accepted"
              ? direct
                ? t("Message accepted. It goes to this agent as its next input.")
                : t("Request added to the main conversation. Delivery is not yet confirmed.")
              : relay.status === "rejected"
                ? t("Request was not accepted. Your message is kept here; try again.")
                : ""
          }
        />
        <div className="flex flex-wrap items-center justify-end gap-2">
          <InfoTooltip className="me-auto" label={t("How messaging works")}>
            {direct
              ? t(
                  "Sent straight to this agent. While it runs, the message steers it; once it has finished, the message starts a new turn.",
                )
              : t(
                  "Via the main agent. Delivery depends on provider support; replies appear in the main conversation.",
                )}
          </InfoTooltip>
          {direct && relay.onOpenConversation ? (
            <Button variant="ghost" onClick={relay.onOpenConversation}>
              {t("Open session")}
            </Button>
          ) : null}
          <Button type="submit" variant="primary" disabled={!canSend} shortcut="Mod+Enter">
            {direct ? t("Send") : t("Relay via main agent")}
          </Button>
        </div>
      </ScrollArea>
    </div>
  );
}
