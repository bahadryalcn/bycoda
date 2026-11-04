import { bindVoiceGeneration } from "./voiceGenerationRetirement";
import {
  AssistantVoiceContextSchema,
  type AssistantVoiceContext,
  type AssistantVoiceContextOpen,
  type AssistantVoiceContextInvalidate,
  type AssistantVoiceContextReason,
  AssistantVoiceDisclosureSchema,
  type AssistantVoiceDisclosureSource,
} from "../../../shared/model/assistantVoiceContext";
import type { VoiceHistoryBinding } from "./voiceHistory";
import type { VoiceThreadTranscript } from "./voiceThreads";
import { withTimeout } from "../../../shared/lib/withTimeout";

type Port = (
  input: AssistantVoiceContextOpen | AssistantVoiceContextInvalidate,
) => Promise<{ voiceContext?: unknown }>;
type OwnerSource = ReturnType<VoiceThreadTranscript["ownerReceipt"]>;
/** History can still be stored, but this generation cannot certify its provenance. */
export class VoiceContextScopeUnavailable extends Error {
  constructor() {
    super("The project directory is incomplete, so voice history provenance is unavailable.");
    this.name = "VoiceContextScopeUnavailable";
  }
}
/** One actual provider connection (or one isolated local reasoning turn).
 * A new owner utterance cannot clean an unknown retained provider context. */
