import { afterEach, expect, it, vi } from "vitest";
import { createApprovalOccurrenceId } from "../../src/shared/model/approvalOccurrence";
import { DELEGATION_PARENT_KEY } from "../../src/shared/model/host-contracts/delegation";
import { CLAUDE_WORKSPACE_GLOB } from "../../src/shared/model/sessionApprovalGrant";
import { cleanups, setup } from "../engine-support/engine.test-support";
import { sessionApprovalGrantsRpc } from "./session-approval-grants-rpc";

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function fixture() {
  const f = await setup("claude");
  vi.mocked(f.provider.approve).mockReturnValue(true);
  const owner = { authorized: async () => true };
  const params = { sessionId: f.id };
  const list = () => sessionApprovalGrantsRpc(f.engine, params, owner);
  const approval = (id: string, occurrence: string) =>
    f.engine.sessionStoreWrite(id, async () => {
      const { session } = await f.store.session(id);
      return session.blocks.find((block) => block.approval?.occurrenceId === occurrence)?.approval;
    });
  const begin = async (turn: number, id = f.id) => {
    const receipt = await f.engine.command({
      type: "send",
      commandId: `send-${turn}`,
      sessionId: id,
      text: "Find implementation files",
    });
    await f.waitForTurnStart(turn);
    return {
      request: (requestId: number, title: string, eligible = false) => {
        const occurrenceId = createApprovalOccurrenceId();
        f.turns[turn - 1].input.onEvent({
          type: "approval.requested",
          callId: occurrenceId,
          requestId,
          occurrenceId,
          title,
          ...(eligible ? { sessionApprovalScope: CLAUDE_WORKSPACE_GLOB } : {}),
        });
        return {
          type: "approve",
          commandId: `approve-${occurrenceId}`,
          sessionId: id,
          runId: receipt.runId,
          requestId,
          approvalOccurrenceId: occurrenceId,
          decision: "allow",
        } as const;
      },
      finish: async () => {
        f.turns[turn - 1].finish();
        await f.engine.waitForRun(id, receipt.runId);
      },
    };
  };
  return { ...f, begin, list, approval, owner, params };
}

it("allows the same tool class across turns only in the original session and stops on exact revocation", async () => {
  const f = await fixture();
  const first = await f.begin(1);
  const request = first.request(1, "Glob", true);
  const grant = { id: request.approvalOccurrenceId, scope: CLAUDE_WORKSPACE_GLOB };
  const command = { ...request, allowForSession: true };
  await f.engine.command(command);
  await vi.waitFor(async () => expect(await f.list()).toEqual([grant]));
  await first.finish();

  const child = await f.engine.command({
    type: "create",
    commandId: "create-child",
    projectId: f.project.id,
    workspaceMode: "current",
    harness: "claude",
    model: "claude:test",
    runtimeMode: "supervised",
    modelSettings: {
      [DELEGATION_PARENT_KEY]: JSON.stringify({
        parentSessionId: f.id,
        kind: "subagent",
        model: "claude:test",
        runId: "child-run",
        startedAt: Date.now(),
        round: 1,
      }),
    },
  });
  const other = await f.begin(2, child.sessionId);
  const childRequest = other.request(1, "Glob in child", true);
  expect(await f.approval(child.sessionId, childRequest.approvalOccurrenceId)).toMatchObject({
    requestId: 1,
  });
  expect(f.provider.approve).toHaveBeenCalledTimes(1);
  await expect(
    sessionApprovalGrantsRpc(f.engine, { sessionId: child.sessionId }, f.owner),
  ).resolves.toEqual([]);
  await other.finish();

  const next = await f.begin(3);
  const automatic = next.request(1, "Glob again", true);
  expect(await f.approval(f.id, automatic.approvalOccurrenceId)).toMatchObject({
    decided: "allow",
  });
  expect(f.provider.approve).toHaveBeenLastCalledWith(
    f.id,
    1,
    "allow",
    automatic.approvalOccurrenceId,
    CLAUDE_WORKSPACE_GLOB,
  );
  const revoke = (grantId: string) =>
    sessionApprovalGrantsRpc(f.engine, { ...f.params, grantId }, f.owner, true);
  await expect(revoke(automatic.approvalOccurrenceId)).resolves.toEqual([grant]);
  await expect(
    sessionApprovalGrantsRpc(
      f.engine,
      { ...f.params, grantId: grant.id },
      { authorized: async () => false },
      true,
    ),
  ).rejects.toThrow("Device authorization was revoked");
  await expect(f.list()).resolves.toEqual([grant]);
  await expect(revoke(grant.id)).resolves.toEqual([]);
  await f.engine.command(command);
  await expect(f.list()).resolves.toEqual([]);

  const afterRevoke = next.request(2, "Glob after revoke", true);
  const pending = await f.approval(f.id, afterRevoke.approvalOccurrenceId);
  expect(pending).toMatchObject({ requestId: 2 });
  expect(pending?.decided).toBeUndefined();
  expect(f.provider.approve).toHaveBeenCalledTimes(2);
  await next.finish();
});

it("keeps destructive, credential and unverified requests behind the original approval gate", async () => {
  const f = await fixture();
  const turn = await f.begin(1);
  const grantRequest = turn.request(1, "Glob", true);
  await expect(
    f.engine.command({ ...grantRequest, decision: "deny", allowForSession: true }),
  ).rejects.toThrow("Invalid session approval decision");
  await expect(
    f.engine.command({
      ...grantRequest,
      allowForSession: true,
      approvalOccurrenceId: createApprovalOccurrenceId(),
    }),
  ).rejects.toThrow("request changed");
  await f.engine.command({ ...grantRequest, allowForSession: true });
  await vi.waitFor(async () => expect(await f.list()).toHaveLength(1));

  for (const [index, operation] of [
    "Bash delete",
    "Read credential file",
    "Unverified filename search",
  ].entries()) {
    const request = turn.request(index + 2, operation);
    await expect(f.engine.command({ ...request, allowForSession: true })).rejects.toThrow(
      "This request cannot be allowed for the session",
    );
    expect(f.provider.approve).toHaveBeenCalledTimes(1);
  }
  await turn.finish();
  await f.engine.updateSession(f.id, { archived: true });
  await f.engine.updateSession(f.id, { archived: false });
  await expect(f.list()).resolves.toEqual([]);
});

it("issues a grant only when the original provider still owns the pending request", async () => {
  const f = await fixture();
  vi.mocked(f.provider.approve).mockReturnValue(false);
  const turn = await f.begin(1);
  await f.engine.command({ ...turn.request(1, "Glob", true), allowForSession: true });
  await vi.waitFor(() => expect(f.provider.approve).toHaveBeenCalledTimes(1));
  await expect(f.list()).resolves.toEqual([]);
  await turn.finish();
});
