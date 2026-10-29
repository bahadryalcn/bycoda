/** Persisted owner identity only: never provider IDs, endpoints or credentials. */
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

function validId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 256 &&
    value.trim() === value &&
    !/[\u0000-\u001f\u007f]/.test(value) &&
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
  const link = `bycoda://session/v1/${identity.join("/")}${turnId === undefined ? "" : `?turn=${encodedId(turnId)}`}`;
  if (link.length > 4096) throw new Error("Local session reference is too long");
  return link;
}

/** Strict, bounded parsing; no URL normalization, authority guessing or fallback. */
export function parseLocalSessionLink(href: string): LocalSessionReference | null {
  if (typeof href !== "string" || href.length > 4096) return null;
  const match = /^bycoda:\/\/session\/v1\/(host|native)\/([^?#]+)(?:\?turn=([^&#]+))?$/.exec(href);
  if (!match) return null;
  try {
    const parts = match[2].split("/").map(decodeURIComponent);
    if (!parts.every(validId)) return null;
    let locator: LocalSessionLocator;
    if (match[1] === "host" && parts.length === 2)
      locator = { kind: "host", environmentId: parts[0], sessionId: parts[1] };
    else if (match[1] === "native" && parts.length === 3)
      locator = {
        kind: "native",
        sourceStoreId: parts[0],
        sourceProfileId: parts[1],
        sessionId: parts[2],
      };
    else return null;
    const turnId = match[3] === undefined ? undefined : decodeURIComponent(match[3]);
    if (turnId !== undefined && !validId(turnId)) return null;
    // Reject raw punctuation/whitespace and ambiguous noncanonical encodings.
    const reference = { locator, ...(turnId === undefined ? {} : { turnId }) };
    return buildLocalSessionLink(reference) === href ? reference : null;
  } catch {
    return null;
  }
}

export function escapeSessionReferenceLabel(title: string): string {
  return (title.replace(/[\u0000-\u001f\u007f]/g, " ").trim() || "Session").replace(
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
