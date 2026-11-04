import { createHash } from "node:crypto";
import type { HostStore } from "../../store";
import type { HostAutomations } from "../../automations";
import {
  parseHostAutomation,
  type HostAutomation,
} from "../../../src/features/automations/model/hostAutomations";
import type { AssistantQuickAutomationJob } from "../../../src/shared/model/host-contracts/assistant";
import { normalizeAssistantQuickAutomationAction } from "../../../src/shared/model/assistantQuickAutomation";

export type AssistantQuickAutomationReceipt = {
  jobId: string;
  automationId: string;
  fingerprint: string;
  state: "pending" | "writing" | "completed" | "unknown" | "conflict";
  createdAt: number;
  updatedAt: number;
  message: string;
  automationCreatedAt?: number;
  automationUpdatedAt?: number;
};
export type AssistantQuickAutomationResult = {
  state: "completed" | "waiting";
  automationId?: string;
  message: string;
};
export type AssistantQuickAutomationService = Pick<
  HostAutomations,
  "list" | "save" | "withAuthorization" | "usesStore"
>;
export const assistantQuickAutomationId = (jobId: string) =>
  `assistant-quick-${createHash("sha256").update(jobId).digest("hex").slice(0, 40)}`;
export function assistantQuickAutomationConfiguration(job: AssistantQuickAutomationJob) {
  const { kind: _, ...action } = normalizeAssistantQuickAutomationAction(job.quickAction);
  return parseHostAutomation({ id: assistantQuickAutomationId(job.id), ...action });
}
export function assistantQuickAutomationFingerprint(job: AssistantQuickAutomationJob) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        id: job.id,
        title: job.title,
        request: job.request,
        action: normalizeAssistantQuickAutomationAction(job.quickAction),
      }),
    )
    .digest("hex");
}
function configuration(value: HostAutomation) {
  const parsed = parseHostAutomation(value);
  return {
    ...parsed,
    modelSettings: Object.fromEntries(
      Object.entries(parsed.modelSettings).sort(([a], [b]) => a.localeCompare(b)),
    ),
  };
}
class QuickAutomationConflictError extends Error {}

