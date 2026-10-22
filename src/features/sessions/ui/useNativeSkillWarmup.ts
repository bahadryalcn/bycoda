import { useEffect, useMemo } from "react";
import { warmNativeSkills } from "../../skills/model/skills";
import { nativeSkillContextForSession } from "../model/sessionSkills";

export function useNativeSkillWarmup(
  session: Parameters<typeof nativeSkillContextForSession>[0] | undefined,
) {
  const context = useMemo(
    () => (session ? nativeSkillContextForSession(session) : null),
    [session?.id, session?.cwd, session?.worktreeCwd, session?.harness],
  );
  useEffect(() => {
    if (context?.cwd) warmNativeSkills(context);
  }, [context]);
}
