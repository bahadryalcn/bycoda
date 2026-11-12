import { Text } from "../../shared/ui/Text";
import { useT } from "../../shared/i18n";
import {
  formatReleaseDate,
  presentReleaseNotes,
  releaseNotesTitleForName,
} from "../model/releaseNotes";
import { AgentMarkdown } from "../../features/sessions/ui/AgentMarkdown";
import { Modal } from "../../shared/ui/Modal";
import { Button } from "../../shared/ui/Button";
import { startTour } from "../../features/onboarding/model/tourState";
import { usePendingHighlights } from "../../features/onboarding/model/useFeatureHighlights";
import { useAppName } from "../../shared/lib/appName";
import { PRODUCT_IDENTITY } from "../../shared/lib/productIdentity";

type Props = {
  version: string;
  onClose: () => void;
};

export function WhatsNewBody({ version }: { version: string }) {
  const t = useT();
  const notes = presentReleaseNotes(version);
  const title = releaseNotesTitleForName(version, useAppName());

  return (
    <article aria-label={title} className="px-5 py-4">
      {notes?.markdown ? (
        <AgentMarkdown className="whats-new-md" text={notes.markdown} streaming={false} />
      ) : (
        <Text as="p" size="secondary" tone="secondary">
          {t("Release notes for this version have not been added yet.")}
        </Text>
      )}
      {PRODUCT_IDENTITY.releaseNotesUrl ? (
        <AgentMarkdown
          className="whats-new-md mt-5"
          text={`[View release on GitHub](${PRODUCT_IDENTITY.releaseNotesUrl})`}
          streaming={false}
        />
      ) : null}
    </article>
  );
}

export function WhatsNewDialog({ version, onClose }: Props) {
  const t = useT();
  const name = useAppName();
  const notes = presentReleaseNotes(version);
  const date = notes?.date ? formatReleaseDate(notes.date) : null;
  // Features added since the user last looked can be pointed out in the app itself.
  const hasHighlights = usePendingHighlights().length > 0;

  return (
    <Modal
      padding="none"
      onClose={onClose}
      title={t("What's new")}
      description={`${name} ${version}${date ? ` · ${date}` : ""}`}
      size="md"
      className="h-[min(72vh,640px)]"
    >
      {hasHighlights ? (
        <div className="flex items-center justify-between gap-3 px-5 pt-4">
          <Text size="secondary" tone="secondary">
            {t("See the new features of this update in the app.")}
          </Text>
          <Button
            variant="primary"
            size="sm"
            onClick={() => {
              onClose();
              startTour("whats-new");
            }}
          >
            {t("Show me")}
          </Button>
        </div>
      ) : null}
      <WhatsNewBody version={version} />
    </Modal>
  );
}
