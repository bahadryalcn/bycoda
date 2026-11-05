import { invoke } from "@tauri-apps/api/core";

const SCOPE = "assistant-thread-sends.v2";
const LEGACY = "bycoda.assistant.send-intents";
const DRAFT_SCOPE = "assistant-thread-drafts.v2";
const LEGACY_DRAFTS = "bycoda.assistant.thread-drafts";
type Entry = { key: string; version: number; value: unknown };
type Outcome = { applied: boolean; entries: Entry[]; compacted?: boolean };
export type AssistantSendIntent = {
  text: string;
  key: string;
  environmentId: string;
  sessionId?: string;
  draftVersion?: number;
};
type HeldSend = {
  claimId: string;
  page: string;
  version: number;
  intent: AssistantSendIntent;
  cleared?: boolean;
};
const heldSends = new Map<string, HeldSend>();
let token: Promise<string> | undefined;
function pageToken(): Promise<string> {
  return (token ??= invoke<string>("canonical_store_page_token").catch((error: unknown) => {
    token = undefined;
    throw error;
  }));
}

export type AssistantNativeDraft = { text: string; version: number };

export async function readAssistantNativeDraft(
  threadId: string,
  environmentId: string,
  allowRecovery = false,
): Promise<AssistantNativeDraft> {
  const storageKey = JSON.stringify([environmentId, threadId]);
  let current = await invoke<Entry | null>("canonical_store_get", {
    scope: DRAFT_SCOPE,
    key: storageKey,
  });
  if (!current) {
    const raw = localStorage.getItem(LEGACY_DRAFTS);
    let text = "";
    if (raw !== null) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        throw new Error("The original draft cannot be read.");
      }
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
        throw new Error("The original draft cannot be read.");
      const item = (parsed as Record<string, unknown>)[threadId];
      if (item !== undefined && typeof item !== "string")
        throw new Error("The original draft cannot be read.");
      text = item ?? "";
    }
    const saved = await invoke<Outcome>("canonical_store_transaction", {
      scope: DRAFT_SCOPE,
      pageToken: await pageToken(),
      operationId: crypto.randomUUID(),
      // Legacy drafts lack Host identity. Keep nonempty text as recoverable
      // evidence instead of silently assigning it to the current Host.
      checks: [{ key: storageKey, version: null }],
      writes: [{ key: storageKey, value: text ? { legacyPending: true } : "" }],
      legacy: raw === null ? [] : [{ key: storageKey, raw }],
      expectedRevision: null,
      claim: null,
    });
    if (raw !== null && localStorage.getItem(LEGACY_DRAFTS) !== raw)
      throw new Error("The original draft changed during migration.");
    current =
      saved.applied && !saved.compacted
        ? (saved.entries.find((entry) => entry.key === storageKey) ?? null)
        : await invoke<Entry | null>("canonical_store_get", {
            scope: DRAFT_SCOPE,
            key: storageKey,
          });
  }
  if (
    current &&
    allowRecovery &&
    current.value &&
    typeof current.value === "object" &&
    (current.value as { legacyPending?: unknown }).legacyPending === true
  )
    return { text: "", version: current.version };
  if (!current || typeof current.value !== "string")
    throw new Error("The original draft needs recovery before editing.");
  return { text: current.value, version: current.version };
}

