import { createHash } from "node:crypto";
import { roomOperationInput } from "./assistant-room-operation-input";

type Source = { environmentId: string; threadId: string };
type Receipt = { signature: string; state: "pending" | "returned" | "uncertain" };
/** Results are one-shot remote observations, never local project proofs or replayable data. */
export class AssistantRoomRemote {
  private readonly pending = new Map<string, string>();
  constructor(
    private readonly ports: {
      read(key: string): Promise<Receipt | undefined>;
      write(key: string, receipt: Receipt): Promise<void>;
      native(
        action: "delegation.grants" | "delegation.call",
        input: Record<string, unknown>,
        source: Source,
        authorized: () => Promise<boolean>,
      ): Promise<unknown>;
    },
  ) {}
  async call(
    action: string,
    input: Record<string, unknown>,
    source: Source,
    requestId: string,
    authorized: () => Promise<boolean>,
  ) {
    if (!(await authorized())) throw new Error("Original Room authority changed.");
    if (action === "remote.grants.list")
      return this.ports.native("delegation.grants", {}, source, authorized);
    const originalId = String(input.requestId ?? "");
    if (!originalId || originalId.length > 200 || originalId.includes("\0"))
      throw new Error("Original remote request identity required.");
    const key = `room-remote:${createHash("sha256")
      .update(JSON.stringify([source.environmentId, source.threadId, originalId]))
      .digest("hex")}`;
    const previous = await this.ports.read(key);
    const compact = (receipt?: Receipt) => ({
      requestId: originalId,
      state: receipt?.state === "pending" ? "uncertain" : (receipt?.state ?? "unknown"),
      resultRetained: false,
      remoteContext: "unverified",
      note: "Transport receipt only. Inspect the remote resource under a current grant; this never repeats the original operation or replays cached remote data.",
    });
    if (action === "remote.result") return compact(previous);
    if (action !== "remote.call" || requestId !== originalId)
      throw new Error("Remote operation identity changed.");
    const signature = createHash("sha256")
      .update(JSON.stringify(roomOperationInput(input, originalId)))
      .digest("hex");
    const active = this.pending.get(key);
    if ((previous && previous.signature !== signature) || (active && active !== signature))
      throw new Error("Remote request ID was reused with changed input.");
    if (previous || active) return compact(previous);
    this.pending.set(key, signature);
    try {
      await this.ports.write(key, { signature, state: "pending" });
      if (!(await authorized())) throw new Error("Original Room authority changed.");
      try {
        const result = await this.ports.native("delegation.call", input, source, authorized);
        if (!(await authorized())) throw new Error("Original Room authority changed.");
        await this.ports.write(key, { signature, state: "returned" });
        return { requestId: originalId, state: "returned", remoteContext: "unverified", result };
      } catch {
        await this.ports.write(key, { signature, state: "uncertain" });
        return compact({ signature, state: "uncertain" });
      }
    } finally {
      this.pending.delete(key);
    }
  }
}
