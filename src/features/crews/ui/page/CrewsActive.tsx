import { Text } from "../../../../shared/ui/Text";
import { useEffect, useState } from "react";
import { t } from "../../../../shared/i18n";
import { formatDuration } from "../../../../shared/i18n/format";
import { Badge } from "../../../../shared/ui/Badge";
import { Button } from "../../../../shared/ui/Button";
import { EmptyState } from "../../../../shared/ui/EmptyState";
import { InlineError } from "../../../../shared/ui/InlineError";
import { Plus } from "../../../../shared/ui/icons";
import { SectionLabel } from "../../../../shared/ui/SectionLabel";
import type { ActiveCrewMemberView } from "../../model/crewActive";
import {
  activeSessionTarget,
  type ActiveSessionTarget,
  type KnownCrewProject,
} from "../../model/crewActiveTarget";
import {
  activeElapsedMs,
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

const FACE_SIZE = 28;

function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}

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
  const now = useNow();
  const [error, setError] = useState("");
  if (items.length === 0)
    return (
      <EmptyState
        context="page"
        title={t("No crew member is working right now")}
        description={t("Start new work and its members show up here while they work.")}
        action={
          <Button variant="primary" startIcon={<Plus className="icon-sm" />} onClick={onNewWork}>
            {t("New work")}
          </Button>
        }
      />
    );
  const currentKey = known ? activeProjectKey(known) : undefined;
  const open = (item: ActiveCrewMemberView) => {
    if (!onOpenSession || !item.sessionId) return;
    setError("");
    void activeSessionTarget(item, known)
      .then(onOpenSession)
      .catch((reason: unknown) =>
        setError(reason instanceof Error ? reason.message : String(reason)),
      );
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
                now={now}
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
  now,
  canOpen,
  canOpenWork,
  onOpen,
  onOpenWork,
}: {
  item: ActiveCrewMemberView;
  now: number;
  canOpen: boolean;
  canOpenWork: boolean;
  onOpen: (item: ActiveCrewMemberView) => void;
  onOpenWork: (item: ActiveCrewMemberView) => void;
}) {
  const elapsed = activeElapsedMs(item.startedAt, now);
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
        {elapsed !== null ? (
          <Text tone="inherit" className="shrink-0 tabular-nums">
            {formatDuration(elapsed)}
          </Text>
        ) : null}
      </Button>
      {item.attention && canOpenWork ? (
        <Button variant="ghost" size="sm" onClick={() => onOpenWork(item)}>
          {t("Open crew work")}
        </Button>
      ) : null}
    </li>
  );
}
