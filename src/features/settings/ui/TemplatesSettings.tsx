import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { TextareaField } from "../../../shared/ui/TextareaField";
import { TextField } from "../../../shared/ui/TextField";
import { SearchInput } from "../../../shared/ui/SearchInput";
import { Button } from "../../../shared/ui/Button";
import { t, useLocale } from "../../../shared/i18n";
import { Plus } from "../../../shared/ui/icons";
import { AdvancedSettings, Group, SettingsFeedback } from "./settingsControls";
import {
  CURSOR_PLACEHOLDER, loadPromptTemplates, MAX_TEMPLATE_BODY, MAX_TEMPLATES,
  savePromptTemplates, subscribePromptTemplates, TRIGGER_PREFIX,
  isValidTrigger, normalizeTrigger, type PromptTemplate,
} from "../../sessions/model/promptTemplates";

function sameTemplates(a: readonly PromptTemplate[], b: readonly PromptTemplate[]) {
  return a.length === b.length && a.every((row, index) => {
    const other = b[index];
    return !!other && row.id === other.id && row.name === other.name && row.body === other.body && (row.trigger ?? "") === (other.trigger ?? "");
  });
}
// Window-local, unsaved authoring state survives Settings navigation/Escape.
let retainedDraft: { rows: PromptTemplate[]; baseline: readonly PromptTemplate[]; selected: string | null } | null = null;
export function clearRetainedTemplateDraft() { retainedDraft = null; }
function templateStorageAvailable() {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem("bycoda.promptTemplates") ?? "[]");
    if (!Array.isArray(raw)) return false;
    return raw.length === loadPromptTemplates().length && raw.every((item) => item && typeof item.id === "string" && typeof item.name === "string" && typeof item.body === "string");
  } catch { return false; }
}

