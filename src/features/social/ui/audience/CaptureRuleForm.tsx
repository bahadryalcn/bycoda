import { useState } from "react";
import { t } from "../../../../shared/i18n";
import { Disclosure } from "../../../../shared/ui/Disclosure";
import { FieldGroup } from "../../../../shared/ui/FieldGroup";
import { InlineMessage } from "../../../../shared/ui/InlineError";
import { Modal } from "../../../../shared/ui/Modal";
import { NumberField } from "../../../../shared/ui/NumberField";
import { Select } from "../../../../shared/ui/Select";
import { TagInput } from "../../../../shared/ui/TagInput";
import { TextField } from "../../../../shared/ui/TextField";
import type { CaptureRule, CaptureSource, SocialList } from "../../model/audience";
import type { SocialAccount } from "../../model/social";
import { SOCIAL_PLATFORM_NAMES } from "../../model/social";
import type { Sequence } from "../../model/outreach";
import type { SocialClient } from "../../model/socialClient";
import { PlatformIcon } from "../common/PlatformIcon";
import { LabeledSelect } from "./LabeledSelect";
import { errorMessage, uniqueTags } from "./audienceModel";
import { useFormFooter, useTouched } from "./formFooter";
import {
  FIND_PEOPLE_KINDS,
  buildFindPeopleSource,
  captureSourceLabel,
  emptyFindPeopleForm,
  findPeopleNeeds,
  formFromSource,
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
  /** The rule being edited. Omit to create a new one, which is always saved turned off. */
  rule?: CaptureRule;
  onClose: () => void;
  onSaved: (rule: CaptureRule) => void;
};

/**
 * A capture rule in four groups: where people come from, which of them count, the list they are
 * added to, and what happens next. A new rule is saved turned off and the owner turns it on from
 * the rule list; editing keeps a rule on or off exactly as it was.
 */
