import { Fragment, type SetStateAction } from "react";
import { Text } from "../../../../shared/ui/Text";
import { InfoPopover } from "../../../../shared/ui/InfoPopover";
import { t } from "../../../../shared/i18n";
import { wallClockNow } from "../../../../shared/lib/time/wallClock";
import { Checkbox } from "../../../../shared/ui/Checkbox";
import { DateTimePicker } from "../../../../shared/ui/DateTimePicker";
import { Divider } from "../../../../shared/ui/Divider";
import { FieldGroup } from "../../../../shared/ui/FieldGroup";
import { RadioGroup } from "../../../../shared/ui/RadioGroup";
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
import { accountAvailability, selectedAccounts, usesInstagramApi } from "./contentRules";
import { dayKey } from "./calendarModel";
import { localScheduleHint } from "./contentSchedule";
import { PlatformFields, hasPlatformFields } from "./platform-fields/PlatformFields";

export type ContentEditorFieldsProps = {
  client: SocialClient;
  editor: SocialMediaEditor;
  snapshot?: SocialSnapshot;
  projectId?: string;
  draft: ContentDraft;
  onDraft: (next: SetStateAction<ContentDraft>) => void;
  onMediaBusyChange?: (busy: boolean) => void;
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
    onMediaBusyChange,
    locked,
    aiStopped,
    creators,
    onNavigate,
  } = props;
  const accounts = snapshot?.accounts ?? [];
  const selected = selectedAccounts(draft, accounts);
  const instagramMedia = selected.some(usesInstagramApi)
    ? selected.every(usesInstagramApi)
      ? "public-only"
      : "mixed"
    : undefined;
  const youtubeUploadAccount = selected.every(
    (account) =>
      account.platform === "youtube" &&
      account.connection !== "browser" &&
      snapshot?.capabilities[account.id]?.some(
        (item) => item.operation === "media" && item.status === "available",
      ),
  )
    ? selected[0]?.id
    : undefined;
  const disabled = !!locked;
  // Uploads may finish after this editor unmounts; update its retained workspace current draft.
  const changeMedia = (media: ContentMedia[]) => onDraft((current) => ({ ...current, media }));
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
        layout="stack"
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
            const row = (
              <Checkbox
                size="body"
                checked={checked}
                disabled={availability.disabled && !checked}
                onChange={() =>
                  onDraft({ ...draft, accountIds: toggleAccount(draft.accountIds, account.id) })
                }
                label={
                  <>
                    <PlatformIcon platform={account.platform} className="icon-sm" />
                    <span>{account.name}</span>
                  </>
                }
                className="content-check content-account"
              />
            );
            return (
              <Fragment key={account.id}>
                {availability.disabled && availability.reason ? (
                  <div className="flex items-center gap-2">
                    {row}
                    <InfoPopover label={t("{p0}: {p1}", { p0: account.name, p1: t("Help") })}>
                      {availability.reason}
                    </InfoPopover>
                  </div>
                ) : (
                  row
                )}
              </Fragment>
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
              label={<Text tone="secondary">{t("Account no longer available")}</Text>}
              key={id}
              className="content-check content-account"
            />
          ))}
      </FieldGroup>
      <FieldGroup legend={t("When")} gap="sm" className="content-when" disabled={disabled}>
        <RadioGroup
          variant="inline"
          label={t("When")}
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
          <DateTimePicker
            label={t("Date and time")}
            min={dayKey(wallClockNow())}
            required
            value={draft.scheduledAt}
            onChange={(value) => onDraft({ ...draft, scheduledAt: value })}
          />
        ) : null}
        {draft.when === "later"
          ? selected.map((account) => {
              const hint = localScheduleHint(account);
              return hint ? (
                <Text key={account.id} as="p" size="caption" tone="muted" leading="inherit">
                  {hint}
                </Text>
              ) : null;
            })
          : null}
      </FieldGroup>
      <ContentMediaField
        client={client}
        editor={editor}
        media={draft.media}
        allowTikTokPhotoUrls={selected.some(
          (account) =>
            account.platform === "tiktok" &&
            account.connection !== "browser" &&
            draft.platform[account.id]?.tiktok?.mediaType === "photo",
        )}
        allowDocument={
          selected.length > 0 && selected.every((account) => account.platform === "linkedin")
        }
        youtubeAccountId={youtubeUploadAccount}
        disabled={disabled || mediaBlocked}
        disabledReason={locked ?? (mediaBlocked ? mediaReason : undefined)}
        instagramMedia={instagramMedia}
        onChange={changeMedia}
        onBusyChange={onMediaBusyChange}
      />
      {selected.filter(hasPlatformFields).map((account) => (
        <section key={account.id} className="content-platform-section" aria-label={account.name}>
          <Divider decorative />
          <div className="content-platform-heading">
            <PlatformIcon platform={account.platform} className="icon-sm" />
            <Text size="body" weight="medium" leading="inherit">
              {t("{p0} options", { p0: account.name })}
            </Text>
          </div>
          <PlatformFields
            account={account}
            value={draft.platform[account.id] ?? {}}
            media={draft.media}
            disabled={disabled}
            creator={creators[account.id]}
            posts={snapshot?.jobs ?? []}
            onChange={(next) => onDraft(setPlatform(draft, account.id, next))}
          />
        </section>
      ))}
    </div>
  );
}
