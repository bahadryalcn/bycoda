import { useState } from "react";
import { useT } from "../../../../../shared/i18n";
import { Button } from "../../../../../shared/ui/Button";
import { useConfirm } from "../../../../../shared/ui/ConfirmDialog";
import { Disclosure } from "../../../../../shared/ui/Disclosure";
import { FileField } from "../../../../../shared/ui/FileField";
import { InlineError, InlineMessage } from "../../../../../shared/ui/InlineError";
import { Select } from "../../../../../shared/ui/Select";
import { TextField } from "../../../../../shared/ui/TextField";
import type { SocialAccount } from "../../../model/social";
import type {
  FacebookBrowserProfilePatch,
  FacebookPersonalName,
  FacebookProfileDetail,
} from "../../../model/socialBrowser";
import type { SocialClient } from "../../../model/socialClient";
import { useAccountWrite } from "../useAccountWrite";
import "./facebook.css";

type Props = { account: SocialAccount; client: SocialClient };

export function FacebookProfilePhotos({ account, client }: Props) {
  const t = useT();
  const [kind, setKind] = useState("avatar");
  const [file, setFile] = useState<File>();
  const [saved, setSaved] = useState(false);
  const { error, is, write } = useAccountWrite(t("Could not save this change. Try again."));
  const confirm = useConfirm();
  const label = kind === "avatar" ? t("Facebook profile picture") : t("Facebook cover photo");
  const save = async () => {
    if (
      !file ||
      !(await confirm.confirm({ title: label, message: account.name, confirmLabel: t("Save") }))
    )
      return;
    const result = await write("photo", async () => {
      const { uploadId } = await client.upload(file);
      if (account.connection === "browser") {
        await client.browserProfileUpdate(
          account.id,
          "facebook",
          kind === "avatar" ? { avatarUploadId: uploadId } : { bannerUploadId: uploadId },
        );
      } else {
        await client.request("facebook.page.uploadPhoto", {
          accountId: account.id,
          kind,
          uploadId,
          confirm: "UPLOAD_FACEBOOK_PAGE_PHOTO",
        });
      }
      return true;
    });
    if (result) {
      setFile(undefined);
      setSaved(true);
    }
  };
  return (
    <div className="social-fb-stack">
      <Select
        label={t("Facebook photo type")}
        value={kind}
        options={[
          { value: "avatar", label: t("Facebook profile picture") },
          { value: "cover", label: t("Facebook cover photo") },
        ]}
        disabled={is("photo")}
        onValueChange={(value) => {
          setKind(value);
          setFile(undefined);
          setSaved(false);
        }}
      />
      <FileField
        label={t("Image")}
        accept={
          account.connection === "browser"
            ? "image/jpeg,image/png,image/webp"
            : "image/jpeg,image/png"
        }
        disabled={is("photo")}
        hint={file?.name}
        onFiles={([image]) => {
          setFile(image);
          setSaved(false);
        }}
      />
      <Button
        variant="secondary"
        size="sm"
        className="self-start"
        loading={is("photo")}
        disabled={!file}
        onClick={() => void save().catch(() => undefined)}
      >
        {t("Save")}
      </Button>
      {saved ? <InlineMessage tone="info">{t("Saved")}</InlineMessage> : null}
      {error ? <InlineError>{error}</InlineError> : null}
      {confirm.dialog}
    </div>
  );
}

