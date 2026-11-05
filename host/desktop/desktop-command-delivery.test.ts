import { describe, expect, it, vi } from "vitest";
import { DesktopCommandDelivery } from "./desktop-command-delivery";
import type { PreparedDesktop } from "./desktopLive";

function setup() {
  const command = { id: "command", sessionId: "session", type: "cancel" as const };
  const entry: PreparedDesktop = {
    commandId: command.id,
    clientId: "client",
    sessionId: command.sessionId,
    ownerId: "page",
    delivery: JSON.stringify(command),
    current: () => true,
    revalidate: vi.fn(async () => undefined),
  };
  let pending = true;
  let offered = false;
  let acknowledged = false;
  let persistedOffer = false;
  const live = {
    pendingDesktop: vi.fn((client: string) =>
      pending && client === entry.clientId ? [entry] : [],
    ),
    finishDesktopOffer: vi.fn((_id: string, delivered: boolean) => {
      pending = false;
      offered = delivered;
    }),
    desktopAcknowledgement: vi.fn((client: string, page: string | undefined, id: string) =>
      offered &&
      !acknowledged &&
      client === entry.clientId &&
      page === entry.ownerId &&
      id === entry.commandId
        ? entry
        : undefined,
    ),
    finishDesktopAcknowledgement: vi.fn(() => {
      acknowledged = true;
    }),
  };
  const store = {
    offerDesktopCommand: vi.fn(
      async (_id: string, _owner: string, validate: () => Promise<void>) => {
        if (persistedOffer) return undefined;
        await validate();
        persistedOffer = true;
        return entry.delivery;
      },
    ),
    ackDesktopCommand: vi.fn(async (_id: string, _owner: string, validate: () => Promise<void>) => {
      await validate();
    }),
  };
  const authorize = vi.fn(async () => undefined);
  const params = { clientId: "client", pageToken: "page" };
  return {
    command,
    entry,
    live,
    store,
    authorize,
    params,
    delivery: new DesktopCommandDelivery(live, store),
  };
}

describe("durable desktop heartbeat delivery", () => {
  it("returns only a committed offer and never offers it on a later heartbeat", async () => {
    const f = setup();
    expect(await f.delivery.poll(f.params, f.authorize)).toEqual([f.command]);
    expect(f.entry.revalidate).toHaveBeenCalledOnce();
    expect(await f.delivery.poll(f.params, f.authorize)).toEqual([]);
    expect(f.store.offerDesktopCommand).toHaveBeenCalledOnce();
  });

  it("retains the physical poll through an abandoned response and excludes overlapping delivery", async () => {
    const f = setup();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    f.entry.revalidate = vi.fn(() => gate);
    const original = f.delivery.poll(f.params, f.authorize);
    expect(await f.delivery.poll(f.params, f.authorize)).toEqual([]);
    release();
    expect(await original).toEqual([f.command]);
    // Deliberately discard original response, as withinBeat does after timeout.
    expect(await f.delivery.poll(f.params, f.authorize)).toEqual([]);
    expect(f.store.offerDesktopCommand).toHaveBeenCalledOnce();
  });

  it("reconciles an uncertain commit without redispatching its payload", async () => {
    const f = setup();
    const offer = f.store.offerDesktopCommand.getMockImplementation()!;
    f.store.offerDesktopCommand.mockImplementationOnce(async (...args) => {
      await offer(...args);
      throw new Error("commit acknowledgement lost");
    });
    await expect(f.delivery.poll(f.params, f.authorize)).rejects.toThrow(
      "commit acknowledgement lost",
    );
    expect(f.live.finishDesktopOffer).not.toHaveBeenCalled();
    expect(await f.delivery.poll(f.params, f.authorize)).toEqual([]);
    expect(f.live.finishDesktopOffer).toHaveBeenCalledWith("command", false);
  });

  it("cannot offer after original admission authority is revoked", async () => {
    const f = setup();
    f.entry.revalidate = vi.fn(async () => {
      throw new Error("revoked");
    });
    await expect(f.delivery.poll(f.params, f.authorize)).rejects.toThrow("revoked");
    expect(f.live.finishDesktopOffer).not.toHaveBeenCalled();
  });

  it("withholds a committed payload if heartbeat authorization changes", async () => {
    const f = setup();
    f.authorize
      .mockImplementationOnce(async () => undefined)
      .mockImplementationOnce(async () => undefined)
      .mockImplementationOnce(async () => {
        throw new Error("revoked after commit");
      });
    await expect(f.delivery.poll(f.params, f.authorize)).rejects.toThrow("revoked after commit");
    expect(await f.delivery.poll(f.params, f.authorize)).toEqual([]);
  });

  it("acknowledges original page once even when its completed turn changed", async () => {
    const f = setup();
    await f.delivery.poll(f.params, f.authorize);
    f.entry.revalidate = vi.fn(async () => {
      throw new Error("turn completed");
    });
    expect(
      await f.delivery.poll({ ...f.params, acked: ["command", "command"] }, f.authorize),
    ).toEqual([]);
    expect(f.store.ackDesktopCommand).toHaveBeenCalledOnce();
    expect(f.entry.revalidate).not.toHaveBeenCalled();
    expect(f.live.finishDesktopAcknowledgement).toHaveBeenCalledWith("command");
  });

  it("rejects ACK correlation from another client or replacement page", async () => {
    const f = setup();
    await f.delivery.poll(f.params, f.authorize);
    for (const params of [
      { ...f.params, clientId: "other" },
      { ...f.params, pageToken: "new-page" },
    ])
      expect(await f.delivery.poll({ ...params, acked: ["command"] }, f.authorize)).toEqual([]);
    expect(f.store.ackDesktopCommand).not.toHaveBeenCalled();
  });

  it("does not consume in-memory acknowledgement before durable confirmation", async () => {
    const f = setup();
    await f.delivery.poll(f.params, f.authorize);
    f.store.ackDesktopCommand.mockRejectedValueOnce(new Error("storage unavailable"));
    await expect(f.delivery.poll({ ...f.params, acked: ["command"] }, f.authorize)).rejects.toThrow(
      "storage unavailable",
    );
    expect(f.live.finishDesktopAcknowledgement).not.toHaveBeenCalled();
    await f.delivery.poll({ ...f.params, acked: ["command"] }, f.authorize);
    expect(f.live.finishDesktopAcknowledgement).toHaveBeenCalledOnce();
  });
});
