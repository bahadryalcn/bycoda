import { createContext } from "react";

export type ServerAgentTarget = { terminalId: string; serverId?: string; name: string };

export type ServerAgentSession = { sessionId: string; cwd: string; serverId?: string };

export const ServerAgentContext = createContext<{
  project: string;
  open(target: ServerAgentTarget): Promise<ServerAgentSession>;
  mount(session: ServerAgentSession, host: HTMLElement): () => void;
  addSelection(sessionId: string, text: string): void;
} | null>(null);
