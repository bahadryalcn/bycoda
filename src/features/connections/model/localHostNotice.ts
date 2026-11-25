import { t } from "../../../shared/i18n";
import type { BundledHostStatus } from "./bundledHostStatus";

export type LocalHostCompatibility = "pending" | "unavailable" | "ok" | "identity" | "capabilities";

export type LocalHostNotice = {
  tone: "info" | "warning";
  /** Translated. */
  title: string;
  /** Translated sentences, shown under the title. */
  details: string[];
  /** The Host's own text for what went wrong, kept behind Details. */
  raw?: string;
  /** The owner may confirm interrupting running work to install the bundled Host now. */
  canUpdateNow?: boolean;
};

const BUSY_UNKNOWN = "Could not check whether the host is busy.";
const OTHER_INSTALL = "Another host update is being installed.";

function versionsLine(
  installed: string | null | undefined,
  bundled: string | null | undefined,
  onlyWhenDifferent: boolean,
): string[] {
  if (!installed || !bundled || (onlyWhenDifferent && installed === bundled)) return [];
  return [
    t("This computer's host is {p0}; this app includes {p1}.", { p0: installed, p1: bundled }),
  ];
}

function versionParts(version: string): number[] | null {
  const parts = version.trim().split(/[-+]/)[0]!.split(".").map(Number);
  return parts.every((part) => Number.isInteger(part) && part >= 0) ? parts : null;
}

/** Whether `candidate` is a strictly newer x.y.z release than `current`; unreadable is not newer. */
function isNewerVersion(candidate: string, current: string): boolean {
  const a = versionParts(candidate);
  const b = versionParts(current);
  if (!a || !b) return false;
  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return difference > 0;
  }
  return false;
}

/**
 * The differing versions and which side has to be updated to match: the `host` when the
 * bundled Host could not be installed over an older one, the `app` when this computer's Host
 * is already newer than the one this app includes. `null` when they match, are unknown, or
 * another installer already owns the Host.
 */
export function localHostVersionMismatch(
  status: BundledHostStatus | null,
): { installed: string; bundled: string; update: "host" | "app" } | null {
  const installed = status?.installed;
  const bundled = status?.bundled;
  if (!status || !installed || !bundled || installed === bundled) return null;
  // The installer never downgrades, so a newer Host can only be matched by a newer app.
  if (isNewerVersion(installed, bundled)) return { installed, bundled, update: "app" };
  if (status.state !== "deferred" && status.state !== "failed") return null;
  if (status.message === OTHER_INSTALL) return null;
  return { installed, bundled, update: "host" };
}

/** What to tell the owner about this computer's host; `null` when nothing is needed from them. */
export function localHostNotice(
  status: BundledHostStatus | null,
  compatibility: LocalHostCompatibility,
): LocalHostNotice | null {
  if (compatibility === "capabilities") {
    return {
      tone: "warning",
      title: t("The app and this computer's Host need to be updated together."),
      details: [
        t(
          "The serving Host does not support managed workspace creation and policy. Update the Host before starting work.",
        ),
      ],
    };
  }
  if (compatibility === "identity") {
    return {
      tone: "warning",
      title: t("The app and this computer's Host need to be updated together."),
      details: [t("The serving Host source differs from the Host bundled with this app.")],
    };
  }
  if (status?.state === "failed") {
    return {
      tone: "warning",
      title: t("The host on this computer could not be updated."),
      details: versionsLine(status.installed, status.bundled, true),
      ...(status.message ? { raw: status.message } : {}),
      canUpdateNow: true,
    };
  }
  if (status?.state !== "deferred") return null;
  const known = Boolean(status.installed && status.bundled);
  const equal = known && status.installed === status.bundled;
  // The two messages this app knows are translated; any other text is the Host's own.
  const knownMessage =
    status.message === BUSY_UNKNOWN
      ? t("It continues when the host can be restarted safely.")
      : status.message === OTHER_INSTALL
        ? t("Another host update is being installed.")
        : undefined;
  const reason = {
    details: knownMessage ? [knownMessage] : [],
    ...(status.message && !knownMessage ? { raw: status.message } : {}),
  };
  if (!equal) {
    return {
      tone: "info",
      title: t("A host update is waiting."),
      details: [...versionsLine(status.installed, status.bundled, false), ...reason.details],
      ...(reason.raw ? { raw: reason.raw } : {}),
      canUpdateNow: status.message !== OTHER_INSTALL,
    };
  }
  if (compatibility === "ok" || compatibility === "pending") return null;
  return { tone: "info", title: t("This computer's host could not be verified."), ...reason };
}
