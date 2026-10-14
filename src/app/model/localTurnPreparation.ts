import { startPerformanceSpan, recordPerformanceEvent } from "../../shared/lib/performanceTrace";

export type LocalTurnStage = "checkpoint" | "attachments" | "prompt" | "ready" | "cancelled";
export type LocalTurnPreparation<A> = {
  traceId?: string;
  checkpoint: () => Promise<void>;
  attachments: () => Promise<A>;
  prompt: () => Promise<string>;
  isCurrent: () => boolean;
  onStage?: (stage: LocalTurnStage) => void;
};

/** Preparation owns no provider side effects. Cancellation must be checked
 * again by the caller immediately before dispatch. Checkpoint completion is
 * always awaited, even while independent read-only preparation overlaps it. */
export async function prepareLocalTurn<A>(
  options: LocalTurnPreparation<A>,
): Promise<{ attachments: A; prompt: string } | null> {
  const finish = startPerformanceSpan("send-prepare", {}, options.traceId);
  const stage = async <T>(name: LocalTurnStage, action: () => Promise<T>): Promise<T> => {
    options.onStage?.(name);
    const end = startPerformanceSpan(
      name === "checkpoint" ? "checkpoint" : "send-prepare",
      { phase: name === "checkpoint" ? 1 : name === "attachments" ? 2 : 3 },
      options.traceId,
    );
    try {
      return await action();
    } finally {
      end();
    }
  };
  try {
    if (!options.isCurrent()) {
      options.onStage?.("cancelled");
      return null;
    }
    const [, attachments, prompt] = await Promise.all([
      stage("checkpoint", options.checkpoint),
      stage("attachments", options.attachments),
      stage("prompt", options.prompt),
    ]);
    if (!options.isCurrent()) {
      options.onStage?.("cancelled");
      return null;
    }
    options.onStage?.("ready");
    recordPerformanceEvent("send-prepare", { phase: 4 }, options.traceId);
    return { attachments, prompt };
  } finally {
    finish();
  }
}
