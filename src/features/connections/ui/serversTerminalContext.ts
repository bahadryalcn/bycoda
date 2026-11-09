import { createContext, useContext } from "react";
import type { ServerRecord, SshEndpoint } from "../model/serverInventory";

/** What the Servers terminal workspace offers to the catalog, settings and quick connect. */
export type TerminalActions = {
  inventoryVisible: boolean;
  open: (server: ServerRecord) => Promise<void>;
  forwardAgent: (server: ServerRecord, reviewId: string) => void;
  quick: (endpoint: SshEndpoint, name?: string) => void;
  generate: (path: string) => void;
};
export const TerminalContext = createContext<TerminalActions | null>(null);
export const useOpenServerTerminal = () => useContext(TerminalContext)?.open;
export const useOpenAgentServerTerminal = () => useContext(TerminalContext)?.forwardAgent;
export const useGenerateSshKey = () => useContext(TerminalContext)?.generate;
export const useOpenQuickServerTerminal = () => useContext(TerminalContext)?.quick;
export const useServerInventoryVisible = () =>
  useContext(TerminalContext)?.inventoryVisible ?? true;
