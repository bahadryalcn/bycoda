import { useState } from "react";
import { t } from "../../../../../shared/i18n";
import { Button } from "../../../../../shared/ui/Button";
import { useConfirm } from "../../../../../shared/ui/ConfirmDialog";
import { FieldGroup } from "../../../../../shared/ui/FieldGroup";
import { InlineError, InlineMessage } from "../../../../../shared/ui/InlineError";
import { Select } from "../../../../../shared/ui/Select";
import { TextField } from "../../../../../shared/ui/TextField";
import type { InstagramHighlightChange, InstagramHighlights } from "../../../model/socialBrowser";
import type { SocialClient } from "../../../model/socialClient";
import { useAccountWrite } from "../useAccountWrite";

export function InstagramHighlightsPanel({
  client,
  accountId,
  disabled,
}: {
  client: SocialClient;
  accountId: string;
  disabled: boolean;
}) {
  const { write, is, error } = useAccountWrite(t("Instagram could not complete this action."));
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
    name.trim().length > 0 && [...name.trim()].length <= 100 && !/[\u0000-\u001f\u007f]/.test(name);

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
  const entries = [
    { value: "", label: t("Create Instagram Highlight") },
    ...(snapshot?.items ?? []).map((item) => ({ value: item.id, label: item.name })),
  ];
  return (
    <FieldGroup legend={t("Instagram Highlights")} disabled={disabled || is("change")}>
      <Button
        size="sm"
        variant="secondary"
        loading={is("highlights")}
        onClick={() => {
          void write("highlights", refresh).catch(() => undefined);
        }}
      >
        {t("Read Instagram Highlights")}
      </Button>
      {snapshot ? (
        <>
          {!snapshot.items.length ? (
            <InlineMessage>{t("No Instagram Highlights found.")}</InlineMessage>
          ) : null}
          <Select
            label={t("Instagram Highlights")}
            value={id}
            options={entries}
            onValueChange={(next) => {
              setId(next);
              setName(snapshot.items.find((item) => item.id === next)?.name ?? "");
              setStories("");
              setNotice("");
            }}
          />
          <TextField
            label={t("Highlight name")}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <TextField
            label={t("Archived Instagram Story IDs")}
            description={t("Enter Story IDs separated by commas.")}
            value={stories}
            onChange={(event) => setStories(event.target.value)}
          />
          <div className="social-tag-line">
            <Button
              size="sm"
              variant="secondary"
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
                    : { action: "create", name, storyIds, confirm: "CREATE_INSTAGRAM_HIGHLIGHT" },
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
      {error ? <InlineError>{error}</InlineError> : null}
      {confirmation.dialog}
    </FieldGroup>
  );
}
