import { z } from "zod";
import { createHash } from "node:crypto";
import { ConversationManagementTools, managementReceiptKey, type GlobalManagementPrincipal, type ManagementPorts, type ManagementReceipt } from "../../conversation/conversation-management-tools";

const id = z.string().min(1).max(300);
const proposalSchema = z.strictObject({
  requestId: id,
  accountId: id,
  projectId: id.nullable(),
  action: z.enum(["replies.send", "messages.send", "comments.send"]),
  entityId: id,
});
export type RoomSocialProposal = z.infer<typeof proposalSchema>;

/** Constructed by SocialService from current records, never from model input. */
export type RoomSocialSnapshot = {
  accountId: string;
  accountGrantVersion: string;
  projectId: string | null;
  projectCwd: string | null;
  action: RoomSocialProposal["action"];
  entityId: string;
  policyVersion: string;
  effectivePolicy: unknown;
  platformLimits: unknown;
  payload: unknown;
};
type Principal = GlobalManagementPrincipal;
const reviewedRoomSend = Symbol("reviewedRoomSend");
export type ReviewedRoomSend = { readonly [reviewedRoomSend]: true; readonly operationHash: string };
export function isReviewedRoomSend(value: ReviewedRoomSend): boolean {
  return value?.[reviewedRoomSend] === true && /^[a-f0-9]{64}$/.test(value.operationHash);
}
type Ports = Pick<ManagementPorts<"social.send", Principal>, "approve" | "receipt" | "saveReceipt"> & {
  /** Must verify exact account grant, project identity and source; capture current payload and policy. */
  snapshot(proposal: RoomSocialProposal, principal: Principal, authorized: () => Promise<boolean>): Promise<RoomSocialSnapshot>;
  /** Must recheck snapshot and authority in the Social mutation boundary before enqueueing. */
  enqueue(proposal: RoomSocialProposal, snapshot: RoomSocialSnapshot, principal: Principal, authorized: () => Promise<boolean>, review: ReviewedRoomSend): Promise<unknown>;
  readback(jobId: string, principal: Principal, authorized: () => Promise<boolean>): Promise<unknown>;
};

/** Native approval binds the canonical Social snapshot, not caller-supplied content. */
export class AssistantRoomSocialSend {
  private readonly management: ConversationManagementTools<"social.send", Principal>;
  constructor(private readonly ports: Ports) {
    this.management = new ConversationManagementTools({ ...ports, execute: async (_action, input, principal, authorized) => {
      const proposal = proposalSchema.parse(input.proposal);
      const approved = input.snapshot as RoomSocialSnapshot;
      const current = await ports.snapshot(proposal, principal, authorized);
      if (JSON.stringify(current) !== JSON.stringify(approved)) throw new Error("Social source, payload or policy changed after owner review.");
      const operationHash = createHash("sha256").update(JSON.stringify(["social.send", input])).digest("hex");
      return ports.enqueue(proposal, approved, principal, authorized, { [reviewedRoomSend]: true, operationHash });
    } }, new Set());
  }

  async submit(raw: unknown, principal: Principal, authorized: () => Promise<boolean>, requestId: string,
    qualify: <T>(effect: () => Promise<T>) => Promise<T>) {
    const proposal = proposalSchema.parse(raw);
    if (proposal.requestId !== requestId) throw new Error("Social operation identity changed.");
    if (!(await authorized())) throw new Error("Room authority revoked.");
    return qualify(async () => {
      const snapshot = await this.ports.snapshot(proposal, principal, authorized);
      if (snapshot.accountId !== proposal.accountId || snapshot.projectId !== proposal.projectId || snapshot.action !== proposal.action || snapshot.entityId !== proposal.entityId || !snapshot.accountGrantVersion || !snapshot.policyVersion || (proposal.projectId !== null && !snapshot.projectCwd) || (proposal.projectId === null && snapshot.projectCwd !== null))
        throw new Error("Social snapshot source identity changed.");
      const result = await this.management.call("social.send", { requestId: `social-send:${requestId}`, proposal, snapshot, source: principal }, principal, authorized);
      return { ...(result as Record<string, unknown>), requestId };
    });
  }

  async status(principal: Principal, requestId: string, authorized: () => Promise<boolean>, qualify: <T>(effect: () => Promise<T>) => Promise<T>): Promise<{ requestId: string } & ManagementReceipt | undefined> {
    id.parse(requestId);
    if (!(await authorized())) throw new Error("Room authority revoked.");
    return qualify(async () => {
      const receipt = await this.ports.receipt(managementReceiptKey(principal, `social-send:${requestId}`));
      if (!(await authorized())) throw new Error("Room authority revoked.");
      if (!receipt) return undefined;
      const result = receipt.result as { id?: unknown } | undefined;
      const current = receipt.state === "completed" && typeof result?.id === "string" ? await this.ports.readback(result.id, principal, authorized) : receipt.result;
      if (!(await authorized())) throw new Error("Room authority revoked.");
      return { requestId, ...receipt, ...(current !== undefined ? { result: current } : {}), state: receipt.state === "pending" ? "uncertain" : receipt.state };
    });
  }
}
