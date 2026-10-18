import { useState } from "react";
import { Button } from "../../../shared/ui/Button";
import { TextField } from "../../../shared/ui/TextField";
import { TextareaField } from "../../../shared/ui/TextareaField";
import type { SocialClient } from "../model/socialClient";
import type { XProfilePatch, XProfileState } from "../model/socialBrowser";

export function XProfileManager({
  accountId,
  client,
}: {
  accountId: string;
  client: SocialClient;
}) {
  const [saved, setSaved] = useState<XProfileState>();
  const [values, setValues] = useState<XProfileState>();
  const [images, setImages] = useState<Pick<XProfilePatch, "avatarUploadId" | "bannerUploadId">>(
    {},
  );
  const [handle, setHandle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const run = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError("");
    setStatus("");
    try {
      await action();
    } catch {
      setError(
        "İşlem doğrulanamadı. Bağlantıyı ve tarayıcıyı kontrol edin; yeniden kaydetmeden önce profili okuyun.",
      );
    } finally {
      setBusy(false);
    }
  };
  const patch: XProfilePatch = { ...images };
  if (saved && values)
    for (const field of ["name", "bio", "location", "website"] as const)
      if (saved[field] !== values[field]) patch[field] = values[field];
  return (
    <details>
      <summary>X profili ve takip</summary>
      <Button
        type="button"
        disabled={busy}
        onClick={() =>
          void run(async () => {
            const profile = await client.xProfileRead(accountId);
            setSaved(profile);
            setValues(profile);
            setStatus("Profil okundu.");
          })
        }
      >
        Profili oku
      </Button>
      {values ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (busy || !Object.keys(patch).length) return;
            void run(async () => {
              const profile = await client.xProfileUpdate(accountId, patch);
              setSaved(profile);
              setValues(profile);
              setImages({});
              setStatus("Profil kaydı yeniden okunarak doğrulandı.");
            });
          }}
        >
          <fieldset disabled={busy}>
            <TextField
              label="Profil adı"
              maxLength={50}
              required
              value={values.name}
              onChange={(e) => setValues({ ...values, name: e.target.value })}
            />
            <TextareaField
              label="Hakkında"
              maxLength={160}
              value={values.bio}
              onChange={(e) => setValues({ ...values, bio: e.target.value })}
            />
            <TextField
              label="Konum"
              maxLength={30}
              value={values.location}
              onChange={(e) => setValues({ ...values, location: e.target.value })}
            />
            <TextField
              label="Web sitesi"
              type="url"
              maxLength={100}
              value={values.website}
              onChange={(e) => setValues({ ...values, website: e.target.value })}
            />
            {(["avatarUploadId", "bannerUploadId"] as const).map((key) => (
              <div key={key}>
                <TextField
                  label={
                    key === "avatarUploadId"
                      ? "Profil resmi · JPEG/PNG, 5 MiB"
                      : "Kapak resmi · JPEG/PNG, 5 MiB"
                  }
                  type="file"
                  accept="image/jpeg,image/png"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    if (!file || busy) return;
                    void run(async () => {
                      const upload = await client.upload(file);
                      setImages((current) => ({ ...current, [key]: upload.uploadId }));
                      setStatus("Görsel hazır; profil kaydında uygulanacak.");
                    });
                  }}
                />
                {images[key] ? (
                  <Button
                    type="button"
                    onClick={() =>
                      setImages((current) => {
                        const next = { ...current };
                        delete next[key];
                        return next;
                      })
                    }
                  >
                    Seçilen görseli kaldır
                  </Button>
                ) : null}
              </div>
            ))}
            <Button type="submit" disabled={!Object.keys(patch).length}>
              Değişiklikleri X profiline uygula
            </Button>
          </fieldset>
        </form>
      ) : null}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (busy || !/^[A-Za-z0-9_]{1,15}$/.test(handle)) return;
          void run(async () => {
            const result = await client.xProfileFollow(accountId, handle);
            setStatus(
              result.changed
                ? `@${result.handle} takip edildi.`
                : `@${result.handle} zaten takip ediliyor.`,
            );
          });
        }}
      >
        <TextField
          label="Takip edilecek X kullanıcı adı"
          value={handle}
          disabled={busy}
          placeholder="kullanici_adi"
          maxLength={15}
          pattern="[A-Za-z0-9_]{1,15}"
          onChange={(e) => setHandle(e.target.value.replace(/^@/, ""))}
        />
        <Button type="submit" disabled={busy || !/^[A-Za-z0-9_]{1,15}$/.test(handle)}>
          Bu hesabı takip et
        </Button>
      </form>
      {error ? <p role="alert">{error}</p> : null}
      {status ? <p role="status">{status}</p> : null}
    </details>
  );
}
