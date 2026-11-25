import { ErrorDetails } from "../../../shared/ui/ErrorDetails";
import { surfaceAttributes } from "../../../shared/ui/Surface";
import { Text } from "../../../shared/ui/Text";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { TextareaField } from "../../../shared/ui/TextareaField";
import { TextField } from "../../../shared/ui/TextField";
import { SearchInput } from "../../../shared/ui/SearchInput";
import { Button } from "../../../shared/ui/Button";
import { LiveText } from "../../../shared/ui/LiveText";
import { InfoPopover } from "../../../shared/ui/InfoPopover";
import { t, useLocale } from "../../../shared/i18n";
import { Plus } from "../../../shared/ui/icons";
import { Group, Row, SettingsFeedback, SettingsSaveBar } from "../../../shared/ui/settings";
import { errorText } from "../../../shared/lib/errors";
import { templateChanges } from "./templatesChanges";
import {
  CURSOR_PLACEHOLDER,
  loadPromptTemplates,
  MAX_TEMPLATE_BODY,
  MAX_TEMPLATES,
  savePromptTemplates,
  subscribePromptTemplates,
  TRIGGER_PREFIX,
  isValidTrigger,
  normalizeTrigger,
  type PromptTemplate,
} from "../../sessions/public/promptTemplates";

function sameTemplates(a: readonly PromptTemplate[], b: readonly PromptTemplate[]) {
  return (
    a.length === b.length &&
    a.every((row, index) => {
      const other = b[index];
      return (
        !!other &&
        row.id === other.id &&
        row.name === other.name &&
        row.body === other.body &&
        (row.trigger ?? "") === (other.trigger ?? "")
      );
    })
  );
}
// Window-local, unsaved authoring state survives Settings navigation/Escape.
let retainedDraft: {
  rows: PromptTemplate[];
  baseline: readonly PromptTemplate[];
  selected: string | null;
} | null = null;
export function clearRetainedTemplateDraft() {
  retainedDraft = null;
}
// Cached per stored string: the render path asks on every keystroke, and only a changed raw value needs a parse.
let storageCheck: { raw: string | null; available: boolean } | null = null;
function checkTemplateStorage(raw: string | null) {
  try {
    const parsed: unknown = JSON.parse(raw ?? "[]");
    if (!Array.isArray(parsed)) return false;
    return (
      parsed.length === loadPromptTemplates().length &&
      parsed.every(
        (item) =>
          item &&
          typeof item.id === "string" &&
          typeof item.name === "string" &&
          typeof item.body === "string",
      )
    );
  } catch {
    return false;
  }
}
function templateStorageAvailable() {
  let raw: string | null;
  try {
    raw = localStorage.getItem("bycoda.promptTemplates");
  } catch {
    return false;
  }
  if (storageCheck?.raw !== raw) storageCheck = { raw, available: checkTemplateStorage(raw) };
  return storageCheck.available;
}

type TemplateProblem = { field: "name" | "body" | "trigger"; message: string };

// One rule per message, so the user can see which field broke and why.
function templateProblem(
  row: PromptTemplate,
  triggers: ReadonlySet<string>,
): TemplateProblem | null {
  const trigger = normalizeTrigger(row.trigger);
  if (!row.name.trim()) return { field: "name", message: t("Enter a name.") };
  if (!row.body.trim()) return { field: "body", message: t("Enter template text.") };
  if (row.body.length > MAX_TEMPLATE_BODY) {
    return {
      field: "body",
      message: t("Use at most {p0} characters.", { p0: String(MAX_TEMPLATE_BODY) }),
    };
  }
  if (trigger && !isValidTrigger(trigger)) {
    return {
      field: "trigger",
      message: t("Use 1 to 24 letters, numbers or dashes for the trigger."),
    };
  }
  if (trigger && triggers.has(trigger)) {
    return { field: "trigger", message: t("This trigger is already used by another template.") };
  }
  return null;
}

