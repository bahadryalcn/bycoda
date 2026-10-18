export type RuntimeLogLevel = "debug" | "info" | "warn" | "error";

export type RuntimeLogSource = {
  id: string;
  kind: "browser" | "server";
  label: string;
  projectId?: string;
  sessionId?: string;
  url?: string;
  available: boolean;
  reason?: string;
};

export type RuntimeLogEntry = {
  id: string;
  cursor: number;
  timestamp: number;
  sourceId: string;
  source: "browser" | "server";
  level: RuntimeLogLevel;
  message: string;
  details?: unknown;
  stack?: string;
  location?: { file: string; line?: number; column?: number };
  projectId?: string;
  sessionId?: string;
};

export type RuntimeLogQuery = {
  streamId?: string;
  after?: number;
  limit?: number;
  sourceId?: string;
  source?: "browser" | "server";
  levels?: RuntimeLogLevel[];
  search?: string;
  projectId?: string;
  sessionId?: string;
};

export type RuntimeLogSnapshot = {
  /** Optional for older hosts; new hosts always return a generation. */
  streamId?: string;
  entries: RuntimeLogEntry[];
  sources: RuntimeLogSource[];
  cursor: number;
  dropped: number;
};
