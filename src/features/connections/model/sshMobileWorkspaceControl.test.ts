import { expect, it, vi } from "vitest";
vi.mock("@tauri-apps/plugin-dialog", () => ({ confirm: vi.fn() }));
vi.mock("./sshGroupDefaults", () => ({ previewSshConfiguration: vi.fn() }));
import {
  createSshMobileWorkspaceControl,
  type SshWorkspaceContext,
  type SshWorkspaceUiOwner,
  type SshWorkspaceReview,
  type SshWorkspaceStatus,
} from "./sshMobileWorkspaceControl";
import type { ServerRecord } from "./serverInventory";
function fixture() {
  const context: SshWorkspaceContext = {
    actorId: "actor",
    environmentId: "env",
    sourceSessionId: "source",
    projectCwd: "/project",
    workingCwd: "/project",
    valid: () => true,
    authorize: async () => true,
  };
  const server: ServerRecord = {
    id: "personal",
    name: "Fixture",
    kind: "ssh",
    sshEndpoint: {
      host: "fixture.invalid",
      port: 22,
      identityFile: "/never-read/private",
      user: "private-user",
    },
    metadata: {
      tags: ["private-tag"],
      favorite: false,
      activity: [{ id: "secret", at: 1, kind: "terminal-opened", bookmarked: false }],
    },
  };
  let currentState: SshWorkspaceStatus["state"] = "opened-on-computer",
    count = 1;
  let visible = true,
    ownerAvailable = true;
  const owner: SshWorkspaceUiOwner = {
    open: vi.fn(async (_id, _server, _digest, valid, notify, authorize) => {
      if (!valid() || !(await authorize()) || !valid()) return false;
      notify("opened-on-computer");
      return true;
    }),
    close: vi.fn(async () => {
      count = 0;
      currentState = "closed";
    }),
    impact: () => ({ state: currentState, count }),
  };
  const preview = vi.fn(async () => ({
    connectionId: "personal",
    configuration: { digest: "a".repeat(64) },
  }));
  const confirmClose = vi.fn(async () => true);
  let seq = 0;
  const handle = createSshMobileWorkspaceControl({
    catalog: () => ({ ready: true, servers: visible ? [server] : [] }),
    owner: () => (ownerAvailable ? owner : undefined),
    preview,
    confirmClose,
    id: () => `id-${++seq}`,
  });
  const review = () =>
    handle(context, "ssh.workspace.review", {
      connectionId: server.id,
    }) as Promise<SshWorkspaceReview>;
  const approve = (reviewId: string, requestId = "request") =>
    handle(context, "ssh.workspace.approve", {
      reviewId,
      requestId,
    }) as Promise<SshWorkspaceStatus>;
  return {
    context,
    server,
    owner,
    preview,
    confirmClose,
    handle,
    review,
    approve,
    hide: () => {
      visible = false;
    },
    replaceOwner: () => {
      ownerAvailable = false;
    },
    drift: () => {
      currentState = "exited";
    },
    setCount: (value: number) => {
      count = value;
    },
  };
}
it("projects only visible personal connection allowlist fields, never secret paths or raw metadata", async () => {
  const f = fixture();
  const result = await f.handle(f.context, "ssh.workspace.catalog.read", {});
  expect(result).toEqual({
    connections: [
      {
        id: "personal",
        name: "Fixture",
        host: "fixture.invalid",
        port: 22,
        hasIdentity: true,
        hasJump: false,
        hasProxy: false,
      },
    ],
    phoneTerminal: false,
    sftp: false,
    forwards: false,
    runbooks: false,
  });
  expect(JSON.stringify(result)).not.toMatch(/private|secret/);
  f.hide();
  expect(await f.handle(f.context, "ssh.workspace.catalog.read", {})).toMatchObject({
    connections: [],
  });
});
it("records pending claim before native open and lost initial response can reconcile by requestId without workspaceId", async () => {
  const f = fixture();
  let release!: () => void;
  vi.mocked(f.owner.open).mockImplementationOnce(async (_id, _server, _digest, _valid, notify) => {
    await new Promise<void>((done) => {
      release = done;
    });
    notify("opened-on-computer");
    return true;
  });
  const review = await f.review(),
    pending = f.approve(review.reviewId);
  await vi.waitFor(() => expect(release).toBeTypeOf("function"));
  const status = (await f.handle(f.context, "ssh.workspace.status", {
    requestId: "request",
  })) as SshWorkspaceStatus;
  expect(status).toMatchObject({ state: "opening", pendingNativeApproval: true });
  expect(status.workspaceId).toBeTruthy();
  expect(await f.approve(review.reviewId)).toMatchObject({ state: "opening" });
  release();
  expect(await pending).toMatchObject({ state: "opened-on-computer" });
  expect(f.owner.open).toHaveBeenCalledTimes(1);
});
it("rejects actor/source scope changes, mixed status identities, raw endpoint and caller actor overrides", async () => {
  const f = fixture(),
    review = await f.review();
  const result = await f.approve(review.reviewId);
  for (const context of [
    { ...f.context, actorId: "foreign" },
    { ...f.context, sourceSessionId: "foreign" },
    { ...f.context, environmentId: "foreign" },
  ])
    await expect(
      f.handle(context, "ssh.workspace.status", { workspaceId: result.workspaceId }),
    ).rejects.toThrow("unavailable");
  await expect(
    f.handle(f.context, "ssh.workspace.status", {
      requestId: "request",
      workspaceId: result.workspaceId,
    }),
  ).rejects.toThrow("one");
  await expect(
    f.handle(f.context, "ssh.workspace.review", { connectionId: "personal", endpoint: {} }),
  ).rejects.toThrow("Unsupported");
  await expect(
    f.handle(f.context, "ssh.workspace.catalog.read", { actorId: "foreign" }),
  ).rejects.toThrow("Unsupported");
});
it("refuses hidden, changed configuration and private source before new native work", async () => {
  for (const type of ["hidden", "digest", "private", "owner"]) {
    const f = fixture(),
      review = await f.review();
    if (type === "hidden") f.hide();
    if (type === "digest")
      f.preview.mockResolvedValue({
        connectionId: "personal",
        configuration: { digest: "b".repeat(64) },
      });
    if (type === "private") f.context.valid = () => false;
    if (type === "owner") f.replaceOwner();
    try {
      await f.approve(review.reviewId);
    } catch {
      /* An invalid source rejects before a receipt. */
    }
    expect(f.owner.open).not.toHaveBeenCalled();
  }
});
it("close has a separate current native impact approval and closes only its created resource", async () => {
  const f = fixture(),
    connect = await f.review(),
    opened = await f.approve(connect.reviewId);
  const close = (await f.handle(f.context, "ssh.workspace.close.review", {
    workspaceId: opened.workspaceId,
  })) as SshWorkspaceReview;
  expect(f.owner.close).not.toHaveBeenCalled();
  expect(
    await f.handle(f.context, "ssh.workspace.close.approve", {
      reviewId: close.reviewId,
      requestId: "close",
    }),
  ).toMatchObject({ state: "closed", terminalCount: 0 });
  expect(f.confirmClose).toHaveBeenCalledTimes(1);
  expect(f.owner.close).toHaveBeenCalledTimes(1);
  expect(vi.mocked(f.owner.close).mock.calls[0][0]).toMatch(/^ssh-mobile:/);
});
it("changed impact and declined close cannot kill resources and receipt remains failed", async () => {
  for (const kind of ["drift", "decline"]) {
    const f = fixture(),
      connect = await f.review(),
      opened = await f.approve(connect.reviewId);
    const close = (await f.handle(f.context, "ssh.workspace.close.review", {
      workspaceId: opened.workspaceId,
    })) as SshWorkspaceReview;
    f.confirmClose.mockImplementation(async () => {
      if (kind === "drift") f.drift();
      return kind !== "decline";
    });
    expect(
      await f.handle(f.context, "ssh.workspace.close.approve", {
        reviewId: close.reviewId,
        requestId: "close",
      }),
    ).toMatchObject({ state: "failed" });
    expect(await f.handle(f.context, "ssh.workspace.status", { requestId: "close" })).toMatchObject(
      { state: "failed" },
    );
    expect(f.owner.close).not.toHaveBeenCalled();
  }
});
it("replacement owner and failed initial preview do not adopt resources or leave pending claim forever", async () => {
  const f = fixture(),
    review = await f.review();
  f.preview.mockRejectedValueOnce(new Error("Unavailable"));
  expect(await f.approve(review.reviewId)).toEqual({ state: "failed" });
  expect(await f.handle(f.context, "ssh.workspace.status", { requestId: "request" })).toEqual({
    state: "failed",
  });
  const next = await f.review(),
    opened = await f.approve(next.reviewId, "next");
  f.replaceOwner();
  expect(
    await f.handle(f.context, "ssh.workspace.status", { workspaceId: opened.workspaceId }),
  ).toMatchObject({ state: "unknown" });
  expect(f.owner.close).not.toHaveBeenCalled();
});
it("uncertain close remains unknown immediately and through status without repeating native close", async () => {
  const f = fixture(),
    connect = await f.review(),
    opened = await f.approve(connect.reviewId);
  const close = (await f.handle(f.context, "ssh.workspace.close.review", {
    workspaceId: opened.workspaceId,
  })) as SshWorkspaceReview;
  vi.mocked(f.owner.close).mockRejectedValueOnce(new Error("Lost close acknowledgement"));
  const request = { reviewId: close.reviewId, requestId: "close" };
  expect(await f.handle(f.context, "ssh.workspace.close.approve", request)).toMatchObject({
    state: "unknown",
  });
  expect(await f.handle(f.context, "ssh.workspace.status", { requestId: "close" })).toMatchObject({
    state: "unknown",
  });
  expect(
    await f.handle(f.context, "ssh.workspace.status", { workspaceId: opened.workspaceId }),
  ).toMatchObject({ state: "unknown" });
  expect(await f.handle(f.context, "ssh.workspace.close.approve", request)).toMatchObject({
    state: "unknown",
  });
  expect(f.owner.close).toHaveBeenCalledTimes(1);
});
it("revocation during a delayed close confirmation refuses the destructive native effect", async () => {
  const f = fixture(),
    review = await f.review(),
    opened = await f.approve(review.reviewId);
  const close = (await f.handle(f.context, "ssh.workspace.close.review", {
    workspaceId: opened.workspaceId,
  })) as SshWorkspaceReview;
  f.confirmClose.mockImplementationOnce(async () => {
    f.context.authorize = async () => false;
    return true;
  });
  expect(
    await f.handle(f.context, "ssh.workspace.close.approve", {
      reviewId: close.reviewId,
      requestId: "close-revoked",
    }),
  ).toMatchObject({ state: "failed" });
  expect(f.owner.close).not.toHaveBeenCalled();
});
