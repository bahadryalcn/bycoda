import { useId, type ReactNode } from "react";
import { t } from "../../../../shared/i18n";
import { Text } from "../../../../shared/ui/Text";
import { surfaceAttributes } from "../../../../shared/ui/Surface";
import { PromptField } from "../../../../shared/ui/PromptField";
import { AgentMarkdown } from "../../../sessions/public/AgentMarkdown";
import {
  ComposerAction,
  TurnOutputActions,
  UserTextPreview,
  userTextParts,
} from "../../../sessions/public/chatPresentation";
import type { FloatingButtonGroupAction } from "../../../../shared/ui/FloatingButtonGroup";
import styles from "./AssistantChat.module.css";

/** Room and job discussions share the normal chat renderer; their owners keep data and authority. */
export function AssistantChatMessage({
  role,
  text,
  author,
  metadata,
  actions,
  children,
}: {
  role: "user" | "assistant" | "system";
  text: string;
  author?: string;
  metadata?: ReactNode;
  actions?: FloatingButtonGroupAction[];
  children?: ReactNode;
}) {
  const messageId = useId();
  return (
    <article className={styles.message} data-author={role}>
      <Text as="div" size="caption" tone="secondary" className={styles.author}>
        {author && (
          <Text as="span" size="caption" weight="medium">
            {author}
          </Text>
        )}
        {metadata}
      </Text>
      <div
        {...surfaceAttributes(
          role === "user"
            ? { variant: "fill-subtle", radius: "chat-end" }
            : { variant: "canvas-chat" },
          styles.content,
        )}
      >
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
      </div>
      <TurnOutputActions getText={() => text} extraItems={actions} />
    </article>
  );
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
