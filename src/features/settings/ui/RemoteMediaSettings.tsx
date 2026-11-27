import { t, useLocale } from "../../../shared/i18n";
import { Row, Select } from "../../../shared/ui/settings";
import {
  REMOTE_MEDIA_MODES,
  REMOTE_MEDIA_MODE_DEFAULT,
  saveRemoteMediaMode,
  useRemoteMediaMode,
  type RemoteMediaMode,
} from "../model/remoteMediaMode";

function modeLabel(mode: RemoteMediaMode) {
  return mode === "stream"
    ? t("Play right away")
    : mode === "download"
      ? t("Download, then play")
      : t("Data saver");
}

/** How video and audio on a connected computer reach the player; shared folders never transfer. */
export function RemoteMediaRow() {
  useLocale();
  const mode = useRemoteMediaMode();
  return (
    <Row
      id="remote-media"
      label={t("Remote media")}
      modified={mode !== REMOTE_MEDIA_MODE_DEFAULT}
      onReset={() => saveRemoteMediaMode(REMOTE_MEDIA_MODE_DEFAULT)}
    >
      <Select
        hideLabel
        label={t("Remote media")}
        value={mode}
        options={REMOTE_MEDIA_MODES.map((value) => ({
          value,
          get label() {
            return modeLabel(value);
          },
          description:
            value === "stream"
              ? t("Stream while you watch.")
              : value === "download"
                ? t("Copy the whole file before playback.")
                : t("Transfer only when you choose Play or Download."),
        }))}
        onChange={(value) => {
          const next = REMOTE_MEDIA_MODES.find((item) => item === value);
          if (next) saveRemoteMediaMode(next);
        }}
      />
    </Row>
  );
}
