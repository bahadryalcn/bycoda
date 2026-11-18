import { Text } from "../../../../../shared/ui/Text";
import { t } from "../../../../../shared/i18n";
import { Button } from "../../../../../shared/ui/Button";
import { Checkbox } from "../../../../../shared/ui/Checkbox";
import { Disclosure } from "../../../../../shared/ui/Disclosure";
import { FieldGroup } from "../../../../../shared/ui/FieldGroup";
import { NumberField } from "../../../../../shared/ui/NumberField";
import { TextareaField } from "../../../../../shared/ui/TextareaField";
import { TextField } from "../../../../../shared/ui/TextField";
import type { XPostDraft } from "../contentDraft";
import type { PlatformFieldProps } from "./PlatformFields";

/** Extra X format fields belong to each selected account's draft. */
export function XFields({ value, disabled, onChange }: PlatformFieldProps) {
  const draft = value.x ?? {};
  const thread = draft.thread ?? [];
  const update = (patch: XPostDraft) => onChange({ x: { ...draft, ...patch } });
  return (
    <FieldGroup legend="X" hideLegend gap="sm" disabled={disabled}>
      <Text as="p" size="caption" tone="muted" leading="inherit" className="content-platform-note">
        {t("X posts take either up to four images or one video.")}
      </Text>
      <Checkbox
        label={t("Poll")}
        checked={!!draft.poll}
        onChange={(event) =>
          update({
            poll: event.target.checked ? { options: "", durationMinutes: "60" } : undefined,
          })
        }
      />
      {draft.poll ? (
        <>
          <TextareaField
            label={t("Poll choices (one per line)")}
            value={draft.poll.options}
            minRows={2}
            maxRows={4}
            onChange={(event) => update({ poll: { ...draft.poll!, options: event.target.value } })}
          />
          <NumberField
            label={t("Poll duration (minutes)")}
            min={5}
            max={10080}
            step={1}
            value={draft.poll.durationMinutes}
            onChange={(event) =>
              update({ poll: { ...draft.poll!, durationMinutes: event.target.value } })
            }
          />
        </>
      ) : null}
      {thread.map((post, index) => (
        <div key={index}>
          <TextareaField
            label={t("Thread post {p0}", { p0: index + 2 })}
            value={post}
            minRows={2}
            maxRows={8}
            autosize
            onChange={(event) =>
              update({ thread: thread.map((item, i) => (i === index ? event.target.value : item)) })
            }
          />
          <Button
            variant="link"
            onClick={() => update({ thread: thread.filter((_, i) => i !== index) })}
          >
            {t("Remove thread post {p0}", { p0: index + 2 })}
          </Button>
        </div>
      ))}
      {thread.length < 24 ? (
        <Button variant="secondary" onClick={() => update({ thread: [...thread, ""] })}>
          {t("Add thread post")}
        </Button>
      ) : null}
      <Disclosure summary={t("More X options")} variant="row" size="sm">
        <div className="content-platform-more">
          <TextField
            label={t("Quote post ID")}
            numeric
            value={draft.quotePostId ?? ""}
            onChange={(event) => update({ quotePostId: event.target.value })}
          />
          <TextField
            label={t("Community ID")}
            numeric
            value={draft.communityId ?? ""}
            onChange={(event) => update({ communityId: event.target.value })}
          />
        </div>
      </Disclosure>
    </FieldGroup>
  );
}
