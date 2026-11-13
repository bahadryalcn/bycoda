import { projectKey } from "../../../shared/lib/paths";
import { useState } from "react";
import { useDictionaryDraft } from "../model/voiceSettingsDrafts";
import { loadVoiceSettings, normalizeVoiceSettings } from "../model/voiceSettings";
import { t, useLocale } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { InlineError } from "../../../shared/ui/InlineError";
import { TagInput } from "../../../shared/ui/TagInput";
import { TextField } from "../../../shared/ui/TextField";
import { Text } from "../../../shared/ui/Text";
import { AdvancedSettings, Row, Select } from "../../settings/public/settingsControls";
import { useRecents } from "../../projects/public/recents";
import { projectDisplayNameFrom, useProjectLabels } from "../../projects/public/projectNames";
import type { VoiceSettings } from "../model/voiceSettings";

type Entry = VoiceSettings["dictationDictionary"][number];

/** Owner-saved spelling and spoken aliases, with an explicit project or shared scope. */
export function DictationDictionarySettings({
  settings,
  change,
}: {
  settings: VoiceSettings;
  change: (patch: Partial<VoiceSettings>) => void;
}) {
  useLocale();
  const projects = useRecents();
  const labels = useProjectLabels();
  const [{ editing, term, aliases, projectId, editingRevision, conflict }, updateDraft] =
    useDictionaryDraft();
  const [removeError, setRemoveError] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const entries = settings.dictationDictionary;
  const begin = (index: number | "new") => {
    const entry = index === "new" ? undefined : entries[index];
    updateDraft({
      term: entry?.term ?? "",
      aliases: entry?.aliases ?? [],
      projectId: entry?.projectId ?? "",
      editing: index,
      editingRevision: JSON.stringify(entries),
      conflict: false,
    });
    setSaveError(false);
  };
  const save = (asNew = false) => {
    if (!term.trim() || editing === null) return;
    if ((asNew || editing === "new") && entries.length >= 500) return;
    if (!asNew && editing !== "new" && JSON.stringify(entries) !== editingRevision) {
      updateDraft({ conflict: true });
      return;
    }
    const entry: Entry = { term: term.trim(), aliases, ...(projectId ? { projectId } : {}) };
    const patch = {
      dictationDictionary:
        editing === "new" || asNew
          ? [...entries, entry]
          : entries.map((previous, index) => (index === editing ? entry : previous)),
    };
    try {
      change(patch);
      const expected = normalizeVoiceSettings({ ...settings, ...patch }).dictationDictionary;
      if (JSON.stringify(loadVoiceSettings().dictationDictionary) !== JSON.stringify(expected))
        throw new Error("Preference not persisted");
      updateDraft({ editing: null });
      setSaveError(false);
    } catch {
      setSaveError(true);
    }
  };
  const scopeOptions = [
    { value: "", label: t("Shared across projects") },
    ...projects.map(({ path }) => ({
      value: projectKey(path),
      label: projectDisplayNameFrom(path, labels),
    })),
    ...(projectId && !projects.some(({ path }) => projectKey(path) === projectId)
      ? [{ value: projectId, label: projectDisplayNameFrom(projectId, labels) }]
      : []),
  ];
  return (
    <AdvancedSettings
      title={t("Dictation dictionary")}
      settingIds={["dictation-dictionary"]}
      defaultOpen={editing !== null}
      keepMounted
    >
      <Row
        id="dictation-dictionary"
        label={t("Saved terms")}
        description={t(
          "Keep names and technical terms consistent. Aliases are replaced with your saved spelling.",
        )}
        stacked
      >
        <div className="flex min-w-0 flex-col gap-2">
          {removeError ? (
            <InlineError>{t("The term could not be removed. Try Remove again.")}</InlineError>
          ) : null}
          {entries.length === 0 ? (
            <EmptyState
              size="inline"
              title={t("No saved terms")}
              description={t("Add names or technical terms you use often.")}
            />
          ) : null}
          {entries.map((entry, index) => (
            <div key={index} className="flex min-w-0 flex-wrap items-start gap-2">
              <div className="min-w-0 flex-1 basis-64">
                <Text as="div" wrap="anywhere">
                  {entry.term}
                </Text>
                <Text as="div" size="caption" tone="secondary" wrap="anywhere">
                  {entry.projectId
                    ? projectDisplayNameFrom(entry.projectId, labels)
                    : t("Shared across projects")}
                  {entry.aliases.length ? ` · ${entry.aliases.join(", ")}` : ""}
                </Text>
              </div>
              <div className="flex shrink-0 gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={editing !== null}
                  onClick={() => begin(index)}
                  label={t("Edit {p0}", { p0: entry.term })}
                >
                  {t("Edit")}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  tone="danger"
                  disabled={editing !== null}
                  label={t("Remove {p0}", { p0: entry.term })}
                  onClick={() => {
                    const dictationDictionary = entries.filter((_, item) => item !== index);
                    try {
                      change({ dictationDictionary });
                      setRemoveError(
                        JSON.stringify(loadVoiceSettings().dictationDictionary) !==
                          JSON.stringify(dictationDictionary),
                      );
                    } catch {
                      setRemoveError(true);
                    }
                  }}
                >
                  {t("Remove")}
                </Button>
              </div>
            </div>
          ))}
          {editing === null ? (
            <div>
              <Button
                variant="secondary"
                size="sm"
                disabled={entries.length >= 500}
                onClick={() => begin("new")}
              >
                {t("Add term")}
              </Button>
            </div>
          ) : (
            <div className="flex min-w-0 flex-col gap-3">
              <TextField
                label={t("Preferred spelling")}
                value={term}
                maxLength={200}
                onChange={(event) => updateDraft({ term: event.target.value })}
                autoFocus
                autoComplete="off"
              />
              <TagInput
                label={t("Spoken aliases")}
                value={aliases}
                maxTags={30}
                placeholder={t("Type an alias and press Enter")}
                inputProps={{ maxLength: 200 }}
                onValueChange={(aliases) => updateDraft({ aliases })}
              />
              <Select
                label={t("Dictionary scope")}
                value={projectId}
                options={scopeOptions}
                onChange={(projectId) => updateDraft({ projectId })}
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  disabled={!term.trim() || (editing === "new" && entries.length >= 500)}
                  onClick={() => save()}
                >
                  {t("Save term")}
                </Button>
                {conflict ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={!term.trim() || entries.length >= 500}
                    onClick={() => save(true)}
                  >
                    {t("Add as new term")}
                  </Button>
                ) : null}
                <Button variant="ghost" size="sm" onClick={() => updateDraft({ editing: null })}>
                  {t("Cancel")}
                </Button>
              </div>
              {saveError ? (
                <InlineError>
                  {t("The term could not be saved. Your draft is kept. Try Save term again.")}
                </InlineError>
              ) : null}
              {conflict ? (
                <InlineError>
                  {t(
                    "The dictionary changed while you were editing. Your draft is kept. Add it as a new term or cancel.",
                  )}
                </InlineError>
              ) : null}
            </div>
          )}
        </div>
      </Row>
    </AdvancedSettings>
  );
}
