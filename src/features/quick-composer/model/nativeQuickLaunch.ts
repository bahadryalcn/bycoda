import { invoke } from "@tauri-apps/api/core";
import type { QuickLaunch } from "./quickComposer";

type Scope = { windowEpoch: string; storeInstance: string };
type Submission = {
  version: 1;
  scope: Scope;
  sequence: number;
  intentId: string;
  request: QuickLaunch;
};
type State = "pending" | "queued" | "acknowledged" | "unknown" | "unavailable" | "failed";
export type NativeQuickReceipt = {
  version: 1;
  scope: Scope;
  sequence: number;
  intentId: string;
  requestDigest: string;
  deliveryId?: string;
  state: State;
  qualified: false;
};
type Entry = {
  intentId: string;
  rawPrompt: string;
  request?: QuickLaunch;
  submission?: Submission;
  attempted: boolean;
  digest?: string;
  deliveryId?: string;
  receipt?: NativeQuickReceipt;
  actual?: Promise<NativeQuickLaunchResult>;
  waiters: number;
};
export type NativeQuickLaunchResult = {
  readonly request: QuickLaunch;
  readonly rawPrompt: string;
  readonly intentId: string;
  readonly receipt: NativeQuickReceipt;
};
type Runtime = { entries: Map<string, Entry> };
type NativeInvoke = (command: string, args?: Record<string, unknown>) => Promise<unknown>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const DIGEST = /^[0-9a-f]{64}$/;
const unknown = () =>
  new Error(
    "Quick launch outcome is unknown. The original request is retained; Start checks its status.",
  );
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw unknown();
  return value as Record<string, unknown>;
};
function closed(value: Record<string, unknown>, required: string[], optional: string[] = []) {
  if (
    required.some((key) => !Object.prototype.hasOwnProperty.call(value, key)) ||
    Object.keys(value).some((key) => !required.includes(key) && !optional.includes(key))
  )
    throw unknown();
}
function scope(value: unknown): Scope {
  const result = object(value);
  closed(result, ["windowEpoch", "storeInstance"]);
  if (
    typeof result.windowEpoch !== "string" ||
    !UUID.test(result.windowEpoch) ||
    typeof result.storeInstance !== "string" ||
    !UUID.test(result.storeInstance)
  )
    throw unknown();
  return { windowEpoch: result.windowEpoch, storeInstance: result.storeInstance };
}
function receipt(value: unknown, entry: Entry): NativeQuickReceipt {
  const result = object(value);
  closed(
    result,
    ["version", "scope", "sequence", "intentId", "requestDigest", "state", "qualified"],
    ["deliveryId"],
  );
  const actualScope = scope(result.scope);
  const expected = entry.submission!;
  if (
    result.version !== 1 ||
    result.qualified !== false ||
    result.sequence !== expected.sequence ||
    result.intentId !== expected.intentId ||
    actualScope.windowEpoch !== expected.scope.windowEpoch ||
    actualScope.storeInstance !== expected.scope.storeInstance ||
    typeof result.requestDigest !== "string" ||
    !DIGEST.test(result.requestDigest) ||
    (entry.digest && entry.digest !== result.requestDigest) ||
    !["pending", "queued", "acknowledged", "unknown", "unavailable", "failed"].includes(
      String(result.state),
    ) ||
    (result.deliveryId !== undefined &&
      (typeof result.deliveryId !== "string" || !UUID.test(result.deliveryId))) ||
    (entry.deliveryId && result.deliveryId && entry.deliveryId !== result.deliveryId) ||
    (["pending", "queued", "acknowledged", "failed"].includes(String(result.state)) &&
      !result.deliveryId)
  )
    throw unknown();
  entry.digest = result.requestDigest;
  if (result.deliveryId) entry.deliveryId = result.deliveryId as string;
  return Object.freeze({ ...result, scope: Object.freeze(actualScope) }) as NativeQuickReceipt;
}
function snapshot(request: QuickLaunch): QuickLaunch {
  // The trusted UI supplies a finite plain DTO. This copy is retained before
  // submission; subsequent edits never alter a pending Native request.
  const encoded = JSON.stringify(request);
  if (
    encoded.length > 1024 * 1024 ||
    new TextEncoder().encode(encoded).byteLength > 1024 * 1024 ||
    new TextEncoder().encode(request.prompt).byteLength > 256 * 1024 ||
    (request.attachments?.length ?? 0) > 20 ||
    Object.keys(request.modelSettings ?? {}).length > 64
  )
    throw new Error("Quick launch request is too large.");
  const result = JSON.parse(encoded) as QuickLaunch;
  Object.freeze(result.modelSettings);
  for (const attachment of result.attachments ?? []) Object.freeze(attachment);
  if (result.attachments) Object.freeze(result.attachments);
  return Object.freeze(result);
}

