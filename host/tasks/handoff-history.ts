import { createHash } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { writeFileAtomic, writeFileAtomicSync } from "../storage/atomic-write";
import type { HandoffHistory } from "../../src/features/sessions/model/handoffBudget";

const MAX_BYTES = 8 * 1024 * 1024;
const HASH = /^[a-f0-9]{64}$/;
type Manifest = { version: 1; metadata: string; messages: string[] };
const digest = (text: string) => createHash("sha256").update(text).digest("hex");

function prepare(history: HandoffHistory): { manifest: Manifest; blobs: Map<string, string> } {
  if (
    !history ||
    typeof history.sessionId !== "string" ||
    !history.sessionId ||
    history.sessionId.length > 200 ||
    !Array.isArray(history.messages) ||
    history.messages.length > 20_000 ||
    history.messages.some(
      (message) =>
        !message ||
        typeof message.id !== "string" ||
        !message.id ||
        !["user", "assistant", "plan", "tasks"].includes(message.role) ||
        typeof message.text !== "string",
    )
  )
    throw new Error("Invalid handoff history");
  const { messages, ...metadata } = history;
  const metadataText = JSON.stringify(metadata);
  const blobs = new Map<string, string>();
  const metadataHash = digest(metadataText);
  blobs.set(metadataHash, metadataText);
  let bytes =
    Buffer.byteLength(metadataText) +
    Buffer.byteLength(',"messages":[]') -
    (metadataText === "{}" ? 1 : 0) +
    Math.max(0, messages.length - 1);
  const hashes = messages.map((message) => {
    const text = JSON.stringify(message);
    bytes += Buffer.byteLength(text);
    const hash = digest(text);
    blobs.set(hash, text);
    return hash;
  });
  if (bytes > MAX_BYTES) throw new Error("Handoff history exceeds 8 MiB");
  return { manifest: { version: 1, metadata: metadataHash, messages: hashes }, blobs };
}

function parseManifest(text: string): Manifest {
  const value: unknown = JSON.parse(text);
  if (!value || typeof value !== "object") throw new Error("Invalid handoff manifest");
  const manifest = value as Manifest;
  if (
    manifest.version !== 1 ||
    typeof manifest.metadata !== "string" ||
    !HASH.test(manifest.metadata) ||
    !Array.isArray(manifest.messages) ||
    manifest.messages.length > 20_000 ||
    manifest.messages.some((hash) => typeof hash !== "string" || !HASH.test(hash))
  )
    throw new Error("Invalid handoff manifest");
  return manifest;
}

function checked(text: string, hash: string): string {
  if (digest(text) !== hash) throw new Error("Corrupt handoff history blob");
  return text;
}

function parseMessage(text: string): HandoffHistory["messages"][number] {
  const message: unknown = JSON.parse(text);
  if (!message || typeof message !== "object" || Array.isArray(message))
    throw new Error("Corrupt handoff history message");
  const value = message as HandoffHistory["messages"][number];
  if (
    typeof value.id !== "string" ||
    !value.id ||
    !["user", "assistant", "plan", "tasks"].includes(value.role) ||
    typeof value.text !== "string"
  )
    throw new Error("Corrupt handoff history message");
  return value;
}
function parseMetadata(text: string, sessionId: string): HandoffHistory & Record<string, unknown> {
  const metadata: unknown = JSON.parse(text);
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata))
    throw new Error("Corrupt handoff history metadata");
  const value = metadata as HandoffHistory & Record<string, unknown>;
  if (
    value.sessionId !== sessionId ||
    (value.retainedContext !== undefined && typeof value.retainedContext !== "string")
  )
    throw new Error("Corrupt handoff history metadata");
  return value;
}

/** Archives live on the session-owning host, never in the project working tree.
 * Immutable blobs and materializations are retained until exact reader retirement exists. */
