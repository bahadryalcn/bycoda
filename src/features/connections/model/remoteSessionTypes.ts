import type { Attachment, Block, RuntimeMode } from "../../sessions";
import type { HostCommand, RemoteProvider } from "./protocol";

export type Configuration = {
  providerAccountId?: string | null;
  authorityGeneration?: number;
  harness: RemoteProvider;
  model: string;
  settings: Record<string, string>;
  mode: RuntimeMode;
};

export type OptimisticTurn = {
  authorityGeneration?: number;
  queued?: HostCommand["queued"];
  commandId: string;
  text: string;
  attachments: Attachment[];
  intent: "default" | "plan" | "build";
  draft?: boolean;
  draftBlockId?: string;
  planBlockId?: string;
  startedAt: number;
  turnModel: NonNullable<Block["turnModel"]>;
  acceptedRun?: { sessionId: string; runId: string; authorityGeneration?: number };
  onSendRejected?: () => boolean;
  restoredDraft?: boolean;
  /** Its command is in the outbox, so a failed dispatch is retried, not shown as failed. */
  saved?: boolean;
};
