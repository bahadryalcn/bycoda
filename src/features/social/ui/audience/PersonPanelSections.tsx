import { Text } from "../../../../shared/ui/Text";
import { useState } from "react";
import { t } from "../../../../shared/i18n";
import { Button } from "../../../../shared/ui/Button";
import { useConfirm } from "../../../../shared/ui/ConfirmDialog";
import { InlineError } from "../../../../shared/ui/InlineError";
import { Modal, ModalActions } from "../../../../shared/ui/Modal";
import { TagInput } from "../../../../shared/ui/TagInput";
import { TextField } from "../../../../shared/ui/TextField";
import { TextareaField } from "../../../../shared/ui/TextareaField";
import type { SocialPerson } from "../../model/audience";
import type { SocialClient } from "../../model/socialClient";
import type { PeopleUpdateInput } from "../../model/socialActions";
import { errorMessage, uniqueTags } from "./audienceModel";

export type PatchSaver = (patch: PeopleUpdateInput["patch"]) => Promise<boolean>;

/** Name, notes and tags. Name and notes save on blur; tags save when the list changes. */
export function PersonDetailsFields({
  person,
  disabled,
  save,
}: {
  person: SocialPerson;
  disabled: boolean;
  save: PatchSaver;
}) {
  const [name, setName] = useState(person.name);
  const [notes, setNotes] = useState(person.notes);
  return (
    <div className="audience-stack">
      <TextField
        label={t("Name")}
        value={name}
        disabled={disabled}
        onChange={(event) => setName(event.target.value)}
        onBlur={() => {
          const next = name.trim();
          if (next && next !== person.name) void save({ name: next }).catch(() => undefined);
          else setName(person.name);
        }}
      />
      <TagInput
        label={t("Tags")}
        placeholder={t("Add a tag")}
        value={person.tags}
        inputProps={{ disabled }}
        normalize={(values) => uniqueTags(values).slice(0, 40)}
        onValueChange={(values) => {
          void save({ tags: uniqueTags(values) }).catch(() => undefined);
        }}
      />
      <TextareaField
        label={t("Notes")}
        value={notes}
        minRows={3}
        maxRows={8}
        disabled={disabled}
        onChange={(event) => setNotes(event.target.value)}
        onBlur={() => {
          if (notes !== person.notes) void save({ notes }).catch(() => undefined);
        }}
      />
    </div>
  );
}

type Suggestion = { personIds: string[]; reason: string; score: number };

/** Possible duplicates across platforms. A merge always waits for an explicit confirmation. */
export function MergeSection({
  client,
  person,
  disabled,
  onMerged,
}: {
  client: SocialClient;
  person: SocialPerson;
  disabled: boolean;
  onMerged: (person: SocialPerson, removedIds: string[]) => void;
}) {
  const { confirm, dialog } = useConfirm();
  const [suggestions, setSuggestions] = useState<Suggestion[]>();
  const [error, setError] = useState<string>();
  const [checking, setChecking] = useState(false);

  async function findMatches() {
    setChecking(true);
    setError(undefined);
    try {
      const result = await client.people.matchSuggestions(person.id);
      setSuggestions(
        result.suggestions
          .map((item) => ({ ...item, personIds: item.personIds.filter((id) => id !== person.id) }))
          .filter((item) => item.personIds.length > 0),
      );
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setChecking(false);
    }
  }

  async function merge(item: Suggestion) {
    const ok = await confirm({
      title: t("Merge these people?"),
      message: t(
        "Their accounts, notes, tags and history move into {p0}. The other records are removed.",
        { p0: person.name },
      ),
      confirmLabel: t("Merge"),
      danger: false,
    });
    if (!ok) return;
    try {
      const merged = await client.people.merge({ targetId: person.id, sourceIds: item.personIds });
      setSuggestions((rows) => rows?.filter((row) => row !== item));
      onMerged(merged, item.personIds);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <div className="audience-stack">
      <div>
        <Button
          variant="secondary"
          size="sm"
          loading={checking}
          disabled={disabled}
          onClick={() => void findMatches().catch(() => undefined)}
        >
          {t("Find possible duplicates")}
        </Button>
      </div>
      {suggestions?.length === 0 ? (
        <Text as="p" size="caption" tone="muted" leading="inherit" className="audience-muted">
          {t("No possible duplicates found.")}
        </Text>
      ) : null}
      {suggestions?.map((item) => (
        <div key={item.personIds.join(",")} className="audience-row">
          <span>
            {t("{p0} possible match: {p1}", { p0: item.personIds.length, p1: item.reason })}
          </span>
          <Button
            variant="secondary"
            size="sm"
            disabled={disabled}
            onClick={() => void merge(item).catch((err: unknown) => setError(errorMessage(err)))}
          >
            {t("Merge into this person")}
          </Button>
        </div>
      ))}
      {error ? <InlineError>{error}</InlineError> : null}
      {dialog}
    </div>
  );
}

/** Export and deletion of one person's data. Deletion needs the typed confirmation. */
export function PersonDataSection({
  client,
  person,
  disabled,
  onDeleted,
}: {
  client: SocialClient;
  person: SocialPerson;
  disabled: boolean;
  onDeleted: (personId: string) => void;
}) {
  const { confirm, dialog } = useConfirm();
  const [exported, setExported] = useState<string>();
  const [error, setError] = useState<string>();

  async function exportPerson() {
    setError(undefined);
    try {
      const result = await client.people.export({ personId: person.id });
      setExported(result.json);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function deletePerson() {
    const ok = await confirm({
      title: t("Delete this person's data?"),
      message: t(
        "Name, accounts, notes, tags and history are removed. A record stays so they are never contacted again.",
      ),
      confirmLabel: t("Delete data"),
      requireText: { text: "DELETE_PERSON", label: t("Type DELETE_PERSON to confirm") },
      danger: true,
    });
    if (!ok) return;
    try {
      await client.people.delete(person.id);
      onDeleted(person.id);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <div className="audience-stack">
      <div className="audience-row">
        <Button
          variant="secondary"
          size="sm"
          disabled={disabled}
          onClick={() => void exportPerson().catch(() => undefined)}
        >
          {t("Export")}
        </Button>
        <Button
          variant="danger"
          size="sm"
          disabled={disabled}
          onClick={() => void deletePerson().catch((err: unknown) => setError(errorMessage(err)))}
        >
          {t("Delete person data")}
        </Button>
      </div>
      {error ? <InlineError>{error}</InlineError> : null}
      {exported !== undefined ? (
        <Modal
          title={t("Exported data")}
          description={t("Copy this text to keep a copy of the data.")}
          onClose={() => setExported(undefined)}
          size="lg"
          footer={
            <ModalActions>
              <Button variant="secondary" onClick={() => setExported(undefined)}>
                {t("Close")}
              </Button>
            </ModalActions>
          }
        >
          <TextareaField
            label={t("Exported data")}
            hideLabel
            value={exported}
            readOnly
            minRows={10}
            maxRows={20}
            monospace
          />
        </Modal>
      ) : null}
      {dialog}
    </div>
  );
}
