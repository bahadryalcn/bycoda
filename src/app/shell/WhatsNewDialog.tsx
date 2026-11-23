import { useT } from "../../shared/i18n";
import {
  formatReleaseDate,
  presentReleaseNotes,
  releaseNotesTitleForName,
} from "../model/releaseNotes";
import { AgentMarkdown } from "../../features/sessions/ui/AgentMarkdown";
import { Modal, ModalActions } from "../../shared/ui/Modal";
import { Button } from "../../shared/ui/Button";
import { startTour } from "../../features/onboarding/model/tourState";
import { usePendingHighlights } from "../../features/onboarding/model/useFeatureHighlights";
import { useAppName } from "../../shared/lib/appName";
import { PRODUCT_IDENTITY } from "../../shared/lib/productIdentity";
import { openExternal } from "../../platform/tauri/openExternal";
import { errorText } from "../../shared/lib/errors";
import { InlineError } from "../../shared/ui/InlineError";
import { useState } from "react";

type Props = {
  version: string;
  onClose: () => void;
};

export function WhatsNewBody({ version }: { version: string }) {
  const notes = presentReleaseNotes(version);
  const title = releaseNotesTitleForName(version, useAppName());
  if (!notes?.markdown) return null;
  return (
    <article aria-label={title}>
      <AgentMarkdown className="whats-new-md" text={notes.markdown} streaming={false} />
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
  const releaseUrl = PRODUCT_IDENTITY.releaseNotesUrl;
  const [linkError, setLinkError] = useState<string | null>(null);

  return (
    <Modal
      onClose={onClose}
      title={t("What's new")}
      description={`${name} ${version}${date ? ` · ${date}` : ""}`}
      size="md"
      height={notes?.markdown ? "tall" : undefined}
      footer={hasHighlights || releaseUrl ? (
        <ModalActions>
          {releaseUrl ? (
            <Button variant="ghost" onClick={() => {
              setLinkError(null);
              void openExternal(releaseUrl).catch((error) => setLinkError(errorText(error)));
            }}>
              {t("View release on GitHub")}
            </Button>
          ) : null}
          {hasHighlights ? (
            <Button variant="primary" size="sm" onClick={() => {
              onClose();
              startTour("whats-new");
            }}>
              {t("Show me")}
            </Button>
          ) : null}
        </ModalActions>
      ) : undefined}
    >
      {linkError ? <InlineError>{linkError}</InlineError> : null}
      <WhatsNewBody version={version} />
    </Modal>
  );
}
