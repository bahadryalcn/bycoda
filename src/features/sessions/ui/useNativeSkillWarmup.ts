import { useEffect } from "react";
import { useStableValue } from "../../../shared/hooks/useStableValue";
import { warmNativeSkills } from "../../skills/model/skills";
import { nativeSkillContextForSession } from "../model/sessionSkills";

type Context = ReturnType<typeof nativeSkillContextForSession>;

/** Stream frames rebuild the session object; only a changed warmup context counts. */
function sameContext(previous: Context, next: Context): boolean {
  return (
    previous === next ||
    (!!previous &&
      !!next &&
      previous.harness === next.harness &&
      previous.cwd === next.cwd &&
      previous.sessionId === next.sessionId)
  );
}

export function useNativeSkillWarmup(
  session: Parameters<typeof nativeSkillContextForSession>[0] | undefined,
) {
  const context = useStableValue(
    session ? nativeSkillContextForSession(session) : null,
    sameContext,
  );
  useEffect(() => {
    if (context?.cwd) warmNativeSkills(context);
  }, [context]);
}
