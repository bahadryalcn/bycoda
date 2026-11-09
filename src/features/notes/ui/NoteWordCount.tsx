import { useDeferredValue, useMemo } from "react";
import { t, useLocale } from "../../../shared/i18n";

export function NoteWordCount({ body }: { body: string }) {
  useLocale();
  const deferredBody = useDeferredValue(body);
  const count = useMemo(
    () => (deferredBody.trim() ? deferredBody.trim().split(/\s+/u).length : 0),
    [deferredBody],
  );
  return t("{p0} words", { p0: count });
}
