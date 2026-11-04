/** Shared clarifying-question model for every harness that can ask the user. */

export const CUSTOM_OPTION_ID = "__custom__";

/** Durable file metadata; paths are resolved on the executing Host. */
export type UserQuestionAttachment = {
  id: string;
  name: string;
  mimeType: string;
  kind: "image" | "audio" | "file";
  size: number;
  path?: string;
  hostEnvironmentId?: string;
};

export type UserQuestionOption = {
  id: string;
  label: string;
  description?: string;
  /** Literal schema value; labels such as Other must not become a free-text option. */
  literal?: boolean;
};

export type UserQuestion = {
  id: string;
  header?: string;
  prompt: string;
  multiSelect: boolean;
  allowCustom: boolean;
  /** Typed form text is a value, including meaningful leading/trailing spaces. */
  preserveCustomWhitespace?: boolean;
  options: UserQuestionOption[];
};

/** Provider-owned execution semantics; omission means the provider did not report it. */
export type UserQuestionBehavior = "blocking" | "nonBlocking";
export type UserQuestionDelivery = "sending" | "queued" | "failed" | "unknown";
export type UserQuestionDismissAction = "skip" | "cancel" | "decline";

export type UserQuestionPrompt = {
  requestId: number;
  /** Host-generated identity for this exact occurrence; not a permission grant. */
  occurrenceId?: string;
  title?: string;
  questions: UserQuestion[];
  behavior?: UserQuestionBehavior;
  dismissAction?: UserQuestionDismissAction;
  providerTurnId?: string;
  callId?: string;
  /** Transport state, never a claim that the model consumed the answer. */
  delivery?: UserQuestionDelivery;
  error?: string;
  /** Deadline owned by the harness; interaction can disable automatic skipping. */
  autoResolveAt?: number;
};

export type UserQuestionReply =
  | {
      kind: "answered";
      answers: Record<string, string[]>;
      custom?: Record<string, string>;
      attachments?: Record<string, UserQuestionAttachment[]>;
    }
  | { kind: "skipped" };
