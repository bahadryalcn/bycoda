import { createContext, useContext, useState, type ReactNode } from "react";
import { Badge } from "../../../shared/ui/Badge";
import { SkillGroupIcon, SkillIcon } from "../../../shared/ui/icons";
import { Tooltip } from "../../../shared/ui/Tooltip";
import { skillTextParts } from "../../skills/model/skills";
import {
  cachedSkillPolicy,
  skillGroupPickerItems,
  skillGroupRuns,
  useSkillGroups,
  type SkillGroupPickerItem,
} from "../../skills/public/skillGroups";
import type { HarnessId } from "../model/session";
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
      <Tooltip
        key={index}
        asChild
        details={run.group.members.map((member) => `${run.group?.prefix}${member}`)}
      >
        <Badge
          size="xs"
          tone="accent"
          appearance="subtle"
          icon={<SkillGroupIcon />}
          className="text-skill"
          data-skill-group-token="true"
        >
          {`${run.group.name} · ${run.group.members.length}`}
        </Badge>
      </Tooltip>
    ) : (
      <SkillRuns key={index} text={run.text} names={names} />
    ),
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
