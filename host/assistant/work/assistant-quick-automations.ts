import { readModelRouting } from "../../model-routing/storage";
import { readAssistantProfile } from "../profile-defaults";
import { AssistantRepository } from "../repository";
import type { ModelRoutingTarget } from "../../../src/shared/model/host-contracts/model-routing";
import { createHash } from "node:crypto";
import type { HostStore } from "../../store";
import type { HostAutomations } from "../../automations/automations";
import {
  parseHostAutomation,
  type HostAutomation,
} from "../../../src/features/automations/model/hostAutomations";
import type { AssistantQuickAutomationJob } from "../../../src/shared/model/host-contracts/assistant";
import { QUICK_AUTOMATION_MAX_AHEAD_MS } from "../../../src/shared/model/host-contracts/assistant-quick-automation";
import { normalizeAssistantQuickAutomationAction } from "../../../src/shared/model/assistantQuickAutomation";
import type { ModelPoolSource } from "../../conversation/conversation-model-pool-guard";
import type { QuickAutomationRoutingFields } from "../../../src/shared/model/host-contracts/assistant-quick-automation";

/** Compatibility with server composition; quick automations no longer read the assistant pool. */
export function setQuickAutomationModelPool(_next: ModelPoolSource | undefined) {}

/** Empty voice choices follow the automation role at fire time, with a concrete provider fallback. */
export async function assistantQuickAutomationPoolJob(
  job: AssistantQuickAutomationJob,
  fallback?: ModelRoutingTarget,
): Promise<
  AssistantQuickAutomationJob & {
    quickAction: AssistantQuickAutomationJob["quickAction"] & QuickAutomationRoutingFields;
  }
> {
  if (job.quickAction.model !== "") return job;
  const action = job.quickAction as AssistantQuickAutomationJob["quickAction"] &
    QuickAutomationRoutingFields;
  if (action.modelChoice?.kind === "fixed")
    throw new Error("Choose a model for a fixed automation.");
  if (!fallback?.model)
    throw new Error("Choose a fallback model or configure Models before creating this automation.");
  return {
    ...job,
    quickAction: {
      ...job.quickAction,
      harness: fallback.harness,
      providerAccountId: fallback.providerAccountId,
      modelSettings: fallback.modelSettings,
      model: fallback.model,
      modelChoice: action.modelChoice ?? { kind: "default" },
    },
  };
}

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
  "list" | "save" | "withAuthorization" | "usesStore" | "scheduleOnce"
>;
const ONCE_WINDOW = "A one-time automation must run at a future time within one year.";
const quickAutomationRunAtValid = (runAt: number | undefined, now: number) =>
  runAt === undefined || (runAt > now && runAt <= now + QUICK_AUTOMATION_MAX_AHEAD_MS);
/** Rejects a one-time automation whose run time is not in the future or is more than a year away. */
export function assertQuickAutomationSchedule(action: { runAt?: number }, now: number) {
  if (!quickAutomationRunAtValid(action.runAt, now)) throw new Error(ONCE_WINDOW);
}
export const assistantQuickAutomationId = (jobId: string) =>
  `assistant-quick-${createHash("sha256").update(jobId).digest("hex").slice(0, 40)}`;
function normalizedQuickAutomationAction(
  action: AssistantQuickAutomationJob["quickAction"] & QuickAutomationRoutingFields,
) {
  return {
    ...normalizeAssistantQuickAutomationAction(action),
    ...(action.modelChoice === undefined ? {} : { modelChoice: action.modelChoice }),
    ...(action.providerAccountId === undefined
      ? {}
      : { providerAccountId: action.providerAccountId }),
  };
}
export function assistantQuickAutomationConfiguration(job: AssistantQuickAutomationJob) {
  const { kind: _, runAt, ...action } = normalizedQuickAutomationAction(job.quickAction);
  // A one-time run is stored as a daily schedule at its local time and armed with `scheduleOnce` after saving.
  const at = new Date(runAt ?? 0);
  const once =
    runAt === undefined
      ? {}
      : {
          scheduleKind: "daily",
          minute: 0,
          time: `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`,
          dayOfWeek: at.getDay(),
        };
  return parseHostAutomation({ id: assistantQuickAutomationId(job.id), ...action, ...once });
}
export function assistantQuickAutomationFingerprint(job: AssistantQuickAutomationJob) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        id: job.id,
        title: job.title,
        request: job.request,
        action: normalizedQuickAutomationAction(job.quickAction),
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
      fingerprint = assistantQuickAutomationFingerprint(job);
    let expected: ReturnType<typeof assistantQuickAutomationConfiguration>;
    try {
      let fallback: ModelRoutingTarget | undefined;
      if (!job.quickAction.model) {
        // A concrete fallback is not a run selection: quota-aware resolution happens at fire time.
        fallback = (await readModelRouting(this.store)).entries[0];
        if (!fallback) {
          const execution = (await readAssistantProfile(new AssistantRepository(this.store)))
            .execution;
          if (execution) fallback = execution;
        }
      }
      expected = assistantQuickAutomationConfiguration(
        await assistantQuickAutomationPoolJob(job, fallback),
      );
    } catch (error) {
      return {
        state: "waiting",
        message: `The automation configuration is invalid. No creation was issued: ${String(error).slice(0, 500)}`,
      };
    }
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
    const runAt = job.quickAction.runAt;
    if (!quickAutomationRunAtValid(runAt, this.now()))
      return {
        state: "waiting",
        message: `${ONCE_WINDOW} No creation was issued.`,
      };
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
          if (runAt !== undefined) await automations.scheduleOnce(automationId, runAt);
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
