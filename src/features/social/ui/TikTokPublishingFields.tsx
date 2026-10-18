import { useQuery } from "@tanstack/react-query";
import { Button } from "../../../shared/ui/Button";
import { Checkbox } from "../../../shared/ui/Checkbox";
import { TextField } from "../../../shared/ui/TextField";
import { NativeSelect } from "../../../shared/ui/Select";
import { Notice } from "./socialShared";
import type { CampaignVariant, TikTokVideoOptions } from "../model/social";
import type { SocialClient } from "../model/socialClient";
import { socialQueryScope } from "../model/socialQuery";

export const tiktokDefaults: TikTokVideoOptions = {
  privacy: "",
  durationSeconds: 0,
  allowComment: false,
  allowDuet: false,
  allowStitch: false,
  brandContent: false,
  brandOrganic: false,
  isAigc: false,
  consent: false,
};
const privacyLabels: Record<string, string> = {
  PUBLIC_TO_EVERYONE: "Herkes",
  MUTUAL_FOLLOW_FRIENDS: "Arkadaşlar",
  FOLLOWER_OF_CREATOR: "Takipçiler",
  SELF_ONLY: "Yalnız ben",
};
export function TikTokPublishingFields({
  variant,
  client,
  onChange,
}: {
  variant: CampaignVariant;
  client: SocialClient;
  onChange: (patch: Partial<CampaignVariant>) => void;
}) {
  const options = variant.tiktok ?? tiktokDefaults;
  const creator = useQuery({
    queryKey: [...socialQueryScope(client), "tiktok-creator", variant.accountId],
    queryFn: () => client.tiktokCreator(variant.accountId),
    staleTime: 0,
    refetchOnWindowFocus: false,
    retry: false,
  });
  const info = creator.data;
  const change = (patch: Partial<TikTokVideoOptions>) =>
    onChange({
      tiktok: {
        ...options,
        consent: false,
        ...patch,
        ...(info?.commentDisabled ? { allowComment: false } : {}),
        ...(info?.duetDisabled ? { allowDuet: false } : {}),
        ...(info?.stitchDisabled ? { allowStitch: false } : {}),
      },
    });
  return (
    <fieldset>
      <legend>TikTok video yayını</legend>
      {info ? (
        <p>
          Hesap: {info.nickname} · En fazla {info.maxDurationSeconds} saniye
        </p>
      ) : (
        <Notice kind={creator.isError ? "error" : "loading"}>
          {creator.isError
            ? "TikTok yayın iznini kontrol edin; hesabı video.publish izniyle yeniden bağlayıp tekrar deneyin."
            : "TikTok yayın ayarları okunuyor…"}
        </Notice>
      )}
      <Button
        type="button"
        variant="secondary"
        loading={creator.isFetching}
        disabled={creator.isFetching}
        onClick={() => void creator.refetch()}
      >
        Yayın ayarlarını yenile
      </Button>
      <label>
        Doğrulanmış alanda HTTPS video URL
        <TextField
          hideLabel
          label=""
          type="url"
          value={variant.media[0]?.url ?? ""}
          onChange={(event) =>
            onChange({
              media: event.target.value ? [{ kind: "video", url: event.target.value }] : [],
              tiktok: { ...options, durationSeconds: 0, consent: false },
            })
          }
        />
      </label>
      <small>
        URL alanı veya öneki TikTok geliştirici uygulamasında doğrulanmış olmalı. Video TikTok
        tarafından bu adresten alınır.
      </small>
      {variant.media[0]?.url ? (
        <video
          className="max-w-full"
          controls
          preload="metadata"
          src={variant.media[0].url}
          onLoadedMetadata={(event) => {
            const duration = event.currentTarget.duration;
            if (Number.isFinite(duration) && duration > 0 && duration !== options.durationSeconds)
              change({ durationSeconds: duration });
          }}
          onError={() => {
            if (options.durationSeconds) change({ durationSeconds: 0 });
          }}
        />
      ) : null}
      <label>
        Görünürlük
        <NativeSelect
          aria-label="Görünürlük"
          required
          value={options.privacy}
          disabled={!info || creator.isFetching || creator.isError}
          onChange={(event) => change({ privacy: event.target.value })}
        >
          <option value="">Görünürlük seçin</option>
          {info?.privacyOptions.map((value) => (
            <option value={value} key={value}>
              {privacyLabels[value]}
            </option>
          ))}
        </NativeSelect>
      </label>
      {(
        [
          ["allowComment", "Yorumlara izin ver", info?.commentDisabled],
          ["allowDuet", "Düete izin ver", info?.duetDisabled],
          ["allowStitch", "Stitch’e izin ver", info?.stitchDisabled],
        ] as const
      ).map(([key, label, blocked]) => (
        <label key={key}>
          <Checkbox
            checked={options[key] && !blocked}
            disabled={!info || !!blocked}
            onChange={(event) => change({ [key]: event.target.checked })}
          />
          {label}
        </label>
      ))}
      <label>
        <Checkbox
          checked={options.brandOrganic}
          onChange={(event) => change({ brandOrganic: event.target.checked })}
        />
        Kendi markamı tanıtıyor
      </label>
      <label>
        <Checkbox
          checked={options.brandContent}
          onChange={(event) => change({ brandContent: event.target.checked })}
        />
        Ücretli marka işbirliği içeriyor
      </label>
      <label>
        <Checkbox
          checked={options.isAigc}
          onChange={(event) => change({ isAigc: event.target.checked })}
        />
        Yapay zekâ ile üretilmiş içerik
      </label>
      {options.brandContent && options.privacy === "SELF_ONLY" ? (
        <Notice kind="error">
          Ücretli marka işbirliği için yalnız ben görünürlüğü kullanılamaz.
        </Notice>
      ) : null}
      <label>
        <Checkbox
          checked={options.consent}
          disabled={
            !info ||
            creator.isFetching ||
            creator.isError ||
            !info.privacyOptions.includes(options.privacy) ||
            !options.durationSeconds ||
            options.durationSeconds > info.maxDurationSeconds
          }
          onChange={(event) => change({ consent: event.target.checked })}
        />
        Videoyu önizledim; TikTok’a göndermeyi ve{" "}
        <a
          href="https://www.tiktok.com/legal/page/global/music-usage-confirmation/en"
          target="_blank"
          rel="noreferrer"
        >
          Music Usage Confirmation
        </a>
        {options.brandContent || options.brandOrganic ? (
          <>
            {" "}
            ile{" "}
            <a
              href="https://www.tiktok.com/legal/page/global/bc-policy/en"
              target="_blank"
              rel="noreferrer"
            >
              Branded Content Policy
            </a>
          </>
        ) : null}{" "}
        koşullarını onaylıyorum.
      </label>
      {options.brandContent || options.brandOrganic ? (
        <p>İçerik etiketi: {options.brandContent ? "Paid partnership" : "Promotional content"}</p>
      ) : null}
      <small>
        Bu seçimler kaydedilir; gönderim ayrıca kampanya onayı ve açık gönderim izni gerektirir.
        TikTok uygulama onayı yoksa herkese açık yayın kullanılamayabilir.
      </small>
    </fieldset>
  );
}
