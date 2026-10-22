/** Desktop-assisted real local PTY. Independent of the headless pipe tool. */
export type MobilePtyTerminal = {
  terminalId: string;
  epoch: string;
  sourceSessionId: string;
  name: string;
  shell: string;
  state: "running" | "exited";
  cols: number;
  rows: number;
  exitCode: number | null;
  control: "mobile" | "none";
  replayStart: number;
  replayEnd: number;
};
export type MobilePtyLease = { terminal: MobilePtyTerminal; leaseId: string; expiresAt: number };
export type MobilePtyList = { terminals: MobilePtyTerminal[] };
export type MobilePtyRead = {
  terminalId: string;
  epoch: string;
  after: number;
  next: number;
  oldest: number;
  end: number;
  dataBase64: string;
  state: "running" | "exited";
  exitCode: number | null;
  gap: boolean;
  hasMore: boolean;
};
export type MobilePtyStatus = {
  terminal: MobilePtyTerminal;
  leaseId: string;
  expiresAt: number;
  lastInputSequence: number;
  lastInputState: "accepted" | "unknown";
};
