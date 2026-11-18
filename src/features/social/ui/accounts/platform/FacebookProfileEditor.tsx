import { useState } from "react";
import { useFormat, useLocale, useT } from "../../../../../shared/i18n";
import { Button } from "../../../../../shared/ui/Button";
import { useConfirm } from "../../../../../shared/ui/ConfirmDialog";
import { Disclosure } from "../../../../../shared/ui/Disclosure";
import { FieldGroup } from "../../../../../shared/ui/FieldGroup";
import { InlineError, InlineMessage } from "../../../../../shared/ui/InlineError";
import { Text } from "../../../../../shared/ui/Text";
import { TextareaField } from "../../../../../shared/ui/TextareaField";
import { TextField } from "../../../../../shared/ui/TextField";
import { TimePicker } from "../../../../../shared/ui/TimePicker";
import type {
  FacebookPagePatch,
  FacebookPageUpdate,
} from "../../../../../integrations/social/adapters/facebook-page-edit";
import type { FacebookPageProfile } from "../../../../../integrations/social/adapters/facebook-page";
import type { SocialAccount } from "../../../model/social";
import type { SocialClient } from "../../../model/socialClient";
import { useAccountWrite } from "../useAccountWrite";
import { weekdayLabels } from "../accountsModel";

type ProfileDraft = Pick<
  FacebookPagePatch,
  "about" | "description" | "website" | "phone" | "avatarPhotoId" | "coverPhotoId"
>;
const weekdays = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

