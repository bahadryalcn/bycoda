import { accountBlockedReason } from "./blockedReason";
import { useState } from "react";
import type {
  SnapchatMonetizationStatus,
  SnapchatProfilePatch,
  SnapchatProfileState,
} from "../../../../integrations/social/snapchat-profile";
import { formatNumber, t } from "../../../../shared/i18n";
import { Button } from "../../../../shared/ui/Button";
import { useConfirm } from "../../../../shared/ui/ConfirmDialog";
import { Disclosure } from "../../../../shared/ui/Disclosure";
import { DescriptionItem, DescriptionList } from "../../../../shared/ui/DescriptionList";
import { EmptyState } from "../../../../shared/ui/EmptyState";
import { FileField } from "../../../../shared/ui/FileField";
import { InfoPopover } from "../../../../shared/ui/InfoPopover";
import { InlineError, InlineMessage } from "../../../../shared/ui/InlineError";
import { SectionLabel } from "../../../../shared/ui/SectionLabel";
import { Surface } from "../../../../shared/ui/Surface";
import { Text } from "../../../../shared/ui/Text";
import { TextareaField } from "../../../../shared/ui/TextareaField";
import { TextField } from "../../../../shared/ui/TextField";
import type { Capability, SocialAccount } from "../../model/social";
import type { SocialClient } from "../../model/socialClient";
import { useAccountWrite } from "./useAccountWrite";
import "./platform/snapchat.css";
import { SnapchatReviews } from "./SnapchatReviews";
import { SnapchatStoryRemoval } from "./SnapchatStoryRemoval";

type Props = {
  client: SocialClient;
  account: SocialAccount;
  capabilities: Capability[];
  disabled: boolean;
  onThisComputer: boolean;
  onChanged(): void;
};

type Field = "name" | "bio" | "website" | "category";
const fields: Field[] = ["name", "bio", "website", "category"];
const labels: Record<Field, () => string> = {
  name: () => t("Profile name"),
  bio: () => t("About"),
  website: () => t("Website"),
  category: () => t("Category"),
};

function monetizationText(status: SnapchatMonetizationStatus["status"]) {
  switch (status) {
    case "eligible":
      return t("Eligible");
    case "ineligible":
      return t("Not eligible");
    case "unavailable":
      return t("Unavailable");
    case "unknown":
      return t("Unknown");
  }
}

