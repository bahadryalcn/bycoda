type Identity = { environmentId: string; threadId: string };
type Entry = {
  identity: () => Identity | undefined;
  retire: () => Promise<void>;
  pending?: Promise<void>;
  closed: boolean;
  outputReady?: () => boolean;
};
const entries = new Map<string, Entry>();
const births = new WeakMap<object, { id: string; bindings: Promise<void>[] }>();
const generationBirths = new Map<string, object>();
const generationBindings = new Map<string, { identity: Identity; promise: Promise<void> }>();

export async function beginVoiceRuntime(runtime: object, provider: "openai" | "grok" | "local") {
  const { invoke, isTauri } = await import("@tauri-apps/api/core");
  if (!isTauri()) return;
  const id = await invoke<string>("voice_runtime_birth", { provider });
  births.set(runtime, { id, bindings: [] });
}

export function associateVoiceGeneration(runtime: object, generation: string) {
  const previous = generationBirths.get(generation);
  if (previous && previous !== runtime) throw new Error("Voice generation runtime changed.");
  generationBirths.set(generation, runtime);
}

export async function bindVoiceGeneration(generation: string, identity: Identity) {
  const previous = generationBindings.get(generation);
  if (previous) {
    if (previous.identity.environmentId !== identity.environmentId || previous.identity.threadId !== identity.threadId) throw new Error("Voice generation source changed.");
    return previous.promise;
  }
  const runtime = generationBirths.get(generation);
  const birth = runtime && births.get(runtime);
  if (!birth) {
    const { isTauri } = await import("@tauri-apps/api/core");
    if (isTauri()) throw new Error("Voice runtime registration unavailable.");
    return;
  }
  const binding = import("@tauri-apps/api/core").then(({ invoke }) =>
    invoke<void>("voice_generation_bind", { birth: birth.id, generation, environment: identity.environmentId, thread: identity.threadId }),
  );
  birth.bindings.push(binding);
  generationBindings.set(generation, { identity, promise: binding });
  await binding;
}

export function closeVoiceRuntimeEvidence(runtime: object, closure: Promise<void>) {
  const birth = births.get(runtime);
  if (!birth) return;
  const completion = Promise.all([closure, ...birth.bindings]).then(async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("voice_runtime_closed", { birth: birth.id });
  });
  void completion.catch(() => { /* Missing evidence remains held. */ });
}

/** A normal disconnect records the same physical closure, so future owner
 * revocation can reconcile an already-closed generation without reconnecting. */
export function recordVoiceGenerationClosure(generationKey: string, closure: Promise<void>): void {
  const entry = entries.get(generationKey);
  if (!entry) return;
  const pending = closure.then(() => {
    entry.closed = true;
  });
  entry.pending = pending;
  void pending.catch(() => {
    if (entry.pending === pending) entry.pending = undefined;
  });
}

/** Runtime registration, never supplied by model tools. Closed tombstones allow
 * a lost native acknowledgement to be reconciled without reopening a provider.
 */
export function registerVoiceGenerationRetirement(
  generationKey: string,
  identity: () => Identity | undefined,
  retire: () => Promise<void>,
  outputReady?: () => boolean,
): void {
  if (!generationKey || generationKey.length > 200 || entries.has(generationKey))
    throw new Error("Voice generation identity was reused.");
  if (entries.size >= 256) {
    const expired = [...entries].find(([, entry]) => entry.closed)?.[0];
    if (!expired) throw new Error("Too many retained voice generations.");
    entries.delete(expired);
    generationBirths.delete(expired);
    generationBindings.delete(expired);
  }
  entries.set(generationKey, { identity, retire, outputReady, closed: false });
}

export function voiceGenerationStatus(input: Record<string, unknown>, source: Identity) {
  if (Object.keys(input).sort().join(",") !== "generationKey,operationHash,requestId" || typeof input.generationKey !== "string" || typeof input.requestId !== "string" || !input.requestId || typeof input.operationHash !== "string" || !/^[a-f0-9]{64}$/.test(input.operationHash)) throw new Error("Invalid voice status request.");
  const entry = entries.get(input.generationKey);
  const identity = entry?.identity();
  if (!entry || entry.closed || !identity || identity.threadId !== source.threadId || identity.environmentId !== source.environmentId || !entry.outputReady?.()) throw new Error("Voice generation output unavailable.");
  return { generationKey: input.generationKey, active: true };
}

/** Pre-connect source evidence requires a bound live runtime, not audio output. */
export function voiceGenerationSource(input: Record<string, unknown>, source: Identity) {
  if (Object.keys(input).sort().join(",") !== "generationKey,operationHash,requestId" ||
      typeof input.generationKey !== "string" || !input.generationKey || input.generationKey.length > 200 ||
      typeof input.requestId !== "string" || !input.requestId || input.requestId.length > 200 ||
      typeof input.operationHash !== "string" || !/^[a-f0-9]{64}$/.test(input.operationHash))
    throw new Error("Invalid voice source request.");
  const entry = entries.get(input.generationKey);
  const identity = entry?.identity();
  const runtime = generationBirths.get(input.generationKey);
  const binding = generationBindings.get(input.generationKey);
  if (!entry || entry.closed || entry.pending || !runtime || !births.get(runtime) || !binding || !identity ||
      identity.threadId !== source.threadId || identity.environmentId !== source.environmentId ||
      binding.identity.threadId !== source.threadId || binding.identity.environmentId !== source.environmentId)
    throw new Error("Voice generation source unavailable.");
  return { generationKey: input.generationKey, active: true };
}

/** Only the authenticated native control bridge calls this operation. Unknown
 * generations do not certify that a retained provider connection has closed.
 */
export async function retireVoiceGeneration(input: Record<string, unknown>, source: Identity) {
  if (
    Object.keys(input).sort().join(",") !== "generationKey,operationHash,requestId" ||
    typeof input.generationKey !== "string" ||
    !input.generationKey ||
    input.generationKey.length > 200 ||
    typeof input.requestId !== "string" ||
    !input.requestId ||
    input.requestId.length > 200 ||
    typeof input.operationHash !== "string" ||
    !/^[a-f0-9]{64}$/.test(input.operationHash)
  )
    throw new Error("Invalid voice retirement request.");
  const entry = entries.get(input.generationKey);
  const identity = entry?.identity();
  if (
    !entry ||
    !identity ||
    identity.environmentId !== source.environmentId ||
    identity.threadId !== source.threadId
  )
    throw new Error("The original voice generation is unavailable in this Room.");
  if (!entry.closed) {
    entry.pending ??= entry.retire().then(() => {
      entry.closed = true;
    });
    // A failed cleanup stays held. A second request may observe actual runtime
    // closure, but it never creates or reconnects a provider connection.
    try {
      await entry.pending;
    } catch (error) {
      entry.pending = undefined;
      throw error;
    }
  }
  const current = entry.identity();
  if (
    !current ||
    current.environmentId !== source.environmentId ||
    current.threadId !== source.threadId
  )
    throw new Error("The original voice generation source changed.");
  return { retired: true, generationKey: input.generationKey };
}
