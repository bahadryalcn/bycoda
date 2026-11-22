import { createContext } from "react";

/**
 * Conversation that owns the transcript rendering a link. Links resolve their
 * Host context from this, never from the selected conversation.
 */
export const TranscriptSessionId = createContext<string | undefined>(undefined);