export class HandoffHistoryStore {
  constructor(private readonly directory: string) {}
  private base(): string {
    return join(this.directory, "handoff-history");
  }
  private sessionKey(sessionId: string): string {
    if (typeof sessionId !== "string" || !sessionId || sessionId.length > 200)
      throw new Error("Invalid session id");
    return digest(sessionId);
  }
  private manifestPath(sessionId: string): string {
    return join(this.base(), `${this.sessionKey(sessionId)}.manifest.json`);
  }
  private legacyPath(sessionId: string): string {
    return join(this.base(), `${this.sessionKey(sessionId)}.json`);
  }
  private blobPath(hash: string): string {
    return join(this.base(), "blobs", `${hash}.json`);
  }
  private exportPath(manifest: Manifest): string {
    return join(this.base(), "exports", `${digest(JSON.stringify(manifest))}.json`);
  }
  private blobSync(hash: string): string {
    return checked(readFileSync(this.blobPath(hash), "utf8"), hash);
  }
  private async blob(hash: string): Promise<string> {
    return checked(await readFile(this.blobPath(hash), "utf8"), hash);
  }
  private materialize(manifest: Manifest, sessionId: string): string {
    const path = this.exportPath(manifest);
    const metadata = parseMetadata(this.blobSync(manifest.metadata), sessionId);
    const messages = manifest.messages.map((hash) => parseMessage(this.blobSync(hash)));
    const text = JSON.stringify({ ...metadata, messages });
    if (Buffer.byteLength(text) > MAX_BYTES) throw new Error("Handoff history exceeds 8 MiB");
    try {
      if (readFileSync(path, "utf8") === text) return path;
      throw new Error("Corrupt handoff history materialization");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    writeFileAtomicSync(path, text, { mode: 0o600 });
    return path;
  }
  private result(manifest: Manifest, sessionId: string): { path: string } {
    const store = this;
    // Defer the full JSON file until its path is actually consumed.
    return {
      get path() {
        return store.materialize(manifest, sessionId);
      },
    };
  }
  private putSync(hash: string, text: string): void {
    try {
      if (this.blobSync(hash) !== text) throw new Error("Corrupt handoff history blob");
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    writeFileAtomicSync(this.blobPath(hash), text, { mode: 0o600 });
  }
  private async put(hash: string, text: string): Promise<void> {
    try {
      if ((await this.blob(hash)) !== text) throw new Error("Corrupt handoff history blob");
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    await writeFileAtomic(this.blobPath(hash), text, { mode: 0o600 });
  }
  /** Command preparation runs inside the host's synchronous SQLite transaction. */
  saveSync(history: HandoffHistory): { path: string } {
    const { manifest, blobs } = prepare(history);
    mkdirSync(join(this.base(), "blobs"), { recursive: true });
    for (const [hash, text] of blobs) this.putSync(hash, text);
    writeFileAtomicSync(this.manifestPath(history.sessionId), JSON.stringify(manifest), {
      mode: 0o600,
    });
    return this.result(manifest, history.sessionId);
  }
  async save(history: HandoffHistory): Promise<{ path: string }> {
    const { manifest, blobs } = prepare(history);
    await mkdir(join(this.base(), "blobs"), { recursive: true });
    for (const [hash, text] of blobs) await this.put(hash, text);
    await writeFileAtomic(this.manifestPath(history.sessionId), JSON.stringify(manifest), {
      mode: 0o600,
    });
    return this.result(manifest, history.sessionId);
  }
  async read(
    sessionId: string,
    cursor = 0,
    limit = 20,
  ): Promise<{
    messages: HandoffHistory["messages"];
    nextCursor?: number;
    retainedContext?: string;
  }> {
    const start = Math.max(0, Math.floor(cursor));
    const end = start + Math.max(1, Math.min(100, Math.floor(limit)));
    let manifest: Manifest;
    try {
      manifest = parseManifest(await readFile(this.manifestPath(sessionId), "utf8"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const legacy = JSON.parse(
        await readFile(this.legacyPath(sessionId), "utf8"),
      ) as HandoffHistory;
      return {
        messages: legacy.messages.slice(start, end),
        ...(start === 0 && legacy.retainedContext
          ? { retainedContext: legacy.retainedContext }
          : {}),
        ...(end < legacy.messages.length ? { nextCursor: end } : {}),
      };
    }
    const metadata = parseMetadata(await this.blob(manifest.metadata), sessionId);
    const messages = await Promise.all(
      manifest.messages.slice(start, end).map(async (hash) => parseMessage(await this.blob(hash))),
    );
    return {
      messages,
      ...(start === 0 && metadata.retainedContext
        ? { retainedContext: metadata.retainedContext }
        : {}),
      ...(end < manifest.messages.length ? { nextCursor: end } : {}),
    };
  }
}
