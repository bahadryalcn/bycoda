import { t, useLocale } from "../../../shared/i18n";
import { Group, Row, Select } from "../../../shared/ui/settings";
import { InfoPopover } from "../../../shared/ui/InfoPopover";
import {
  REMOTE_MEDIA_MODES,
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
export function RemoteMediaSettings() {
  useLocale();
  const mode = useRemoteMediaMode();
  return (
    <Group title={t("Remote files")}>
      <Row
        id="remote-media"
        label={t("Remote media")}
        info={
          <InfoPopover className="shrink-0" label={t("Remote media")}>
            <p>
              {t(
                "Play right away streams from the connected computer as you watch. Download, then play copies the whole file first. Data saver transfers nothing until you choose Play or Download. A finished copy of the same file version is reused, and shared folders always play in place.",
              )}
            </p>
          </InfoPopover>
        }
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
          }))}
          onChange={(value) => {
            const next = REMOTE_MEDIA_MODES.find((item) => item === value);
            if (next) saveRemoteMediaMode(next);
          }}
        />
      </Row>
    </Group>
  );
}
