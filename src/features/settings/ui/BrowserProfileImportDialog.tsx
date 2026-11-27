import { useState } from "react";
import { t } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { Modal, ModalActions } from "../../../shared/ui/Modal";
import { RadioGroup } from "../../../shared/ui/RadioGroup";
import { Text } from "../../../shared/ui/Text";
import { InlineError } from "../../../shared/ui/InlineError";
import { LoadingText } from "../../../shared/ui/LoadingText";

export type BrowserImportSource = {
  id: string;
  browser: string;
  browserName: string;
  profileName: string;
  isDefault: boolean;
};

/**
 * Which installed browser profile to import; the default browser's profile is preselected.
 * `sources` is undefined while detection runs; `error` is the Host's refusal, never "none found".
 */
export function BrowserProfileImportDialog({
  sources,
  error,
  onRetry,
  onImport,
  onFile,
  onClose,
}: {
  sources: BrowserImportSource[] | undefined;
  error?: string;
  onRetry: () => void;
  onImport: (source: BrowserImportSource) => void;
  onFile: () => void;
  onClose: () => void;
}) {
  const [picked, setChoice] = useState<string>();
  const choice = picked ?? (sources?.find(({ isDefault }) => isDefault) ?? sources?.[0])?.id;
  const selected = sources?.find(({ id }) => id === choice);
  return (
    <Modal
      title={t("Import browser profile")}
      size="sm"
      onClose={onClose}
      footerStart={
        <Button variant="ghost" onClick={onFile}>
          {t("From file…")}
        </Button>
      }
      footer={
        <ModalActions>
          <Button variant="ghost" onClick={onClose}>
            {t("Cancel")}
          </Button>
          <Button
            variant="primary"
            disabled={!selected}
            onClick={() => selected && onImport(selected)}
          >
            {t("Import")}
          </Button>
        </ModalActions>
      }
    >
      {error ? (
        <InlineError details={error} retry={{ onRetry }}>
          {t("Could not look for browsers on this computer.")}
        </InlineError>
      ) : !sources ? (
        <LoadingText>{t("Looking for browsers…")}</LoadingText>
      ) : sources.length === 0 ? (
        <Text tone="muted">{t("No supported browser profile was found on this computer.")}</Text>
      ) : (
        <RadioGroup
          label={t("Browser profile to import")}
          variant="list"
          value={choice}
          onValueChange={setChoice}
          options={sources.map((source) => ({
            value: source.id,
            label: `${source.browserName} – ${source.profileName}`,
            description: source.isDefault ? t("Default browser") : undefined,
          }))}
        />
      )}
    </Modal>
  );
}
