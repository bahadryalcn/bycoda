import { useContext as useSocialContext } from "react";
import { SocialBusyContext as SocialLockContext } from "./socialContext";
import { useContext, useRef, useState } from "react";
import { Badge } from "../../../shared/ui/Badge";
import { Button } from "../../../shared/ui/Button";
import { TextField } from "../../../shared/ui/TextField";
import { TextareaField } from "../../../shared/ui/TextareaField";
import { Progress } from "../../../shared/ui/Progress";
import { t, useLocale } from "../../../shared/i18n";
import type { SocialClient } from "../model/socialClient";
import type { XProfilePatch, XProfileState } from "../model/socialBrowser";
import { SocialBusyContext } from "./socialContext";

export function XProfileManager({
  accountId,
  accountName,
  client,
}: {
  accountId: string;
  /** Shown beside the actions that write to this X account. */
  accountName?: string;
  client: SocialClient;
}) {
  const socialLocked = useSocialContext(SocialLockContext);
  useLocale();
  const [saved, setSaved] = useState<XProfileState>();
  const [values, setValues] = useState<XProfileState>();
  const [images, setImages] = useState<Pick<XProfilePatch, "avatarUploadId" | "bannerUploadId">>(
    {},
  );
  const [handle, setHandle] = useState("");
  const [pending, setPending] = useState<string>();
  const workspaceBusy = useContext(SocialBusyContext);
  const occupied = useRef(false);
  const busy = !!pending || workspaceBusy;
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const run = async (key: string, action: () => Promise<void>) => {
    if (busy || occupied.current) return;
    occupied.current = true;
    setPending(key);
    setError("");
    setStatus("");
    try {
      await action();
    } catch {
      setError(
        t(
          "The action could not be verified. Check the connection and browser, and read the profile before saving again.",
        ),
      );
    } finally {
      occupied.current = false;
      setPending(undefined);
    }
  };
  const patch: XProfilePatch = { ...images };
  if (saved && values)
    for (const field of ["name", "bio", "location", "website"] as const)
      if (saved[field] !== values[field]) patch[field] = values[field];
  const handleValid = /^[A-Za-z0-9_]{1,15}$/.test(handle);
  const account = accountName ? (
    <Badge variant="label" appearance="outline">
      {t("Account: {p0}", { p0: accountName })}
    </Badge>
  ) : null;
  return (
    <details>
      <summary>{t("X profile and following")}</summary>
      <Button
        type="button"
        variant="secondary"
        disabled={socialLocked || busy}
        loading={pending === "read"}
        onClick={() =>
          void run("read", async () => {
            const profile = await client.xProfileRead(accountId);
            setSaved(profile);
            setValues(profile);
            setStatus(t("Profile read."));
          })
        }
      >
        {t("Read profile")}
      </Button>
      {values ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (busy || !Object.keys(patch).length) return;
            void run("save", async () => {
              const profile = await client.xProfileUpdate(accountId, patch);
              setSaved(profile);
              setValues(profile);
              setImages({});
              setStatus(t("Profile save was verified by reading it back."));
            });
          }}
        >
          <fieldset>
            <TextField
              label={t("Profile name")}
              disabled={socialLocked || busy}
              maxLength={50}
              required
              value={values.name}
              onChange={(e) => setValues({ ...values, name: e.target.value })}
            />
            <TextareaField
              label={t("About")}
              disabled={socialLocked || busy}
              maxLength={160}
              value={values.bio}
              onChange={(e) => setValues({ ...values, bio: e.target.value })}
            />
            <TextField
              label={t("Location")}
              disabled={socialLocked || busy}
              maxLength={30}
              value={values.location}
              onChange={(e) => setValues({ ...values, location: e.target.value })}
            />
            <TextField
              label={t("Website")}
              disabled={socialLocked || busy}
              type="url"
              maxLength={100}
              value={values.website}
              onChange={(e) => setValues({ ...values, website: e.target.value })}
            />
            {(["avatarUploadId", "bannerUploadId"] as const).map((key) => (
              <div key={key}>
                <TextField
                  disabled={socialLocked || busy}
                  label={
                    key === "avatarUploadId"
                      ? t("Profile image · JPEG/PNG, 5 MiB")
                      : t("Cover image · JPEG/PNG, 5 MiB")
                  }
                  type="file"
                  accept="image/jpeg,image/png"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    if (!file || busy) return;
                    void run(key, async () => {
                      const upload = await client.upload(file);
                      setImages((current) => ({ ...current, [key]: upload.uploadId }));
                      setStatus(t("Image is ready; it will be applied when the profile is saved."));
                    });
                  }}
                />
                {pending === key ? <Progress label={t("Operation in progress…")} /> : null}
                {images[key] ? (
                  <Button
                    disabled={socialLocked || busy}
                    type="button"
                    variant="secondary"
                    tone="danger"
                    onClick={() =>
                      setImages((current) => {
                        const next = { ...current };
                        delete next[key];
                        return next;
                      })
                    }
                  >
                    {t("Remove selected image")}
                  </Button>
                ) : null}
              </div>
            ))}
            {!Object.keys(patch).length ? (
              <p className="social-muted">{t("No profile changes to apply.")}</p>
            ) : null}
            <div className="social-actions">
              <Button
                type="submit"
                loading={pending === "save"}
                disabled={socialLocked || busy || !Object.keys(patch).length}
              >
                {t("Apply changes to X profile")}
              </Button>
              {account}
            </div>
          </fieldset>
        </form>
      ) : null}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (busy || !handleValid) return;
          void run("follow", async () => {
            const result = await client.xProfileFollow(accountId, handle);
            setStatus(
              result.changed
                ? t("Followed @{p0}.", { p0: result.handle })
                : t("Already following @{p0}.", { p0: result.handle }),
            );
          });
        }}
      >
        <TextField
          label={t("X username to follow")}
          value={handle}
          disabled={socialLocked || busy}
          placeholder={t("username")}
          maxLength={15}
          pattern="[A-Za-z0-9_]{1,15}"
          onChange={(e) => setHandle(e.target.value.replace(/^@/, ""))}
        />
        {handle && !handleValid ? (
          <p className="social-muted">{t("Use up to 15 letters, digits or underscores.")}</p>
        ) : null}
        <div className="social-actions">
          <Button
            type="submit"
            loading={pending === "follow"}
            disabled={socialLocked || busy || !handleValid}
          >
            {t("Follow this account")}
          </Button>
          {account}
        </div>
      </form>
      {error ? <p role="alert">{error}</p> : null}
      {status ? <p role="status">{status}</p> : null}
    </details>
  );
}
