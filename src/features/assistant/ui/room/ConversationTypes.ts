import type { ConversationPanelProps, ConversationPanelState } from "./useConversationPanelState";
import type { ConversationPanelMessagesState } from "./useConversationPanelMessages";
import type { ConversationPanelSendState } from "./useConversationPanelSend";
import type { useConversationPanelView } from "./useConversationPanelView";

/** Everything the Conversations tab hooks produce, passed whole to the presentational parts. */
export type ConversationContext = ConversationPanelProps &
  ConversationPanelState &
  ConversationPanelMessagesState &
  ConversationPanelSendState &
  ReturnType<typeof useConversationPanelView>;
