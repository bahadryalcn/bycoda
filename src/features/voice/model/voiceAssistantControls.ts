import { z } from "zod";
import type {
  AssistantRequest,
  AssistantResponse,
} from "../../../shared/model/host-contracts/assistant";
import { assistantJobProjectIds, assistantJobVisible } from "../../assistant/model/assistantJobs";
import { verifiedAssistantJobDeleteReview } from "../../assistant/model/assistantJobDeletion";
import type { AssistantJobDeleteReview } from "../../../shared/model/host-contracts/assistant";
export const VOICE_ASSISTANT_CONTROL_TOOLS = [
  {
    name: "assistant_status",
    description:
      "Read bounded assistant jobs and personal assistant notes in visible project scope. Discover exact IDs and versions before changing anything. Assistant jobs are not coding sessions: for sessions (oturum) in a project, list them with workspace.sessions.list.",
    properties: {},
    required: [],
  },
  {
    name: "assistant_job_control",
    description:
      "Pause, resume, stop, keep after an uncertain deletion, or delete one assigned assistant job on the current owner's explicit request. Preserve its discovered ID/version. Deletion always waits for actual owner confirmation; never supply an approval boolean. Set deleteTasks true only for a direct current owner request to delete this job AND its canonical tasks together; an exact Host scope is reviewed first. Omit deleteTasks for job-only deletion. Keep releases only a pending deletion hold and leaves all execution paused. Does not manage manual conversations.",
    properties: {
      id: { type: "string", maxLength: 200 },
      expectedVersion: { type: "integer", minimum: 0 },
      action: { type: "string", enum: ["pause", "resume", "stop", "delete", "keep"] },
      deleteTasks: { type: "boolean" },
    },
    required: ["id", "expectedVersion", "action"],
  },
  {
    name: "assistant_note_delete",
    description:
      "Delete one discovered personal assistant note after an explicit owner request and actual exact-note confirmation. Preserve its ID/updatedAt. Cannot delete owner History or conversations.",
    properties: {
      id: { type: "string", maxLength: 200 },
      expectedUpdatedAt: { type: "integer", minimum: 0 },
    },
    required: ["id", "expectedUpdatedAt"],
  },
  {
    name: "assistant_stop_all",
    description:
      "Emergency stop and pause all assistant work, only when the accepted CURRENT owner speech explicitly says to stop everything. No model-supplied confirmation or inferred approval. Does not close voice or alter manual conversations.",
    properties: {},
    required: [],
  },
  {
    name: "assistant_presence",
    description:
      "Apply only the accepted CURRENT owner's explicit first-person away, return or do-not-disturb statement. The Host-bound controller derives the state from those exact accepted words; arguments cannot choose it. Does not pause or stop jobs, change permissions, or open the microphone.",
    properties: {},
    required: [],
  },
] as const;
const job = z
  .strictObject({
    id: z.string().min(1).max(200),
    expectedVersion: z.number().int().nonnegative(),
    action: z.enum(["pause", "resume", "stop", "delete", "keep"]),
    deleteTasks: z.boolean().optional(),
  })
  .refine((input) => !input.deleteTasks || input.action === "delete");
