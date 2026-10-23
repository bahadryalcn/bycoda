import { useT } from "../../../shared/i18n";
import { type ReactNode, useSyncExternalStore } from "react";
import { basename } from "../../../platform/tauri/fs";
import { projectKey } from "../../../shared/lib/paths";
import { looksLikeProject } from "../../projects/model/recents";
import {
  loadTabGroupLabels,
  resolveTabGroupLabel,
  subscribeTabGroupLabels,
} from "../../workspace/model/tabGroups";
import { loadCrewSceneEnabled, subscribeCrewSceneEnabled } from "../../settings/model/settings";
import { useLockOverscroll } from "../../../shared/hooks/useLockOverscroll";
import { CrewScene } from "./crewSurface";
import { PRODUCT_IDENTITY } from "../../../shared/lib/productIdentity";
import { Button } from "../../../shared/ui/Button";
import { FolderOpen } from "../../../shared/ui/icons";
import { runGuideAction } from "../../onboarding/model/guide";
import { openUsageGuide } from "../../onboarding/model/usageGuide";
import "./BycodaSession.css";

type Props = {
  cwd: string;
  composer?: ReactNode;
  hasChatBackground?: boolean;
};

export function EmptySession({ cwd, composer, hasChatBackground }: Props) {
  const t = useT();
  const lockOverscroll = useLockOverscroll<HTMLDivElement>();
  const crewEnabled = useSyncExternalStore(
    subscribeCrewSceneEnabled,
    loadCrewSceneEnabled,
    () => true,
  );
  const getProjectLabel = () =>
    looksLikeProject(cwd)
      ? resolveTabGroupLabel(projectKey(cwd), loadTabGroupLabels(), basename(cwd))
      : null;
  const project = useSyncExternalStore(subscribeTabGroupLabels, getProjectLabel, getProjectLabel);
  const title = project ? t("Work on {p0}.", { p0: project }) : t("Start a new task.");

  return (
    <div
      ref={lockOverscroll}
      className="bycoda-empty relative flex h-full min-h-0 overflow-y-auto overscroll-none"
    >
      {composer ? (
        // Same box as the docked composer (max-w-4xl, p-1.5), so the input
        // keeps its width when the first message docks it.
        <div className="bycoda-entry-workbench pointer-events-none relative z-10 mx-auto flex w-full flex-1 flex-col">
          <div className="bycoda-entry-heading">
            <div className="bycoda-wordmark" aria-label={PRODUCT_IDENTITY.displayName}>
              <img src={PRODUCT_IDENTITY.logoSrc} alt="" />
              <img className="bycoda-brand-lettering" src={PRODUCT_IDENTITY.wordmarkSrc} alt="" />
            </div>
            <div className="bycoda-task-brief pointer-events-auto">
              <h1 className="text-(--ui-tone-neutral-fg)" title={project ? cwd : undefined}>
                {title}
              </h1>
              {project ? null : (
                <div className="bycoda-entry-actions bycoda-arc">
                  <Button
                    variant="primary"
                    startIcon={<FolderOpen size={14} />}
                    onClick={() => runGuideAction("open-project")}
                  >
                    {t("Open a project")}
                  </Button>
                  <Button variant="ghost" onClick={openUsageGuide}>
                    {t("Guide")}
                  </Button>
                </div>
              )}
            </div>
          </div>

          <div className="bycoda-entry-composer pointer-events-auto w-full">{composer}</div>
          {crewEnabled && !hasChatBackground ? <CrewScene /> : null}
        </div>
      ) : null}
    </div>
  );
}