export function CaptureRuleForm({
  client,
  accounts,
  lists,
  sequences,
  rule,
  onClose,
  onSaved,
}: CaptureRuleFormProps) {
  const [name, setName] = useState(rule?.name ?? "");
  const [source, setSource] = useState<FindPeopleForm>(() =>
    rule ? formFromSource(rule.source) : emptyFindPeopleForm(accounts[0]?.id),
  );
  const [keywords, setKeywords] = useState<string[]>(rule?.filter.keywords ?? []);
  const [language, setLanguage] = useState(rule?.filter.language ?? "");
  const [minFollowers, setMinFollowers] = useState(
    rule?.filter.minFollowers === undefined ? "" : String(rule.filter.minFollowers),
  );
  const [sentiment, setSentiment] = useState<Sentiment>(rule?.filter.sentiment ?? "");
  const [targetListId, setTargetListId] = useState(rule?.targetListId ?? "");
  const [actionKind, setActionKind] = useState<ActionKind>(rule?.action?.kind ?? "none");
  const [tag, setTag] = useState(rule?.action?.kind === "tag" ? rule.action.tag : "");
  const [sequenceId, setSequenceId] = useState(
    rule?.action?.kind === "enroll" ? rule.action.sequenceId : "",
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const { touched, touch } = useTouched();

  const staticLists = lists.filter((list) => list.kind === "static");
  const built = buildFindPeopleSource(source);
  const needs = findPeopleNeeds(source.kind);
  const followers = minFollowers === "" ? undefined : Number(minFollowers);
  const extraSet = [language.trim(), minFollowers, sentiment].filter(Boolean).length;

  const nameReason = name.trim() ? undefined : t("Enter a name for the rule.");
  const sourceReason = "error" in built ? built.error : undefined;
  const listReason = targetListId ? undefined : t("Choose the list the people are added to.");
  const actionReason =
    actionKind === "tag" && !tag.trim()
      ? t("Enter the tag to add.")
      : actionKind === "enroll" && !sequenceId
        ? t("Choose a sequence.")
        : undefined;
  const followersReason =
    followers !== undefined && (!Number.isInteger(followers) || followers < 0)
      ? t("Enter a whole number of followers.")
      : undefined;
  const reason = nameReason ?? sourceReason ?? listReason ?? actionReason ?? followersReason;

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
      const saved = await client.captureRules.save({
        ...(rule ? { id: rule.id } : {}),
        name: name.trim(),
        source: built.source as CaptureSource,
        filter,
        targetListId,
        enabled: rule?.enabled ?? false,
        ...(action ? { action } : {}),
      });
      onSaved(saved);
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  const footer = useFormFooter({
    saving,
    error,
    blockedReason: reason,
    saveLabel: t("Save rule"),
    onSave: () => void save().catch(() => undefined),
    onCancel: onClose,
  });

  return (
    <Modal
      title={rule ? t("Edit rule") : t("New rule")}
      description={
        rule
          ? t("Saving keeps the rule turned on or off, as it is now.")
          : t("The rule is saved turned off. Turn it on from the list when you are ready.")
      }
      onClose={() => {
        if (!saving) onClose();
      }}
      size="lg"
      {...footer}
    >
      <div className="audience-stack">
        <TextField
          label={t("Rule name")}
          value={name}
          disabled={saving}
          error={touched("name") ? nameReason : undefined}
          onBlur={() => touch("name")}
          onChange={(event) => setName(event.target.value)}
        />

        <FieldGroup legend={t("From")} disabled={saving}>
          <div className="audience-pair">
            <Select
              label={t("Account")}
              value={source.accountId}
              disabled={saving || !accounts.length}
              error={touched("account") && !source.accountId ? t("Choose an account.") : undefined}
              options={accounts.map((account) => ({
                value: account.id,
                label: t("{p0} ({p1})", {
                  p0: account.name,
                  p1: SOCIAL_PLATFORM_NAMES[account.platform],
                }),
                icon: <PlatformIcon platform={account.platform} />,
              }))}
              onOpen={() => touch("account")}
              onValueChange={(accountId) => setSource({ ...source, accountId })}
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
          </div>
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
              error={touched("query") ? sourceReason : undefined}
              onBlur={() => touch("query")}
              onChange={(event) => setSource({ ...source, query: event.target.value })}
            />
          ) : null}
          {needs === "handle" ? (
            <TextField
              label={t("Account handle")}
              placeholder="@name"
              value={source.handle}
              disabled={saving}
              error={touched("handle") ? sourceReason : undefined}
              onBlur={() => touch("handle")}
              onChange={(event) => setSource({ ...source, handle: event.target.value })}
            />
          ) : null}
        </FieldGroup>

        <FieldGroup legend={t("Only people who")} disabled={saving}>
          <TagInput
            label={t("Wrote a text containing")}
            placeholder={t("Add a word")}
            value={keywords}
            inputProps={{ disabled: saving }}
            onValueChange={setKeywords}
          />
          <Disclosure
            summary={t("More conditions")}
            count={extraSet || undefined}
            defaultOpen={extraSet > 0}
          >
            <div className="audience-stack">
              <div className="audience-pair">
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
                  error={followersReason}
                  onChange={(event) => setMinFollowers(event.target.value)}
                />
              </div>
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
            </div>
          </Disclosure>
        </FieldGroup>

        <FieldGroup legend={t("Add them to")} disabled={saving}>
          {staticLists.length ? (
            <LabeledSelect
              label={t("List")}
              value={targetListId}
              disabled={saving}
              error={touched("list") ? listReason : undefined}
              options={[
                { value: "", label: t("Choose a list") },
                ...staticLists.map((list) => ({ value: list.id, label: list.name })),
              ]}
              onChange={(value) => {
                touch("list");
                setTargetListId(value);
              }}
            />
          ) : (
            <InlineMessage tone="warning">
              {t("There is no list to add people to. Create a list in People first.")}
            </InlineMessage>
          )}
        </FieldGroup>

        <FieldGroup legend={t("Then")} disabled={saving}>
          <LabeledSelect
            label={t("Next step")}
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
              error={touched("tag") ? actionReason : undefined}
              onBlur={() => touch("tag")}
              onChange={(event) => setTag(event.target.value)}
            />
          ) : null}
          {actionKind === "enroll" ? (
            <LabeledSelect
              label={t("Sequence")}
              value={sequenceId}
              disabled={saving}
              error={touched("sequence") ? actionReason : undefined}
              options={[
                { value: "", label: t("Choose a sequence") },
                ...sequences.map((sequence) => ({ value: sequence.id, label: sequence.name })),
              ]}
              onChange={(value) => {
                touch("sequence");
                setSequenceId(value);
              }}
            />
          ) : null}
        </FieldGroup>
      </div>
    </Modal>
  );
}