const note = z.strictObject({
  id: z.string().min(1).max(200),
  expectedUpdatedAt: z.number().int().nonnegative(),
});
const empty = z.strictObject({});
const negative =
  /(?:do not|don['’]?t|never|sakın|asla).{0,25}(?:stop|pause|resume|delete|durdur|duraklat|sil)|(?:durdurma|duraklatma|silme|devam ettirme)|(?:worker|tool|session|agent).{0,25}(?:said|says|output)|(?:ajan|araç|oturum).{0,25}(?:dedi|yazdı)/iu;
const verbs = {
  pause: /\bpause\b|duraklat|askıya al/iu,
  resume: /\bresume\b|devam et|sürdür/iu,
  stop: /\bstop\b|durdur/iu,
  delete: /\bdelete\b|\bremove\b|\bsil\b|kaldır/iu,
  keep: /\bkeep\b|\bretain\b|sakla|koru/iu,
};
export function voiceOwnerRequestedTaskDeletion(text: string) {
  if (
    !voiceOwnerRequestedControl(text, "delete") ||
    /\b(?:if|when|suppose|imagine|said|saying|note|notes|write|save)\b|(?:diye|dedi|dersem|diyelim|eğer|olursa|not\s+(?:yaz|kaydet))/iu.test(
      text,
    )
  )
    return false;
  return (
    /^(?:(?:please|can you|could you|would you)\s+)*(?:[\p{L}\d_-]+[,：:]\s*)?(?:delete|remove)\s+.+\s+(?:and|with|including)\s+(?:all\s+)?(?:its|the|their)?\s*tasks\b[.!?]*$/iu.test(
      text.trim(),
    ) ||
    /^(?:lütfen\s+)?.+\s+(?:ve|ile)\s+(?:tüm\s+)?görevlerini\s+(?:birlikte\s+)?sil(?:\s+lütfen)?[.!?]*$/iu.test(
      text.trim(),
    )
  );
}
export function voiceOwnerRequestedControl(text: string, action: keyof typeof verbs) {
  return (
    !negative.test(text) &&
    verbs[action].test(text) &&
    !/(?:how (?:do|can)|how to|nasıl).*(?:stop|pause|delete|durdur|sil)/iu.test(text)
  );
}
/** A bare "stop"/"durdur" only silences speech; stopping a session's work must name the work or point at it ("bunu durdur", "stop it"). */
export function voiceOwnerRequestedSessionStop(text: string) {
  return (
    voiceOwnerRequestedControl(text, "stop") &&
    /\b(?:work|task|job|session|agent|run)\b|\bstop\s+(?:it|that|this)\b|(?:^|\s)(?:işi?|görevi?|çalışmayı|oturumu?|ajanı?|agent|bunu|onu|şunu)(?=\s|$)/iu.test(
      text,
    )
  );
}
/** The realtime stop_work tool: stops the bound session only for an explicit spoken request. */
export function voiceSessionStopTool(text: string, stop: () => void) {
  if (!voiceOwnerRequestedSessionStop(text))
    return { error: "Say which work to stop; a bare stop only silences speech." };
  stop();
  return { accepted: true, status: "stop_requested" };
}
export function voiceOwnerRequestedStopAll(text: string) {
  if (
    !voiceOwnerRequestedControl(text, "stop") ||
    /["“”«»`]|\b(?:if|suppose|imagine|hypothetical|say|saying|said|means|note|notes|write|save|when|will|should)\b|\bwould\b(?!\s+you\s+stop)|^(?:i|we|they|he|she|you)\s+|(?:diye|dedi|dersem|diyelim|not\s+(?:yaz|kaydet)|notuna|eğer|olursa)/iu.test(
      text,
    )
  )
    return false;
  const clean = text
    .trim()
    .replace(/[.!?]+$/u, "")
    .trim();
  return (
    /^(?:(?:hey|okay|ok|please|can you|could you|would you)\s+)*(?:[\p{L}\d_-]{1,40}[,:]?\s+)?stop\s+(?:everything|all(?:\s+(?:work|jobs|tasks|assistant work))?)(?:\s+(?:now|please|immediately|right now|for now|thanks))*$/iu.test(
      clean,
    ) ||
    /^(?:[\p{L}\d_-]{1,40}[,:]?\s+)?(?:lütfen\s+)?(?:(?:acil(?:\s+olarak)?\s+)?(?:hepsini|her şeyi|herşeyi|tüm işleri|bütün işleri|tüm görevleri|bütün görevleri|tüm çalışmaları|bütün çalışmaları)\s+(?:hemen\s+)?|acil\s+)durdur(?:\s+(?:lütfen|hemen|artık))*$/iu.test(
      clean,
    )
  );
}
export function voiceOwnerPresenceIntent(
  text: string,
  assistantName = "",
): "away" | "present" | "dnd" | undefined {
  if (!text || text.length > 300 || /["“”«»`\n\r]/u.test(text)) return;
  let clean = text
    .normalize("NFC")
    .trim()
    .replace(/[.!?。！？]+$/u, "")
    .trim();
  clean = clean.replace(/^(?:hey|hi|merhaba|selam)[,:：]?\s+/iu, "");
  const name = assistantName.trim();
  if (name && clean.toLocaleLowerCase().startsWith(name.toLocaleLowerCase())) {
    const rest = clean.slice(name.length);
    if (/^[\s,:：]/u.test(rest)) clean = rest.replace(/^[\s,:：]+/u, "");
  }
  clean = clean.replace(/^(?:please|lütfen)\s+/iu, "").replace(/\s+(?:please|lütfen)$/iu, "");
  if (
    /^(?:i(?:['’]m| am) (?:away|leaving|heading out)|mark me (?:as )?away|set my status to away|(?:ben )?(?:gidiyorum|uzaktayım|ayrılıyorum)|je (?:pars|suis absent)|ich (?:gehe weg|bin weg)|me voy|estoy ausente|vou sair|estou ausente|我(?:要离开|离开了)|離席します)$/iu.test(
      clean,
    )
  )
    return "away";
  if (
    /^(?:i(?:['’]m| am) back|i(?:['’]ve| have) returned|mark me (?:as )?present|set my status to present|(?:ben )?(?:geri döndüm|döndüm|geldim|buradayım)|je suis (?:de retour|revenu)|ich bin (?:zurück|wieder da)|ya volví|he vuelto|voltei|estou de volta|我回来了|戻りました)$/iu.test(
      clean,
    )
  )
    return "present";
  if (
    /^(?:do not disturb(?: me)?|turn on do not disturb|set my status to do not disturb|(?:beni )?rahatsız etme(?:yin)?|rahatsız etmeyin modunu aç|ne me dérangez pas|bitte nicht stören|no molestar|não incomodar|请勿打扰|おやすみモードにして)$/iu.test(
      clean,
    )
  )
    return "dnd";
}
type Source = { key: string; utterance: string; assistantName?: string };
type Request = (input: AssistantRequest) => Promise<AssistantResponse>;
export interface VoiceAssistantControlPorts {
  request(input: AssistantRequest): Promise<AssistantResponse>;
  captureRequest?(): Promise<Request>;
  allowedProjectIds(): Promise<ReadonlySet<string>>;
  confirm(input: {
    kind: "job" | "note";
    action: "pause" | "resume" | "stop" | "delete" | "keep";
    id: string;
    title: string;
    version: number;
    projectId?: string;
    projectIds?: string[];
    deleteReview?: AssistantJobDeleteReview;
  }): Promise<boolean>;
}
/** A narrow owner-intent broker, never an arbitrary assistant owner-RPC proxy. */
export class VoiceAssistantControls {
  private sources = new Map<string, { request: Promise<Request>; active: () => boolean }>();
  private attempts = new Map<
    string,
    { signature: string; result: Promise<unknown>; done: boolean }
  >();
  constructor(private ports: VoiceAssistantControlPorts) {}
  private requestFor(key: string, active: () => boolean): Promise<Request> {
    if (!active()) return Promise.reject(new Error("The spoken request is no longer active."));
    const prior = this.sources.get(key);
    if (prior) return prior.request;
    if (this.sources.size >= 512) {
      for (const [id, source] of this.sources)
        if (!source.active()) {
          this.sources.delete(id);
          break;
        }
      if (this.sources.size >= 512)
        return Promise.reject(
          new Error(
            "Assistant control results remain uncertain. Review the Room before continuing.",
          ),
        );
    }
    const request = this.ports.captureRequest
      ? this.ports.captureRequest()
      : Promise.resolve(this.ports.request.bind(this.ports));
    this.sources.set(key, { request, active });
    return request;
  }
  call(name: string, args: unknown, source: Source, active: () => boolean): Promise<unknown> {
    if (!VOICE_ASSISTANT_CONTROL_TOOLS.some((tool) => tool.name === name))
      return Promise.reject(new Error("Unknown assistant control."));
    const input =
      name === "assistant_job_control"
        ? job.parse(args)
        : name === "assistant_note_delete"
          ? note.parse(args)
          : empty.parse(args);
    if (name === "assistant_status")
      return this.requestFor(source.key, active)
        .then((request) => this.snapshot(active, undefined, request))
        .then(({ snapshot, allowed }) => ({
          jobs: snapshot.jobs
            .filter((item) => assistantJobVisible(item, (id) => allowed.has(id)))
            .slice(0, 30)
            .map((item) => {
              const { id, title, status, version, projectId } = item,
                projectIds = assistantJobProjectIds(item);
              return {
                id,
                title,
                status,
                version,
                projectId,
                ...(projectIds.length > 1 ? { projectIds } : {}),
                ...(item.pendingTaskDeletion ? { pendingTaskDeletion: true } : {}),
                ...(item.awaitingOwnerRestart ? { awaitingOwnerRestart: true } : {}),
                ...(snapshot.jobHolds?.[id] ? { holdReason: snapshot.jobHolds[id] } : {}),
              };
            }),
          notes: snapshot.notes
            .filter((item) => item.tags.includes("assistant"))
            .slice(0, 30)
            .map(({ id, title, updatedAt }) => ({ id, title, updatedAt })),
        }));
    const key = `${source.key}:${name}:${"id" in input ? input.id : "all"}:${"action" in input ? input.action : ""}`;
    const signature = JSON.stringify(input),
      previous = this.attempts.get(key);
    if (previous) {
      if (previous.signature !== signature)
        return Promise.reject(
          new Error("A voice control retry must preserve the original target and version."),
        );
      return previous.result;
    }
    if (this.attempts.size >= 512) {
      for (const [id, value] of this.attempts)
        if (value.done) {
          this.attempts.delete(id);
          break;
        }
      if (this.attempts.size >= 512)
        return Promise.reject(
          new Error(
            "Assistant control results remain uncertain. Review the Room before continuing.",
          ),
        );
    }
    const captured = { ...source };
    let attempted = false;
    const result = (async () => {
      if (!active()) throw new Error("The spoken request is no longer active.");
      const request = await this.requestFor(captured.key, active);
      if (!active()) throw new Error("The spoken request is no longer active.");
      if (name === "assistant_stop_all") {
        if (!voiceOwnerRequestedStopAll(captured.utterance))
          throw new Error("Say explicitly to stop all assistant work.");
        attempted = true;
        await request({ op: "pauseAll" });
        return { status: "stop_requested", paused: true };
      }
      if (name === "assistant_presence") {
        const state = voiceOwnerPresenceIntent(captured.utterance, captured.assistantName);
        if (!state)
          throw new Error("Say explicitly that you are away, back or do not want to be disturbed.");
        if (!active()) throw new Error("The spoken request is no longer active.");
        attempted = true;
        const result = await request({ op: "presence.set", state });
        if (!active()) throw new Error("The spoken request is no longer active.");
        if (result.ok !== true) throw new Error("Availability change was not confirmed.");
        return { status: "presence_updated", state };
      }
      const action = "action" in input ? input.action : "delete";
      if (!voiceOwnerRequestedControl(captured.utterance, action))
        throw new Error("Ask explicitly to change an assistant job or note.");
      const before = await this.snapshot(active, undefined, request);
      if (name === "assistant_job_control" && "expectedVersion" in input) {
        const found = before.snapshot.jobs.find(
          (item) =>
            item.id === input.id && assistantJobVisible(item, (id) => before.allowed.has(id)),
        );
        const target = found ? { ...found, projectIds: assistantJobProjectIds(found) } : undefined;
        if (!target || target.version !== input.expectedVersion)
          throw new Error("The job changed or is outside visible project scope.");
        if (action === "keep" && !target.pendingTaskDeletion)
          throw new Error("The job changed or is outside visible project scope.");
        let deleteReview: AssistantJobDeleteReview | undefined;
        if (input.deleteTasks) {
          if (!voiceOwnerRequestedTaskDeletion(captured.utterance))
            throw new Error("Ask explicitly to delete the job and its tasks together.");
          const response = await request({
            op: "jobs.deleteReview",
            id: target.id,
            expectedVersion: target.version,
          });
          deleteReview = verifiedAssistantJobDeleteReview(target, response.deleteReview, (id) =>
            before.allowed.has(id),
          );
          if (!deleteReview)
            throw new Error(
              "The task deletion scope could not be verified. You can still delete only the job.",
            );
        }
        const normalized = (value: string) =>
          value.toLocaleLowerCase().normalize("NFKD").replace(/\p{M}/gu, "");
        const eligible = before.snapshot.jobs.filter(
          (item) =>
            assistantJobVisible(item, (id) => before.allowed.has(id)) &&
            !["done", "failed", "cancelled"].includes(item.status),
        );
        const exact =
          normalized(captured.utterance).includes(normalized(target.title)) ||
          captured.utterance.includes(target.id) ||
          (eligible.length === 1 && eligible[0].id === target.id);
        if (
          (action === "delete" || !exact) &&
          !(await this.ports.confirm({
            kind: "job",
            action,
            id: target.id,
            title: target.title,
            version: target.version,
            projectId: target.projectId ?? undefined,
            projectIds: [...target.projectIds],
            ...(deleteReview ? { deleteReview } : {}),
          }))
        )
          return { status: "cancelled" };
        const latest = await this.snapshot(active, before.allowed, request),
          current = latest.snapshot.jobs.find(
            (item) =>
              item.id === target.id && assistantJobVisible(item, (id) => latest.allowed.has(id)),
          );
        if (
          !current ||
          current.version !== target.version ||
          current.projectId !== target.projectId ||
          JSON.stringify(assistantJobProjectIds(current)) !== JSON.stringify(target.projectIds)
        )
          throw new Error("The job changed or is outside visible project scope.");
        attempted = true;
        const response = await request(
          action === "keep"
            ? { op: "jobs.deleteAbort", id: target.id, expectedVersion: target.version }
            : {
                op: "jobs.control",
                id: target.id,
                expectedVersion: target.version,
                action,
                ...(deleteReview
                  ? { deleteTasks: true, taskDeleteToken: deleteReview.sourceToken }
                  : {}),
              },
        );
        if (
          !response.job ||
          response.job.id !== target.id ||
          response.job.projectId !== target.projectId ||
          JSON.stringify(assistantJobProjectIds(response.job)) !== JSON.stringify(target.projectIds)
        )
          throw new Error("Job status is unknown. Check the Room before retrying.");
        if (
          action === "keep" &&
          (response.job.status !== "paused" ||
            response.job.pendingTaskDeletion ||
            response.job.awaitingOwnerRestart !== true)
        )
          throw new Error("Job status is unknown. Check the Room before retrying.");
        const allowed = await this.ports.allowedProjectIds();
        if (
          !active() ||
          !assistantJobVisible(response.job, (id) => before.allowed.has(id) && allowed.has(id))
        )
          throw new Error("The job changed or is outside visible project scope.");
        return {
          job: {
            id: response.job.id,
            title: response.job.title,
            status: response.job.status,
            version: response.job.version,
          },
        };
      }
      if (name === "assistant_note_delete" && "expectedUpdatedAt" in input) {
        const found = before.snapshot.notes.find(
          (item) => item.id === input.id && item.tags.includes("assistant"),
        );
        const target = found ? { ...found } : undefined;
        if (!target || target.updatedAt !== input.expectedUpdatedAt)
          throw new Error("The assistant note changed. Review it before deleting.");
        if (
          !(await this.ports.confirm({
            kind: "note",
            action: "delete",
            id: target.id,
            title: target.title,
            version: target.updatedAt,
          }))
        )
          return { status: "cancelled" };
        const latest = await this.snapshot(active, undefined, request),
          current = latest.snapshot.notes.find(
            (item) => item.id === target.id && item.tags.includes("assistant"),
          );
        if (!current || current.updatedAt !== target.updatedAt)
          throw new Error("The assistant note changed. Review it before deleting.");
        attempted = true;
        const response = await request({
          op: "notes.delete",
          id: target.id,
          expectedUpdatedAt: target.updatedAt,
        });
        if (response.ok !== true)
          throw new Error("Note deletion is uncertain. Review the Room before retrying.");
        return { deleted: true, id: target.id };
      }
      throw new Error("Invalid assistant control target.");
    })();
    const attempt = { signature, result, done: false };
    this.attempts.set(key, attempt);
    void result.then(
      () => {
        attempt.done = true;
      },
      () => {
        if (!attempted) this.attempts.delete(key);
      },
    );
    return result;
  }
  private async snapshot(
    active: () => boolean,
    frozen?: ReadonlySet<string>,
    request = this.ports.request.bind(this.ports),
  ) {
    const before = await this.ports.allowedProjectIds();
    const response = await request({
      op: "snapshot",
      limit: 100,
      features: ["jobHolds", "jobStalled"],
    });
    const current = await this.ports.allowedProjectIds();
    const allowed = new Set(
      [...before].filter((id) => current.has(id) && (!frozen || frozen.has(id))),
    );
    if (!active()) throw new Error("The spoken request is no longer active.");
    if (!response.snapshot) throw new Error("Assistant status is unavailable.");
    return { snapshot: response.snapshot, allowed };
  }
}
