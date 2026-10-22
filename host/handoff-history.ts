import { mkdir, writeFile, readFile, rename } from "node:fs/promises";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync, renameSync } from "node:fs";
import type { HandoffHistory } from "../src/features/sessions/model/handoffBudget";

/** Archives live on the session-owning host, never in the project working tree. */
export class HandoffHistoryStore {
  constructor(private readonly directory: string) {}
  private path(sessionId: string): string {
    if (!sessionId || sessionId.length > 200) throw new Error("Invalid session id");
    return join(
      this.directory,
      "handoff-history",
      `${createHash("sha256").update(sessionId).digest("hex")}.json`,
    );
  }
  /** Command preparation runs inside the host's synchronous SQLite transaction. */
  saveSync(history: HandoffHistory): { path: string } {
    const text = JSON.stringify(history);
    if (Buffer.byteLength(text) > 8 * 1024 * 1024) throw new Error("Handoff history exceeds 8 MiB");
    if (
      history.messages.length > 20_000 ||
      history.messages.some(
        (message) =>
          !message.id ||
          !["user", "assistant", "plan", "tasks"].includes(message.role) ||
          typeof message.text !== "string",
      )
    )
      throw new Error("Invalid handoff history");
    const path = this.path(history.sessionId);
    mkdirSync(join(this.directory, "handoff-history"), { recursive: true });
    const temporary = `${path}.${randomUUID()}.tmp`;
    writeFileSync(temporary, text, { mode: 0o600 });
    renameSync(temporary, path);
    return { path };
  }
  async save(history: HandoffHistory): Promise<{ path: string }> {
    const text = JSON.stringify(history);
    if (Buffer.byteLength(text) > 8 * 1024 * 1024) throw new Error("Handoff history exceeds 8 MiB");
    if (
      history.messages.length > 20_000 ||
      history.messages.some(
        (message) =>
          !message.id ||
          !["user", "assistant", "plan", "tasks"].includes(message.role) ||
          typeof message.text !== "string",
      )
    )
      throw new Error("Invalid handoff history");
    const path = this.path(history.sessionId);
    await mkdir(join(this.directory, "handoff-history"), { recursive: true });
    const temporary = `${path}.${randomUUID()}.tmp`;
    await writeFile(temporary, text, { mode: 0o600 });
    await rename(temporary, path);
    return { path };
  }
  async read(
    sessionId: string,
    cursor = 0,
    limit = 20,
  ): Promise<{ messages: HandoffHistory["messages"]; nextCursor?: number }> {
    const history = JSON.parse(await readFile(this.path(sessionId), "utf8")) as HandoffHistory;
    const start = Math.max(0, Math.floor(cursor));
    const end = start + Math.max(1, Math.min(100, Math.floor(limit)));
    const messages = history.messages.slice(start, end);
    return { messages, ...(end < history.messages.length ? { nextCursor: end } : {}) };
  }
}