export function FacebookPersonalProfileForm({ account, client }: Props) {
  const t = useT();
  const [field, setField] = useState("bio");
  const [drafts, setDrafts] = useState<Partial<Record<string, string>>>({});
  const [existing, setExisting] = useState<Partial<Record<string, string>>>({});
  const [name, setName] = useState<FacebookPersonalName>({ first: "", middle: "", last: "" });
  const [visibility, setVisibility] = useState("show");
  const [saved, setSaved] = useState(false);
  const { error, is, write } = useAccountWrite(t("Could not save this change. Try again."));
  const confirm = useConfirm();
  const details = {
    work: t("Facebook workplace"),
    school: t("Facebook high school"),
    college: t("Facebook college"),
    currentCity: t("Facebook current city"),
    hometown: t("Facebook hometown"),
  };
  const fields = {
    bio: t("Facebook profile bio"),
    introDetail: t("Facebook intro details"),
    website: t("Website"),
    name: t("Profile name"),
    ...details,
  };
  const label = fields[field as keyof typeof fields];
  const draft = drafts[field] ?? "";
  const current = existing[field]?.trim();
  const valid =
    field === "name"
      ? Boolean(name.first.trim() && name.last.trim())
      : field === "bio"
        ? drafts.bio !== undefined
        : Boolean(draft.trim() && draft.trim() !== current);
  const save = async () => {
    if (
      !valid ||
      !(await confirm.confirm({ title: label, message: account.name, confirmLabel: t("Save") }))
    )
      return;
    const patch: FacebookBrowserProfilePatch =
      field === "name"
        ? { personalName: name }
        : field === "bio"
          ? { bio: draft }
          : field === "introDetail"
            ? { introDetail: { label: draft, visible: visibility === "show" } }
            : field === "website"
              ? current
                ? { websiteUpdate: { current, value: draft } }
                : { website: draft }
              : {
                  detail: {
                    field: field as FacebookProfileDetail,
                    value: draft,
                    ...(current ? { current } : {}),
                  },
                };
    const result = await write("profile", () =>
      client.browserProfileUpdate(account.id, "facebook", patch),
    );
    if (result) setSaved(true);
  };
  return (
    <div className="social-fb-stack">
      <Select
        label={t("Profile details")}
        value={field}
        options={Object.entries(fields).map(([value, label]) => ({ value, label }))}
        disabled={is("profile")}
        onValueChange={(value) => {
          setField(value);
          setSaved(false);
        }}
      />
      {field === "name" ? (
        <div className="social-fb-grid">
          {(
            [
              ["first", t("First name")],
              ["middle", t("Facebook middle name")],
              ["last", t("Last name")],
            ] as const
          ).map(([key, label]) => (
            <TextField
              key={key}
              label={label}
              value={name[key]}
              maxLength={75}
              disabled={is("profile")}
              onChange={(event) => {
                setName({ ...name, [key]: event.currentTarget.value });
                setSaved(false);
              }}
            />
          ))}
        </div>
      ) : (
        <TextField
          label={field === "introDetail" ? t("Facebook detail label") : label}
          value={draft}
          maxLength={field === "website" ? 2048 : field === "bio" ? 101 : 100}
          disabled={is("profile")}
          onChange={(event) => {
            setDrafts({ ...drafts, [field]: event.currentTarget.value });
            setSaved(false);
          }}
        />
      )}
      {field !== "name" && field !== "bio" && field !== "introDetail" ? (
        <Disclosure summary={t("Replace a value already on Facebook")} variant="row">
          <TextField
            label={t("Existing Facebook value (optional)")}
            description={t("Type the current value exactly as Facebook shows it to replace it.")}
            value={existing[field] ?? ""}
            maxLength={field === "website" ? 2048 : 100}
            disabled={is("profile")}
            onChange={(event) => {
              setExisting({ ...existing, [field]: event.currentTarget.value });
              setSaved(false);
            }}
          />
        </Disclosure>
      ) : null}
      {field === "introDetail" ? (
        <Select
          label={t("Visibility")}
          value={visibility}
          options={[
            { value: "show", label: t("Show") },
            { value: "hide", label: t("Hide from intro") },
          ]}
          disabled={is("profile")}
          onValueChange={(value) => {
            setVisibility(value);
            setSaved(false);
          }}
        />
      ) : null}
      <Button
        variant="primary"
        size="sm"
        className="self-start"
        loading={is("profile")}
        disabled={!valid || saved}
        onClick={() => void save().catch(() => undefined)}
      >
        {t("Save profile")}
      </Button>
      {saved ? <InlineMessage tone="info">{t("Saved")}</InlineMessage> : null}
      {error ? <InlineError>{error}</InlineError> : null}
      {confirm.dialog}
    </div>
  );
}