export function createNativeQuickLaunchRuntime(
  nativeInvoke: NativeInvoke = invoke,
  runtime: Runtime = { entries: new Map() },
) {
  const readScope = async () => {
    const result = object(await nativeInvoke("quick_composer_launch_scope"));
    closed(result, ["version", "scope", "nextSequence", "qualified"]);
    if (
      result.version !== 1 ||
      result.qualified !== false ||
      !Number.isSafeInteger(result.nextSequence) ||
      Number(result.nextSequence) < 1
    )
      throw unknown();
    return { scope: Object.freeze(scope(result.scope)), sequence: Number(result.nextSequence) };
  };
  const perform = async (
    entry: Entry,
    prepare: () => Promise<QuickLaunch>,
    explicit: boolean,
    rawPrompt: string,
    lineage?: { intentId?: string },
  ): Promise<NativeQuickLaunchResult> => {
    entry.request ??= snapshot(await prepare());
    if (!entry.submission) {
      if (!explicit) throw unknown();
      entry.submission = Object.freeze({
        version: 1,
        ...(await readScope()),
        intentId: entry.intentId,
        request: entry.request,
      });
    }
    let result: NativeQuickReceipt;
    if (entry.attempted) {
      result = receipt(
        await nativeInvoke("quick_composer_submit_status", { query: entry.submission }),
        entry,
      );
      // Fresh status must verify no effects before an explicit corrected Start.
      // The old Failed tuple stays terminal; even unchanged retry gets a NEW
      // UUID/exact Native nextSequence. Closure retry only observes the old one.
      if (result.state === "failed" && explicit) {
        const corrected = snapshot(await prepare());
        const next = await readScope();
        if (
          next.scope.windowEpoch !== entry.submission.scope.windowEpoch ||
          next.scope.storeInstance !== entry.submission.scope.storeInstance ||
          next.sequence <= entry.submission.sequence
        )
          throw unknown();
        const intentId = crypto.randomUUID();
        entry.intentId = intentId;
        entry.rawPrompt = rawPrompt;
        entry.request = corrected;
        entry.submission = Object.freeze({ version: 1, ...next, intentId, request: corrected });
        entry.digest = undefined;
        entry.deliveryId = undefined;
        entry.receipt = undefined;
        if (lineage) lineage.intentId = intentId;
        result = receipt(
          await nativeInvoke("quick_composer_submit_intent", { submission: entry.submission }),
          entry,
        );
      }
    } else {
      if (!explicit) throw unknown();
      entry.attempted = true;
      result = receipt(
        await nativeInvoke("quick_composer_submit_intent", { submission: entry.submission }),
        entry,
      );
    }
    entry.receipt = result;
    if (result.state !== "queued" && result.state !== "acknowledged") throw unknown();
    return Object.freeze({
      request: entry.request,
      rawPrompt: entry.rawPrompt,
      intentId: entry.intentId,
      receipt: result,
    });
  };
  return {
    has(key: string) {
      return runtime.entries.has(key);
    },
    run(options: {
      key: string;
      intentId: string;
      rawPrompt: string;
      prepare(): Promise<QuickLaunch>;
      explicit: boolean;
      lineage?: { intentId?: string };
    }): Promise<NativeQuickLaunchResult> {
      let entry = runtime.entries.get(options.key);
      if (!entry) {
        if (
          !options.explicit ||
          !UUID.test(options.intentId) ||
          options.rawPrompt.length > 256 * 1024 ||
          runtime.entries.size >= 32
        )
          return Promise.reject(unknown());
        entry = {
          intentId: options.intentId,
          rawPrompt: options.rawPrompt,
          attempted: false,
          waiters: 0,
        };
        runtime.entries.set(options.key, entry);
      }
      if (
        !options.explicit &&
        options.lineage?.intentId &&
        options.lineage.intentId !== entry.intentId
      )
        return Promise.reject(unknown());
      if (options.lineage) options.lineage.intentId = entry.intentId;
      if (entry.waiters >= 32)
        return Promise.reject(new Error("Too many Quick launch status waiters."));
      const accepted = entry;
      accepted.waiters++;
      if (!accepted.actual) {
        const actual = perform(
          accepted,
          options.prepare,
          options.explicit,
          options.rawPrompt,
          options.lineage,
        );
        accepted.actual = actual;
        void actual
          .finally(() => {
            if (accepted.actual === actual) accepted.actual = undefined;
            // Read-only preparation/scope discovery did not publish any Native
            // tuple or submit attempt. Keep the raw draft in its actual owner;
            // a later explicit Start must prepare the CURRENT corrected text.
            // An attempted delivery remains immutable/status-only on failure.
            if (
              !accepted.submission &&
              !accepted.attempted &&
              runtime.entries.get(options.key) === accepted
            )
              runtime.entries.delete(options.key);
          })
          .catch(() => {});
      }
      return accepted.actual.finally(() => {
        accepted.waiters--;
      });
    },
    complete(key: string, result: NativeQuickLaunchResult) {
      const entry = runtime.entries.get(key);
      if (entry?.intentId === result.intentId && entry.receipt === result.receipt && !entry.actual)
        runtime.entries.delete(key);
    },
  };
}

// Data and actual pending jobs survive module replacement; fresh methods read
// that state. These renderer IDs are matching hints, never Native authority.
const runtimeKey = Symbol.for("bycoda.quick.native-launch-runtime.v1");
const root = globalThis as typeof globalThis & { [runtimeKey]?: Runtime };
root[runtimeKey] ??= { entries: new Map() };
export const nativeQuickLaunches = createNativeQuickLaunchRuntime(invoke, root[runtimeKey]);
