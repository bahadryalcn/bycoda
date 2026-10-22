import type { TemplateSkill } from "../../skills/model/skills";

/**
 * Reusable prompt snippets the user saves once in Settings and inserts from the
 * composer: from the slash picker, or by typing `;trigger` and a space.
 * Global (not per project), kept in localStorage like the other small prefs.
 */
export type PromptTemplate = {
  id: string;
  name: string;
  body: string;
  /** Optional short word typed as `;trigger` to expand the body in place. */
  trigger?: string;
};

const KEY = "bycoda.promptTemplates";
const CHANGE_EVENT = "bycoda:prompt-templates-change";

export const CURSOR_PLACEHOLDER = "{{cursor}}";
export const TRIGGER_PREFIX = ";";
export const MAX_TEMPLATES = 100;
export const MAX_TEMPLATE_BODY = 20_000;

const TRIGGER_RE = /^[a-z0-9][a-z0-9-]{0,23}$/;

export function normalizeTrigger(value: string | undefined): string | undefined {
  const trigger = (value ?? "").trim().replace(/^;/, "").toLowerCase();
  return trigger || undefined;
}

export function isValidTrigger(trigger: string): boolean {
  return TRIGGER_RE.test(trigger);
}

function parse(raw: string | null): PromptTemplate[] {
  try {
    const value: unknown = JSON.parse(raw ?? "[]");
    if (!Array.isArray(value)) return [];
    const seenIds = new Set<string>();
    const seenTriggers = new Set<string>();
    const templates: PromptTemplate[] = [];
    for (const entry of value) {
      if (!entry || typeof entry !== "object") continue;
      const row = entry as Record<string, unknown>;
      if (typeof row.id !== "string" || !row.id || seenIds.has(row.id)) continue;
      if (typeof row.name !== "string" || typeof row.body !== "string") continue;
      const name = row.name.trim();
      if (!name || !row.body.trim()) continue;
      let trigger = typeof row.trigger === "string" ? normalizeTrigger(row.trigger) : undefined;
      if (trigger && (!isValidTrigger(trigger) || seenTriggers.has(trigger))) {
        trigger = undefined;
      }
      seenIds.add(row.id);
      if (trigger) seenTriggers.add(trigger);
      templates.push({
        id: row.id,
        name,
        body: row.body.slice(0, MAX_TEMPLATE_BODY),
        ...(trigger ? { trigger } : {}),
      });
      if (templates.length >= MAX_TEMPLATES) break;
    }
    return templates;
  } catch {
    return [];
  }
}

let cacheStorage: Storage | null = null;
let cacheRaw: string | null | undefined;
let cacheValue: PromptTemplate[] = [];

/** Stable between calls while storage is unchanged, so it can back `useSyncExternalStore`. */
export function loadPromptTemplates(): PromptTemplate[] {
  try {
    const storage = localStorage;
    const raw = storage.getItem(KEY);
    if (cacheStorage === storage && cacheRaw === raw) return cacheValue;
    cacheStorage = storage;
    cacheRaw = raw;
    cacheValue = parse(raw);
    return cacheValue;
  } catch {
    return [];
  }
}

/** Throws a message fit for the UI when the list cannot be saved. */
export function validatePromptTemplates(templates: readonly PromptTemplate[]): void {
  if (templates.length > MAX_TEMPLATES) {
    throw new Error(`Keep at most ${MAX_TEMPLATES} templates`);
  }
  const triggers = new Set<string>();
  for (const template of templates) {
    if (!template.name.trim()) throw new Error("Every template needs a name");
    if (!template.body.trim()) {
      throw new Error(`"${template.name.trim()}" needs some text`);
    }
    if (template.body.length > MAX_TEMPLATE_BODY) {
      throw new Error(`"${template.name.trim()}" is too long`);
    }
    const trigger = normalizeTrigger(template.trigger);
    if (!trigger) continue;
    if (!isValidTrigger(trigger)) {
      throw new Error(`Trigger "${trigger}" must be 1-24 letters, numbers or dashes`);
    }
    if (triggers.has(trigger)) {
      throw new Error(`Trigger "${trigger}" is used twice`);
    }
    triggers.add(trigger);
  }
}

export function savePromptTemplates(templates: readonly PromptTemplate[]): void {
  validatePromptTemplates(templates);
  const clean = templates.map((template) => {
    const trigger = normalizeTrigger(template.trigger);
    return {
      id: template.id,
      name: template.name.trim(),
      body: template.body,
      ...(trigger ? { trigger } : {}),
    };
  });
  try {
    if (clean.length > 0) localStorage.setItem(KEY, JSON.stringify(clean));
    else localStorage.removeItem(KEY);
  } catch {
    throw new Error("Could not save templates");
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }
}

export function subscribePromptTemplates(onStoreChange: () => void) {
  if (typeof window === "undefined") return () => {};
  const onStorage = (event: StorageEvent) => {
    if (event.key === KEY) onStoreChange();
  };
  window.addEventListener(CHANGE_EVENT, onStoreChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onStoreChange);
    window.removeEventListener("storage", onStorage);
  };
}

function slug(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** The `/word` that finds the template in the slash picker. */
export function templateInvocation(template: PromptTemplate): string {
  return template.trigger || slug(template.name) || "template";
}

function preview(body: string): string {
  const line = body
    .replace(CURSOR_PLACEHOLDER, "")
    .split("\n")
    .map((part) => part.trim())
    .find(Boolean);
  const text = line ?? "";
  return text.length > 120 ? `${text.slice(0, 117)}...` : text;
}

/** Shapes a template as a picker row, so the slash picker lists it with commands and skills. */
export function templateSkill(template: PromptTemplate): TemplateSkill {
  return {
    kind: "template",
    scope: "template",
    source: "bycoda",
    name: template.name,
    invocation: templateInvocation(template),
    description: preview(template.body),
    templateId: template.id,
    body: template.body,
  };
}

/**
 * Replaces `text[start, end)` with the template body. The first `{{cursor}}`
 * marks where the caret lands (end of the body without one); later ones are
 * dropped so they never leak into a prompt.
 */
export function insertTemplateBody(
  text: string,
  start: number,
  end: number,
  body: string,
): { text: string; caret: number } {
  const from = Math.max(0, Math.min(start, text.length));
  const to = Math.max(from, Math.min(end, text.length));
  const at = body.indexOf(CURSOR_PLACEHOLDER);
  const clean = (value: string) => value.split(CURSOR_PLACEHOLDER).join("");
  const before = clean(at < 0 ? body : body.slice(0, at));
  const after = at < 0 ? "" : clean(body.slice(at + CURSOR_PLACEHOLDER.length));
  return {
    text: text.slice(0, from) + before + after + text.slice(to),
    caret: from + before.length,
  };
}

export type TemplateTrigger = {
  start: number;
  end: number;
  template: PromptTemplate;
};

/** The `;trigger` word ending at `caret`, when it names a saved template. */
export function templateTriggerAt(
  text: string,
  caret: number,
  templates: readonly PromptTemplate[],
): TemplateTrigger | null {
  const head = text.slice(0, caret);
  const match = /(?:^|\s);([a-z0-9][a-z0-9-]*)$/.exec(head);
  if (!match) return null;
  const template = templates.find((entry) => entry.trigger === match[1]);
  if (!template) return null;
  return { start: caret - match[1]!.length - 1, end: caret, template };
}