export function TemplatesSettings() {
  useLocale();
  const saved = useSyncExternalStore(
    subscribePromptTemplates,
    loadPromptTemplates,
    loadPromptTemplates,
  );
  const [rows, setRows] = useState<PromptTemplate[]>(() => retainedDraft?.rows ?? [...saved]);
  const [baseline, setBaseline] = useState(() => retainedDraft?.baseline ?? saved);
  const [selectedId, setSelectedId] = useState<string | null>(
    () => retainedDraft?.selected ?? saved[0]?.id ?? null,
  );
  const [query, setQuery] = useState("");
  const [error, setError] = useState<{ title: string; detail?: string } | null>(null);
  const [fieldError, setFieldError] = useState<{
    id: string;
    field: "name" | "body" | "trigger";
  } | null>(null);
  const [savedMessage, setSavedMessage] = useState(false);
  const [, reread] = useState(0);
  const nameRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const triggerRef = useRef<HTMLInputElement>(null);
  const dirty = !sameTemplates(rows, baseline);
  const changedElsewhere = !sameTemplates(saved, baseline);
  // Read during render through the store, so a storage change re-renders without a per-keystroke parse.
  const available = useSyncExternalStore(
    subscribePromptTemplates,
    templateStorageAvailable,
    templateStorageAvailable,
  );
  const selected = rows.find((row) => row.id === selectedId) ?? rows[0];
  const matches = query.trim()
    ? rows.filter((row) =>
        [row.name, row.trigger ?? "", row.body]
          .join(" ")
          .toLocaleLowerCase()
          .includes(query.trim().toLocaleLowerCase()),
      )
    : rows;
  useEffect(() => {
    retainedDraft = dirty ? { rows, baseline, selected: selectedId } : null;
  }, [rows, baseline, selectedId, dirty]);
  useEffect(() => {
    if (!changedElsewhere || dirty || !available) return;
    setRows([...saved]);
    setBaseline(saved);
  }, [saved, changedElsewhere, dirty, available]);
  const update = (id: string, patch: Partial<PromptTemplate>) => {
    setSavedMessage(false);
    setError(null);
    setFieldError(null);
    setRows((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  };
  const editRows = (next: PromptTemplate[]) => {
    setSavedMessage(false);
    setError(null);
    setFieldError(null);
    setRows(next);
  };
  const reload = () => {
    if (!templateStorageAvailable()) {
      setError({ title: t("Template storage is unavailable. Retry reading before saving.") });
      return;
    }
    const current = loadPromptTemplates();
    setRows([...current]);
    setBaseline(current);
    setSelectedId(current[0]?.id ?? null);
    setError(null);
    setSavedMessage(false);
    retainedDraft = null;
  };
  /** True only once storage returns what was written; any refusal keeps the rows. */
  const save = (): boolean => {
    if (!templateStorageAvailable()) {
      setError({ title: t("Template storage is unavailable. Retry reading before saving.") });
      return false;
    }
    if (!sameTemplates(loadPromptTemplates(), baseline)) {
      setError({
        title: t(
          "Templates changed in another window. Reload before saving to avoid overwriting those changes.",
        ),
      });
      return false;
    }
    const triggers = new Set<string>();
    for (const row of rows) {
      const problem = templateProblem(row, triggers);
      if (problem) {
        setFieldError({ id: row.id, field: problem.field });
        setSelectedId(row.id);
        setError({ title: problem.message });
        requestAnimationFrame(() =>
          (problem.field === "name"
            ? nameRef.current
            : problem.field === "body"
              ? bodyRef.current
              : triggerRef.current
          )?.focus(),
        );
        return false;
      }
      const trigger = normalizeTrigger(row.trigger);
      if (trigger) triggers.add(trigger);
    }
    try {
      // A write that throws is the only refusal storage gives; returning is the acknowledgment.
      savePromptTemplates(rows);
      const current = loadPromptTemplates();
      setRows([...current]);
      setBaseline(current);
      setError(null);
      setSavedMessage(true);
      retainedDraft = null;
      return true;
    } catch (reason) {
      setError({ title: t("Could not save templates."), detail: errorText(reason) });
      return false;
    }
  };
  const addTemplate = () => {
    const row = { id: crypto.randomUUID(), name: "", body: "" };
    setRows((current) => [...current, row]);
    setSelectedId(row.id);
    setQuery("");
    setError(null);
    setSavedMessage(false);
  };
  const addButton = (
    <Button
      variant="ghost"
      disabled={!available || rows.length >= MAX_TEMPLATES}
      onClick={addTemplate}
    >
      <Plus strokeWidth={1.75} />
      {t("Add template")}
    </Button>
  );
  const listed = dirty ? templateChanges(rows, baseline, editRows) : [];
  // Anything the list does not name still counts, so Save never hides behind a clean count.
  const changes = dirty && !listed.length ? [{ id: "other", label: t("Other changes") }] : listed;
  const empty = rows.length === 0;
  const showPanel = !empty || dirty || changedElsewhere || !available || error != null;
  return (
    <Group
      id="prompt-templates"
      title={t("Prompt templates")}
      layout="full"
      info={
        <InfoPopover className="shrink-0" label={t("How to use templates")}>
          <p>
            {t(
              "Pick a template from the / menu, or type {p0} followed by a space. Use {p1} to set the caret position.",
              { p0: TRIGGER_PREFIX + "trigger", p1: CURSOR_PLACEHOLDER },
            )}
          </p>
          <p>
            {t(
              "Name and text are required. The trigger is optional. Up to {p0} templates, with {p1} characters each.",
              { p0: String(MAX_TEMPLATES), p1: String(MAX_TEMPLATE_BODY) },
            )}
          </p>
        </InfoPopover>
      }
      action={empty ? undefined : addButton}
    >
      {empty ? <Row label={t("No templates yet")}>{addButton}</Row> : null}
      {showPanel ? (
        <div className="settings-templates">
          {!available ? (
            <SettingsFeedback
              state="error"
              action={{
                label: t("Retry"),
                onClick: () => {
                  if (templateStorageAvailable()) setError(null);
                  reread((value) => value + 1);
                },
              }}
            >
              {t("Template storage is unavailable. Retry reading before saving.")}
            </SettingsFeedback>
          ) : null}
          {!empty ? (
            <div
              {...surfaceAttributes(
                { frame: "card", edge: "all", radius: "card" },
                "template-manager",
              )}
            >
              <div className="template-manager-nav">
                <SearchInput
                  appearance="field"
                  aria-label={t("Search prompt templates")}
                  placeholder={t("Search prompt templates")}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
                <LiveText
                  className="template-manager-count"
                  size="caption"
                  tone="secondary"
                  leading="inherit"
                  text={
                    query.trim()
                      ? t("{p0} of {p1} templates", {
                          p0: String(matches.length),
                          p1: String(rows.length),
                        })
                      : t("{p0} templates (up to {p1})", {
                          p0: String(rows.length),
                          p1: String(MAX_TEMPLATES),
                        })
                  }
                />
                <div
                  className="template-manager-list flex flex-col gap-1"
                  role="group"
                  aria-label={t("Prompt templates")}
                >
                  {matches.map((row) => (
                    <Button
                      key={row.id}
                      variant="item"
                      align="start"
                      fullWidth
                      pressed={row.id === selected?.id}
                      onClick={() => setSelectedId(row.id)}
                    >
                      <span className="template-manager-item">
                        <Text as="span" size="inherit" tone="inherit" truncate>
                          {row.name || t("New template")}
                        </Text>
                        {row.trigger ? (
                          <Text
                            size="caption"
                            tone="secondary"
                            leading="inherit"
                            className="template-manager-item-trigger"
                          >
                            {TRIGGER_PREFIX}
                            {normalizeTrigger(row.trigger)}
                          </Text>
                        ) : null}
                      </span>
                    </Button>
                  ))}
                  {!matches.length && available ? (
                    <SettingsFeedback state="empty" presentation="inset">
                      {t("No matching templates")}
                    </SettingsFeedback>
                  ) : null}
                </div>
              </div>
              {selected ? (
                <div
                  {...surfaceAttributes(
                    { frame: "pane", edge: "responsive-start" },
                    "template-manager-editor",
                  )}
                >
                  <TextField
                    ref={nameRef}
                    label={t("Template name")}
                    aria-label={t("Template name")}
                    error={
                      fieldError?.id === selected.id && fieldError.field === "name"
                        ? error?.title
                        : undefined
                    }
                    value={selected.name}
                    onChange={(event) => update(selected.id, { name: event.target.value })}
                    spellCheck={false}
                    autoComplete="off"
                  />
                  <TextField
                    ref={triggerRef}
                    label={t("Template trigger")}
                    aria-label={t("Template trigger")}
                    error={
                      fieldError?.id === selected.id && fieldError.field === "trigger"
                        ? error?.title
                        : undefined
                    }
                    value={selected.trigger ?? ""}
                    onChange={(event) => update(selected.id, { trigger: event.target.value })}
                    placeholder={t("trigger (optional)")}
                    spellCheck={false}
                    autoComplete="off"
                  />
                  <TextareaField
                    ref={bodyRef}
                    label={t("Template text")}
                    aria-label={t("Template text")}
                    error={
                      fieldError?.id === selected.id && fieldError.field === "body"
                        ? error?.title
                        : undefined
                    }
                    value={selected.body}
                    onChange={(event) => update(selected.id, { body: event.target.value })}
                    rows={8}
                    maxLength={MAX_TEMPLATE_BODY}
                    spellCheck={false}
                  />
                  <Button
                    variant="ghost"
                    tone="danger"
                    onClick={() => {
                      setRows((current) => current.filter((row) => row.id !== selected.id));
                      setError(null);
                      setSavedMessage(false);
                    }}
                  >
                    {t("Delete template")}
                  </Button>
                </div>
              ) : null}
            </div>
          ) : null}
          <SettingsSaveBar
            id="prompt-templates"
            title={t("Prompt templates")}
            changes={changes}
            pending={false}
            saved={savedMessage && !error}
            canSave={available && !changedElsewhere}
            saveLabel={t("Save templates")}
            discardLabel={t("Discard changes and reload")}
            discardEnabled={dirty || changedElsewhere}
            onDiscard={reload}
            onSave={save}
          >
            {/* A validation error is already announced on its field; do not announce it twice. */}
            {error && !(selected && fieldError?.id === selected.id) ? (
              <SettingsFeedback
                state="error"
                extra={error.detail ? <ErrorDetails detail={error.detail} /> : undefined}
              >
                {error.title}
              </SettingsFeedback>
            ) : null}
            {changedElsewhere && dirty ? (
              <SettingsFeedback state="warning">
                {t(
                  "Templates changed in another window. Reload before saving to avoid overwriting those changes.",
                )}
              </SettingsFeedback>
            ) : null}
          </SettingsSaveBar>
        </div>
      ) : null}
    </Group>
  );
}
