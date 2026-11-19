import { Text } from "../../../../shared/ui/Text";
import { useState } from "react";
import { t } from "../../../../shared/i18n";
import { Badge } from "../../../../shared/ui/Badge";
import { Button } from "../../../../shared/ui/Button";
import { EmptyState } from "../../../../shared/ui/EmptyState";
import { InlineError } from "../../../../shared/ui/InlineError";
import { SectionLabel } from "../../../../shared/ui/SectionLabel";
import type { ActiveCrewMemberView } from "../../model/crewActive";
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
import { memberTraits } from "../../model/memberAvatars";
import { CREW_ATTENTION_TONE } from "../../model/crewSignal";
import { crewAttentionLabel } from "../../model/crewPresentation";
import { roleLabel } from "../CrewMemberForm";
import { MemberAvatar } from "../MemberAvatar";
import { presentRemoteError } from "../../../connections/public/remoteFailure";
import { ActiveElapsed } from "./ActiveElapsed";

const FACE_SIZE = 28;

/** The Active tab: every crew member working on any connected host, grouped by project. */
export function CrewsActive({
  items,
  truncated,
  known,
  onOpenSession,
  onOpenWork,
  onNewWork,
}: {
  items: readonly ActiveCrewMemberView[];
  truncated?: boolean;
  /** The project the page shows; its members' work can open in the Work tab. */
  known?: KnownCrewProject;
  onOpenSession?: (target: ActiveSessionTarget) => void | Promise<void>;
  onOpenWork: (item: ActiveCrewMemberView) => void;
  onNewWork: () => void;
}) {
  const [error, setError] = useState("");
  if (items.length === 0)
    return (
      <EmptyState
        context="page"
        title={t("No crew member is working right now")}
        description={t("Start new work and its members show up here while they work.")}
        action={{ label: t("New work"), onClick: onNewWork }}
      />
    );
  const currentKey = known ? activeProjectKey(known) : undefined;
  const open = (item: ActiveCrewMemberView) => {
    if (!onOpenSession || !item.sessionId) return;
    setError("");
    void activeSessionTarget(item, known)
      .then(onOpenSession)
      .catch((reason: unknown) => setError(presentRemoteError(reason, { explicit: true })));
  };
  return (
    <div className="flex flex-col gap-4 p-4">
      {error ? <InlineError>{error}</InlineError> : null}
      {groupActiveByProject(items, currentKey).map((group) => (
        <section key={group.key} aria-label={group.name || t("Project")} className="flex flex-col">
          <SectionLabel count={group.items.length}>{group.name || t("Project")}</SectionLabel>
          <ul className="flex flex-col gap-0">
            {group.items.map((item) => (
              <ActiveRow
                key={activeMemberKey(item)}
                item={item}
                canOpen={!!onOpenSession && !!item.sessionId}
                canOpenWork={!!known && activeProjectKey(item) === currentKey}
                onOpen={open}
                onOpenWork={onOpenWork}
              />
            ))}
          </ul>
        </section>
      ))}
      {truncated ? (
        <Text as="p" tone="inherit">
          {t("Only the first members are listed.")}
        </Text>
      ) : null}
    </div>
  );
}

function ActiveRow({
  item,
  canOpen,
  canOpenWork,
  onOpen,
  onOpenWork,
}: {
  item: ActiveCrewMemberView;
  canOpen: boolean;
  canOpenWork: boolean;
  onOpen: (item: ActiveCrewMemberView) => void;
  onOpenWork: (item: ActiveCrewMemberView) => void;
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
            {item.handle ? (
              <Text tone="inherit" truncate>
                @{item.handle}
              </Text>
            ) : null}
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
      {item.attention && canOpenWork ? (
        <Button variant="ghost" size="sm" onClick={() => onOpenWork(item)}>
          {t("Open crew work")}
        </Button>
      ) : null}
    </li>
  );
}
