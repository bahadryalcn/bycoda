import { useId, type ReactNode } from "react";
import { t } from "../../../../shared/i18n";
import type { MessageTimelineItem } from "../../../../shared/ui/MessageTimeline";
import { PromptField } from "../../../../shared/ui/PromptField";
import { AgentMarkdown } from "../../../sessions/public/AgentMarkdown";
import {
  ComposerAction,
  TurnOutputActions,
  UserTextPreview,
  userTextParts,
} from "../../../sessions/public/chatPresentation";
import type { FloatingButtonGroupAction } from "../../../../shared/ui/FloatingButtonGroup";

function AssistantChatBody({
  role,
  text,
  children,
}: {
  role: "user" | "assistant" | "system";
  text: string;
  children?: ReactNode;
}) {
  const messageId = useId();
  return (
    <>
      {role === "user" ? (
        <UserTextPreview
          parts={userTextParts(text)}
          messageId={messageId}
          renderActions={() => <TurnOutputActions getText={() => text} />}
        />
      ) : (
        <AgentMarkdown text={text} revealOnMount={false} hardBreaks />
      )}
      {children}
    </>
  );
}

/**
 * Room and job discussions share the normal chat renderer on the shared message timeline;
 * their owners keep data and authority. The user's messages are the owner's own.
 */
export function assistantChatItem({
  id,
  role,
  text,
  time,
  author,
  meta,
  actions,
  children,
}: {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  time: number;
  author?: string;
  meta?: ReactNode;
  actions?: FloatingButtonGroupAction[];
  children?: ReactNode;
}): MessageTimelineItem {
  return {
    id,
    time,
    own: role === "user",
    plain: role === "assistant",
    author,
    meta,
    actions: <TurnOutputActions getText={() => text} extraItems={actions} />,
    body: (
      <AssistantChatBody role={role} text={text}>
        {children}
      </AssistantChatBody>
    ),
  };
}

/** Controlled text-only chat: no session queue, attachments or model ownership is invented. */
export function AssistantChatComposer({
  value,
  onValueChange,
  onSend,
  label,
  placeholder,
  sendLabel,
  pending = false,
  disabled = false,
  readOnly = false,
  sendDisabled = false,
  maxLength = 16000,
}: {
  value: string;
  onValueChange: (value: string) => void;
  onSend: () => void;
  label: string;
  placeholder?: string;
  sendLabel?: string;
  pending?: boolean;
  disabled?: boolean;
  readOnly?: boolean;
  sendDisabled?: boolean;
  maxLength?: number;
}) {
  const blocked = disabled || readOnly || sendDisabled || pending || !value.trim();
  return (
    <PromptField
      quiet
      label={label}
      placeholder={placeholder ?? label}
      value={value}
      disabled={disabled}
      readOnly={readOnly}
      minRows={2}
      maxRows={8}
      maxLength={maxLength}
      onChange={(event) => onValueChange(event.currentTarget.value)}
      onKeyDown={(event) => {
        if (
          event.key === "Enter" &&
          !event.shiftKey &&
          !event.altKey &&
          !event.ctrlKey &&
          !event.metaKey &&
          !event.nativeEvent.isComposing &&
          event.keyCode !== 229
        ) {
          event.preventDefault();
          if (!blocked) onSend();
        }
      }}
      toolbarTrailing={
        <ComposerAction
          busy={false}
          submitting={pending ? "send" : null}
          disabled={blocked}
          hasValue={Boolean(value.trim())}
          label={sendLabel ?? t("Send")}
          onSend={() => {
            if (!blocked) onSend();
          }}
          onStop={() => {}}
        />
      }
    />
  );
}
