import { Heading } from "../../../shared/ui/Heading";
import { useT } from "../../../shared/i18n";
import { type ReactNode, useSyncExternalStore } from "react";
import { basename } from "../../../platform/tauri/fs";
import { projectKey } from "../../../shared/lib/paths";
import { looksLikeProject } from "../../projects/public/recents";
import {
  loadTabGroupLabels,
  resolveTabGroupLabel,
  subscribeTabGroupLabels,
} from "../../workspace/model/tabGroups";
import { loadCrewSceneEnabled, subscribeCrewSceneEnabled } from "../../settings/public/settings";
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
  const project = useSyncExternalStore(
    subscribeTabGroupLabels,
    () =>
      looksLikeProject(cwd)
        ? resolveTabGroupLabel(projectKey(cwd), loadTabGroupLabels(), basename(cwd))
        : null,
    () =>
      looksLikeProject(cwd)
        ? resolveTabGroupLabel(projectKey(cwd), loadTabGroupLabels(), basename(cwd))
        : null,
  );
  const title = project ? t("Work on {p0}.", { p0: project }) : t("Start a new task.");

  return (
    <div
      ref={lockOverscroll}
      className="bycoda-empty relative flex h-full min-h-0 overflow-y-auto overscroll-none"
    >
      {composer ? (
        // Same box as the docked composer (max-w-4xl, p-1.5), so the input
        // keeps its width when the first message docks it.
        // z-10: in-pane stacking above sibling layers; no in-pane layer scale exists, so the literal stays.
        <div className="bycoda-entry-workbench pointer-events-none relative z-(--layer-pane-sheet) mx-auto flex w-full flex-1 flex-col">
          <div className="bycoda-entry-heading">
            <div className="bycoda-wordmark" aria-label={PRODUCT_IDENTITY.displayName}>
              <img src={PRODUCT_IDENTITY.logoSrc} alt="" />
              <img className="bycoda-brand-lettering" src={PRODUCT_IDENTITY.wordmarkSrc} alt="" />
            </div>
            <div className="bycoda-task-brief pointer-events-auto">
              <Heading size="page" title={project ? cwd : undefined}>
                {title}
              </Heading>
              {project ? null : (
                <div className="bycoda-entry-actions bycoda-arc">
                  <Button
                    variant="primary"
                    startIcon={<FolderOpen className="icon-sm" />}
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
