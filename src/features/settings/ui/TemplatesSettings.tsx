import { t, useLocale } from "../../../shared/i18n";
import { useEffect, useState, useSyncExternalStore } from "react";
import { Plus, Trash2 } from "../../../shared/ui/icons";
import { Group } from "./settingsControls";
import {
  CURSOR_PLACEHOLDER,
  loadPromptTemplates,
  MAX_TEMPLATE_BODY,
  MAX_TEMPLATES,
  savePromptTemplates,
  subscribePromptTemplates,
  TRIGGER_PREFIX,
  type PromptTemplate,
} from "../../sessions/model/promptTemplates";

const FIELD =
  "rounded-md border border-content/10 bg-transparent px-2 text-[12px] text-content placeholder:text-content/35 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

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

/** Settings page for saved prompt snippets, inserted from the composer's slash picker or `;trigger`. */
export function TemplatesSettings() {
  useLocale();
  const saved = useSyncExternalStore(subscribePromptTemplates, loadPromptTemplates, () => []);
  const [rows, setRows] = useState<PromptTemplate[]>(() => [...saved]);
  const [baseline, setBaseline] = useState(saved);
  const [error, setError] = useState<string | null>(null);
  const [savedMessage, setSavedMessage] = useState(false);
  const dirty = !sameTemplates(rows, baseline);
  const changedElsewhere = !sameTemplates(saved, baseline);

  useEffect(() => {
    if (!changedElsewhere || dirty) return;
    setRows([...saved]);
    setBaseline(saved);
  }, [saved, changedElsewhere, dirty]);

  const update = (id: string, patch: Partial<PromptTemplate>) => {
    setSavedMessage(false);
    setError(null);
    setRows((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  };

  const save = () => {
    if (changedElsewhere) return;
    try {
      savePromptTemplates(rows);
      setError(null);
      // Re-read so names and triggers show as they were stored.
      setRows([...loadPromptTemplates()]);
      setBaseline(loadPromptTemplates());
      setSavedMessage(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <Group
      id="prompt-templates"
      title={t("Prompt templates")}
      layout="full"
      description={t(
        "Pick a template from the / menu, or type {p0} followed by a space. Use {p1} to set the caret position.",
        {
          p0: `${TRIGGER_PREFIX}trigger`,
          p1: CURSOR_PLACEHOLDER,
        },
      )}
      scope={t("Available in the composer across projects in this app.")}
      persistence={{
        mode: "explicit",
        state: error ? "error" : dirty ? "dirty" : savedMessage ? "saved" : "idle",
        error,
      }}
      action={
        <button
          type="button"
          disabled={rows.length >= MAX_TEMPLATES}
          onClick={() => {
            setSavedMessage(false);
            setError(null);
            setRows((current) => [...current, { id: crypto.randomUUID(), name: "", body: "" }]);
          }}
          className="flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-content/10 px-2.5 text-[12px] text-content/80 hover:bg-content/10 hover:text-content disabled:cursor-default disabled:opacity-40"
        >
          <Plus className="size-3.5" strokeWidth={1.75} />
          {t("Add template")}
        </button>
      }
    >
      <div className="settings-templates">
        <p className="px-4 py-3 text-[12px] text-content/65">
          {t(
            "Name and text are required. The trigger is optional. Up to {p0} templates, with {p1} characters each.",
            {
              p0: String(MAX_TEMPLATES),
              p1: String(MAX_TEMPLATE_BODY),
            },
          )}
        </p>
        <div>
          {rows.length === 0 ? (
            <p className="px-4 py-3 text-[12px] text-content/45">{t("No templates yet")}</p>
          ) : (
            rows.map((row) => (
              <div
                key={row.id}
                className="flex flex-col gap-2 border-b border-content/5 px-4 py-3 last:border-b-0"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <label className="flex min-w-0 flex-1 basis-40 flex-col gap-1 text-[12px] text-content/65">
                    {t("Template name")}
                    <input
                      value={row.name}
                      onChange={(event) => update(row.id, { name: event.target.value })}
                      placeholder={t("Name")}
                      aria-label={t("Template name")}
                      spellCheck={false}
                      autoComplete="off"
                      className={`${FIELD} h-7 min-w-0 w-full`}
                    />
                  </label>
                  <label className="flex w-36 max-w-full flex-col gap-1 text-[12px] text-content/65">
                    {t("Template trigger")}
                    <span className="flex h-7 items-center gap-1 rounded-md border border-content/10 px-2">
                      {TRIGGER_PREFIX}
                      <input
                        value={row.trigger ?? ""}
                        onChange={(event) => update(row.id, { trigger: event.target.value })}
                        placeholder={t("trigger (optional)")}
                        aria-label={t("Template trigger")}
                        spellCheck={false}
                        autoComplete="off"
                        className="min-w-0 flex-1 bg-transparent text-content placeholder:text-content/35 focus-visible:outline-2 focus-visible:outline-accent"
                      />
                    </span>
                  </label>
                  <button
                    type="button"
                    title={t("Delete template")}
                    aria-label={t("Delete template")}
                    onClick={() => {
                      setSavedMessage(false);
                      setError(null);
                      setRows((current) => current.filter((item) => item.id !== row.id));
                    }}
                    className="grid size-7 shrink-0 place-items-center rounded-md text-content/45 hover:bg-content/10 hover:text-content"
                  >
                    <Trash2 className="size-3.5" strokeWidth={1.75} />
                  </button>
                </div>
                <label className="flex flex-col gap-1 text-[12px] text-content/65">
                  {t("Template text")}
                  <textarea
                    value={row.body}
                    onChange={(event) => update(row.id, { body: event.target.value })}
                    placeholder={t('Text to insert, e.g. "Review {p0} for bugs"', {
                      p0: CURSOR_PLACEHOLDER,
                    })}
                    aria-label={t("Template text")}
                    rows={3}
                    maxLength={MAX_TEMPLATE_BODY}
                    spellCheck={false}
                    className={`${FIELD} min-h-16 w-full resize-y py-1.5 font-mono leading-5`}
                  />
                </label>
              </div>
            ))
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3 px-4 py-3">
          <button
            type="button"
            disabled={!dirty || changedElsewhere}
            onClick={save}
            className="primary-action h-7 rounded-md px-3 text-[12px] font-medium disabled:cursor-default disabled:opacity-40"
          >
            {t("Save templates")}
          </button>
          {dirty && !error && !changedElsewhere ? (
            <span className="text-[12px] text-content/45">{t("Unsaved changes")}</span>
          ) : null}
          {error ? (
            <span role="alert" className="text-[12px] text-danger">
              {error}
            </span>
          ) : null}
        </div>
        {changedElsewhere && dirty ? (
          <div role="alert" className="flex flex-wrap items-center gap-3 py-3 text-[12px]">
            <span>
              {t(
                "Templates changed in another window. Reload before saving to avoid overwriting those changes.",
              )}
            </span>
            <button
              type="button"
              onClick={() => {
                setRows([...saved]);
                setBaseline(saved);
                setError(null);
                setSavedMessage(false);
              }}
              className="rounded-md border border-content/10 px-3 py-1.5 active:bg-content/10 focus-visible:outline-2 focus-visible:outline-accent"
            >
              {t("Discard changes and reload")}
            </button>
          </div>
        ) : null}
      </div>
    </Group>
  );
}
