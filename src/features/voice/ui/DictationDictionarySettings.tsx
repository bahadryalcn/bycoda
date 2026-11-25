import { projectKey } from "../../../shared/lib/paths";
import { useState } from "react";
import { useDictionaryDraft } from "../model/voiceSettingsDrafts";
import { loadVoiceSettings, normalizeVoiceSettings } from "../model/voiceSettings";
import { t, useLocale } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { ContinuousList } from "../../../shared/ui/ContinuousList";
import { EmptyState } from "../../../shared/ui/EmptyState";
import { InlineError, InlineMessage } from "../../../shared/ui/InlineError";
import { TagInput } from "../../../shared/ui/TagInput";
import { TextField } from "../../../shared/ui/TextField";
import { Text } from "../../../shared/ui/Text";
import { Row, Select } from "../../../shared/ui/settings";
import { useRecents } from "../../projects/public/recents";
import { projectDisplayNameFrom, useProjectLabels } from "../../projects/public/projectNames";
import type { VoiceSettings } from "../model/voiceSettings";

type Entry = VoiceSettings["dictationDictionary"][number];

/** Stored dictionaries are clamped to this many entries by the settings model. */
const DICTIONARY_LIMIT = 500;

/** Same spelling in the same scope; case and surrounding spaces do not make a different term. */
function scopedTermKey(entry: Pick<Entry, "term" | "projectId">) {
  return `${entry.projectId ?? ""}\n${entry.term.trim().toLowerCase()}`;
}

function hasDuplicate(entries: readonly Entry[], candidate: Entry, ignoredIndex: number | null) {
  const key = scopedTermKey(candidate);
  return entries.some((entry, index) => index !== ignoredIndex && scopedTermKey(entry) === key);
}

/**
 * Row identity from term and scope, so a row keeps its DOM when other rows change. Legacy
 * duplicates that already exist in storage get an occurrence suffix to keep keys unique.
 */
function rowIdentities(entries: readonly Entry[]) {
  const seen = new Map<string, number>();
  return entries.map((entry, index) => {
    const base = scopedTermKey(entry);
    const occurrence = (seen.get(base) ?? 0) + 1;
    seen.set(base, occurrence);
    return {
      entry,
      index,
      key: occurrence === 1 ? base : `${base}\n${occurrence}`,
    };
  });
}

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
  const rows = rowIdentities(entries);
  const editingIndex = typeof editing === "number" ? editing : null;
  const full = entries.length >= DICTIONARY_LIMIT;
  const candidate: Entry = {
    term: term.trim(),
    aliases,
    ...(projectId ? { projectId } : {}),
  };
  const hasTerm = term.trim() !== "";
  // A conflict re-saves as a new term, so the entry being edited no longer counts as its own copy.
  const duplicateError =
    editing !== null && hasTerm && hasDuplicate(entries, candidate, conflict ? null : editingIndex);
  const duplicateAnywhere = hasTerm && hasDuplicate(entries, candidate, null);
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
    if ((asNew || editing === "new") && entries.length >= DICTIONARY_LIMIT) return;
    if (!asNew && editing !== "new" && JSON.stringify(entries) !== editingRevision) {
      updateDraft({ conflict: true });
      return;
    }
    if (hasDuplicate(entries, candidate, asNew ? null : editingIndex)) return;
    const entry = candidate;
    const patch = {
      dictationDictionary:
        editing === "new" || asNew
          ? [...entries, entry]
          : entries.map((previous, index) => (index === editing ? entry : previous)),
    };
    try {
      change(patch);
      const expected = normalizeVoiceSettings({
        ...settings,
        ...patch,
      }).dictationDictionary;
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
        ) : (
          <>
            <Text as="div" size="caption" tone="secondary">
              {t("{p0} of {p1} terms saved", {
                p0: String(entries.length),
                p1: String(DICTIONARY_LIMIT),
              })}
            </Text>
            <ContinuousList
              stateKey="voice-dictation-dictionary"
              label={t("Saved terms")}
              items={rows}
              itemKey={(row) => row.key}
              requiredKey={editingIndex === null ? null : (rows[editingIndex]?.key ?? null)}
              renderItem={({ entry, index }) => (
                <div className="flex min-w-0 flex-wrap items-start gap-2">
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
              )}
            />
          </>
        )}
        {editing === null ? (
          <div className="flex min-w-0 flex-col gap-2">
            <div>
              <Button variant="secondary" size="sm" disabled={full} onClick={() => begin("new")}>
                {t("Add term")}
              </Button>
            </div>
            {full ? (
              <InlineMessage tone="warning">
                {t("The dictionary is full at {p0} terms. Remove a term to add another.", {
                  p0: String(DICTIONARY_LIMIT),
                })}
              </InlineMessage>
            ) : null}
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
                disabled={!hasTerm || (editing === "new" && full) || duplicateError}
                onClick={() => save()}
              >
                {t("Save term")}
              </Button>
              {conflict ? (
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={!hasTerm || full || duplicateAnywhere}
                  onClick={() => save(true)}
                >
                  {t("Add as new term")}
                </Button>
              ) : null}
              <Button variant="ghost" size="sm" onClick={() => updateDraft({ editing: null })}>
                {t("Cancel")}
              </Button>
            </div>
            {duplicateError ? (
              <InlineError>
                {t("This term is already saved in this scope. Edit the saved term instead.")}
              </InlineError>
            ) : null}
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
  );
}
