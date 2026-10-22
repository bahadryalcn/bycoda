/** Headless host shells use pipes. Full-screen/PTY programs and resizing are unsupported. */
export type HostTerminal = {
  id: string;
  projectId: string;
  name: string;
  cwd: string;
  shell: string;
  transport: "pipe";
  state: "running" | "exited";
  createdAt: number;
  exitCode: number | null;
};

export type HostTerminalProfile = { id: string; name: string };
export type HostTerminalList = {
  terminals: HostTerminal[];
  writable: boolean;
  profiles: HostTerminalProfile[];
};
export type HostTerminalCreate = {
  projectId: string;
  /** Reuse only for a retry of the same creation request. */
  requestId: string;
  name?: string;
  cwd?: string;
  profileId?: string;
};
export type HostTerminalRead = {
  terminal: HostTerminal;
  output: string;
  /** Character offset, independent of the bounded retained output window. */
  cursor: number;
  truncated: boolean;
  hasMore: boolean;
};
