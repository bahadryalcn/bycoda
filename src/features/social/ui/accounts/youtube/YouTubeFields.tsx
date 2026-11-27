import { t } from "../../../../../shared/i18n";
import { Disclosure } from "../../../../../shared/ui/Disclosure";
import { TextField } from "../../../../../shared/ui/TextField";
import type { SocialClient } from "../../../model/socialClient";
import { FormField, RefField } from "./YouTubeFormFields";
import {
  youtubeIdKeys,
  youtubeRefSource,
  type YouTubeDraft,
  type YouTubeFormField,
} from "./youtubeForms";

const wideTypes = new Set(["textarea", "lines", "links", "images"]);

/**
 * The fields of one form. Identifier fields become pickers fed by the account's own lists; every
 * identifier can still be typed inside one closed "Enter an ID" fallback.
 */
export function YouTubeFields({
  client,
  accountId,
  fields,
  draft,
  setField,
  disabled,
  enabled,
  unset,
  listAvailable,
}: {
  client: SocialClient;
  accountId: string;
  fields: YouTubeFormField[];
  draft: YouTubeDraft;
  setField(key: string, value: string | File[]): void;
  disabled: boolean;
  /** Pickers read the account's lists only while the account can be reached. */
  enabled: boolean;
  unset: string;
  /** The section shows a list the owner can pick the identifier from. */
  listAvailable: boolean;
}) {
  const manual = fields.filter(({ key }) => youtubeIdKeys.has(key));
  const shown = fields.filter(({ key }) => !youtubeIdKeys.has(key) || youtubeRefSource(key, draft));
  const grid = (list: YouTubeFormField[]) => (
    <div className="youtube-fields">
      {list.map((field) => {
        const source = youtubeRefSource(field.key, draft);
        const value = draft[field.key];
        return (
          <div
            key={field.key}
            className="youtube-field"
            data-wide={wideTypes.has(field.type ?? "") || undefined}
          >
            {source ? (
              <RefField
                client={client}
                accountId={accountId}
                source={source}
                field={field}
                value={typeof value === "string" ? value : ""}
                disabled={disabled}
                enabled={enabled}
                unset={unset}
                set={(next) => setField(field.key, next)}
              />
            ) : (
              <FormField
                field={field}
                value={value}
                disabled={disabled}
                unset={unset}
                set={(next) => setField(field.key, next)}
              />
            )}
          </div>
        );
      })}
    </div>
  );
  const common = shown.filter(({ advanced }) => !advanced);
  const more = shown.filter(({ advanced }) => advanced);
  return (
    <>
      {common.length ? grid(common) : null}
      {more.length ? (
        <Disclosure variant="plain" summary={t("More options")}>
          {grid(more)}
        </Disclosure>
      ) : null}
      {manual.length ? (
        <Disclosure variant="plain" summary={t("Enter an ID instead")} defaultOpen={!listAvailable}>
          <div className="youtube-fields">
            {manual.map((field) => (
              <div key={field.key} className="youtube-field">
                <TextField
                  label={field.idLabel ?? field.label}
                  value={typeof draft[field.key] === "string" ? String(draft[field.key]) : ""}
                  disabled={disabled}
                  required={field.required}
                  onChange={(event) => setField(field.key, event.target.value)}
                />
              </div>
            ))}
          </div>
        </Disclosure>
      ) : null}
    </>
  );
}
