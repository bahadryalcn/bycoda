import { t, useLocale } from "../../../shared/i18n";
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
import { CrewScene } from "./CrewScene";
import { PRODUCT_IDENTITY } from "../../../shared/lib/productIdentity";
import "./BycodaSession.css";

type Props = {
  cwd: string;
  composer?: ReactNode;
  hasChatBackground?: boolean;
};

export function EmptySession({ cwd, composer, hasChatBackground }: Props) {
  useLocale();
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
              <h1 className="text-content" title={project ? cwd : undefined}>
                {title}
              </h1>
            </div>
          </div>

          <div className="bycoda-entry-composer pointer-events-auto w-full">{composer}</div>
          {crewEnabled && !hasChatBackground ? <CrewScene /> : null}
        </div>
      ) : null}
    </div>
  );
}