export class VoiceCausalGeneration {
  retirementIdentity() {
    return this.initialThread && this.environmentId
      ? { threadId: this.initialThread, environmentId: this.environmentId }
      : undefined;
  }
  readonly generationKey: string;
  private head?: AssistantVoiceContext;
  private work: Promise<AssistantVoiceContext | undefined> = Promise.resolve(undefined);
  private unknown = false;
  private initialThread?: string;
  private environmentId?: string;
  private port?: Port;
  private visible?: (ids: readonly string[]) => boolean;
  constructor(
    private readonly seedMessageIds: readonly string[],
    private readonly summaryUsed: boolean,
    private readonly active: () => boolean,
    private readonly failed: (error: unknown) => void,
    private readonly id: () => string = () => crypto.randomUUID(),
    private readonly summaryProofId?: string,
  ) {
    this.generationKey = id();
    this.seedMessageIds = Object.freeze([...seedMessageIds]);
  }
  /** Bind and durably register this exact runtime before any seed reaches a provider. */
  async bindRuntimeIdentity(history: VoiceHistoryBinding) {
    if (!this.active() || history.current?.() === false || history.remote)
      throw new Error("Voice runtime source unavailable.");
    const [opened, scope, environmentId] = await Promise.all([
      history.open(), history.scope?.(), history.environmentId?.(),
    ]);
    // The Host qualifies each exact seed independently. A partial directory can
    // still contain visible personal turns; it cannot certify tool provenance.
    if (!this.active() || history.current?.() === false || !scope || !scope.current() || !environmentId)
      throw new Error("Voice runtime source unavailable.");
    const threadId = opened.thread.id;
    if ((this.initialThread && this.initialThread !== threadId) || (this.environmentId && this.environmentId !== environmentId))
      throw new Error("Voice runtime source changed.");
    this.initialThread = threadId;
    this.environmentId = environmentId;
    await bindVoiceGeneration(this.generationKey, { threadId, environmentId });
    if (!this.active() || history.current?.() === false || !scope.current())
      throw new Error("Voice runtime source changed.");
    const response = await history.request({
      op: "voice.runtime.register", threadId, generationKey: this.generationKey,
      seedMessageIds: [...this.seedMessageIds],
      ...(this.summaryUsed && this.summaryProofId ? { summaryProofId: this.summaryProofId } : {}),
    });
    if (!response.ok || !this.active() || history.current?.() === false || !scope.current())
      throw new Error("Voice runtime registration was not confirmed.");
  }
  accept(history: VoiceHistoryBinding, source: OwnerSource, ownerText: string) {
    const previous = this.work;
    const captured = source.then(
      (value) => ({ value }),
      (error) => ({ error }),
    );
    // Capture the owner receipt promise now; a later bind cannot replace it.
    this.work = previous
      .then(async () => {
        const accepted = await captured;
        if ("error" in accepted) throw accepted.error;
        const owner = accepted.value;
        if (!this.active() || history.current?.() === false) return;
        const scope = await history.scope?.(),
          environmentId = await history.environmentId?.();
        if (
          history.remote ||
          !environmentId ||
          !scope ||
          !scope.current() ||
          owner.request !== history.request ||
          owner.message.text !== ownerText
        )
          throw new Error("The voice question context could not be verified for saving.");
        if (!scope.complete) {
          if (history.global) throw new VoiceContextScopeUnavailable();
          throw new Error("The voice question context could not be verified for saving.");
        }
        if (
          (this.initialThread && this.initialThread !== owner.message.threadId) ||
          (this.environmentId && this.environmentId !== environmentId)
        )
          throw new Error("The captured question Host changed.");
        this.initialThread = owner.message.threadId;
        this.environmentId = environmentId;
        await bindVoiceGeneration(this.generationKey, { threadId: this.initialThread, environmentId });
        if (!this.active() || history.current?.() === false) return;
        this.visible = (ids) =>
          this.active() &&
          scope.current() &&
          history.current?.() !== false &&
          ids.every((id) => scope.projectIds.includes(id) && scope.liveProjectIds().has(id));
        const request: Port = history.request;
        this.port = request;
        const receipt = AssistantVoiceContextSchema.parse(
          (
            await request({
              op: "voice.context.open",
              threadId: owner.message.threadId,
              requestId: this.id(),
              generationKey: this.generationKey,
              seedMessageIds: [...this.seedMessageIds],
              ownerMessageId: owner.message.id,
              contextProjectIds: [...scope.projectIds],
              summaryUsed: this.summaryUsed,
              ...(this.summaryUsed && this.summaryProofId
                ? { summaryProofId: this.summaryProofId }
                : {}),
              ...(this.head ? { previousContextId: this.head.id } : {}),
            })
          ).voiceContext,
        );
        if (!this.active() || !scope.current() || history.current?.() === false) return;
        this.observe(receipt);
        if (this.unknown && receipt.status !== "unknown") await this.markUnknown("context-changed");
        return this.head;
      })
      .catch((error) => {
        this.unknown = true;
        if (this.active()) this.failed(error);
        return undefined;
      });
    return this.work;
  }
  /** Capture this exact turn's pending receipt, never a later accepted turn. */
  proof(): Promise<string | undefined> {
    const work = this.work;
    return work.then((receipt) =>
      this.active() &&
      !this.unknown &&
      receipt?.status === "known" &&
      this.head?.id === receipt.id &&
      this.head.status === "known"
        ? receipt.id
        : undefined,
    );
  }
  async context(): Promise<AssistantVoiceContext | undefined> {
    await this.work;
    return this.head ? structuredClone(this.head) : undefined;
  }
  async tool() {
    await this.work;
    const head = this.head;
    if (!head || !this.active()) return;
    return {
      id: head.id,
      environmentId: head.environmentId,
      receive: (
        value: unknown,
        rawDisclosure: unknown,
        requestId: string,
        expectedSource?: AssistantVoiceDisclosureSource,
      ) => {
        try {
          const receipt = AssistantVoiceContextSchema.parse(value),
            disclosure = AssistantVoiceDisclosureSchema.parse(rawDisclosure);
          if (
            !this.active() ||
            receipt.id !== head.id ||
            receipt.ownerMessageId !== head.ownerMessageId ||
            disclosure.contextId !== head.id ||
            disclosure.requestId !== requestId ||
            receipt.environmentId !== this.environmentId ||
            receipt.threadId !== this.initialThread ||
            receipt.generationKey !== this.generationKey ||
            (disclosure.verified &&
              (!Array.isArray(disclosure.projectIds) || !this.visible?.(disclosure.projectIds))) ||
            (!disclosure.verified &&
              (receipt.status !== "unknown" ||
                !expectedSource ||
                !disclosure.source ||
                Object.keys(expectedSource).some(
                  (key) =>
                    disclosure.source?.[key as keyof AssistantVoiceDisclosureSource] !==
                    expectedSource[key as keyof AssistantVoiceDisclosureSource],
                ) ||
                disclosure.source.sessionId !== expectedSource.sessionId ||
                disclosure.source.projectId !== expectedSource.projectId ||
                disclosure.source.accountId !== expectedSource.accountId ||
                disclosure.source.environmentId !== receipt.environmentId ||
                disclosure.source.threadId !== head.threadId ||
                (disclosure.source.projectId !== undefined &&
                  !this.visible?.([disclosure.source.projectId]))))
          )
            throw new Error(
              "The voice tool result could not be verified. Check its original operation.",
            );
          // Authenticated data can be usable while it lacks retained-history
          // provenance. Unknown is monotonic and can never become a save grant.
          if (!disclosure.verified || receipt.status === "unknown") this.unknown = true;
          // Tool responses may arrive after a newer owner turn or a later
          // completion. Their exact operation result remains valid, but their
          // context snapshot must never roll the current head backward.
          if (this.head?.id === receipt.id && receipt.version >= this.head.version)
            this.observe(receipt);
        } catch (error) {
          this.unknown = true;
          if (this.active()) this.failed(error);
          throw error;
        }
      },
    };
  }
  private observe(value: unknown) {
    const receipt = AssistantVoiceContextSchema.parse(value);
    if (
      receipt.environmentId !== this.environmentId ||
      receipt.threadId !== this.initialThread ||
      receipt.generationKey !== this.generationKey ||
      (this.head &&
        receipt.ownerMessageId === this.head.ownerMessageId &&
        receipt.id !== this.head.id)
    )
      throw new Error("The captured question Host changed.");
    if (this.head && receipt.id === this.head.id && receipt.version < this.head.version)
      throw new Error("The voice question source changed before it could be saved.");
    if (
      receipt.status === "known" &&
      (!Array.isArray(receipt.projectIds) || !this.visible?.(receipt.projectIds))
    )
      throw new Error("The voice question context could not be verified for saving.");
    if (receipt.status === "unknown") this.unknown = true;
    this.head = receipt;
  }
  async invalidate(reason: AssistantVoiceContextReason = "unverified-tool") {
    // Close the local proof synchronously, before awaiting any tool/disclosure.
    this.unknown = true;
    // Losing Host provenance must not freeze the audio connection. Unknown is
    // already monotonic locally; late completions cannot grant save authority.
    try {
      await withTimeout(this.work, 5000, "Voice context");
      await withTimeout(this.markUnknown(reason), 5000, "Voice context invalidation");
    } catch (error) {
      if (this.active()) this.failed(error);
    }
  }
  private async markUnknown(reason: AssistantVoiceContextReason) {
    const head = this.head;
    if (!head || !this.port) return;
    try {
      const result = await this.port({
        op: "voice.context.invalidate",
        id: head.id,
        requestId: this.id(),
        reason,
      });
      const receipt = AssistantVoiceContextSchema.parse(result.voiceContext);
      if (receipt.id !== head.id || receipt.status !== "unknown")
        throw new Error("The voice question context could not be verified for saving.");
      this.observe(receipt);
    } catch (error) {
      if (this.active()) this.failed(error);
    }
  }
}
