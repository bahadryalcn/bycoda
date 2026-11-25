import { t } from "../../../shared/i18n";
import type { WorkResolved } from "../../../shared/model/host-contracts/work-executor";

/** The one compact line for "who ran this and with what helpers"; `why` is the reason, for a tooltip. */
export type TaskResolvedLine = { text: string; why?: string };

function helpersText(helpers: WorkResolved["helpers"]): string {
  const advisor = helpers.advisor ? ` + ${t("advisor")}` : "";
  if (helpers.subagents === "off") return `${t("No helpers")}${advisor}`;
  if (helpers.subagents === "auto") return `${t("Helpers: automatic")}${advisor}`;
  return `${t("Helpers: {p0}", { p0: helpers.subagents.length })}${advisor}`;
}

/** What the Host recorded when the work started; undefined until then. */
export function taskResolvedLine(resolved: WorkResolved | undefined): TaskResolvedLine | undefined {
  if (!resolved) return undefined;
  const executor = resolved.executor.kind === "crew" ? t("Crew") : t("Single agent");
  const why = [resolved.reason, resolved.helpers.limited].filter(Boolean).join(" ");
  return { text: `${executor} · ${helpersText(resolved.helpers)}`, why: why || undefined };
}
