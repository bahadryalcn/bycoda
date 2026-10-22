import { t, useLocale } from "../../shared/i18n";
import { formatReleaseDate, presentReleaseNotes, releaseNotesTitle } from "../model/releaseNotes";
import { AgentMarkdown } from "../../features/sessions/ui/AgentMarkdown";
import { Modal } from "../../shared/ui/Modal";
import { appName } from "../../shared/lib/appName";
import { PRODUCT_IDENTITY } from "../../shared/lib/productIdentity";

type Props = {
  version: string;
  onClose: () => void;
};

export function WhatsNewBody({ version }: { version: string }) {
  useLocale();
  const notes = presentReleaseNotes(version);
  const title = releaseNotesTitle(version);

  return (
    <article aria-label={title} className="px-5 py-4">
      {notes?.markdown ? (
        <AgentMarkdown className="whats-new-md" text={notes.markdown} streaming={false} />
      ) : (
        <p className="text-[13px] text-content/60">
          {t("Release notes for this version have not been added yet.")}
        </p>
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
  useLocale();
  const notes = presentReleaseNotes(version);
  const date = notes?.date ? formatReleaseDate(notes.date) : null;

  return (
    <Modal
      onClose={onClose}
      title={t("What's new")}
      description={`${appName()} ${version}${date ? ` · ${date}` : ""}`}
      size="md"
      className="h-[min(72vh,640px)]"
    >
      <WhatsNewBody version={version} />
    </Modal>
  );
}
