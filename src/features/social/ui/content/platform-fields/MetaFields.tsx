import { openExternal } from "../../../../../platform/tauri/openExternal";
import { Button } from "../../../../../shared/ui/Button";
import { surfaceAttributes } from "../../../../../shared/ui/Surface";
import { Text } from "../../../../../shared/ui/Text";
import { t } from "../../../../../shared/i18n";
import { FieldGroup } from "../../../../../shared/ui/FieldGroup";
import { NativeSelect } from "../../../../../shared/ui/Select";
import { SOCIAL_PLATFORM_NAMES } from "../../../model/social";
import type { FacebookDraft } from "../contentDraft";
import type { PlatformFieldProps } from "./PlatformFields";
import { InstagramFields } from "./InstagramFields";

const FACEBOOK_STORY_COMPOSER = "https://www.facebook.com/stories/create";

/** Meta post destinations; carousel rules come from the attachments. */
export function MetaFields(props: PlatformFieldProps) {
  const { account, value, disabled, onChange } = props;
  const name = SOCIAL_PLATFORM_NAMES[account.platform];
  if (account.platform === "instagram" && account.connection !== "browser")
    return <InstagramFields {...props} />;
  if (account.platform !== "facebook")
    return (
      <Text as="p" size="caption" tone="muted" leading="inherit" className="content-platform-note">
        {t("Attach either one video or up to four images.")}
      </Text>
    );
  const target = value.facebook?.target ?? "feed";
  return (
    <FieldGroup
      legend={t("{p0} destination", { p0: name })}
      {...surfaceAttributes({ frame: "pane", edge: "block-start" }, "content-platform")}
      disabled={disabled}
    >
      <NativeSelect
        aria-label={t("{p0} destination", { p0: name })}
        value={target}
        onChange={(event) =>
          onChange({
            ...value,
            facebook: {
              target: event.target.value as FacebookDraft["target"],
              frameRate: value.facebook?.frameRate,
              ...(value.facebook?.scheduledPublishAt
                ? { scheduledPublishAt: value.facebook.scheduledPublishAt }
                : {}),
            },
          })
        }
      >
        <option value="feed">{t("Page post")}</option>
        <option value="reel">{t("Reel")}</option>
        {account.connection !== "browser" ? <option value="video">{t("Video")}</option> : null}
        {account.connection !== "browser" ? <option value="story">{t("Story")}</option> : null}
      </NativeSelect>
      {account.connection === "browser" ? (
        // Stories need the Page API connection; a browser-connected Page hands off to the composer.
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            openExternal(FACEBOOK_STORY_COMPOSER).catch(() => undefined);
          }}
        >
          {t("Create a Story on Facebook")}
        </Button>
      ) : null}
      {account.connection === "browser" ? (
        <Text as="p" size="caption" tone="muted" leading="inherit">
          {t("In Facebook, switch to the Page first so the Story posts as the Page.")}
        </Text>
      ) : null}
    </FieldGroup>
  );
}
