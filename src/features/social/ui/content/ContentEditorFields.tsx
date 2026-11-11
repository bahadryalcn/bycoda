import { t } from "../../../../shared/i18n";
import { wallClockNow } from "../../../../shared/lib/time/wallClock";
import { Checkbox } from "../../../../shared/ui/Checkbox";
import { DateTimeField } from "../../../../shared/ui/DateTimePicker";
import { FieldGroup } from "../../../../shared/ui/FieldGroup";
import { SegmentedControl } from "../../../../shared/ui/SegmentedControl";
import { TextareaField } from "../../../../shared/ui/TextareaField";
import { TextField } from "../../../../shared/ui/TextField";
import { EmptyHint } from "../common/EmptyHint";
import { PlatformIcon } from "../common/PlatformIcon";
import { capabilityReasonText } from "../common/capabilityText";
import type { SocialClient } from "../../model/socialClient";
import type { SocialSnapshot, TikTokCreatorInfo } from "../../model/social";
import type { SocialMediaEditor } from "../../model/socialMediaEditor";
import type { SocialScreenProps } from "../shell/screens";
import { ContentEditorAi } from "./ContentEditorAi";
import { ContentMediaField } from "./ContentMediaField";
import { setPlatform, toggleAccount, type ContentDraft, type ContentMedia } from "./contentDraft";
import { accountAvailability, selectedAccounts } from "./contentRules";
import { dayKey } from "./calendarModel";
import { PlatformFields } from "./platform-fields/PlatformFields";

export type ContentEditorFieldsProps = {
  client: SocialClient;
  editor: SocialMediaEditor;
  snapshot?: SocialSnapshot;
  projectId?: string;
  draft: ContentDraft;
  onDraft: (next: ContentDraft) => void;
  /** Why the post cannot be changed here (already scheduled). Disables every field. */
  locked?: string;
  aiStopped: boolean;
  creators: Partial<Record<string, TikTokCreatorInfo>>;
  onNavigate: SocialScreenProps["onNavigate"];
};

/** Text, AI, accounts, media, time and the platform options of the selected accounts. */
export function ContentEditorFields(props: ContentEditorFieldsProps) {
  const {
    client,
    editor,
    snapshot,
    projectId,
    draft,
    onDraft,
    locked,
    aiStopped,
    creators,
    onNavigate,
  } = props;
  const accounts = snapshot?.accounts ?? [];
  const selected = selectedAccounts(draft, accounts);
  const disabled = !!locked;
  const mediaBlocked =
    selected.length > 0 &&
    selected.every((account) => {
      const media = snapshot?.capabilities[account.id]?.find((item) => item.operation === "media");
      return !media || media.status !== "available";
    });
  const mediaReason = selected.length
    ? capabilityReasonText(
        snapshot?.capabilities[selected[0]!.id]?.find((item) => item.operation === "media") ?? {
          status: "unsupported",
          reasonCode: "unsupported.not_yet",
        },
      )
    : undefined;
  return (
    <div className="content-fields">
      <div className="content-text">
        <TextareaField
          label={t("Post")}
          disabled={disabled}
          minRows={4}
          maxRows={12}
          autosize
          value={draft.text}
          onChange={(event) => onDraft({ ...draft, text: event.target.value })}
        />
        <TextField
          label={t("Link")}
          type="url"
          disabled={disabled}
          value={draft.link}
          onChange={(event) => onDraft({ ...draft, link: event.target.value })}
        />
        <ContentEditorAi
          client={client}
          projectId={projectId}
          accountCount={selected.length}
          aiStopped={aiStopped}
          disabled={disabled}
          onNavigate={onNavigate}
          onUse={(result) =>
            onDraft({
              ...draft,
              text: result.text,
              name: result.name ?? draft.name,
              link: result.link ?? draft.link,
            })
          }
        />
      </div>
      <FieldGroup
        legend={t("Accounts")}
        layout="row"
        gap="sm"
        className="content-accounts"
        disabled={disabled}
      >
        {accounts.length === 0 ? (
          <EmptyHint
            message={t("No accounts yet. Connect one in Accounts & Settings.")}
            action={{ label: t("Accounts & Settings"), onClick: () => onNavigate("accounts") }}
          />
        ) : (
          accounts.map((account) => {
            const availability = accountAvailability(account, { projectId, snapshot });
            const checked = draft.accountIds.includes(account.id);
            return (
              <Checkbox
                checked={checked}
                disabled={availability.disabled && !checked}
                onChange={() =>
                  onDraft({ ...draft, accountIds: toggleAccount(draft.accountIds, account.id) })
                }
                label={
                  <>
                    <PlatformIcon platform={account.platform} className="icon-sm" />
                    <span>{account.name}</span>
                    {availability.disabled ? (
                      <span className="content-check-reason">{availability.reason}</span>
                    ) : null}
                  </>
                }
                key={account.id}
                className="content-check content-account"
              />
            );
          })
        )}
        {/* Chosen accounts that are gone from the snapshot: shown checked so the owner can uncheck them. */}
        {draft.accountIds
          .filter((id) => !accounts.some((account) => account.id === id))
          .map((id) => (
            <Checkbox
              checked
              onChange={() =>
                onDraft({ ...draft, accountIds: toggleAccount(draft.accountIds, id) })
              }
              label={<span>{t("Account no longer available")}</span>}
              key={id}
              className="content-check content-account"
            />
          ))}
      </FieldGroup>
      <FieldGroup legend={t("When")} gap="sm" className="content-when" disabled={disabled}>
        <SegmentedControl
          selectionRole="radio"
          value={draft.when}
          options={[
            { value: "now", label: t("Now") },
            { value: "later", label: t("Later") },
          ]}
          onValueChange={(value) =>
            onDraft({ ...draft, when: value === "later" ? "later" : "now" })
          }
        />
        {draft.when === "later" ? (
          <DateTimeField
            label={t("Date and time")}
            mode="datetime"
            min={dayKey(wallClockNow())}
            required
            value={draft.scheduledAt}
            onChange={(value) => onDraft({ ...draft, scheduledAt: value })}
          />
        ) : null}
      </FieldGroup>
      <ContentMediaField
        client={client}
        editor={editor}
        media={draft.media}
        disabled={disabled || mediaBlocked}
        disabledReason={locked ?? (mediaBlocked ? mediaReason : undefined)}
        onChange={(next: ContentMedia[]) => onDraft({ ...draft, media: next })}
      />
      {selected.map((account) => (
        <section key={account.id} className="content-platform-section" aria-label={account.name}>
          <PlatformFields
            account={account}
            value={draft.platform[account.id] ?? {}}
            media={draft.media}
            disabled={disabled}
            creator={creators[account.id]}
            onChange={(next) => onDraft(setPlatform(draft, account.id, next))}
          />
        </section>
      ))}
    </div>
  );
}
