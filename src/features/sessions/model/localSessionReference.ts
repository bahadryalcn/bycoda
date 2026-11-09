/** Persisted owner identity only: never provider IDs, endpoints or credentials. */
import {
  hasControlCharacters,
  replaceControlCharacters,
} from "../../../shared/lib/controlCharacters";
export type LocalSessionLocator =
  | { kind: "host"; environmentId: string; sessionId: string }
  | {
      kind: "native";
      sourceStoreId: string;
      sourceProfileId: string;
      sessionId: string;
    };

export type LocalSessionReference = {
  locator: LocalSessionLocator;
  turnId?: string;
};

export const SESSION_LINK_ORIGIN = "https://link.bycoda.codes";

function validId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 256 &&
    value.trim() === value &&
    !hasControlCharacters(value) &&
    value !== "." &&
    value !== ".."
  );
}

function encodedId(value: string): string {
  if (!validId(value)) throw new Error("Invalid local session reference identity");
  // Encoding the extra punctuation also makes the URI safe in Markdown targets.
  return encodeURIComponent(value).replace(
    /[!'()*.~]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

export function buildLocalSessionLink(value: LocalSessionReference | LocalSessionLocator): string {
  return buildSessionLink(value, `${SESSION_LINK_ORIGIN}/session`);
}

/** OS handoff preserves the complete owner identity of the public HTTPS link. */
export function buildSessionAppLink(value: LocalSessionReference | LocalSessionLocator): string {
  return buildSessionLink(value, "bycoda://session");
}

function buildSessionLink(
  value: LocalSessionReference | LocalSessionLocator,
  prefix: string,
): string {
  const { locator, turnId } = "locator" in value ? value : { locator: value, turnId: undefined };
  const identity =
    locator.kind === "host"
      ? ["host", encodedId(locator.environmentId), encodedId(locator.sessionId)]
      : locator.kind === "native"
        ? [
            "native",
            encodedId(locator.sourceStoreId),
            encodedId(locator.sourceProfileId),
            encodedId(locator.sessionId),
          ]
        : null;
  if (!identity) throw new Error("Unknown local session reference owner");
  const link = `${prefix}/v1/${identity.join("/")}${turnId === undefined ? "" : `?turn=${encodedId(turnId)}`}`;
  if (link.length > 4096) throw new Error("Local session reference is too long");
  return link;
}

/** Strict, bounded parsing; no URL normalization, authority guessing or fallback. */
export function parseLocalSessionLink(href: string): LocalSessionReference | null {
  if (typeof href !== "string" || href.length > 4096) return null;
  const match =
    /^(bycoda:\/\/session|https:\/\/link\.bycoda\.codes\/session)\/v1\/(host|native)\/([^?#]+)(?:\?turn=([^&#]+))?$/.exec(
      href,
    );
  if (!match) return null;
  try {
    const parts = match[3].split("/").map(decodeURIComponent);
    if (!parts.every(validId)) return null;
    let locator: LocalSessionLocator;
    if (match[2] === "host" && parts.length === 2)
      locator = { kind: "host", environmentId: parts[0], sessionId: parts[1] };
    else if (match[2] === "native" && parts.length === 3)
      locator = {
        kind: "native",
        sourceStoreId: parts[0],
        sourceProfileId: parts[1],
        sessionId: parts[2],
      };
    else return null;
    const turnId = match[4] === undefined ? undefined : decodeURIComponent(match[4]);
    if (turnId !== undefined && !validId(turnId)) return null;
    // Reject raw punctuation/whitespace and ambiguous noncanonical encodings.
    const reference = { locator, ...(turnId === undefined ? {} : { turnId }) };
    return buildSessionLink(reference, match[1]) === href ? reference : null;
  } catch {
    return null;
  }
}

export function escapeSessionReferenceLabel(title: string): string {
  return (replaceControlCharacters(title, " ").trim() || "Session").replace(
    /[\\`*_[\]<>!()#|~]/g,
    "\\$&",
  );
}

/** Additive Conversation Tool fields, separate from strict sessions.list RPC. */
export function localSessionLinkFields(
  locator: LocalSessionLocator,
  title: string,
  turnId?: string,
) {
  const reference: LocalSessionReference = {
    locator,
    ...(turnId === undefined ? {} : { turnId }),
  };
  const link = buildLocalSessionLink(reference);
  return {
    reference,
    link,
    markdownReference: `[${escapeSessionReferenceLabel(title)}](${link})`,
  };
}