/** Exactly one reviewed canonical creation. No runNow, generic RPC or model port. */
export class HostAssistantQuickAutomations {
  readonly ready: Promise<void>;
  private tail: Promise<unknown> = Promise.resolve();
  constructor(
    private readonly store: HostStore,
    private readonly ports: {
      automations(): AssistantQuickAutomationService;
      authorized(job: AssistantQuickAutomationJob): Promise<boolean>;
      now?(): number;
    },
  ) {
    this.ready = (async () => {
      await store.ready;
      await store.db.scope(() =>
        store.db.exec(
          "CREATE TABLE IF NOT EXISTS assistant_quick_automations(job_id TEXT PRIMARY KEY,value TEXT NOT NULL)",
        ),
      );
    })();
  }
  private now() {
    return this.ports.now?.() ?? Date.now();
  }
  async receipt(id: string): Promise<AssistantQuickAutomationReceipt | undefined> {
    await this.ready;
    const row = await this.store.db
      .prepare("SELECT value FROM assistant_quick_automations WHERE job_id=?")
      .get(id);
    return row ? JSON.parse(row.value) : undefined;
  }
  private write(record: AssistantQuickAutomationReceipt) {
    return this.store.db
      .prepare(
        "INSERT INTO assistant_quick_automations(job_id,value) VALUES(?,?) ON CONFLICT(job_id) DO UPDATE SET value=excluded.value",
      )
      .run(record.jobId, JSON.stringify({ ...record, updatedAt: this.now() }));
  }
  run(job: AssistantQuickAutomationJob): Promise<AssistantQuickAutomationResult> {
    const result = this.tail.then(() => this.execute(job));
    this.tail = result.catch(() => undefined);
    return result;
  }
  private async execute(job: AssistantQuickAutomationJob): Promise<AssistantQuickAutomationResult> {
    await this.ready;
    const automationId = assistantQuickAutomationId(job.id),
      fingerprint = assistantQuickAutomationFingerprint(job),
      expected = assistantQuickAutomationConfiguration(job);
    let receipt = await this.receipt(job.id);
    if (receipt && (receipt.automationId !== automationId || receipt.fingerprint !== fingerprint))
      return {
        state: "waiting",
        message:
          "The reviewed automation payload changed. Inspect its original intent; it will not be replayed.",
      };
    if (receipt?.state === "completed")
      return {
        state: "completed",
        automationId,
        message:
          "The reviewed automation was created. Its schedule and later edits have an independent lifecycle.",
      };
    if (!receipt) {
      receipt = {
        jobId: job.id,
        automationId,
        fingerprint,
        state: "pending",
        createdAt: this.now(),
        updatedAt: this.now(),
        message: "The owner reviewed this exact automation configuration.",
      };
      await this.store.transaction(() => this.write(receipt!), "critical");
    }
    let automations: AssistantQuickAutomationService;
    try {
      automations = this.ports.automations();
      if (!automations.usesStore(this.store))
        throw new Error("Automation storage differs from this Host's creation ledger.");
    } catch (error) {
      return {
        state: "waiting",
        message: `Automation storage is unavailable. No creation was issued: ${String(error).slice(0, 500)}`,
      };
    }
    if (receipt.state !== "pending") {
      const existing = (await automations.list()).find((item) => item.id === automationId);
      return {
        state: "waiting",
        message: existing
          ? "An automation exists at the original ID without a confirmed atomic creation receipt. Inspect its configuration; it will not be adopted or overwritten."
          : "The prior automation creation is unknown or missing. Owner inspection is required; no replay was issued.",
      };
    }
    if (!(await this.ports.authorized(job)))
      return {
        state: "waiting",
        message: "This quick job was stopped, paused or changed before automation creation.",
      };
    receipt = {
      ...receipt,
      state: "writing",
      message:
        "The exact automation creation was admitted once; its original identity is retained.",
    };
    await this.store.transaction(() => this.write(receipt!), "critical");
    // Canonical withAuthorization installs its own guard. Preserve the actual
    // caller's outer grant as well as this saved job's final-effect fence.
    const inherited = await this.store.db.captureAuthorization();
    const authorized = async () => {
      await inherited();
      return this.ports.authorized(job);
    };
    try {
      await automations.withAuthorization(authorized, () =>
        this.store.transaction(async () => {
          await this.store.db.checkAuthorization();
          if (!(await this.ports.authorized(job)))
            throw new Error("The owner-held quick job changed before creation.");
          if ((await automations.list()).some((item) => item.id === automationId))
            throw new QuickAutomationConflictError(
              "The deterministic automation ID already exists and will not be overwritten.",
            );
          const created = await automations.save(expected);
          if (
            JSON.stringify(configuration(created)) !==
            JSON.stringify(configuration({ ...expected, nextRunAt: 0, createdAt: 0, updatedAt: 0 }))
          )
            throw new Error(
              "The actual automation configuration did not match the owner's reviewed payload.",
            );
          await this.write({
            ...receipt!,
            state: "completed",
            automationCreatedAt: created.createdAt,
            automationUpdatedAt: created.updatedAt,
            message:
              "The exact canonical automation and its creation receipt committed atomically.",
          });
        }, "critical"),
      );
      return {
        state: "completed",
        automationId,
        message:
          "The reviewed automation was created. Its schedule and later edits have an independent lifecycle.",
      };
    } catch (error) {
      // The transaction may have committed before its response was lost or revoked.
      // A completed receipt is atomic proof; later owner edits/deletion do not undo it.
      const actual = await this.receipt(job.id);
      if (actual?.state === "completed" && actual.fingerprint === fingerprint)
        return {
          state: "completed",
          automationId,
          message:
            "The reviewed automation was created. Its schedule and later edits have an independent lifecycle.",
        };
      const conflict = error instanceof QuickAutomationConflictError;
      await this.store.db.runRecoveryBookkeeping(() =>
        this.store.transaction(
          () =>
            this.write({
              ...receipt!,
              state: conflict ? "conflict" : "unknown",
              message: `Creation needs inspection; no replay or overwrite is allowed. ${String(error).slice(0, 500)}`,
            }),
          "critical",
        ),
      );
      return {
        state: "waiting",
        message: conflict
          ? "An existing automation occupies this quick job's ID. It was not overwritten; owner inspection is required."
          : "The quick automation creation result is unknown. Inspect Automations before issuing another creation.",
      };
    }
  }
}