export function TemplatesSettings() {
  useLocale();
  const saved = useSyncExternalStore(subscribePromptTemplates, loadPromptTemplates, loadPromptTemplates);
  const [rows, setRows] = useState<PromptTemplate[]>(() => retainedDraft?.rows ?? [...saved]);
  const [baseline, setBaseline] = useState(() => retainedDraft?.baseline ?? saved);
  const [selectedId, setSelectedId] = useState<string | null>(() => retainedDraft?.selected ?? saved[0]?.id ?? null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<{ id: string; field: "name" | "body" | "trigger" } | null>(null);
  const [savedMessage, setSavedMessage] = useState(false);
  const [, reread] = useState(0);
  const nameRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const triggerRef = useRef<HTMLInputElement>(null);
  const dirty = !sameTemplates(rows, baseline);
  const changedElsewhere = !sameTemplates(saved, baseline);
  const available = templateStorageAvailable();
  const selected = rows.find((row) => row.id === selectedId) ?? rows[0];
  const matches = rows.filter((row) => [row.name, row.trigger ?? "", row.body].join(" ").toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  useEffect(() => {
    retainedDraft = dirty ? { rows, baseline, selected: selectedId } : null;
  }, [rows, baseline, selectedId, dirty]);
  useEffect(() => {
    if (!changedElsewhere || dirty || !available) return;
    setRows([...saved]); setBaseline(saved);
  }, [saved, changedElsewhere, dirty, available]);
  const update = (id: string, patch: Partial<PromptTemplate>) => {
    setSavedMessage(false); setError(null); setFieldError(null);
    setRows((current) => current.map((row) => row.id === id ? { ...row, ...patch } : row));
  };
  const reload = () => {
    if (!templateStorageAvailable()) { setError(t("Template storage is unavailable. Retry reading before saving.")); return; }
    const current = loadPromptTemplates();
    setRows([...current]); setBaseline(current); setSelectedId(current[0]?.id ?? null);
    setError(null); setSavedMessage(false); retainedDraft = null;
  };
  const save = () => {
    if (!templateStorageAvailable()) { setError(t("Template storage is unavailable. Retry reading before saving.")); return; }
    if (!sameTemplates(loadPromptTemplates(), baseline)) {
      setError(t("Templates changed in another window. Reload before saving to avoid overwriting those changes.")); return;
    }
    const triggers = new Set<string>();
    for (const row of rows) {
      const trigger = normalizeTrigger(row.trigger);
      const field = !row.name.trim() ? "name" : !row.body.trim() || row.body.length > MAX_TEMPLATE_BODY ? "body" : trigger && (!isValidTrigger(trigger) || triggers.has(trigger)) ? "trigger" : null;
      if (field) {
        setFieldError({ id: row.id, field });
        setSelectedId(row.id); setError(t("Check the selected template's name, text and unique trigger."));
        requestAnimationFrame(() => (field === "name" ? nameRef.current : field === "body" ? bodyRef.current : triggerRef.current)?.focus());
        return;
      }
      if (trigger) triggers.add(trigger);
    }
    try {
      savePromptTemplates(rows);
      const current = loadPromptTemplates();
      setRows([...current]); setBaseline(current); setError(null); setSavedMessage(true); retainedDraft = null;
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  };
  return <Group id="prompt-templates" title={t("Prompt templates")} layout="full"
    persistence={{ mode: "explicit", state: error ? "error" : dirty ? "dirty" : savedMessage ? "saved" : "idle", error }}
    action={<Button variant="ghost" disabled={!available || rows.length >= MAX_TEMPLATES} onClick={() => {
      const row = { id: crypto.randomUUID(), name: "", body: "" };
      setRows((current) => [...current, row]); setSelectedId(row.id); setQuery(""); setError(null); setSavedMessage(false);
    }}><Plus strokeWidth={1.75} />{t("Add template")}</Button>}>
    <div className="settings-templates">
      {!available ? <SettingsFeedback state="error" action={<Button onClick={() => { if (templateStorageAvailable()) setError(null); reread((value) => value + 1); }}>{t("Retry")}</Button>}>{t("Template storage is unavailable. Retry reading before saving.")}</SettingsFeedback> : null}
      <AdvancedSettings defaultOpen={false} title={t("How to use templates")}>
        <p className="chat-detail">{t("Pick a template from the / menu, or type {p0} followed by a space. Use {p1} to set the caret position.", { p0: TRIGGER_PREFIX + "trigger", p1: CURSOR_PLACEHOLDER })}</p>
        <p className="chat-detail">{t("Name and text are required. The trigger is optional. Up to {p0} templates, with {p1} characters each.", { p0: String(MAX_TEMPLATES), p1: String(MAX_TEMPLATE_BODY) })}</p>
      </AdvancedSettings>
      <div className="template-manager">
        <div className="flex min-w-0 flex-col gap-2">
          <SearchInput appearance="field" aria-label={t("Search prompt templates")} placeholder={t("Search prompt templates")} value={query} onChange={(event) => setQuery(event.target.value)} />
          <div className="template-manager-list flex flex-col gap-1" role="group" aria-label={t("Prompt templates")}>
            {matches.map((row) => <Button key={row.id} variant="item" align="start" fullWidth selected={row.id === selected?.id} aria-pressed={row.id === selected?.id} onClick={() => setSelectedId(row.id)}>{row.name || t("New template")}</Button>)}
            {!matches.length && available ? <SettingsFeedback state="empty" presentation="inset">{rows.length ? t("No matching templates") : t("No templates yet")}</SettingsFeedback> : null}
          </div>
        </div>
        {selected ? <div className="flex min-w-0 flex-col gap-3">
          <TextField ref={nameRef} label={t("Template name")} aria-label={t("Template name")} error={fieldError?.id === selected.id && fieldError.field === "name" ? error ?? undefined : undefined} value={selected.name} onChange={(event) => update(selected.id, { name: event.target.value })} spellCheck={false} autoComplete="off" />
          <TextField ref={triggerRef} label={t("Template trigger")} aria-label={t("Template trigger")} error={fieldError?.id === selected.id && fieldError.field === "trigger" ? error ?? undefined : undefined} value={selected.trigger ?? ""} onChange={(event) => update(selected.id, { trigger: event.target.value })} placeholder={t("trigger (optional)")} spellCheck={false} autoComplete="off" />
          <TextareaField ref={bodyRef} label={t("Template text")} aria-label={t("Template text")} error={fieldError?.id === selected.id && fieldError.field === "body" ? error ?? undefined : undefined} value={selected.body} onChange={(event) => update(selected.id, { body: event.target.value })} rows={8} maxLength={MAX_TEMPLATE_BODY} spellCheck={false} />
          <Button variant="ghost" tone="danger" onClick={() => { setRows((current) => current.filter((row) => row.id !== selected.id)); setError(null); setSavedMessage(false); }}>{t("Delete template")}</Button>
        </div> : null}
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button variant="primary" disabled={!available || !dirty || changedElsewhere} onClick={save}>{t("Save templates")}</Button>
        {dirty || changedElsewhere ? <Button onClick={reload}>{t("Discard changes and reload")}</Button> : null}
      </div>
      {error ? <SettingsFeedback state="error">{error}</SettingsFeedback> : null}
      {changedElsewhere && dirty ? <SettingsFeedback state="warning">{t("Templates changed in another window. Reload before saving to avoid overwriting those changes.")}</SettingsFeedback> : null}
    </div>
  </Group>;
}
