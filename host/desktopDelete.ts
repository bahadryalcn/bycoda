import { randomUUID } from "node:crypto";

type Job = { id: string; sessionId: string; cwd: string };
type Pending = {
  job: Job;
  client?: string;
  authorized: () => boolean;
  finish: (error?: string) => void;
};

/** The desktop remains the sole writer of its session database. */
export class DesktopDelete {
  private clients = new Map<string, number>();
  private pending = new Map<string, Pending>();

  request(sessionId: string, cwd: string, authorized: () => boolean): Promise<void> {
    if (![...this.clients.values()].some((at) => Date.now() - at < 20_000))
      return Promise.reject(
        new Error(
          "Open the updated bycoda app on that computer to delete its conversations remotely.",
        ),
      );
    if (this.pending.size >= 100)
      return Promise.reject(
        new Error("Too many conversation deletions are waiting for the desktop."),
      );
    return new Promise((resolve, reject) => {
      const id = randomUUID();
      const timer = setTimeout(
        () =>
          finish(
            "The desktop did not confirm deletion. Refresh the conversation list before retrying.",
          ),
        18_000,
      );
      const finish = (error?: string) => {
        clearTimeout(timer);
        this.pending.delete(id);
        if (error) reject(new Error(error));
        else resolve();
      };
      this.pending.set(id, { job: { id, sessionId, cwd }, authorized, finish });
    });
  }

  beat(client: string, input: unknown): { jobs: Job[]; acked: string[] } {
    if (!input || typeof input !== "object" || Array.isArray(input)) return { jobs: [], acked: [] };
    const payload = input as {
      version?: number;
      replies?: { id: string; error?: string }[];
    };
    if (payload.version !== 1) return { jobs: [], acked: [] };
    this.clients.set(client, Date.now());
    for (const [key, at] of this.clients) if (Date.now() - at >= 20_000) this.clients.delete(key);
    const acked: string[] = [];
    for (const reply of Array.isArray(payload.replies) ? payload.replies.slice(0, 100) : []) {
      if (!reply || typeof reply.id !== "string") continue;
      const pending = this.pending.get(reply.id);
      if (pending && pending.client !== client) continue;
      pending?.finish(typeof reply.error === "string" ? reply.error : undefined);
      acked.push(reply.id);
    }
    const jobs: Job[] = [];
    for (const pending of this.pending.values()) {
      if (!pending.authorized()) {
        pending.finish("Device authorization was revoked");
        continue;
      }
      // Deliver once; a lost reply must never replay a destructive operation.
      if (pending.client) continue;
      pending.client = client;
      jobs.push(pending.job);
    }
    return { jobs, acked };
  }

  close(): void {
    for (const pending of this.pending.values())
      pending.finish("The host closed before deletion was confirmed.");
  }
}
