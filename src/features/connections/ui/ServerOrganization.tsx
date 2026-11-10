import { useId, useRef, useState } from "react";
import { t } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { Checkbox } from "../../../shared/ui/Checkbox";
import { InlineError } from "../../../shared/ui/InlineError";
import { TextField } from "../../../shared/ui/TextField";
import { updateServerMetadata, type ServerRecord } from "../model/serverInventory";

/** Metadata remains attached to canonical IDs, never to a second connection list. */
export function ServerOrganization({
  server,
  servers = [server],
  expanded = false,
}: {
  server: ServerRecord;
  servers?: ServerRecord[];
  expanded?: boolean;
}) {
  const suggestionsId = useId();
  const pending = useRef(false);
  const groups = [
    ...new Set(
      servers.map((item) => item.metadata.group).filter((value): value is string => Boolean(value)),
    ),
  ].sort();
  const tagSuggestions = [...new Set(servers.flatMap((item) => item.metadata.tags))].sort();
  const [group, setGroup] = useState(server.metadata.group ?? "");
  const [tags, setTags] = useState(server.metadata.tags.join(", "));
  const tagPrefix = tags.includes(",") ? tags.slice(0, tags.lastIndexOf(",") + 1) + " " : "";
  const [favorite, setFavorite] = useState(server.metadata.favorite);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const Container = expanded ? "section" : "details";
  const Heading = expanded ? "h3" : "summary";
  return (
    <Container className="mbs-4 border-t border-stroke pbs-4 text-ui-caption">
      <Heading className="font-medium">{t("Organization")}</Heading>
      <form
        className="mbs-3 flex flex-col gap-3"
        onSubmit={async (event) => {
          event.preventDefault();
          if (pending.current) return;
          pending.current = true;
          setSaving(true);
          setError("");
          setSaved(false);
          try {
            await updateServerMetadata(server.id, {
              group: group.trim(),
              tags: [
                ...new Set(
                  tags
                    .split(",")
                    .map((tag) => tag.trim())
                    .filter(Boolean),
                ),
              ],
              favorite,
            });
            setSaved(true);
          } catch {
            setError(t("Couldn’t save server organization."));
          } finally {
            pending.current = false;
            setSaving(false);
          }
        }}
      >
        <TextField
          label={t("Group")}
          list={`${suggestionsId}-groups`}
          value={group}
          maxLength={100}
          disabled={saving}
          onChange={(event) => {
            setGroup(event.target.value);
            setSaved(false);
          }}
        />
        <TextField
          label={t("Tags")}
          list={`${suggestionsId}-tags`}
          value={tags}
          maxLength={1000}
          disabled={saving}
          onChange={(event) => {
            setTags(event.target.value);
            setSaved(false);
          }}
          description={t("Separate tags with commas.")}
        />
        <datalist id={`${suggestionsId}-groups`}>
          {groups.map((value) => (
            <option key={value} value={value} />
          ))}
        </datalist>
        <datalist id={`${suggestionsId}-tags`}>
          {tagSuggestions.map((value) => (
            <option key={value} value={`${tagPrefix}${value}`} />
          ))}
        </datalist>
        <Checkbox
          checked={favorite}
          disabled={saving}
          onChange={(event) => {
            setFavorite(event.target.checked);
            setSaved(false);
          }}
          label={t("Favorite")}
          className="flex items-center gap-2"
        />
        {error ? <InlineError>{error}</InlineError> : null}
        <div className="flex justify-end gap-2">
          <Button type="submit" loading={saving} success={saved} successLabel={t("Saved")}>
            {t("Save")}
          </Button>
        </div>
      </form>
    </Container>
  );
}
