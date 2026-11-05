import type {
  AssistantRequest,
  AssistantResponse,
  AssistantSnapshot,
} from "../../../shared/model/host-contracts/assistant";
import { loadVoiceMemory } from "./voiceMemory";
import { loadVoicePersona } from "./voicePersona";

type Request = (input: AssistantRequest) => Promise<AssistantResponse>;
const MIGRATION = "bycoda.voice.host-memory-migrated.v1";
export function voiceMemoryMigrationComplete() {
  try {
    return localStorage.getItem(MIGRATION) === "done";
  } catch {
    return false;
  }
}
export async function migrateVoiceOwnerMemory(snapshot: AssistantSnapshot, request: Request) {
  if (!snapshot.profile.setupComplete || localStorage.getItem(MIGRATION) === "done") return;
  const persona = loadVoicePersona();
  const memory = loadVoiceMemory();
  const entries = [
    ...(persona.rules.trim()
      ? [{ text: persona.rules, kind: "rule" as const, source: "typed" as const }]
      : []),
    ...(memory.enabled
      ? memory.notes.map((note) => ({
          text: note.text,
          kind: "fact" as const,
          source: "learned" as const,
        }))
      : []),
  ];
  for (const entry of entries) {
    const found = await request({
      op: "memory.search",
      query: entry.text.slice(0, 200),
      limit: 100,
    });
    if (found.entries?.some((value) => value.text === entry.text && value.kind === entry.kind))
      continue;
    await request({
      op: "memory.save",
      ...entry,
      scope: "all",
      quote: entry.kind === "rule" ? entry.text : "",
      active: true,
      forbiddenTerms: [],
    });
  }
  localStorage.setItem(MIGRATION, "done"); // Legacy keys intentionally remain as backup.
}

export async function rememberHostVoiceMemory(
  text: unknown,
  kind: unknown,
  request: Request,
  ownerQuote?: string,
) {
  if (kind === "rule")
    return {
      saved: false,
      error: "Only your current explicit correction can create an owner rule.",
    };
  if (!loadVoiceMemory().enabled)
    return { saved: false, error: "Memory is turned off in Settings." };
  const clean = typeof text === "string" ? text.trim() : "";
  if (!clean || clean.length > 300)
    return { saved: false, error: "The note is empty or too long." };
  const found = await request({ op: "memory.search", query: clean.slice(0, 200), limit: 100 });
  const existing = found.entries?.find(
    (entry) =>
      entry.kind === "fact" &&
      entry.scope === "all" &&
      entry.text.toLocaleLowerCase() === clean.toLocaleLowerCase(),
  );
  const nextKind = "fact";
  const result =
    existing && existing.kind === nextKind && existing.active
      ? { memory: existing }
      : await request({
          op: "memory.save",
          ...(existing ? { id: existing.id, expectedVersion: existing.version } : {}),
          kind: nextKind,
          text: clean,
          scope: "all",
          source: "spoken",
          quote: ownerQuote && ownerQuote.length <= 4000 ? ownerQuote : "",
          active: true,
          forbiddenTerms: [],
        });
  if (!result.memory) return { saved: false, error: "Memory could not be changed." };
  return { saved: true, id: result.memory.id };
}
export function ownerAskedToForget(text: string) {
  return (
    /\bforget\b|\bunut\b|\bsil\b/iu.test(text) &&
    !/(?:do not|don['’]?t|never).{0,15}forget|unutma|silme/iu.test(text)
  );
}
export async function forgetHostVoiceMemory(
  id: unknown,
  request: Request,
  ownerQuote?: string,
  confirmed?: { version: number; text: string },
) {
  if (!loadVoiceMemory().enabled)
    return { forgotten: false, error: "Memory is turned off in Settings." };
  if (typeof id !== "string") return { forgotten: false, error: "The note was not found." };
  if (!ownerQuote || !ownerAskedToForget(ownerQuote) || !confirmed)
    return { forgotten: false, error: "Choose the exact memory to forget and confirm it." };
  const result = await request({ op: "memory.search", query: "", limit: 100 });
  const entry = result.entries?.find((value) => value.id === id);
  if (!entry) return { forgotten: false, error: "The note was not found." };
  if (entry.version !== confirmed.version || entry.text !== confirmed.text)
    return { forgotten: false, error: "The saved memory changed. Review it before deleting." };
  await request({ op: "memory.delete", id, expectedVersion: entry.version });
  return { forgotten: true };
}
