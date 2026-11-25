import { useState } from "react";
import { t } from "../../../../../shared/i18n";
import { hasControlCharacters } from "../../../../../shared/lib/controlCharacters";
import { Button } from "../../../../../shared/ui/Button";
import { useConfirm } from "../../../../../shared/ui/ConfirmDialog";
import { FieldGroup } from "../../../../../shared/ui/FieldGroup";
import { InlineError, InlineMessage } from "../../../../../shared/ui/InlineError";
import { Disclosure } from "../../../../../shared/ui/Disclosure";
import { EmptyState } from "../../../../../shared/ui/EmptyState";
import { ListRow } from "../../../../../shared/ui/ListRow";
import { LoadingText } from "../../../../../shared/ui/LoadingText";
import { Text } from "../../../../../shared/ui/Text";
import { TextField } from "../../../../../shared/ui/TextField";
import type { InstagramHighlightChange, InstagramHighlights } from "../../../model/socialBrowser";
import type { SocialClient } from "../../../model/socialClient";
import { useAccountWrite } from "../useAccountWrite";
import "./instagram.css";

export function InstagramHighlightsPanel({
  client,
  accountId,
  disabled,
}: {
  client: SocialClient;
  accountId: string;
  disabled: boolean;
}) {
  const { write, is, error, details } = useAccountWrite(
    t("Instagram could not complete this action."),
  );
  const confirmation = useConfirm();
  const [snapshot, setSnapshot] = useState<InstagramHighlights>();
  const [notice, setNotice] = useState("");
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const [stories, setStories] = useState("");
  const selected = snapshot?.items.find((item) => item.id === id);
  const storyIds = stories
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const validStories =
    storyIds.length <= 100 &&
    new Set(storyIds).size === storyIds.length &&
    storyIds.every((value) => /^\d{1,30}$/.test(value));
  const validName =
    name.trim().length > 0 && [...name.trim()].length <= 100 && !hasControlCharacters(name);

  const refresh = async () => {
    const result = await client.browserInstagramHighlights(accountId);
    setSnapshot(result);
    if (id && !result.items.some((item) => item.id === id)) setId("");
  };
  const run = (change: InstagramHighlightChange, title: string) => {
    const details =
      change.action === "delete"
        ? selected?.name
        : [change.name, change.storyIds?.join(", ")].filter(Boolean).join(" · ");
    void confirmation
      .confirm({
        title,
        message: t("Apply this change on Instagram?"),
        details,
        confirmLabel: title,
        danger: change.action === "delete",
      })
      .then((approved) => {
        if (!approved) return;
        return write("change", async () => {
          setNotice("");
          setSnapshot(undefined);
          await client.browserInstagramHighlightChange(accountId, change);
          setNotice(t("Instagram updated."));
          setStories("");
          await refresh();
        });
      })
      .catch(() => undefined);
  };
  const actionLabel = selected ? t("Edit Instagram Highlight") : t("Create Instagram Highlight");
  const choose = (next: string) => {
    setId(next);
    setName(snapshot?.items.find((item) => item.id === next)?.name ?? "");
    setStories("");
    setNotice("");
  };
  return (
    <FieldGroup legend={t("Instagram Highlights")} hideLegend disabled={disabled || is("change")}>
      <div className="instagram-head">
        <Text size="caption" tone="secondary">
          {t("Pick a Highlight to rename it, or start a new one.")}
        </Text>
        <Button
          size="sm"
          variant="secondary"
          loading={is("highlights")}
          onClick={() => {
            void write("highlights", refresh).catch(() => undefined);
          }}
        >
          {snapshot ? t("Refresh") : t("Read Instagram Highlights")}
        </Button>
      </div>
      {is("highlights") && !snapshot ? <LoadingText /> : null}
      {snapshot ? (
        <>
          {!snapshot.items.length ? (
            <EmptyState size="inline" context="list" title={t("No Instagram Highlights found.")} />
          ) : null}
          <ul className="instagram-rows">
            <li>
              <ListRow
                size="md"
                selected={!selected}
                aria-pressed={!selected}
                onClick={() => choose("")}
              >
                {t("Create Instagram Highlight")}
              </ListRow>
            </li>
            {snapshot.items.map((item) => (
              <li key={item.id}>
                <ListRow
                  size="md"
                  selected={item.id === id}
                  aria-pressed={item.id === id}
                  onClick={() => choose(item.id)}
                >
                  {item.name}
                </ListRow>
              </li>
            ))}
          </ul>
          <div className="instagram-grid">
            <TextField
              label={t("Highlight name")}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <Disclosure
            key={selected?.id ?? "new"}
            variant="plain"
            summary={selected ? t("Add archived Stories") : t("Choose archived Stories")}
            defaultOpen={!selected}
          >
            <TextField
              label={t("Archived Instagram Story IDs")}
              description={t("Enter Story IDs separated by commas.")}
              value={stories}
              onChange={(event) => setStories(event.target.value)}
            />
          </Disclosure>
          <div className="instagram-actions">
            <Button
              size="sm"
              variant="primary"
              disabled={!validName || !validStories || (!selected && !storyIds.length)}
              onClick={() =>
                run(
                  selected
                    ? {
                        action: "edit",
                        id: selected.id,
                        expectedName: selected.name,
                        name,
                        ...(storyIds.length ? { storyIds } : {}),
                        confirm: "EDIT_INSTAGRAM_HIGHLIGHT",
                      }
                    : {
                        action: "create",
                        name,
                        storyIds,
                        confirm: "CREATE_INSTAGRAM_HIGHLIGHT",
                      },
                  actionLabel,
                )
              }
            >
              {actionLabel}
            </Button>
            {selected ? (
              <Button
                size="sm"
                variant="secondary"
                tone="danger"
                onClick={() =>
                  run(
                    {
                      action: "delete",
                      id: selected.id,
                      expectedName: selected.name,
                      confirm: "DELETE_INSTAGRAM_HIGHLIGHT",
                    },
                    t("Delete Instagram Highlight"),
                  )
                }
              >
                {t("Delete Instagram Highlight")}
              </Button>
            ) : null}
          </div>
        </>
      ) : null}
      {notice ? <InlineMessage>{notice}</InlineMessage> : null}
      {error ? <InlineError details={details}>{error}</InlineError> : null}
      {confirmation.dialog}
    </FieldGroup>
  );
}
