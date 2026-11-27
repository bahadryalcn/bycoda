import { accountBlockedReason } from "../blockedReason";
import { useState } from "react";
import { useT } from "../../../../../shared/i18n";
import { Button } from "../../../../../shared/ui/Button";
import { Checkbox } from "../../../../../shared/ui/Checkbox";
import { useConfirm } from "../../../../../shared/ui/ConfirmDialog";
import { DescriptionItem, DescriptionList } from "../../../../../shared/ui/DescriptionList";
import { EmptyState } from "../../../../../shared/ui/EmptyState";
import { InlineError, InlineMessage } from "../../../../../shared/ui/InlineError";
import { SectionLabel } from "../../../../../shared/ui/SectionLabel";
import { Select } from "../../../../../shared/ui/Select";
import { Text } from "../../../../../shared/ui/Text";
import { useAccountWrite } from "../useAccountWrite";
import type { TikTokPanelProps } from "./TikTokAccountTools";
import "./tiktok.css";

const fields = ["comments", "duet", "stitch"] as const;
const scopes = ["everyone", "followers", "friends", "nobody"] as const;
type Scope = (typeof scopes)[number];
type Privacy = { privateAccount?: boolean } & Partial<Record<(typeof fields)[number], Scope>>;

export function TikTokPrivacy({
  client,
  accountId,
  disabled,
  accountName,
}: TikTokPanelProps & { accountName: string }) {
  const t = useT();
  const [saved, setSaved] = useState<Privacy>();
  const [draft, setDraft] = useState<Privacy>();
  const [uncertain, setUncertain] = useState(false);
  const { is, write, failureTitle, details } = useAccountWrite(
    t("Could not read or save TikTok privacy settings."),
  );
  const confirm = useConfirm();
  const labels = {
    comments: t("Comments"),
    duet: t("Duet"),
    stitch: t("Stitch"),
  };
  const scopeLabels = {
    everyone: t("Everyone"),
    followers: t("Followers"),
    friends: t("Friends"),
    nobody: t("Nobody"),
  };
  const changed = fields.filter((field) => draft?.[field] !== saved?.[field]);
  const visibilityChanged = draft?.privateAccount !== saved?.privateAccount;
  const dirty = visibilityChanged || changed.length > 0;
  const busy = is("read") || is("save");

  const read = async () => {
    const privacy = await write("read", () =>
      client.request<Privacy>("tiktok.privacy.read", { accountId }),
    );
    if (privacy) {
      setSaved(privacy);
      setDraft(privacy);
      setUncertain(false);
    }
  };

  const save = async () => {
    if (!draft || !dirty) return;
    const patch: Privacy = {};
    if (visibilityChanged) patch.privateAccount = draft.privateAccount;
    for (const field of changed) patch[field] = draft[field];
    const updated = await write("save", () =>
      client.request<Privacy | { status: "unknown" }>("tiktok.privacy.update", {
        accountId,
        confirm: true,
        patch,
      }),
    );
    if (updated && "status" in updated) setUncertain(true);
    else if (updated) {
      setSaved(updated);
      setDraft(updated);
    }
  };

  return (
    <div className="tiktok-panel">
      <div className="tiktok-head">
        <SectionLabel as="h3">{t("Privacy")}</SectionLabel>
        <Button
          variant="secondary"
          size="sm"
          loading={is("read")}
          disabled={disabled || busy || (dirty && !uncertain)}
          disabledReason={
            disabled || busy
              ? accountBlockedReason(disabled)
              : t("Save or discard your changes before reading again.")
          }
          onClick={() => read().catch(() => undefined)}
        >
          {draft ? t("Refresh") : t("Read privacy settings")}
        </Button>
      </div>
      {!draft && !busy && !failureTitle && (
        <Text size="caption" tone="secondary">
          {t("Nothing loaded yet. Read it from TikTok to see it here.")}
        </Text>
      )}
      {uncertain && (
        <InlineMessage tone="warning">
          {t("TikTok did not confirm this change. Check its current state before trying again.")}
        </InlineMessage>
      )}
      {draft && !Object.keys(draft).length && (
        <EmptyState
          context="panel"
          illustration={false}
          title={t("Privacy settings unavailable")}
        />
      )}
      {draft && Object.keys(draft).length > 0 && (
        <div className="tiktok-panel">
          {draft.privateAccount !== undefined && (
            <Checkbox
              label={t("Private account")}
              size="secondary"
              checked={draft.privateAccount}
              disabled={disabled || busy}
              disabledReason={accountBlockedReason(disabled)}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  privateAccount: event.currentTarget.checked,
                })
              }
            />
          )}
          <div className="tiktok-grid">
            {fields.map(
              (field) =>
                draft[field] && (
                  <Select
                    key={field}
                    label={labels[field]}
                    value={draft[field]}
                    options={scopes.map((value) => ({
                      value,
                      label: scopeLabels[value],
                    }))}
                    disabled={disabled || busy}
                    onValueChange={(value) => {
                      const scope = scopes.find((candidate) => candidate === value);
                      if (scope) setDraft({ ...draft, [field]: scope });
                    }}
                  />
                ),
            )}
          </div>
          <div className="tiktok-actions">
            <Button
              size="sm"
              variant="primary"
              loading={is("save")}
              disabled={disabled || busy || !dirty || uncertain}
              disabledReason={
                disabled || busy
                  ? accountBlockedReason(disabled)
                  : !dirty
                    ? t("No changes to save.")
                    : t(
                        "TikTok did not confirm this change. Check its current state before trying again.",
                      )
              }
              onClick={() =>
                confirm
                  .confirm({
                    title: t("Save privacy settings"),
                    message: t("Review the exact changes before confirming."),
                    context: accountName,
                    details: (
                      <DescriptionList size="sm">
                        {visibilityChanged && (
                          <DescriptionItem term={t("Account visibility")}>
                            {draft.privateAccount ? t("Private") : t("Public")}
                          </DescriptionItem>
                        )}
                        {changed.map((field) => (
                          <DescriptionItem key={field} term={labels[field]}>
                            {draft[field] && scopeLabels[draft[field]]}
                          </DescriptionItem>
                        ))}
                      </DescriptionList>
                    ),
                    confirmLabel: t("Save privacy settings"),
                    danger: false,
                    onConfirm: save,
                  })
                  .catch(() => undefined)
              }
            >
              {t("Save privacy settings")}
            </Button>
            {dirty && (
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => setDraft(saved)}>
                {t("Discard changes")}
              </Button>
            )}
          </div>
        </div>
      )}
      {failureTitle && <InlineError details={details}>{failureTitle}</InlineError>}
      {confirm.dialog}
    </div>
  );
}
