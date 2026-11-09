import { t, useLocale } from "../../shared/i18n";
import { useLockOverscroll } from "../../shared/hooks/useLockOverscroll";
import { releaseNotesMarkdown, type ReleaseNotesTabSource } from "../model/releaseNotes";
import { AgentMarkdown } from "../../features/sessions/ui/AgentMarkdown";
import { SurfaceSelection } from "../../features/sessions/ui/SurfaceSelection";

export function ReleaseNotesSurface({ source }: { source: ReleaseNotesTabSource }) {
  useLocale();
  const lockOverscroll = useLockOverscroll<HTMLDivElement>();
  const markdown = releaseNotesMarkdown(source);

  return (
    <div ref={lockOverscroll} className="h-full overflow-y-auto overscroll-none">
      <article aria-label={t("Release notes")} className="mx-auto w-full max-w-3xl px-8 py-10">
        {markdown ? (
          <SurfaceSelection contentVersion={markdown}>
            <AgentMarkdown text={markdown} streaming={false} />
          </SurfaceSelection>
        ) : (
          <p className="text-ui-secondary text-(--ui-text-secondary)">
            {t("Release notes for this version are not available in this build.")}
          </p>
        )}
      </article>
    </div>
  );
}
