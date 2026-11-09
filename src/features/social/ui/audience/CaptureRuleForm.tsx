import { useState } from "react";
import { t } from "../../../../shared/i18n";
import { Button } from "../../../../shared/ui/Button";
import { InlineError } from "../../../../shared/ui/InlineError";
import { Modal, ModalActions } from "../../../../shared/ui/Modal";
import { NumberField } from "../../../../shared/ui/NumberField";
import { TagInput } from "../../../../shared/ui/TagInput";
import { TextField } from "../../../../shared/ui/TextField";
import type { CaptureRule, CaptureSource, SocialList } from "../../model/audience";
import type { SocialAccount } from "../../model/social";
import { SOCIAL_PLATFORM_NAMES } from "../../model/social";
import type { Sequence } from "../../model/outreach";
import type { SocialClient } from "../../model/socialClient";
import { DisabledReason } from "../common/DisabledReason";
import { LabeledSelect } from "./LabeledSelect";
import { errorMessage, uniqueTags } from "./audienceModel";
import {
  FIND_PEOPLE_KINDS,
  buildFindPeopleSource,
  captureSourceLabel,
  emptyFindPeopleForm,
  findPeopleNeeds,
  type CaptureSourceKind,
  type FindPeopleForm,
} from "./findPeopleSource";

type ActionKind = "none" | "tag" | "enroll";
type Sentiment = "" | "positive" | "neutral" | "negative";

export type CaptureRuleFormProps = {
  client: SocialClient;
  accounts: readonly SocialAccount[];
  lists: readonly SocialList[];
  sequences: readonly Sequence[];
  onClose: () => void;
  onSaved: (rule: CaptureRule) => void;
};

