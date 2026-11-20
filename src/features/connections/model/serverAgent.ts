import { createContext } from "react";
import type { RecentProject } from "../../projects/public/recents";

export type ServerAgentTarget = { terminalId: string; serverId?: string; name: string };

export type ServerAgentSession = { sessionId: string; cwd: string; serverId?: string };

export const ServerAgentContext = createContext<{
  projects: readonly RecentProject[];
  open(target: ServerAgentTarget, project: string): Promise<ServerAgentSession>;
  mount(session: ServerAgentSession, host: HTMLElement): () => void;
  addSelection(sessionId: string, text: string): void;
  sendSelection(session: ServerAgentSession, text: string): Promise<void>;
} | null>(null);
