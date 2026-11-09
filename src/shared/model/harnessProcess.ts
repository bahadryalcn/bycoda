/** Source-issued process correlation. This is neither an operation grant nor provider ACK. */
export type HarnessProcessReceipt = Readonly<{
  version: 1;
  backend: "native" | "host";
  sessionId: string;
  pid: number;
  constructionId: string;
}>;

const constructionId =
  /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}(?![\s\S])/;
const fields = new Set(["version", "backend", "sessionId", "pid", "constructionId"]);

export function isHarnessConstructionId(value: unknown): value is string {
  return typeof value === "string" && value.length === 36 && constructionId.test(value);
}

/** Validate only a spawn's actual receipt; never fill missing fields from current session state. */
export function requireHarnessProcessReceipt(
  value: unknown,
  sessionId: string,
  backend: HarnessProcessReceipt["backend"],
): HarnessProcessReceipt {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new Error(
      "The execution backend cannot identify this process. Update it before starting work.",
    );
  const row = value as Record<string, unknown>;
  if (
    Object.keys(row).some((key) => !fields.has(key)) ||
    row.version !== 1 ||
    row.backend !== backend ||
    row.sessionId !== sessionId ||
    typeof row.pid !== "number" ||
    !Number.isSafeInteger(row.pid) ||
    row.pid < 1 ||
    row.pid > 0xffff_ffff ||
    !isHarnessConstructionId(row.constructionId)
  )
    throw new Error(
      "The execution backend returned an invalid process identity. This process cannot receive commands.",
    );
  return Object.freeze({
    version: 1,
    backend,
    sessionId,
    pid: row.pid,
    constructionId: row.constructionId,
  });
}
