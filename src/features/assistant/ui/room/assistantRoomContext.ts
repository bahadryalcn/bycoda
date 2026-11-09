import { createContext, useContext } from "react";
import type { AssistantRoomCore } from "./useAssistantRoomState";
import type { useAssistantRoomJobs } from "./useAssistantRoomJobs";

export type AssistantRoom = AssistantRoomCore & ReturnType<typeof useAssistantRoomJobs>;

export const AssistantRoomContext = createContext<AssistantRoom | null>(null);

export function useAssistantRoom(): AssistantRoom {
  const room = useContext(AssistantRoomContext);
  if (!room) throw new Error("Assistant room state is only available inside the Room.");
  return room;
}