export function FacebookProfileEditor({
  client,
  account,
}: {
  client: SocialClient;
  account: SocialAccount;
}) {
  const t = useT();
  const locale = useLocale();
  const format = useFormat();
  const [profile, setProfile] = useState<FacebookPageProfile>();
  const [patch, setPatch] = useState<FacebookPagePatch>({});
  const [emails, setEmails] = useState<string>();
  const [reviewRequired, setReviewRequired] = useState(false);
  const [browserPatch, setBrowserPatch] = useState<{ name?: string; username?: string }>({});
  const [notice, setNotice] = useState("");
  const { error, write, is } = useAccountWrite(t("Could not save this change. Try again."));
  const confirm = useConfirm();
  const browser = account.connection === "browser";

  const read = async () => {
    const result = await write("read", () =>
      client.request<FacebookPageProfile>("facebook.page.read", { accountId: account.id }),
    );
    if (result) {
      setProfile(result);
      setReviewRequired(false);
    }
  };
  const save = async () => {
    if (
      !(await confirm.confirm({
        title: t("Save profile"),
        message: account.name,
        confirmLabel: t("Save"),
      }))
    )
      return;
    setNotice("");
    if (browser) {
      const result = await write("save", () =>
        client.browserProfileUpdate(account.id, "facebook", browserPatch),
      );
      if (result) {
        setBrowserPatch({});
        setNotice(t("Saved"));
      }
      return;
    }
    const result = await write("save", () =>
      client.request<FacebookPageUpdate>("facebook.page.update", {
        accountId: account.id,
        patch: {
          ...patch,
          ...(emails === undefined
            ? {}
            : {
                emails: emails
                  .split(/[,\n]/)
                  .map((entry) => entry.trim())
                  .filter(Boolean),
              }),
        },
        confirm: "UPDATE_FACEBOOK_PAGE",
      }),
    );
    if (!result) return;
    if (result.updated.includes("emails")) setEmails(undefined);
    setPatch(
      Object.fromEntries(
        Object.entries(patch).filter(
          ([key]) => !result.updated.includes(key as keyof FacebookPagePatch),
        ),
      ),
    );
    if (result.status === "partial") {
      setReviewRequired(true);
      setNotice(t("Some Facebook changes are unconfirmed. Read the profile before trying again."));
      return;
    }
    setNotice(t("Saved"));
    await read();
  };
  const field = (key: keyof ProfileDraft, label: string, maxLength: number) => (
    <TextField
      label={label}
      maxLength={maxLength}
      value={
        patch[key] ??
        (key === "avatarPhotoId" || key === "coverPhotoId" ? "" : (profile?.[key] ?? ""))
      }
      disabled={is("save")}
      onChange={(event) => setPatch({ ...patch, [key]: event.currentTarget.value })}
    />
  );
  const hours = patch.hours ?? profile?.hours ?? {};
  const hoursField = (key: string, label: string) => (
    <TimePicker
      label={label}
      value={hours[key] ?? ""}
      clearable
      disabled={is("save")}
      onChange={(value) => {
        const next = { ...hours };
        if (value) next[key] = value;
        else delete next[key];
        setPatch({ ...patch, hours: next });
      }}
    />
  );

  return (
    <section className="social-card" aria-label={t("Edit profile")}>
      {browser ? (
        <div className="social-field-row">
          <TextField
            label={t("Profile name")}
            value={browserPatch.name ?? ""}
            disabled={is("save")}
            onChange={(event) => setBrowserPatch({ name: event.currentTarget.value })}
          />
          <TextField
            label={t("Username")}
            value={browserPatch.username ?? ""}
            disabled={is("save")}
            onChange={(event) => setBrowserPatch({ username: event.currentTarget.value })}
          />
        </div>
      ) : (
        <>
          <Button
            variant="secondary"
            size="sm"
            className="self-start"
            loading={is("read")}
            onClick={() => void read().catch(() => undefined)}
          >
            {t("Read profile")}
          </Button>
          {profile ? (
            <>
              <Text as="p">
                {[profile.name, profile.username && `@${profile.username}`, profile.category]
                  .filter(Boolean)
                  .join(" · ")}
              </Text>
              <div className="social-field-row">
                <Text as="span">
                  {t("Followers")}{" "}
                  {profile.followersCount === undefined
                    ? t("Unavailable")
                    : format.formatNumber(profile.followersCount)}
                </Text>
                <Text as="span">
                  {t("Likes")}{" "}
                  {profile.fanCount === undefined
                    ? t("Unavailable")
                    : format.formatNumber(profile.fanCount)}
                </Text>
              </div>
              {field("about", t("About"), 100)}
              <TextareaField
                label={t("Description")}
                value={patch.description ?? profile.description ?? ""}
                maxLength={2000}
                disabled={is("save")}
                onChange={(event) => setPatch({ ...patch, description: event.currentTarget.value })}
              />
              <div className="social-field-row">
                {field("website", t("Website"), 2048)}
                {field("phone", t("Phone"), 100)}
              </div>
              <TextareaField
                label={t("Email")}
                value={emails ?? (profile.emails ?? []).join("\n")}
                disabled={is("save")}
                onChange={(event) => setEmails(event.currentTarget.value)}
              />
              <Disclosure summary={t("Hours")} variant="row">
                {weekdayLabels(locale).map(({ day, label }) => (
                  <FieldGroup key={day} legend={label} layout="row">
                    {hoursField(`${weekdays[day]}_1_open`, t("Start"))}
                    {hoursField(`${weekdays[day]}_1_close`, t("End"))}
                    {hoursField(`${weekdays[day]}_2_open`, t("Start"))}
                    {hoursField(`${weekdays[day]}_2_close`, t("End"))}
                  </FieldGroup>
                ))}
              </Disclosure>
              <div className="social-field-row">
                {field("avatarPhotoId", t("Profile photo ID"), 25)}
                {field("coverPhotoId", t("Cover photo ID"), 25)}
              </div>
            </>
          ) : null}
        </>
      )}
      <Button
        variant="primary"
        size="sm"
        className="self-start"
        disabled={
          browser
            ? !Object.values(browserPatch).some((value) => value.trim())
            : reviewRequired || (!Object.keys(patch).length && emails === undefined)
        }
        loading={is("save")}
        onClick={() => void save().catch(() => undefined)}
      >
        {t("Save profile")}
      </Button>
      {notice ? <InlineMessage tone="info">{notice}</InlineMessage> : null}
      {error ? <InlineError>{error}</InlineError> : null}
      {confirm.dialog}
    </section>
  );
}
