import type {
  WorkOutcome,
  WorkReceipt,
  WorkRecord,
  WorkTarget,
  WorkWait,
} from "../../src/shared/model/host-contracts/work";

export type WorkObservation =
  | { state: "unknown" }
  | { state: "running"; receipt: WorkReceipt }
  /** Completed means exact physical run retirement is proven, not merely UI completion. */
  | { state: "completed"; receipt: WorkReceipt; outcome: WorkOutcome };

/** Host launch helper returned before issuing send. Never infer this from an error. */
export type WorkLaunchDeferral = { deferredBeforeSend: true; wait: WorkWait };

/** Host composition supplies concrete domain dispatch, never a second provider engine. */
export interface WorkCallbacks {
  /** Recheck permission, cap and domain dependency gates before every dispatch. */
  admit?(work: WorkRecord): Promise<WorkWait | undefined>;
  resolve(work: WorkRecord): Promise<{ target: WorkTarget } | { wait: WorkWait }>;
  /** Persist onAccepted inside existing command admission before provider effects.
   * A thrown error is ambiguous. It MUST NOT trigger a private producer retry. */
  launch(
    work: WorkRecord,
    onAccepted: (receipt: WorkReceipt) => Promise<void>,
  ): Promise<WorkReceipt | WorkLaunchDeferral>;
  /** Recover by requestId when an ACK was lost; absence is unknown, never proof of failure. */
  observe(work: WorkRecord): Promise<WorkObservation>;
  /** Exact receipt only. Resolution proves cancellation requested, not retirement. */
  stop(work: WorkRecord, receipt: WorkReceipt): Promise<void>;
  /** Existing external run accounting; exact identities allow deduplication. */
  externalRunning(): Promise<Array<WorkReceipt & { projectId?: string }>>;
  projectConcurrency?(projectId: string): Promise<number | undefined>;
}
