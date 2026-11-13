import { createContext, useContext, type ReactNode } from "react";
import { Badge } from "../../../shared/ui/Badge";
import { Sparkles } from "../../../shared/ui/icons";
import { skillTextParts } from "../../skills/model/skills";
import type { HarnessId } from "../model/session";
import { useComposerSkills } from "./useComposerSkills";

const EMPTY_NAMES: ReadonlySet<string> = new Set();
export const TranscriptSkillNames = createContext(EMPTY_NAMES);

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
  return <TranscriptSkillNames value={names}>{children}</TranscriptSkillNames>;
}

/** Preserve the literal command for selection/copy; only recognized skills get emphasis. */
export function SkillTokenText({ text }: { text: string }) {
  const names = useContext(TranscriptSkillNames);
  return skillTextParts(text, names).map((part, index) =>
    part.skill ? (
      <Badge
        key={index}
        size="xs"
        tone="accent"
        appearance="subtle"
        icon={<Sparkles />}
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
