import { createContext, useContext, useMemo, type ReactNode } from "react";
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
  const names = useMemo(
    () =>
      new Set(skills.filter((skill) => skill.kind !== "template").map((skill) => skill.invocation)),
    [skills],
  );
  return <TranscriptSkillNames value={names}>{children}</TranscriptSkillNames>;
}

/** Preserve the literal command for selection/copy; only recognized skills get emphasis. */
export function SkillTokenText({ text }: { text: string }) {
  const names = useContext(TranscriptSkillNames);
  return skillTextParts(text, names).map((part, index) =>
    part.skill ? (
      <span key={index} className="text-skill font-semibold" data-skill-token="true">
        {part.text}
      </span>
    ) : (
      part.text
    ),
  );
}
