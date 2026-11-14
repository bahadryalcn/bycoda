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
  mode: z.enum(["auto", "queue", "steer"]),
  state: z.enum(["pending", "dispatching", "settled"]),
  delivery: z.enum(["queued", "started", "steered", "failed", "unknown"]),
  error: z.string().optional(),
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
    if (!this.messages) {
      const loaded = await readStateFile(
        this.file,
        (text) => z.array(MessageSchema).max(1000).parse(JSON.parse(text)),
        { quarantine: false },
      );
      if (loaded.status === "corrupt")
        throw new Error("Agent message state is unreadable; repair is required.");
      this.messages = loaded.status === "ok" ? loaded.value : [];
    }
    return structuredClone(this.messages);
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