export async function writeAssistantNativeDraft(
  threadId: string,
  environmentId: string,
  expected: number,
  text: string,
): Promise<number> {
  const storageKey = JSON.stringify([environmentId, threadId]);
  const result = await invoke<Outcome>("canonical_store_transaction", {
    scope: DRAFT_SCOPE,
    pageToken: await pageToken(),
    operationId: crypto.randomUUID(),
    checks: [{ key: storageKey, version: expected }],
    writes: [{ key: storageKey, value: text }],
    // The rejected draft is retained even when its compare-and-swap conflicts.
    legacy: [
      {
        key: storageKey,
        raw: JSON.stringify({ kind: "assistant-thread-draft", text }),
        conflictOnly: true,
      },
    ],
    expectedRevision: null,
    claim: null,
  });
  const row = result.entries.find((entry) => entry.key === storageKey);
  if (!result.applied || !row)
    throw new Error("The draft changed in another window. Your text is kept here.");
  if (result.compacted) {
    let current: Entry | null;
    try {
      current = await invoke<Entry | null>("canonical_store_get", {
        scope: DRAFT_SCOPE,
        key: storageKey,
      });
    } catch {
      throw new Error("The draft was saved, but its current state could not be verified.");
    }
    if (!current || current.version !== row.version || current.value !== text)
      throw new Error("The draft changed in another window. Your text is kept here.");
  }
  return row.version;
}

export type AssistantDraftBackup = { hash: string; bytes: number };
export async function readAssistantDraftBackups(
  threadId: string,
  environmentId: string,
  afterHash?: string,
  expectedRevision?: number,
): Promise<{
  backups: AssistantDraftBackup[];
  revision: number;
  next?: string;
}> {
  const key = JSON.stringify([environmentId, threadId]);
  const page = await invoke<{ items: AssistantDraftBackup[]; revision: number }>(
    "assistant_draft_backup_list",
    {
      key,
      environmentId,
      threadId,
      afterHash: afterHash ?? null,
      expectedRevision: expectedRevision ?? null,
      limit: 32,
    },
  );
  return {
    backups: page.items,
    revision: page.revision,
    ...(page.items.length === 32 ? { next: page.items[page.items.length - 1].hash } : {}),
  };
}

export async function readAssistantDraftBackup(
  threadId: string,
  environmentId: string,
  hash: string,
): Promise<{ text: string; savedAt?: number | null }> {
  return invoke("assistant_draft_backup_read", {
    key: JSON.stringify([environmentId, threadId]),
    environmentId,
    threadId,
    hash,
  });
}

/** Preserve the current in-window text before an explicit recovery selection. */
export async function preserveAssistantDraft(
  threadId: string,
  environmentId: string,
  text: string,
): Promise<void> {
  const key = JSON.stringify([environmentId, threadId]);
  const current = await invoke<Entry | null>("canonical_store_get", { scope: DRAFT_SCOPE, key });
  await invoke<Outcome>("canonical_store_transaction", {
    scope: DRAFT_SCOPE,
    pageToken: await pageToken(),
    operationId: crypto.randomUUID(),
    checks: [{ key, version: current?.version ?? null }],
    writes: [],
    legacy: [{ key, raw: JSON.stringify({ kind: "assistant-thread-draft", text }) }],
    expectedRevision: null,
    claim: null,
  });
}

