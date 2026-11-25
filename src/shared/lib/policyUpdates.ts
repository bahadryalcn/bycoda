import bundledUpdate from "./policy-updates.json";
import { isoTimestamp } from "./time/timestamps";

const repository = "https://github.com/bahadryalcn/bycoda/blob/main/docs/guides";
export const policyUpdateFeed =
  "https://raw.githubusercontent.com/bahadryalcn/bycoda/main/src/shared/lib/policy-updates.json";
export const policyUpdateIntervalMs = 6 * 60 * 60 * 1000;
export const policyUpdateStorageKey = "bycoda.policyUpdate.seen";

const documents = {
  privacy: `${repository}/privacy-policy.md`,
  terms: `${repository}/terms-of-use.md`,
} as const;

type Document = keyof typeof documents;
export type PolicyUpdate = {
  revision: number;
  publishedOn: string;
  documents: Document[];
  en: string;
  tr: string;
};

function isDocument(value: unknown): value is Document {
  return value === "privacy" || value === "terms";
}

function isPublicationDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return isoTimestamp(value)?.startsWith(`${value}T`) ?? false;
}

export function parsePolicyUpdate(input: unknown): PolicyUpdate | undefined {
  if (!input || typeof input !== "object") return undefined;
  const { revision, publishedOn, documents: changed, en, tr } = input as Partial<PolicyUpdate>;
  if (
    typeof revision !== "number" ||
    !Number.isSafeInteger(revision) ||
    revision < 1 ||
    !isPublicationDate(publishedOn) ||
    !Array.isArray(changed) ||
    changed.length < 1 ||
    changed.length > 2 ||
    !changed.every(isDocument) ||
    new Set(changed).size !== changed.length ||
    typeof en !== "string" ||
    !en.trim() ||
    en.length > 512 ||
    typeof tr !== "string" ||
    !tr.trim() ||
    tr.length > 512
  )
    return undefined;
  return { revision, publishedOn, documents: changed, en, tr };
}

export function policyDocumentUrl(document: Document): string {
  return documents[document];
}

export const bundledPolicyUpdate = parsePolicyUpdate(bundledUpdate);

export async function readPolicyUpdate(signal: AbortSignal): Promise<PolicyUpdate | undefined> {
  if (signal.aborted) return undefined;
  const request = new AbortController();
  const abort = () => request.abort();
  signal.addEventListener("abort", abort, { once: true });
  const deadline = setTimeout(abort, 10_000);
  try {
    const response = await fetch(policyUpdateFeed, {
      credentials: "omit",
      redirect: "error",
      signal: request.signal,
    });
    if (!response.ok) return undefined;
    const payload = await response.text();
    if (payload.length > 4096) return undefined;
    return parsePolicyUpdate(JSON.parse(payload));
  } finally {
    clearTimeout(deadline);
    signal.removeEventListener("abort", abort);
  }
}
