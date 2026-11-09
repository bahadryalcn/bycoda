import { useRef, useState } from "react";
import { openExternal } from "../../../platform/tauri/openExternal";
import { Button } from "../../../shared/ui/Button";
import { Badge } from "../../../shared/ui/Badge";
import { DropdownMenu } from "../../../shared/ui/DropdownMenu";
import { MoreHorizontal } from "../../../shared/ui/icons";
import { TextField } from "../../../shared/ui/TextField";
import { InfoPopover } from "../../../shared/ui/InfoPopover";
import { LiveText } from "../../../shared/ui/LiveText";
import { Modal } from "../../../shared/ui/Modal";
import { t } from "../../../shared/i18n";
import { Row, SettingsFeedback } from "../../settings/public/settingsControls";
import type { VoiceSettings as Preferences } from "../model/voiceSettings";
import type { PathKey, VoiceSetup } from "./useVoiceSetup";
import styles from "./VoiceSettings.module.css";

/** Setup status, install and recovery actions, and the Locate voice files dialog. */
export function VoiceSetupRow({
  setup,
  settings,
  change,
}: {
  setup: VoiceSetup;
  settings: Preferences;
  change: (patch: Partial<Preferences>) => void;
}) {
  const [moreOpen, setMoreOpen] = useState(false);
  const moreAnchor = useRef<HTMLButtonElement>(null);
  const { installing, busy, ready, visibleError, pythonMissing, message, detail } = setup;
  const paths: [PathKey, string, string][] = [
    ["python", "Python", "voice-python"],
    ["whisperPath", "Speech recognition model", "voice-whisper"],
    // Only VoxCPM2 uses a model folder the owner can choose.
    ...(settings.natural && settings.engine === "voxcpm2"
      ? [["ttsPath", "Natural voice model", "voice-tts"] as [PathKey, string, string]]
      : []),
  ];
  return (
    <>
      <Row
        id="voice-setup"
        label={settings.enabled ? t("Voice setup") : t("Dictation setup")}
        description={setup.setupHint}
        feedback={
          setup.setupError ? (
            <SettingsFeedback state="error">{message}</SettingsFeedback>
          ) : undefined
        }
      >
        <Badge
          tone={
            setup.setupError ? "danger" : ready ? "success" : setup.working ? "info" : "warning"
          }
        >
          <LiveText text={setup.setupError ? t("Needs attention") : message} />
        </Badge>
        {detail ? (
          <InfoPopover label={t("Technical details")}>
            <p className={styles.detail}>{detail}</p>
          </InfoPopover>
        ) : null}
        {!installing ? (
          <>
            {pythonMissing ? (
              <Button
                variant="primary"
                onClick={() =>
                  void openExternal("https://www.python.org/downloads/release/python-31210/").catch(
                    (cause) => {
                      setup.setError({
                        message: t("Open python.org to install Python 3.10–3.12."),
                        detail: String(cause),
                      });
                    },
                  )
                }
              >
                {t("Get Python")}
              </Button>
            ) : !ready && !visibleError ? (
              <Button variant="primary" onClick={() => setup.install()}>
                {t("Install")}
              </Button>
            ) : null}
            {setup.gpuUpgrade ? (
              <Button variant="primary" onClick={() => setup.install()}>
                {t("Install GPU support")}
              </Button>
            ) : null}
            {visibleError ? (
              <Button
                variant="ghost"
                onClick={() => {
                  setup.resetJob();
                  setup.check();
                }}
                disabled={busy}
              >
                {t("Try again")}
              </Button>
            ) : null}
            <Button
              ref={moreAnchor}
              variant="ghost"
              size="sm"
              iconOnly
              label={t("More voice setup actions")}
              tooltip={t("More voice setup actions")}
              aria-haspopup="menu"
              aria-expanded={moreOpen}
              onClick={() => setMoreOpen((open) => !open)}
            >
              <MoreHorizontal aria-hidden className="icon-sm" />
            </Button>
            {moreOpen ? (
              <DropdownMenu
                anchor={moreAnchor}
                label={t("More voice setup actions")}
                items={[
                  { kind: "item", id: "locate", label: t("Locate existing") },
                  ...((ready || pythonMissing) && !visibleError
                    ? [
                        {
                          kind: "item" as const,
                          id: "check",
                          label: t("Check again"),
                          disabled: busy,
                        },
                      ]
                    : []),
                ]}
                onClose={() => setMoreOpen(false)}
                onPick={(id) => {
                  setMoreOpen(false);
                  if (id === "locate") setup.setLocating(true);
                  else {
                    setup.resetJob();
                    setup.check();
                  }
                }}
              />
            ) : null}
          </>
        ) : null}
      </Row>
      {setup.locating ? (
        <Modal
          title={t("Locate voice files")}
          size="md"
          onClose={setup.closeLocate}
          footer={
            <Button variant="primary" onClick={setup.closeLocate}>
              {t("Done")}
            </Button>
          }
        >
          <div className={styles.locations}>
            {paths.map(([key, label, id]) => (
              <div className={styles.fieldRow} key={key}>
                <Row id={id} label={t(label)}>
                  <div className={styles.path}>
                    <TextField
                      label={t(label)}
                      hideLabel
                      aria-label={t(label)}
                      value={settings[key]}
                      placeholder={t("Automatic detection")}
                      onChange={(event) => {
                        setup.resetJob();
                        change({ [key]: event.target.value });
                      }}
                    />
                    <Button
                      disabled={installing || setup.browsing !== null}
                      loading={setup.browsing === key}
                      onClick={() => setup.browse(key)}
                    >
                      {t("Browse")}
                    </Button>
                  </div>
                </Row>
              </div>
            ))}
            <p className={styles.hint}>{t("Leave a location empty to find it automatically.")}</p>
            {visibleError ? (
              <SettingsFeedback state="error">{visibleError.message}</SettingsFeedback>
            ) : null}
          </div>
        </Modal>
      ) : null}
    </>
  );
}
