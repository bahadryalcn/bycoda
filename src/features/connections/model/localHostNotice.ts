import type { BundledHostStatus } from "./bundledHostStatus";

export type LocalHostCompatibility = "pending" | "unavailable" | "ok" | "identity" | "capabilities";

/** An English source string and the params it is translated with (`t(text, params)`). */
export type LocalHostNoticeLine = { text: string; params?: Record<string, string> };

export type LocalHostNotice = {
  tone: "info" | "warning";
  title: string;
  details: LocalHostNoticeLine[];
};

const BUSY_UNKNOWN = "Could not check whether the host is busy.";
const MISMATCH_TITLE = "The app and this computer's Host need to be updated together.";

function versionsLine(
  installed: string | null | undefined,
  bundled: string | null | undefined,
  onlyWhenDifferent: boolean,
): LocalHostNoticeLine[] {
  if (!installed || !bundled || (onlyWhenDifferent && installed === bundled)) return [];
  return [
    {
      text: "This computer's host is {p0}; this app includes {p1}.",
      params: { p0: installed, p1: bundled },
    },
  ];
}

/** What to tell the owner about this computer's host; `null` when nothing is needed from them. */
export function localHostNotice(
  status: BundledHostStatus | null,
  compatibility: LocalHostCompatibility,
): LocalHostNotice | null {
  if (compatibility === "capabilities") {
    return {
      tone: "warning",
      title: MISMATCH_TITLE,
      details: [
        {
          text: "The serving Host does not support managed workspace creation and policy. Update the Host before starting work.",
        },
      ],
    };
  }
  if (compatibility === "identity") {
    return {
      tone: "warning",
      title: MISMATCH_TITLE,
      details: [{ text: "The serving Host source differs from the Host bundled with this app." }],
    };
  }
  if (status?.state === "failed") {
    return {
      tone: "warning",
      title: "The host on this computer could not be updated.",
      details: [
        ...versionsLine(status.installed, status.bundled, true),
        ...(status.message ? [{ text: status.message }] : []),
      ],
    };
  }
  if (status?.state !== "deferred") return null;
  const known = Boolean(status.installed && status.bundled);
  const equal = known && status.installed === status.bundled;
  const reason: LocalHostNoticeLine[] = status.message
    ? [
        {
          text:
            status.message === BUSY_UNKNOWN
              ? "It continues when the host can be restarted safely."
              : status.message,
        },
      ]
    : [];
  if (!equal) {
    return {
      tone: "info",
      title: "A host update is waiting.",
      details: [...versionsLine(status.installed, status.bundled, false), ...reason],
    };
  }
  if (compatibility === "ok" || compatibility === "pending") return null;
  return { tone: "info", title: "This computer's host could not be verified.", details: reason };
}
