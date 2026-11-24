import { createContext, useContext, useState, type ReactNode } from "react";
import { Badge } from "../../../shared/ui/Badge";
import { Button } from "../../../shared/ui/Button";
import styles from "../../../shared/ui/DraftToken.module.css";
import { ChevronDown, SkillGroupIcon, SkillIcon } from "../../../shared/ui/icons";
import { HOVER_CARD_CLOSE_MS, useHoverIntent } from "../../../shared/ui/Tooltip";
import { skillTextParts } from "../../skills/model/skills";
import {
  cachedSkillPolicy,
  skillGroupPickerItems,
  skillGroupRuns,
  useSkillGroups,
  type SkillGroupPickerItem,
} from "../../skills/public/skillGroups";
import type { HarnessId } from "../model/session";
import { ComposerSkillReference } from "./ComposerReferenceActions";
import { useComposerSkills } from "./useComposerSkills";

const EMPTY_NAMES: ReadonlySet<string> = new Set();
export const TranscriptSkillNames = createContext(EMPTY_NAMES);
const NO_GROUPS: readonly SkillGroupPickerItem[] = [];
/** Resolved skill groups; a sent group's expanded members read as the group again. */
export const TranscriptSkillGroups = createContext(NO_GROUPS);

/** Share one catalog subscription across the transcript, using the composer's cache. */
export function TranscriptSkills({
  harness,
  cwd,
  sessionId,
  children,
}: {
  harness: HarnessId;
  cwd: string;
  sessionId?: string;
  children: ReactNode;
}) {
  const { skills } = useComposerSkills({
    harness,
    executionCwd: cwd,
    sessionId,
    pickerOpen: false,
  });
  const names = new Set(
    skills.filter((skill) => skill.kind !== "template").map((skill) => skill.invocation),
  );
  // Storage is read once on mount, not during render; the badges are display only and
  // sending re-checks the authoritative policy.
  const [policy] = useState(cachedSkillPolicy);
  const groups = skillGroupPickerItems(useSkillGroups(), skills, policy);
  return (
    <TranscriptSkillNames value={names}>
      <TranscriptSkillGroups value={groups}>{children}</TranscriptSkillGroups>
    </TranscriptSkillNames>
  );
}

/** Preserve the literal command for selection/copy; only recognized skills get emphasis. */
export function SkillTokenText({ text }: { text: string }) {
  const names = useContext(TranscriptSkillNames);
  const groups = useContext(TranscriptSkillGroups);
  return skillGroupRuns(text, groups).map((run, index) =>
    run.group ? (
      <SkillGroupToken key={index} group={run.group} />
    ) : (
      <SkillRuns key={index} text={run.text} names={names} />
    ),
  );
}

function SkillGroupToken({ group }: { group: { name: string; members: readonly string[] } }) {
  const intent = useHoverIntent({
    closeDelay: HOVER_CARD_CLOSE_MS,
  });
  const [pinned, setPinned] = useState<HTMLButtonElement | null>(null);
  const anchor = pinned ?? intent.anchor;
  const close = () => {
    setPinned(null);
    intent.close();
  };

  return (
    <>
      {/* ui-drift-ignore: hand-rolled-disclosure -- this trigger opens a popover dialog. */}
      <Button
        variant="link"
        layout="text"
        motion="none"
        data-skill-group-token="true"
        aria-haspopup="dialog"
        aria-expanded={Boolean(anchor)}
        className="no-underline!"
        onPointerEnter={(event) => {
          if (!pinned && event.pointerType !== "touch") intent.scheduleOpen(event.currentTarget);
        }}
        onPointerLeave={() => intent.scheduleClose()}
        onFocus={(event) => {
          if (!pinned && event.currentTarget.matches(":focus-visible"))
            intent.scheduleOpen(event.currentTarget, 0);
        }}
        onBlur={() => intent.scheduleClose()}
        onClick={(event) => {
          event.stopPropagation();
          if (pinned) close();
          else {
            intent.close();
            setPinned(event.currentTarget);
          }
        }}
      >
        <span className={styles.compact} data-inline-reference="group">
          <SkillGroupIcon aria-hidden />
          <span>{group.name}</span>
          <small>{group.members.length}</small>
          <ChevronDown aria-hidden />
        </span>
      </Button>
      {anchor ? (
        <ComposerSkillReference
          anchor={anchor}
          label={group.name}
          group={group}
          close={close}
          hover={{ enter: intent.cancel, leave: intent.scheduleClose }}
        />
      ) : null}
    </>
  );
}

function SkillRuns({ text, names }: { text: string; names: ReadonlySet<string> }) {
  return skillTextParts(text, names).map((part, index) =>
    part.skill ? (
      <Badge
        key={index}
        size="xs"
        tone="accent"
        appearance="subtle"
        icon={<SkillIcon />}
        className="text-skill"
        data-skill-token="true"
      >
        {part.text}
      </Badge>
    ) : (
      part.text
    ),
  );
}
