import type { useT } from "../../../../shared/i18n";

type Translate = ReturnType<typeof useT>;

/** The Host a plan share was measured on: "this computer" only when it is the local one. */
export type PlanShareHost = { name: string; local: boolean };

/**
 * The untracked row's label and info for the Host the share was measured on. Usage that a
 * remote Host does not explain is named after that Host, never attributed to this computer.
 */
export function untrackedCopy(t: Translate, host: PlanShareHost): { label: string; info: string } {
  if (host.local)
    return {
      label: t("Not tracked on this computer"),
      info: t(
        "Provider-reported usage that sessions on this computer do not explain, such as the web, a phone or other computers. All values are estimates.",
      ),
    };
  return {
    label: t("Not tracked on Host {p1}", { p1: host.name }),
    info: t(
      "Provider-reported usage that sessions on Host {p1} do not explain, such as the web, a phone or other computers. All values are estimates.",
      { p1: host.name },
    ),
  };
}
