import { SettingsFeedback } from "./settingsControls";

import { TextareaField } from "../../../shared/ui/TextareaField";
import { TextField } from "../../../shared/ui/TextField";
import { Button } from "../../../shared/ui/Button";
import { t, useLocale } from "../../../shared/i18n";
import { useEffect, useState, useSyncExternalStore } from "react";
import { Plus, Trash2 } from "../../../shared/ui/icons";
import { AdvancedSettings, Group } from "./settingsControls";
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
      persistence={{
        mode: "explicit",
        state: error ? "error" : dirty ? "dirty" : savedMessage ? "saved" : "idle",
        error,
      }}
      action={
        <Button
          variant="ghost"
          size="sm"
          type="button"
          disabled={rows.length >= MAX_TEMPLATES}
          onClick={() => {
            setSavedMessage(false);
            setError(null);
            setRows((current) => [...current, { id: crypto.randomUUID(), name: "", body: "" }]);
          }}
        >
          <Plus className="icon-sm" strokeWidth={1.75} />
          {t("Add template")}
        </Button>
      }
    >
      <div className="settings-templates">
        <AdvancedSettings defaultOpen={false} title={t("How to use templates")}>
          <p className="chat-detail">
            {t(
              "Pick a template from the / menu, or type {p0} followed by a space. Use {p1} to set the caret position.",
              { p0: `${TRIGGER_PREFIX}trigger`, p1: CURSOR_PLACEHOLDER },
            )}
          </p>
          <p className="chat-detail">
            {t("Available in the composer across projects in this app.")}
          </p>
          <p className="chat-detail">
            {t(
              "Name and text are required. The trigger is optional. Up to {p0} templates, with {p1} characters each.",
              {
                p0: String(MAX_TEMPLATES),
                p1: String(MAX_TEMPLATE_BODY),
              },
            )}
          </p>
        </AdvancedSettings>
        <div>
          {rows.length === 0 ? (
            <p className="px-4 py-3 text-ui-caption text-(--ui-text-muted)">
              {t("No templates yet")}
            </p>
          ) : (
            rows.map((row) => (
              <div
                key={row.id}
                className="@container/template-entry flex flex-col gap-2 border-b border-stroke px-4 py-3 last:border-b-0"
              >
                <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2 @min-[480px]/template-entry:grid-cols-[minmax(0,1fr)_9rem_auto]">
                  <label className="flex min-w-0 flex-col gap-1 text-ui-caption text-(--ui-text-secondary)">
                    {t("Template name")}
                    <TextField
                      hideLabel
                      label={t("Template name")}
                      value={row.name}
                      onChange={(event) => update(row.id, { name: event.target.value })}
                      placeholder={t("Name")}
                      spellCheck={false}
                      autoComplete="off"
                    />
                  </label>
                  <label className="col-start-1 row-start-2 flex w-36 max-w-full flex-col gap-1 text-ui-caption text-(--ui-text-secondary) @min-[480px]/template-entry:col-start-2 @min-[480px]/template-entry:row-start-1">
                    <span>
                      {t("Template trigger")} <span aria-hidden>({TRIGGER_PREFIX})</span>
                    </span>
                    <TextField
                      hideLabel
                      label={t("Template trigger")}
                      value={row.trigger ?? ""}
                      onChange={(event) => update(row.id, { trigger: event.target.value })}
                      placeholder={t("trigger (optional)")}
                      spellCheck={false}
                      autoComplete="off"
                    />
                  </label>
                  <Button
                    className="col-start-2 row-start-1 @min-[480px]/template-entry:col-start-3"
                    variant="ghost"
                    size="sm"
                    tone="danger"
                    iconOnly
                    label={t("Delete template")}
                    type="button"
                    onClick={() => {
                      setSavedMessage(false);
                      setError(null);
                      setRows((current) => current.filter((item) => item.id !== row.id));
                    }}
                  >
                    <Trash2 className="icon-sm" strokeWidth={1.75} />
                  </Button>
                </div>
                <label className="flex flex-col gap-1 text-ui-caption text-(--ui-text-secondary)">
                  {t("Template text")}
                  <TextareaField
                    hideLabel
                    label={t("Template text")}
                    value={row.body}
                    onChange={(event) => update(row.id, { body: event.target.value })}
                    placeholder={t('Text to insert, e.g. "Review {p0} for bugs"', {
                      p0: CURSOR_PLACEHOLDER,
                    })}
                    rows={3}
                    maxLength={MAX_TEMPLATE_BODY}
                    spellCheck={false}
                  />
                </label>
              </div>
            ))
          )}
        </div>
        {rows.length > 0 || dirty || savedMessage ? (
          <div className="flex flex-wrap items-center gap-3 px-4 py-3">
            <Button
              variant="primary"
              size="sm"
              type="button"
              disabled={!dirty || changedElsewhere}
              onClick={save}
            >
              {t("Save templates")}
            </Button>
            {dirty && !error && !changedElsewhere ? (
              <span className="text-ui-caption text-(--ui-text-muted)">{t("Unsaved changes")}</span>
            ) : null}
            {error ? <SettingsFeedback state="error">{error}</SettingsFeedback> : null}
          </div>
        ) : null}
        {changedElsewhere && dirty ? (
          <SettingsFeedback state="error">
            <span>
              {t(
                "Templates changed in another window. Reload before saving to avoid overwriting those changes.",
              )}
            </span>
            <Button
              variant="ghost"
              size="sm"
              type="button"
              onClick={() => {
                setRows([...saved]);
                setBaseline(saved);
                setError(null);
                setSavedMessage(false);
              }}
            >
              {t("Discard changes and reload")}
            </Button>
          </SettingsFeedback>
        ) : null}
      </div>
    </Group>
  );
}