export function SnapchatProfilePanel({
  client,
  account,
  capabilities,
  disabled,
  onThisComputer,
  onChanged,
}: Props) {
  const browser = account.connection === "browser";
  const [profile, setProfile] = useState<SnapchatProfileState>();
  const [draft, setDraft] = useState<Partial<Record<Field, string>>>({});
  const [avatar, setAvatar] = useState<{ file: File; uploadId?: string }>();
  const [status, setStatus] = useState<SnapchatMonetizationStatus>();
  const [checkBeforeSaving, setCheckBeforeSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const { failureTitle, details, is, write } = useAccountWrite(
    t("The profile could not be verified. Read the profile again before saving."),
  );
  const confirmation = useConfirm();
  const busy = is("read") || is("write") || is("monetization");
  const capability = capabilities.find((item) => item.operation === "profile.read");
  const connectionBlocked =
    !account.connected ||
    !account.accessApproved ||
    (browser ? account.paused : capability?.status !== "available");
  const blocked = disabled || !onThisComputer || connectionBlocked;
  const blockedReason = disabled
    ? accountBlockedReason(true)
    : !onThisComputer
      ? t("Open this account on the computer it is connected to.")
      : connectionBlocked
        ? capability?.reason || t("Connection needed")
        : accountBlockedReason(false);
  const hasProfile = profile?.hasPublicProfile === true;
  const read = () =>
    write("read", async () => {
      const next = await client.snapchatProfileRead(account.id);
      setProfile(next);
      setCheckBeforeSaving(false);
      setSaved(false);
    });
  const current = (field: Field) => draft[field] ?? profile?.[field] ?? "";
  const patch: SnapchatProfilePatch = {};
  for (const field of fields) {
    const value = draft[field];
    if (value !== undefined && value.trim() !== (profile?.[field] ?? ""))
      patch[field] = value.trim();
  }
  const canEdit = browser && (hasProfile || account.accountType === "member");
  const canSave =
    canEdit &&
    profile !== undefined &&
    !checkBeforeSaving &&
    (hasProfile ? Object.keys(patch).length > 0 || !!avatar : current("name").trim() !== "");
  const confirmRequest = {
    title: hasProfile ? t("Save changes?") : t("Create Public Profile"),
    message: t("Public profile fields of {p0}.", { p0: account.name }),
    details: [
      ...fields
        .filter((field) => patch[field] !== undefined && (hasProfile || field === "name"))
        .map((field) => (
          <Text key={field} as="p" size="secondary" wrap="anywhere">
            {labels[field]()} · {patch[field] || t("Empty")}
          </Text>
        )),
      ...(hasProfile && avatar
        ? [
            <Text key="avatar" as="p" size="secondary">
              {t("Profile picture")} · {avatar.file.name}
            </Text>,
          ]
        : []),
    ],
    confirmLabel: hasProfile ? t("Save changes") : t("Create Public Profile"),
    danger: false,
    onConfirm: async () => {
      if (!canSave || blocked || busy) throw new Error(t("Action unavailable."));
      await write("write", async () => {
        setSaved(false);
        let uploadId = avatar?.uploadId;
        if (hasProfile && avatar && !uploadId) {
          uploadId = (await client.upload(avatar.file)).uploadId;
          setAvatar({ file: avatar.file, uploadId });
        }
        setCheckBeforeSaving(true);
        const result = hasProfile
          ? await client.snapchatProfileUpdate(account.id, {
              ...patch,
              ...(uploadId ? { avatarUploadId: uploadId } : {}),
            })
          : await client.snapchatProfileCreate(account.id, {
              name: current("name").trim(),
            });
        setProfile(result);
        setDraft({});
        setAvatar(undefined);
        setCheckBeforeSaving(false);
        setSaved(true);
        onChanged();
      });
    },
  };
  return (
    <>
      <Disclosure summary={t("Snapchat Public Profile")} variant="row">
        <div className="social-sc-stack">
          <div className="social-sc-toolbar">
            <Button
              size="sm"
              variant={profile ? "secondary" : "primary"}
              disabled={blocked || busy}
              disabledReason={blockedReason}
              loading={is("read")}
              onClick={() => void read().catch(() => undefined)}
            >
              {t("Read profile")}
            </Button>
            {browser ? (
              <Button
                size="sm"
                variant="secondary"
                disabled={blocked || busy}
                disabledReason={blockedReason}
                loading={is("monetization")}
                onClick={() =>
                  void write("monetization", async () =>
                    setStatus(await client.snapchatMonetization(account.id)),
                  ).catch(() => undefined)
                }
              >
                {t("Snapchat monetization status")}
              </Button>
            ) : null}
          </div>
          {!profile && !is("read") && !connectionBlocked ? (
            <Text as="p" size="secondary" tone="muted">
              {t("Read the profile to see it and edit it here.")}
            </Text>
          ) : null}
          {failureTitle ? <InlineError details={details}>{failureTitle}</InlineError> : null}
          {saved ? <InlineMessage tone="success">{t("Changes saved.")}</InlineMessage> : null}
          {status ? (
            <Surface variant="inset" padding="sm" className="social-sc-group">
              <Text as="p">
                {t("Snapchat monetization status")} · {monetizationText(status.status)}
              </Text>
              {status.dailyRewardsEligible !== undefined ? (
                <Text as="p">
                  {t("Daily rewards")} ·{" "}
                  {monetizationText(status.dailyRewardsEligible ? "eligible" : "ineligible")}
                </Text>
              ) : null}
            </Surface>
          ) : null}
          {connectionBlocked ? (
            <InlineMessage tone="warning">
              {account.paused && browser
                ? t("Paused")
                : capability?.reason || t("Connection needed")}
            </InlineMessage>
          ) : null}
          {checkBeforeSaving ? (
            <InlineMessage tone="warning">
              {t("The profile could not be verified. Read the profile again before saving.")}
            </InlineMessage>
          ) : null}
          {profile && !hasProfile ? (
            <EmptyState context="panel" size="inline" title={t("No Public Profile yet.")} />
          ) : null}
          {!browser ? (
            <>
              {profile && hasProfile ? (
                <DescriptionList size="sm">
                  {fields
                    .filter((field) => profile[field])
                    .map((field) => (
                      <DescriptionItem key={field} term={labels[field]()}>
                        {profile[field]}
                      </DescriptionItem>
                    ))}
                  {"username" in profile && typeof profile.username === "string" ? (
                    <DescriptionItem term={t("Username")}>{profile.username}</DescriptionItem>
                  ) : null}
                  {"subscribers" in profile && typeof profile.subscribers === "number" ? (
                    <DescriptionItem term={t("Subscribers")}>
                      {formatNumber(profile.subscribers)}
                    </DescriptionItem>
                  ) : null}
                </DescriptionList>
              ) : null}
              <Text as="p" size="secondary" tone="muted">
                {t("Edit the profile using a connected Snapchat browser account.")}
              </Text>
            </>
          ) : profile && canEdit ? (
            <>
              <div className="social-sc-group">
                <div className="social-card-head">
                  <SectionLabel variant="inline" size="secondary" as="h4">
                    {t("Profile details")}
                  </SectionLabel>
                  {!hasProfile ? (
                    <InfoPopover className="shrink-0">
                      {t("Add the rest of the profile after it is created.")}
                    </InfoPopover>
                  ) : null}
                </div>
                <TextField
                  label={labels.name()}
                  value={current("name")}
                  disabled={blocked || busy}
                  onChange={(event) => setDraft({ ...draft, name: event.currentTarget.value })}
                />
                {hasProfile ? (
                  <>
                    <TextareaField
                      label={labels.bio()}
                      value={current("bio")}
                      disabled={blocked || busy}
                      onChange={(event) => setDraft({ ...draft, bio: event.currentTarget.value })}
                    />
                    <div className="social-sc-grid">
                      {(["website", "category"] as const).map((field) => (
                        <TextField
                          key={field}
                          label={labels[field]()}
                          value={current(field)}
                          disabled={blocked || busy}
                          onChange={(event) =>
                            setDraft({
                              ...draft,
                              [field]: event.currentTarget.value,
                            })
                          }
                        />
                      ))}
                    </div>
                    <FileField
                      label={t("Profile picture")}
                      accept="image/jpeg,image/png"
                      disabled={blocked || busy}
                      description={avatar?.file.name}
                      onFiles={([file]) => {
                        if (file && ["image/jpeg", "image/png"].includes(file.type))
                          setAvatar({ file });
                      }}
                    />
                  </>
                ) : null}
              </div>
              <div className="social-sc-actions">
                <Button
                  variant="primary"
                  size="sm"
                  loading={is("write")}
                  disabled={blocked || busy || !canSave}
                  disabledReason={
                    blocked || busy
                      ? blockedReason
                      : checkBeforeSaving
                        ? t("Read the profile again before saving.")
                        : t("No changes to save.")
                  }
                  onClick={() => void confirmation.confirm(confirmRequest).catch(() => undefined)}
                >
                  {hasProfile ? t("Save changes") : t("Create Public Profile")}
                </Button>
                {avatar ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() => setAvatar(undefined)}
                  >
                    {t("Remove {p0}", { p0: avatar.file.name })}
                  </Button>
                ) : null}
              </div>
            </>
          ) : null}
          {browser && account.accountType === "public_profile" ? (
            <SnapchatStoryRemoval client={client} account={account} disabled={blocked || busy} />
          ) : null}
        </div>
      </Disclosure>
      <SnapchatReviews
        client={client}
        accountId={account.id}
        accountName={account.name}
        disabled={disabled}
        canApprove={!blocked && !account.paused}
      />
      {confirmation.renderDialog(confirmRequest)}
    </>
  );
}
