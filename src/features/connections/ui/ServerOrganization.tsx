import { useState } from "react";
import { t } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { Checkbox } from "../../../shared/ui/Checkbox";
import { TextField } from "../../../shared/ui/TextField";
import { updateServerMetadata, type ServerRecord } from "../model/serverInventory";

/** Metadata remains attached to canonical IDs, never to a second connection list. */
export function ServerOrganization({
  server,
  expanded = false,
}: {
  server: ServerRecord;
  expanded?: boolean;
}) {
  const [group, setGroup] = useState(server.metadata.group ?? "");
  const [tags, setTags] = useState(server.metadata.tags.join(", "));
  const [favorite, setFavorite] = useState(server.metadata.favorite);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const Container = expanded ? "section" : "details";
  const Heading = expanded ? "h3" : "summary";
  return (
    <Container className="mbs-4 border-t border-stroke pbs-4 text-xs">
      <Heading className="font-medium">{t("Organization")}</Heading>
      <form
        className="mbs-3 flex flex-col gap-3"
        onSubmit={async (event) => {
          event.preventDefault();
          if (saving) return;
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
            setSaving(false);
          }
        }}
      >
        <TextField
          label={t("Group")}
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
          value={tags}
          maxLength={1000}
          disabled={saving}
          onChange={(event) => {
            setTags(event.target.value);
            setSaved(false);
          }}
          description={t("Separate tags with commas.")}
        />
        <label className="flex items-center gap-2">
          <Checkbox
            checked={favorite}
            disabled={saving}
            onChange={(event) => {
              setFavorite(event.target.checked);
              setSaved(false);
            }}
          />
          {t("Favorite")}
        </label>
        {error ? (
          <p role="alert" className="text-(--ui-tone-danger-fg)">
            {error}
          </p>
        ) : null}
        <div className="flex items-center justify-between gap-2">
          <span role="status" className="text-(--ui-text-muted)">
            {saved ? t("Saved") : ""}
          </span>
          <Button type="submit" loading={saving}>
            {t("Save")}
          </Button>
        </div>
      </form>
    </Container>
  );
}
