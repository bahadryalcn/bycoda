import { createStoredSetting } from "../../../shared/lib/storedSetting";

/** `off` never uploads, `ask` asks per crash, `auto` uploads crashes and a weekly report. */
export type DiagnosticsMode = "off" | "ask" | "auto";
export type DiagnosticsConsent = { mode: DiagnosticsMode | null; decidedAt: string | null };

const CONSENT_KEY = "bycoda.diagnostics.consent.v1";
const CHANGE_EVENT = "bycoda:diagnostics-consent-change";
const NOT_DECIDED: DiagnosticsConsent = { mode: null, decidedAt: null };

function parseConsent(raw: string): DiagnosticsConsent {
  try {
    const value = JSON.parse(raw) as { mode?: unknown; decidedAt?: unknown };
    if (value.mode !== "off" && value.mode !== "ask" && value.mode !== "auto") return NOT_DECIDED;
    return {
      mode: value.mode,
      decidedAt: typeof value.decidedAt === "string" ? value.decidedAt : null,
    };
  } catch {
    return NOT_DECIDED;
  }
}

const consent = createStoredSetting<DiagnosticsConsent>({
  key: CONSENT_KEY,
  fallback: NOT_DECIDED,
  event: CHANGE_EVENT,
  storageEvents: true,
  parse: parseConsent,
  serialize: (value) => JSON.stringify(value),
});

export const getDiagnosticsConsent = (): DiagnosticsConsent => consent.load();

/** The effective mode: a user who never decided is asked per crash. Primitive for `useSyncExternalStore`. */
export const getDiagnosticsMode = (): DiagnosticsMode => consent.load().mode ?? "ask";

export function setDiagnosticsMode(
  mode: DiagnosticsMode,
  now: () => Date = () => new Date(),
): void {
  consent.save({ mode, decidedAt: now().toISOString() });
}

export const subscribeDiagnosticsConsent = consent.subscribe;
