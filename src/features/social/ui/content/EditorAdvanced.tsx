import { useState } from "react";
import { t } from "../../../../shared/i18n";
import { Button } from "../../../../shared/ui/Button";
import { Checkbox } from "../../../../shared/ui/Checkbox";
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
  const [open, setOpen] = useState(false);
  const facts = snapshot?.profiles.find((profile) => profile.projectId === projectId)?.facts ?? [];
  const { repeat, utm } = draft;
  const setRepeat = (patch: Partial<typeof repeat>) =>
    onDraft({ ...draft, repeat: { ...repeat, ...patch } });
  const setUtm = (patch: Partial<typeof utm>) => onDraft({ ...draft, utm: { ...utm, ...patch } });
  return (
    <section className="content-advanced">
      <Button
        variant="link"
        aria-expanded={open}
        aria-controls="content-advanced-body"
        onClick={() => setOpen((value) => !value)}
      >
        {t("More options")}
      </Button>
      {open ? (
        <div id="content-advanced-body" className="content-advanced-body">
          <TextField
            label={t("Campaign name")}
            disabled={disabled}
            value={draft.name}
            description={t(
              "Shown in the calendar and lists. Defaults to the first line of the post.",
            )}
            onChange={(event) => onDraft({ ...draft, name: event.target.value })}
          />
          <fieldset className="content-advanced-group" disabled={disabled}>
            <legend>{t("Repeat")}</legend>
            <Checkbox
              checked={repeat.enabled}
              onChange={(event) => setRepeat({ enabled: event.target.checked })}
              label={t("Repeat this post as a paused program")}
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
          </fieldset>
          <fieldset className="content-advanced-group" disabled={disabled}>
            <legend>{t("Brand facts")}</legend>
            {facts.length ? (
              facts.map((fact) => (
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
                    <>
                      <span>
                        <strong>{fact.topic}</strong> {fact.text}
                      </span>
                    </>
                  }
                  key={fact.id}
                  className="content-check"
                />
              ))
            ) : (
              <p className="content-platform-note">{t("No brand facts for this project yet.")}</p>
            )}
          </fieldset>
          <fieldset className="content-advanced-group" disabled={disabled}>
            <legend>{t("Link tags (UTM)")}</legend>
            <TextField
              label={t("Source")}
              value={utm.source}
              description={t("Added to the link when it is valid.")}
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
          </fieldset>
        </div>
      ) : null}
    </section>
  );
}
