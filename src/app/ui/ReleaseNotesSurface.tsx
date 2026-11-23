import { EmptyState } from "../../shared/ui/EmptyState";
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
      <article aria-label={t("Release notes")} className="mx-auto w-full max-w-3xl px-(--ui-space-8) py-(--ui-space-10)">
        {markdown ? (
          <SurfaceSelection contentVersion={markdown}>
            <AgentMarkdown text={markdown} streaming={false} />
          </SurfaceSelection>
        ) : (
          <EmptyState size="inline" context="list" description={t("Release notes for this version are not available in this build.")} />
        )}
      </article>
    </div>
  );
}