/** Hold the original send identity until its exact reply is confirmed. */
export async function sendAssistantNative<T>(
  threadId: string,
  intent: AssistantSendIntent,
  receive: (response: unknown) => Promise<T>,
  onDurableHandoff?: () => void,
): Promise<T> {
  const page = await pageToken();
  const storageKey = JSON.stringify([intent.environmentId, threadId]);
  const claimId = crypto.randomUUID();
  const current = await invoke<Entry | null>("canonical_store_get", {
    scope: SCOPE,
    key: storageKey,
  });
  let previous = current?.value ?? null;
  let source: string | null = null;
  if (!current) {
    source = localStorage.getItem(LEGACY);
    if (source !== null) {
      try {
        const parsed: unknown = JSON.parse(source);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
          previous = { invalidLegacy: true };
        else previous = (parsed as Record<string, unknown>)[threadId] ?? null;
      } catch {
        previous = { invalidLegacy: true };
      }
    }
  }
  const acquired = await invoke<Outcome>("canonical_store_transaction", {
    scope: SCOPE,
    pageToken: page,
    operationId: crypto.randomUUID(),
    checks: [{ key: storageKey, version: current?.version ?? null }],
    writes: current ? [] : [{ key: storageKey, value: previous }],
    legacy: source === null ? [] : [{ key: storageKey, raw: source }],
    expectedRevision: null,
    claim: { key: storageKey, operationId: claimId, mode: "acquire" },
  });
  if (!acquired.applied)
    throw new Error("The reply has not been confirmed. Check the conversation before retrying.");
  if (source !== null && localStorage.getItem(LEGACY) !== source)
    throw new Error("The send identity changed. Check the conversation before retrying.");
  const version =
    current?.version ?? acquired.entries.find((entry) => entry.key === storageKey)?.version;
  if (version === undefined) throw new Error("The send identity was not confirmed.");
  if (previous !== null) {
    const old = previous as Partial<AssistantSendIntent>;
    if (
      old &&
      typeof old === "object" &&
      typeof old.text === "string" &&
      typeof old.key === "string" &&
      old.environmentId === intent.environmentId &&
      (old.sessionId === undefined || typeof old.sessionId === "string")
    ) {
      heldSends.set(storageKey, { claimId, page, version, intent: old as AssistantSendIntent });
    } else {
      await invoke("canonical_store_settle", {
        scope: SCOPE,
        key: storageKey,
        operationId: claimId,
        pageToken: page,
      });
    }
    throw new Error("The reply has not been confirmed. Check the conversation before retrying.");
  }
  const saved = await invoke<Outcome>("canonical_store_transaction", {
    scope: SCOPE,
    pageToken: page,
    operationId: crypto.randomUUID(),
    checks: [{ key: storageKey, version }],
    writes: [{ key: storageKey, value: intent }],
    legacy: [],
    expectedRevision: null,
    claim: { key: storageKey, operationId: claimId, mode: "require" },
  });
  const savedVersion = saved.entries.find((entry) => entry.key === storageKey)?.version;
  if (!saved.applied || savedVersion === undefined)
    throw new Error("The send identity was not saved.");
  heldSends.set(storageKey, { claimId, page, version: savedVersion, intent });
  onDurableHandoff?.();
  const response = await invoke<unknown>("assistant_native_send", {
    pageToken: page,
    key: storageKey,
    operationId: claimId,
    intentVersion: savedVersion,
    environmentId: intent.environmentId,
  });
  const result = await receive(response);
  await invoke("assistant_native_finish", {
    pageToken: page,
    key: storageKey,
    operationId: claimId,
  });
  heldSends.delete(storageKey);
  return result;
}

export async function reconcileAssistantNative(
  threadId: string,
  environmentId: string,
  requestKey: string,
): Promise<unknown> {
  const key = JSON.stringify([environmentId, threadId]);
  const result = await invoke<unknown>("assistant_native_reconcile", {
    pageToken: await pageToken(),
    key,
    requestKey,
    operationId: heldSends.get(key)?.claimId ?? null,
  });
  heldSends.delete(key);
  return result;
}

/** A retained claim remains held until Native verifies the original Host route. */
export function assistantNativeHeldIntent(
  threadId: string,
  environmentId: string,
): AssistantSendIntent | undefined {
  const storageKey = JSON.stringify([environmentId, threadId]);
  return heldSends.get(storageKey)?.intent;
}

export async function readAssistantNativeHeldIntent(
  threadId: string,
  environmentId: string,
): Promise<AssistantSendIntent | undefined> {
  const key = JSON.stringify([environmentId, threadId]);
  const row = await invoke<Entry | null>("canonical_store_get", { scope: SCOPE, key });
  const value = row?.value as Partial<AssistantSendIntent> | null | undefined;
  if (
    !value ||
    typeof value !== "object" ||
    typeof value.text !== "string" ||
    typeof value.key !== "string" ||
    value.environmentId !== environmentId ||
    (value.sessionId !== undefined && typeof value.sessionId !== "string")
  )
    return undefined;
  return value as AssistantSendIntent;
}
