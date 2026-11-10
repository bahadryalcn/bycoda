import { t } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { useActiveCrewMembers, useActiveCrewSupported } from "../model/crewActive";
import {
  activeSessionTarget,
  type ActiveSessionTarget,
  type KnownCrewProject,
} from "../model/crewActiveTarget";
import {
  activeMemberFocus,
  activeMemberWorking,
  activeProjectKey,
  railActiveFaces,
} from "../model/crewActiveView";
import { openCrewsPageAt } from "../model/crewsPage";
import { memberTraits } from "../model/memberAvatars";
import { MemberAvatar } from "./MemberAvatar";

const STRIP_FACE_SIZE = 20;

/**
 * The faces of members working in this project, above the rail's crew list. Mount it only
 * while the section is shown: it polls the hosts.
 */
export function CrewRailActive({
  project,
  onOpenSession,
  onError,
}: {
  project: KnownCrewProject;
  onOpenSession?: (target: ActiveSessionTarget) => void | Promise<void>;
  onError: (message: string) => void;
}) {
  const supported = useActiveCrewSupported();
  const { data } = useActiveCrewMembers(supported);
  const { shown, more } = railActiveFaces(data?.items ?? [], activeProjectKey(project));
  if (!shown.length) return null;
  return (
    <div role="group" aria-label={t("Working now")} className="flex items-center gap-1 px-2 py-1">
      {shown.map((item) => {
        const label = `${item.memberName} · ${activeMemberFocus(item)}`;
        return (
          <Button
            key={`${item.runId}:${item.memberId}:${item.taskId ?? ""}`}
            variant="ghost"
            iconOnly
            motion="none"
            label={label}
            disabled={!onOpenSession || !item.sessionId}
            onClick={() =>
              void activeSessionTarget(item, project)
                .then((target) => onOpenSession?.(target))
                .catch((reason: unknown) =>
                  onError(reason instanceof Error ? reason.message : String(reason)),
                )
            }
          >
            <MemberAvatar
              traits={memberTraits({
                id: item.memberId,
                source: item.memberSource,
                avatar: item.avatar,
              })}
              size={STRIP_FACE_SIZE}
              active={activeMemberWorking(item)}
            />
          </Button>
        );
      })}
      {more > 0 ? (
        <Button
          variant="ghost"
          size="sm"
          motion="none"
          tooltip={t("Show everyone working now")}
          onClick={() => openCrewsPageAt({ tab: "active" })}
        >
          {`+${more}`}
        </Button>
      ) : null}
    </div>
  );
}
