import { useId, useRef, useState } from "react";
import { SectionLabel } from "../../../shared/ui/SectionLabel";
import { Text } from "../../../shared/ui/Text";
import { Disclosure } from "../../../shared/ui/Disclosure";
import { t } from "../../../shared/i18n";
import { Checkbox } from "../../../shared/ui/Checkbox";
import { InlineError } from "../../../shared/ui/InlineError";
import { surfaceAttributes } from "../../../shared/ui/Surface";
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
  /** What the last acknowledged save (or the loaded record) holds; an unchanged draft saves nothing. */
  const persisted = useRef(JSON.stringify([group, tags, favorite]));
  const title = <>{t("Organization")}</>;
  // Metadata saves itself when a field is left or the favorite flips; there is no Save button.
  const save = async (next: { group: string; tags: string; favorite: boolean }) => {
    const snapshot = JSON.stringify([next.group, next.tags, next.favorite]);
    if (pending.current || snapshot === persisted.current) return;
    pending.current = true;
    setSaving(true);
    setError("");
    try {
      await updateServerMetadata(server.id, {
        group: next.group.trim(),
        tags: [
          ...new Set(
            next.tags
              .split(",")
              .map((tag) => tag.trim())
              .filter(Boolean),
          ),
        ],
        favorite: next.favorite,
      });
      persisted.current = snapshot;
    } catch {
      setError(t("Couldn’t save server organization."));
    } finally {
      pending.current = false;
      setSaving(false);
    }
  };
  const content = (
    <>
      <form
        className="mbs-3 flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          void save({ group, tags, favorite });
        }}
      >
        <TextField
          label={t("Group")}
          list={`${suggestionsId}-groups`}
          value={group}
          maxLength={100}
          disabled={saving}
          onChange={(event) => setGroup(event.target.value)}
          onBlur={() => void save({ group, tags, favorite })}
        />
        <TextField
          label={t("Tags")}
          list={`${suggestionsId}-tags`}
          value={tags}
          maxLength={1000}
          disabled={saving}
          placeholder={t("e.g. prod, web")}
          onChange={(event) => setTags(event.target.value)}
          onBlur={() => void save({ group, tags, favorite })}
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
            void save({ group, tags, favorite: event.target.checked });
          }}
          label={t("Favorite")}
          className="flex items-center gap-2"
        />
        {error ? <InlineError>{error}</InlineError> : null}
      </form>
    </>
  );
  return expanded ? (
    <Text
      as="section"
      size="caption"
      tone="inherit"
      {...surfaceAttributes({ frame: "pane", edge: "top" }, "mbs-4 pbs-4")}
    >
      <SectionLabel as="h3">{title}</SectionLabel>
      {content}
    </Text>
  ) : (
    <Disclosure
      size="sm"
      textSize="caption"
      {...surfaceAttributes({ frame: "pane", edge: "top" }, "mbs-4 pbs-4")}
      summary={title}
    >
      <Text as="div" size="caption" tone="inherit">
        {content}
      </Text>
    </Disclosure>
  );
}
