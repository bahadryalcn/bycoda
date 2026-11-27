import { t } from "../../../../shared/i18n";
import { Text } from "../../../../shared/ui/Text";
import { Checkbox } from "../../../../shared/ui/Checkbox";
import { Disclosure } from "../../../../shared/ui/Disclosure";
import { FieldGroup } from "../../../../shared/ui/FieldGroup";
import { NumberField } from "../../../../shared/ui/NumberField";
import { TextField } from "../../../../shared/ui/TextField";
import type { SocialSnapshot } from "../../model/social";
import type { ContentDraft } from "./contentDraft";

export type EditorAdvancedProps = {
  draft: ContentDraft;
  onDraft: (next: ContentDraft) => void;
  snapshot?: SocialSnapshot;
  projectId?: string;
  disabled: boolean;
};

const numberOf = (value: string) => (value === "" ? 0 : Number(value));

/** Optional settings, closed by default: campaign name, repeat, brand facts and UTM. */
export function EditorAdvanced({
  draft,
  onDraft,
  snapshot,
  projectId,
  disabled,
}: EditorAdvancedProps) {
  const facts = snapshot?.profiles.find((profile) => profile.projectId === projectId)?.facts ?? [];
  const { repeat, utm } = draft;
  const setRepeat = (patch: Partial<typeof repeat>) =>
    onDraft({ ...draft, repeat: { ...repeat, ...patch } });
  const setUtm = (patch: Partial<typeof utm>) => onDraft({ ...draft, utm: { ...utm, ...patch } });
  return (
    <Disclosure summary={t("More options")}>
      <div className="content-advanced-body">
        <TextField
          label={t("Campaign name")}
          disabled={disabled}
          value={draft.name}
          onChange={(event) => onDraft({ ...draft, name: event.target.value })}
        />
        <FieldGroup
          legend={t("Repeat")}
          gap="sm"
          className="content-advanced-group"
          disabled={disabled}
        >
          <Checkbox
            checked={repeat.enabled}
            onChange={(event) => setRepeat({ enabled: event.target.checked })}
            label={t("Repeat this post as a paused program")}
            size="body"
            leading="inherit"
            className="content-check"
          />
          {repeat.enabled ? (
            <>
              <NumberField
                label={t("Shortest gap (minutes)")}
                min={1}
                value={repeat.minMinutes}
                onChange={(event) => setRepeat({ minMinutes: numberOf(event.target.value) })}
              />
              <NumberField
                label={t("Longest gap (minutes)")}
                min={1}
                value={repeat.maxMinutes}
                onChange={(event) => setRepeat({ maxMinutes: numberOf(event.target.value) })}
              />
              <NumberField
                label={t("Number of posts")}
                min={1}
                value={repeat.totalPosts}
                onChange={(event) => setRepeat({ totalPosts: numberOf(event.target.value) })}
              />
            </>
          ) : null}
        </FieldGroup>
        {facts.length ? (
          <FieldGroup
            legend={t("Brand facts")}
            gap="sm"
            className="content-advanced-group"
            disabled={disabled}
          >
            {facts.map((fact) => (
              <Checkbox
                checked={draft.factIds.includes(fact.id)}
                onChange={(event) =>
                  onDraft({
                    ...draft,
                    factIds: event.target.checked
                      ? [...draft.factIds, fact.id]
                      : draft.factIds.filter((id) => id !== fact.id),
                  })
                }
                label={
                  <span>
                    <Text as="span" weight="medium">
                      {fact.topic}
                    </Text>{" "}
                    {fact.text}
                  </span>
                }
                key={fact.id}
                size="body"
                leading="inherit"
                className="content-check"
              />
            ))}
          </FieldGroup>
        ) : null}
        <FieldGroup
          legend={t("Link tags (UTM)")}
          gap="sm"
          className="content-advanced-group"
          disabled={disabled}
        >
          <TextField
            label={t("Source")}
            value={utm.source}
            onChange={(event) => setUtm({ source: event.target.value })}
          />
          <TextField
            label={t("Medium")}
            value={utm.medium}
            onChange={(event) => setUtm({ medium: event.target.value })}
          />
          <TextField
            label={t("Campaign tag")}
            value={utm.campaign}
            onChange={(event) => setUtm({ campaign: event.target.value })}
          />
        </FieldGroup>
      </div>
    </Disclosure>
  );
}
