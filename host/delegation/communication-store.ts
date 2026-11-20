import { join } from "node:path";
import { z } from "zod";
import { readStateFile, writeFileAtomic } from "../storage/atomic-write";

const MessageSchema = z.object({
  id: z.string(),
  requestKey: z.string(),
  payloadHash: z.string(),
  parentSessionId: z.string(),
  projectId: z.string(),
  senderSessionId: z.string(),
  targetSessionId: z.string(),
  targetRunId: z.string().optional(),
  text: z.string().max(20_000),
  /** The sender's own words, without the Host's delivery wrapper. */
  body: z.string().max(20_000).optional(),
  mode: z.enum(["auto", "queue", "steer"]),
  state: z.enum(["pending", "dispatching", "settled"]),
  delivery: z.enum(["queued", "started", "steered", "failed", "cancelled", "unknown"]),
  error: z.string().optional(),
  /** Recipient transcript block that carries the message, when the Host knows it. */
  blockId: z.string().optional(),
  createdAt: z.number(),
});
export type AgentMessage = z.infer<typeof MessageSchema>;

/** Durable outbox and retry receipts. Unknown effects are retained, never replayed. */
export class AgentMessageStore {
  private messages?: AgentMessage[];
  private readonly file: string;
  constructor(directory: string) {
    this.file = join(directory, "delegation", "messages.json");
  }

  async list(): Promise<AgentMessage[]> {
    return structuredClone(await this.load());
  }

  async forTarget(sessionId: string, projectId: string): Promise<AgentMessage[]> {
    const messages = await this.load();
    return structuredClone(
      messages.filter(
        (message) =>
          message.targetSessionId === sessionId &&
          message.projectId === projectId &&
          !!message.targetRunId,
      ),
    );
  }

  private async load(): Promise<AgentMessage[]> {
    if (!this.messages) {
      const loaded = await readStateFile(
        this.file,
        (text) => z.array(MessageSchema).max(1000).parse(JSON.parse(text)),
        { quarantine: false },
      );
      if (loaded.status === "corrupt")
        throw new Error("Agent message state is unreadable; repair is required.");
      this.messages ??= loaded.status === "ok" ? loaded.value : [];
    }
    return this.messages;
  }

  // The communication service serializes every read/modify/write.
  async save(messages: AgentMessage[]): Promise<void> {
    while (messages.length > 1000) {
      const index = messages.findIndex(
        (message) => message.state === "settled" && message.delivery !== "unknown",
      );
      if (index < 0) throw new Error("Agent message receipts are full.");
      messages.splice(index, 1);
    }
    await writeFileAtomic(this.file, JSON.stringify(messages), { mode: 0o600 });
    this.messages = structuredClone(messages);
  }
}
