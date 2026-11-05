import { pathKey } from "../../shared/lib/paths";
import { t } from "../../shared/i18n/technical";

/** Explicit window-transfer snapshot. Capture and lease state remain Host-owned. */
export type BrowserDraftTransfer = {
  comment: string;
  annotation?: { id: string; navigationId: string };
  captures?: { id: string; comment: string }[];
  current?: { id: string; comment: string };
  uncertainDelivery?: boolean;
  inputBlocked?: boolean;
};

const drafts = new Map<string, BrowserDraftTransfer>();
const listeners = new Map<string, Set<(draft: BrowserDraftTransfer) => void>>();
const key = (cwd: string, sessionId: string | undefined, targetValue: string) =>
  JSON.stringify([pathKey(cwd), sessionId, targetValue]);
export type BrowserWorkspaceDrafts = Record<string, BrowserDraftTransfer>;
export function readBrowserWorkspaceDrafts(cwd: string, sessionId: string): BrowserWorkspaceDrafts {
  const result: BrowserWorkspaceDrafts = Object.create(null);
  const project = pathKey(cwd);
  for (const [id, value] of drafts) {
    const [ownerProject, ownerSession, target] = JSON.parse(id) as [string, string, string];
    if (ownerProject === project && ownerSession === sessionId)
      result[target] = structuredClone(value);
  }
  if (new TextEncoder().encode(JSON.stringify(result)).byteLength > 12 * 1024 * 1024)
    throw new Error(t("Tools draft is too large to transfer. Keep this window open."));
  return result;
}
export function restoreBrowserWorkspaceDrafts(
  cwd: string,
  sessionId: string,
  values: BrowserWorkspaceDrafts,
): void {
  if (new TextEncoder().encode(JSON.stringify(values)).byteLength > 12 * 1024 * 1024)
    throw new Error(t("Tools draft is too large to transfer. Keep this window open."));
  for (const value of Object.values(values)) validateDraft(value);
  for (const [target, value] of Object.entries(values))
    restoreBrowserDraftTransfer(cwd, sessionId, target, value);
}
function validateDraft(draft: BrowserDraftTransfer) {
  if (
    typeof draft.comment !== "string" ||
    draft.comment.length > 4000 ||
    (draft.captures?.length ?? 0) > 8 ||
    draft.captures?.some((capture) => capture.comment.length > 4000) ||
    (draft.current?.comment.length ?? 0) > 4000
  )
    throw new Error(t("Tools draft is too large to transfer. Keep this window open."));
}

export function readBrowserDraftTransfer(
  cwd: string,
  sessionId: string | undefined,
  targetValue: string,
) {
  const value = drafts.get(key(cwd, sessionId, targetValue));
  return value ? { ...value } : undefined;
}

export function restoreBrowserDraftTransfer(
  cwd: string,
  sessionId: string | undefined,
  targetValue: string,
  draft: BrowserDraftTransfer,
) {
  validateDraft(draft);
  const id = key(cwd, sessionId, targetValue);
  const value: BrowserDraftTransfer = {
    comment: draft.comment,
    annotation: draft.annotation ? { ...draft.annotation } : undefined,
    captures: draft.captures?.map((capture) => ({ ...capture })),
    current: draft.current ? { ...draft.current } : undefined,
    uncertainDelivery: draft.uncertainDelivery === true,
    inputBlocked: draft.inputBlocked === true,
  };
  if (JSON.stringify(drafts.get(id)) === JSON.stringify(value)) return;
  drafts.set(id, value);
  listeners.get(id)?.forEach((listener) => listener(value));
}

export function writeBrowserDraftTransfer(
  cwd: string,
  sessionId: string | undefined,
  targetValue: string,
  draft: BrowserDraftTransfer,
) {
  drafts.set(key(cwd, sessionId, targetValue), structuredClone(draft));
}

export function subscribeBrowserDraftTransfer(
  cwd: string,
  sessionId: string | undefined,
  targetValue: string,
  listener: (draft: BrowserDraftTransfer) => void,
) {
  const id = key(cwd, sessionId, targetValue);
  const group = listeners.get(id) ?? new Set();
  group.add(listener);
  listeners.set(id, group);
  return () => {
    group.delete(listener);
    if (!group.size) listeners.delete(id);
  };
}
