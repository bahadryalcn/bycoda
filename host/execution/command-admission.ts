import type { EngineCommandAdmission } from "../engine";

/** Nested domain/Work gates both retain their exact checks and receipt writers. */
export function composeCommandAdmission(
  outer: EngineCommandAdmission | undefined,
  inner: EngineCommandAdmission,
): EngineCommandAdmission {
  if (!outer) return inner;
  return {
    check: async (stage) => {
      await outer.check(stage);
      await inner.check(stage);
    },
    onAccepted: async (receipt) => {
      const failures: unknown[] = [];
      for (const callback of [outer.onAccepted, inner.onAccepted]) {
        try {
          await callback?.(receipt);
        } catch (error) {
          failures.push(error);
        }
      }
      if (failures.length) throw new AggregateError(failures, "Command receipt persistence failed");
    },
  };
}
