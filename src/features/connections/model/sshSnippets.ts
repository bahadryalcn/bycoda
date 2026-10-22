import {
  loadPromptTemplates,
  savePromptTemplates,
  subscribePromptTemplates,
} from "../../sessions/model/promptTemplates";
import { isSingleLineCommand } from "../../terminal/model/terminalSuggestions";

const KEY = "bycoda.sshSnippetReferences.v1";
const CHANGE = "bycoda:ssh-snippets";
type Reference = { serverId: string; version: number; fingerprint: string };
type Manifest = { schemaVersion: 1; references: Record<string, Reference> };
export type SshSnippet = {
  id: string;
  serverId: string;
  name: string;
  command: string;
  version: number;
  /** Editing a shared template elsewhere requires another explicit preview/save. */
  reviewed: boolean;
};

// Change detector only; this is not a credential hash or security signature.
function fingerprint(text: string) {
  let result = 2166136261;
  for (let index = 0; index < text.length; index++)
    result = Math.imul(result ^ text.charCodeAt(index), 16777619);
  return (result >>> 0).toString(16);
}
function manifest(): Manifest {
  const raw = localStorage.getItem(KEY);
  if (!raw) return { schemaVersion: 1, references: {} };
  const parsed: unknown = JSON.parse(raw);
  if (
    !parsed ||
    typeof parsed !== "object" ||
    !("schemaVersion" in parsed) ||
    parsed.schemaVersion !== 1 ||
    !("references" in parsed) ||
    !parsed.references ||
    typeof parsed.references !== "object"
  )
    throw new Error("Could not read saved command references");
  const references: Record<string, Reference> = {};
  for (const [id, value] of Object.entries(parsed.references)) {
    if (
      !value ||
      typeof value !== "object" ||
      typeof value.serverId !== "string" ||
      !Number.isSafeInteger(value.version) ||
      value.version < 1 ||
      typeof value.fingerprint !== "string"
    )
      throw new Error("Could not read saved command references");
    Object.defineProperty(references, id, {
      value,
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  return { schemaVersion: 1, references };
}
export function loadSshSnippets(serverId: string): SshSnippet[] {
  const references = manifest().references;
  return loadPromptTemplates().flatMap((template) => {
    const ref = Object.prototype.hasOwnProperty.call(references, template.id) ? references[template.id] : undefined;
    return ref?.serverId === serverId
      ? [
          {
            id: template.id,
            serverId,
            name: template.name,
            command: template.body,
            version: ref.version,
            reviewed: ref.fingerprint === fingerprint(template.body),
          },
        ]
      : [];
  });
}
export function saveSshSnippet(input: {
  id?: string;
  serverId: string;
  name: string;
  command: string;
  expectedVersion?: number;
  expectedCommand?: string;
}): SshSnippet {
  if (!input.serverId || !input.name.trim() || input.name.length > 200)
    throw new Error("A target server and command name are required");
  if (input.command.length > 8192 || !isSingleLineCommand(input.command))
    throw new Error("Use one command line without terminal controls");
  const data = manifest();
  const templates = loadPromptTemplates();
  const id = input.id ?? `ssh-command-${crypto.randomUUID()}`;
  const previous = Object.prototype.hasOwnProperty.call(data.references, id) ? data.references[id] : undefined;
  if (
    input.id &&
    (!previous ||
      previous.serverId !== input.serverId ||
      previous.version !== input.expectedVersion ||
      templates.find((template) => template.id === id)?.body !== input.expectedCommand)
  )
    throw new Error("This command changed. Reload it before saving");
  const version = (previous?.version ?? 0) + 1;
  data.references[id] = {
    serverId: input.serverId,
    version,
    fingerprint: fingerprint(input.command),
  };
  // The one existing content store remains authoritative. A failed body write
  // leaves a mismatched reference, which disables insertion until reviewed.
  localStorage.setItem(KEY, JSON.stringify(data));
  const next = templates.filter((template) => template.id !== id);
  next.push({ id, name: input.name.trim(), body: input.command });
  savePromptTemplates(next);
  window.dispatchEvent(new Event(CHANGE));
  return {
    id,
    serverId: input.serverId,
    name: input.name.trim(),
    command: input.command,
    version,
    reviewed: true,
  };
}
export function removeSshSnippet(id: string, serverId: string, expectedVersion: number) {
  const data = manifest();
  const previous = Object.prototype.hasOwnProperty.call(data.references, id) ? data.references[id] : undefined;
  if (!previous || previous.serverId !== serverId || previous.version !== expectedVersion)
    throw new Error("This command changed. Reload it before deleting");
  // Remove the shared template explicitly; unrelated prompt templates are retained.
  savePromptTemplates(loadPromptTemplates().filter((template) => template.id !== id));
  delete data.references[id];
  localStorage.setItem(KEY, JSON.stringify(data));
  window.dispatchEvent(new Event(CHANGE));
}
export function subscribeSshSnippets(callback: () => void) {
  const prompts = subscribePromptTemplates(callback);
  const storage = (event: StorageEvent) => {
    if (event.key === KEY) callback();
  };
  window.addEventListener(CHANGE, callback);
  window.addEventListener("storage", storage);
  return () => {
    prompts();
    window.removeEventListener(CHANGE, callback);
    window.removeEventListener("storage", storage);
  };
}
export async function insertSshSnippet(
  snippet: SshSnippet,
  serverId: string,
  onInsert: (text: string) => Promise<void>,
) {
  const current = loadSshSnippets(serverId).find((entry) => entry.id === snippet.id);
  if (
    !current ||
    snippet.serverId !== serverId ||
    !current.reviewed ||
    current.version !== snippet.version ||
    current.command !== snippet.command ||
    !isSingleLineCommand(current.command)
  )
    throw new Error("Review the current command for this server before inserting");
  await onInsert(current.command);
}
