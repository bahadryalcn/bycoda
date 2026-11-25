import { useState } from "react";
import { t } from "../../../../shared/i18n";
import { Badge } from "../../../../shared/ui/Badge";
import { Button } from "../../../../shared/ui/Button";
import { InlineError } from "../../../../shared/ui/InlineError";
import { SectionLabel } from "../../../../shared/ui/SectionLabel";
import { Text } from "../../../../shared/ui/Text";
import { describeRemoteError, presentRemoteError } from "../../../connections/public/remoteFailure";
import {
  useActiveCrewMembers,
  useActiveCrewSupported,
  type ActiveCrewMemberView,
} from "../../model/crewActive";
import {
  activeSessionTarget,
  type ActiveSessionTarget,
  type KnownCrewProject,
} from "../../model/crewActiveTarget";
import {
  activeMemberFocus,
  activeMemberKey,
  activeMemberWorking,
  activeProjectKey,
  groupActiveByProject,
} from "../../model/crewActiveView";
import { CREW_ATTENTION_TONE } from "../../model/crewSignal";
import { crewAttentionLabel } from "../../model/crewPresentation";
import { memberTraits } from "../../model/memberAvatars";
import { roleLabel } from "../CrewMemberForm";
import { MemberAvatar } from "../MemberAvatar";
import { ActiveElapsed } from "./ActiveElapsed";

const FACE_SIZE = 28;

/** Crew members working in other projects or on other hosts; the Work list owns this project. */
export function CrewsActive({
  known,
  onOpenSession,
}: {
  /** The project the page shows; its members are left to the Work list. */
  known?: KnownCrewProject;
  onOpenSession?: (target: ActiveSessionTarget) => void | Promise<void>;
}) {
  const supported = useActiveCrewSupported();
  const active = useActiveCrewMembers(supported);
  const [error, setError] = useState("");
  if (!supported) return null;
  if (active.error) {
    const { message: summary, details } = describeRemoteError(active.error);
    return (
      <div className="p-4 pb-0">
        <InlineError
          details={details}
          retry={{ onRetry: () => void active.refetch(), pending: active.isFetching }}
        >
          {summary}
        </InlineError>
      </div>
    );
  }
  const currentKey = known ? activeProjectKey(known) : undefined;
  const items = (active.data?.items ?? []).filter((item) => activeProjectKey(item) !== currentKey);
  if (!items.length) return null;
  const open = (item: ActiveCrewMemberView) => {
    if (!onOpenSession || !item.sessionId) return;
    setError("");
    void activeSessionTarget(item, known)
      .then(onOpenSession)
      .catch((reason: unknown) => setError(presentRemoteError(reason, { explicit: true })));
  };
  return (
    <div className="flex flex-col gap-3 p-4 pb-0">
      {error ? <InlineError details={error} /> : null}
      {groupActiveByProject(items, currentKey).map((group) => (
        <section key={group.key} aria-label={group.name || t("Project")} className="flex flex-col">
          <SectionLabel count={group.items.length}>{group.name || t("Project")}</SectionLabel>
          <ul className="flex flex-col gap-0">
            {group.items.map((item) => (
              <ActiveRow
                key={activeMemberKey(item)}
                item={item}
                canOpen={!!onOpenSession && !!item.sessionId}
                onOpen={open}
              />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function ActiveRow({
  item,
  canOpen,
  onOpen,
}: {
  item: ActiveCrewMemberView;
  canOpen: boolean;
  onOpen: (item: ActiveCrewMemberView) => void;
}) {
  const attention = item.attention ? crewAttentionLabel(item.attention) : "";
  const focus = activeMemberFocus(item);
  return (
    <li className="flex min-h-(--ui-control-height-compact) items-stretch gap-1">
      <Button
        variant="item"
        motion="none"
        type="button"
        disabled={!canOpen}
        disabledReason={!canOpen ? t("This member has no session to open yet.") : undefined}
        onClick={() => onOpen(item)}
        className="flex min-w-0 flex-1 items-center gap-3"
      >
        <MemberAvatar
          traits={memberTraits({
            id: item.memberId,
            source: item.memberSource,
            avatar: item.avatar,
          })}
          size={FACE_SIZE}
          active={activeMemberWorking(item)}
        />
        <span className="flex min-w-0 flex-1 flex-col text-start">
          <span className="flex min-w-0 items-baseline gap-1.5">
            <Text size="secondary" tone="inherit" weight="medium" truncate>
              {item.memberName}
            </Text>
            <Text tone="inherit" className="shrink-0">
              {roleLabel(item.memberRole)}
            </Text>
          </span>
          <Text tone="inherit" truncate>
            {[item.definitionName, focus !== item.definitionName ? focus : ""]
              .filter(Boolean)
              .join(" · ")}
          </Text>
        </span>
        {attention && item.attention ? (
          <Badge size="xs" tone={CREW_ATTENTION_TONE[item.attention]}>
            {attention}
          </Badge>
        ) : null}
        <ActiveElapsed startedAt={item.startedAt} />
      </Button>
    </li>
  );
}