/** A new rule is saved turned off. The owner turns it on from the rule list. */
export function CaptureRuleForm({
  client,
  accounts,
  lists,
  sequences,
  onClose,
  onSaved,
}: CaptureRuleFormProps) {
  const [name, setName] = useState("");
  const [source, setSource] = useState<FindPeopleForm>(() => emptyFindPeopleForm(accounts[0]?.id));
  const [keywords, setKeywords] = useState<string[]>([]);
  const [language, setLanguage] = useState("");
  const [minFollowers, setMinFollowers] = useState("");
  const [sentiment, setSentiment] = useState<Sentiment>("");
  const [targetListId, setTargetListId] = useState("");
  const [actionKind, setActionKind] = useState<ActionKind>("none");
  const [tag, setTag] = useState("");
  const [sequenceId, setSequenceId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  const staticLists = lists.filter((list) => list.kind === "static");
  const built = buildFindPeopleSource(source);
  const needs = findPeopleNeeds(source.kind);
  const followers = minFollowers === "" ? undefined : Number(minFollowers);

  const reason = !name.trim()
    ? t("Enter a name for the rule.")
    : "error" in built
      ? built.error
      : !targetListId
        ? t("Choose the list the people are added to.")
        : actionKind === "tag" && !tag.trim()
          ? t("Enter the tag to add.")
          : actionKind === "enroll" && !sequenceId
            ? t("Choose a sequence.")
            : followers !== undefined && (!Number.isInteger(followers) || followers < 0)
              ? t("Enter a whole number of followers.")
              : undefined;
  const saveState = reason ? { disabled: true as const, reason } : { disabled: false as const };

  async function save() {
    if (reason || "error" in built) return;
    const filter: CaptureRule["filter"] = {};
    const cleanKeywords = uniqueTags(keywords);
    if (cleanKeywords.length) filter.keywords = cleanKeywords;
    if (language.trim()) filter.language = language.trim();
    if (followers !== undefined) filter.minFollowers = followers;
    if (sentiment) filter.sentiment = sentiment;
    const action =
      actionKind === "tag"
        ? { kind: "tag" as const, tag: tag.trim() }
        : actionKind === "enroll"
          ? { kind: "enroll" as const, sequenceId }
          : undefined;
    setSaving(true);
    setError(undefined);
    try {
      const rule = await client.captureRules.save({
        name: name.trim(),
        source: built.source as CaptureSource,
        filter,
        targetListId,
        enabled: false,
        ...(action ? { action } : {}),
      });
      onSaved(rule);
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      title={t("New rule")}
      description={t("The rule is saved turned off. Turn it on from the list when you are ready.")}
      onClose={() => {
        if (!saving) onClose();
      }}
      size="lg"
      footerStart={error ? <InlineError>{error}</InlineError> : undefined}
      footer={
        <ModalActions>
          <Button variant="ghost" disabled={saving} onClick={onClose}>
            {t("Cancel")}
          </Button>
          <DisabledReason
            variant="primary"
            loading={saving}
            {...saveState}
            onClick={() => void save().catch(() => undefined)}
          >
            {t("Save rule")}
          </DisabledReason>
        </ModalActions>
      }
    >
      <div className="audience-stack">
        <TextField
          label={t("Rule name")}
          value={name}
          disabled={saving}
          onChange={(event) => setName(event.target.value)}
        />
        <LabeledSelect
          label={t("Account")}
          value={source.accountId}
          disabled={saving || !accounts.length}
          options={accounts.map((account) => ({
            value: account.id,
            label: `${SOCIAL_PLATFORM_NAMES[account.platform]} · ${account.name}`,
          }))}
          onChange={(accountId) => setSource({ ...source, accountId })}
        />
        <LabeledSelect
          label={t("Where to look")}
          value={source.kind}
          disabled={saving}
          options={FIND_PEOPLE_KINDS.map((kind) => ({
            value: kind,
            label: captureSourceLabel(kind),
          }))}
          onChange={(kind) => setSource({ ...source, kind: kind as CaptureSourceKind })}
        />
        {needs === "postRef" ? (
          <TextField
            label={t("Post link or ID (optional)")}
            value={source.postRef}
            disabled={saving}
            onChange={(event) => setSource({ ...source, postRef: event.target.value })}
          />
        ) : null}
        {needs === "query" ? (
          <TextField
            label={t("Keyword or hashtag")}
            value={source.query}
            disabled={saving}
            onChange={(event) => setSource({ ...source, query: event.target.value })}
          />
        ) : null}
        {needs === "handle" ? (
          <TextField
            label={t("Account handle")}
            placeholder="@name"
            value={source.handle}
            disabled={saving}
            onChange={(event) => setSource({ ...source, handle: event.target.value })}
          />
        ) : null}

        <TagInput
          label={t("Only if the text contains")}
          placeholder={t("Add a word")}
          value={keywords}
          inputProps={{ disabled: saving }}
          onValueChange={setKeywords}
        />
        <TextField
          label={t("Language (optional)")}
          placeholder={t("For example en or tr")}
          value={language}
          disabled={saving}
          onChange={(event) => setLanguage(event.target.value)}
        />
        <NumberField
          label={t("Minimum followers (optional)")}
          min={0}
          value={minFollowers}
          disabled={saving}
          onChange={(event) => setMinFollowers(event.target.value)}
        />
        <LabeledSelect
          label={t("Tone (optional)")}
          value={sentiment}
          disabled={saving}
          options={[
            { value: "", label: t("Any tone") },
            { value: "positive", label: t("Positive") },
            { value: "neutral", label: t("Neutral") },
            { value: "negative", label: t("Negative") },
          ]}
          onChange={(value) => setSentiment(value as Sentiment)}
        />

        <LabeledSelect
          label={t("Add them to")}
          value={targetListId}
          disabled={saving}
          options={[
            { value: "", label: t("Choose a list") },
            ...staticLists.map((list) => ({ value: list.id, label: list.name })),
          ]}
          onChange={setTargetListId}
        />
        <LabeledSelect
          label={t("Then")}
          value={actionKind}
          disabled={saving}
          options={[
            { value: "none", label: t("Nothing more") },
            { value: "tag", label: t("Add a tag") },
            { value: "enroll", label: t("Start a sequence") },
          ]}
          onChange={(value) => setActionKind(value as ActionKind)}
        />
        {actionKind === "tag" ? (
          <TextField
            label={t("Tag")}
            value={tag}
            disabled={saving}
            onChange={(event) => setTag(event.target.value)}
          />
        ) : null}
        {actionKind === "enroll" ? (
          <LabeledSelect
            label={t("Sequence")}
            value={sequenceId}
            disabled={saving}
            options={[
              { value: "", label: t("Choose a sequence") },
              ...sequences.map((sequence) => ({ value: sequence.id, label: sequence.name })),
            ]}
            onChange={setSequenceId}
          />
        ) : null}
      </div>
    </Modal>
  );
}
