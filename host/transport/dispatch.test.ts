import { describe, expect, it, vi } from "vitest";
import { createEnvironmentService } from "../domains/environment/service";
import { createProjectsService } from "../domains/projects/service";
import { HostDomainOutcomeError } from "../domains/context";
import { RpcErrorSchema } from "../../src/shared/model/host-contracts";
import {
  createHostReadDispatcher,
  HostDispatchError,
  type HostReadDispatchContext,
} from "./dispatch";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

const descriptor = {
  protocolVersion: 1,
  environmentId: "fixture-host",
  name: "Fixture",
  providers: ["codex", "claude", "cursor", "acp", "codex"],
  capabilities: ["sessions", "machine.changes"],
  platform: "win32",
  gitRewindExecution: "host",
  webControl: { origin: "http://127.0.0.1:9001", url: "http://127.0.0.1:9001/control" },
  buildIdentity: { sourceCommit: "fixture", dirty: true },
};

function fixture() {
  const snapshot = vi.fn(async () => descriptor);
  const sourceProjects = [
    { id: "project-a", cwd: "C:/Fixture", name: "Fixture", appearance: { color: "neutral" } },
  ];
  const list = vi.fn(async () => sourceProjects);
  const environment = createEnvironmentService({ snapshot });
  const projects = createProjectsService({ list });
  const dispatch = createHostReadDispatcher({
    environmentId: "fixture-host",
    environment,
    projects,
  });
  const authorized = vi.fn(async () => true);
  const context: HostReadDispatchContext = {
    environmentId: "fixture-host",
    principal: { kind: "device", id: "opaque-device" },
    authorized,
  };
  return { dispatch, environment, projects, snapshot, list, sourceProjects, authorized, context };
}

describe("effectful domain failure outcomes", () => {
  it("carries a verified committed domain outcome without exposing private causes", async () => {
    const { context } = fixture();
    const dispatch = createHostReadDispatcher({
      environmentId: "fixture-host",
      environment: { describe: async () => descriptor },
      projects: { list: async () => [] },
      operations: {
        "notes.delete": async () => {
          throw new HostDomainOutcomeError("The note was deleted. Refresh its state.", "accepted", {
            cause: new Error("private/path?token=secret"),
          });
        },
      },
    });
    const error = await dispatch
      .dispatch("notes.delete", { id: "note", expectedUpdatedAt: 1 }, context)
      .catch((cause) => cause);
    const wire = RpcErrorSchema.parse({ code: -32603, message: error.message, data: error.details });
    expect(wire.data).toEqual({ category: "unavailable", retryable: false, delivery: "accepted" });
    expect(JSON.stringify(wire)).not.toMatch(/private|secret|commandId|operationId/);
  });

  it("rechecks authorization before disclosing a committed outcome", async () => {
    const { context } = fixture();
    let permitted = true;
    const dispatch = createHostReadDispatcher({
      environmentId: "fixture-host",
      environment: { describe: async () => descriptor },
      projects: { list: async () => [] },
      operations: {
        "notes.delete": async () => {
          permitted = false;
          throw new HostDomainOutcomeError("The note was deleted.", "accepted");
        },
      },
    });
    await expect(dispatch.dispatch("notes.delete", { id: "note", expectedUpdatedAt: 1 }, {
      ...context, authorized: async () => permitted,
    })).rejects.toMatchObject({ code: "unauthorized" });
  });

  it("preserves uncertainty after a non-command service has performed its effect", async () => {
    const { context } = fixture();
    let effects = 0;
    const dispatch = createHostReadDispatcher({
      environmentId: "fixture-host",
      environment: { describe: async () => descriptor },
      projects: { list: async () => [] },
      operations: {
        "notes.delete": async () => {
          effects++;
          throw new Error("private committed operation diagnostic");
        },
      },
    });
    const error = await dispatch
      .dispatch("notes.delete", { id: "note", expectedUpdatedAt: 1 }, context)
      .catch((cause) => cause);
    expect(effects).toBe(1);
    expect(error).toMatchObject({
      code: "service-unavailable",
      details: { category: "unavailable", retryable: false, delivery: "unknown" },
    });
    expect(error.message).not.toContain("private");
    expect(error.details).not.toHaveProperty("commandId");
    expect(error.details).not.toHaveProperty("operationId");
  });
});

describe("environment and projects domain reads", () => {
  it("preserves complete descriptor metadata and legacy provider fallback", async () => {
    const { environment } = fixture();
    expect(await environment.describe()).toEqual({
      ...descriptor,
      providers: ["codex", "claude"],
    });
    expect(await environment.describe({ supportedProviders: "legacy-invalid-array" })).toEqual({
      ...descriptor,
      providers: ["codex", "claude"],
    });
    expect(descriptor.providers).toHaveLength(5);
  });

  it("negotiates explicit provider support without advertising uninstalled providers", async () => {
    const { environment } = fixture();
    expect(
      (await environment.describe({ supportedProviders: ["cursor", "acp", "missing"] })).providers,
    ).toEqual(["cursor", "acp"]);
    expect((await environment.describe({ supportedProviders: [] })).providers).toEqual([]);
  });

  it("keeps store project fields and collection ownership", async () => {
    const { projects, sourceProjects } = fixture();
    const result = await projects.list();
    expect(result).toEqual(sourceProjects);
    expect(result).not.toBe(sourceProjects);
    result.pop();
    expect(sourceProjects).toHaveLength(1);
  });

  it("does not start a cancelled domain read", async () => {
    const { environment, projects, snapshot, list } = fixture();
    const controller = new AbortController();
    controller.abort();
    await expect(environment.describe({}, { signal: controller.signal })).rejects.toBeDefined();
    await expect(projects.list({ signal: controller.signal })).rejects.toBeDefined();
    expect(snapshot).not.toHaveBeenCalled();
    expect(list).not.toHaveBeenCalled();
  });
});

describe("transport-neutral read dispatcher", () => {
  it("routes only implemented device reads and revalidates before disclosure", async () => {
    const { dispatch, context, authorized } = fixture();
    expect(dispatch.supports("environment.describe")).toBe(true);
    expect(dispatch.supports("projects.list")).toBe(true);
    expect(dispatch.supports("sessions.page")).toBe(false);
    expect(
      await dispatch.dispatch("environment.describe", { supportedProviders: ["cursor"] }, context),
    ).toEqual({ ...descriptor, providers: ["cursor"] });
    expect(authorized).toHaveBeenCalledTimes(2);
  });

  it.each(["conversation", "social", "runtime-logs", "peer"] as const)(
    "does not promote a %s tool principal into a device grant",
    async (kind) => {
      const { dispatch, context, authorized, list } = fixture();
      await expect(
        dispatch.dispatch(
          "projects.list",
          {},
          {
            ...context,
            principal: { kind, id: "scoped-tool" },
          },
        ),
      ).rejects.toMatchObject({ code: "unauthorized" });
      expect(authorized).not.toHaveBeenCalled();
      expect(list).not.toHaveBeenCalled();
    },
  );

  it("rejects a replaced environment before running its service", async () => {
    const { dispatch, context, list } = fixture();
    await expect(
      dispatch.dispatch("projects.list", {}, { ...context, environmentId: "replacement-host" }),
    ).rejects.toMatchObject({ code: "wrong-environment" });
    expect(list).not.toHaveBeenCalled();
  });

  it("fails closed when the grant is revoked or cannot be checked", async () => {
    const { dispatch, context, list } = fixture();
    await expect(
      dispatch.dispatch("projects.list", {}, { ...context, authorized: async () => false }),
    ).rejects.toMatchObject({ code: "unauthorized" });
    await expect(
      dispatch.dispatch(
        "projects.list",
        {},
        {
          ...context,
          authorized: async () => {
            throw new Error("private auth diagnostic");
          },
        },
      ),
    ).rejects.toMatchObject({
      code: "unauthorized",
      message: "Device authorization could not be verified.",
    });
    expect(list).not.toHaveBeenCalled();
  });

  it.each(["commands.dispatch", "sessions.page", "constructor", "__proto__"])(
    "does not route unavailable method %s merely because schemas or prototypes exist",
    async (method) => {
      const { dispatch, context, list, snapshot } = fixture();
      await expect(dispatch.dispatch(method, {}, context)).rejects.toMatchObject({
        code: "method-not-found",
      });
      expect(list).not.toHaveBeenCalled();
      expect(snapshot).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["projects.list", { projectId: "unexpected-filter" }],
    ["environment.describe", { supportedProviders: "codex" }],
    ["environment.describe", { supportedProviders: [true] }],
    ["projects.list", []],
  ])("rejects invalid or unknown typed parameters for %s", async (method, params) => {
    const { dispatch, context, list, snapshot } = fixture();
    await expect(dispatch.dispatch(method as string, params, context)).rejects.toMatchObject({
      code: "invalid-params",
      message: "Host read parameters are invalid.",
    });
    expect(list).not.toHaveBeenCalled();
    expect(snapshot).not.toHaveBeenCalled();
  });

  it("does not disclose a read completed after revocation", async () => {
    const { context } = fixture();
    const started = deferred<void>();
    const finish = deferred<unknown>();
    let permitted = true;
    const dispatch = createHostReadDispatcher({
      environmentId: "fixture-host",
      environment: { describe: async () => descriptor },
      projects: {
        list: async () => {
          started.resolve();
          return finish.promise;
        },
      },
    });
    const result = dispatch.dispatch(
      "projects.list",
      {},
      {
        ...context,
        authorized: async () => permitted,
      },
    );
    await started.promise;
    permitted = false;
    finish.resolve([{ id: "private-project" }]);
    await expect(result).rejects.toMatchObject({ code: "unauthorized" });
  });

  it("releases a cancelled wait without disclosing its late result", async () => {
    const { context } = fixture();
    const started = deferred<void>();
    const finish = deferred<unknown>();
    const controller = new AbortController();
    const dispatch = createHostReadDispatcher({
      environmentId: "fixture-host",
      environment: { describe: async () => descriptor },
      projects: {
        list: async () => {
          started.resolve();
          return finish.promise;
        },
      },
    });
    const result = dispatch.dispatch(
      "projects.list",
      {},
      { ...context, signal: controller.signal },
    );
    await started.promise;
    controller.abort(new Error("private cancellation reason"));
    await expect(result).rejects.toMatchObject({
      code: "cancelled",
      message: "Host read was cancelled.",
    });
    finish.resolve([{ id: "late-project" }]);
  });

  it("cancels a pending authorization read before starting a service", async () => {
    const { dispatch, context, list } = fixture();
    const started = deferred<void>();
    const authorization = deferred<boolean>();
    const controller = new AbortController();
    const result = dispatch.dispatch(
      "projects.list",
      {},
      {
        ...context,
        signal: controller.signal,
        authorized: () => {
          started.resolve();
          return authorization.promise;
        },
      },
    );
    await started.promise;
    controller.abort();
    await expect(result).rejects.toMatchObject({ code: "cancelled" });
    authorization.resolve(true);
    expect(list).not.toHaveBeenCalled();
  });

  it("maps service failures to a safe category while retaining diagnostic cause", async () => {
    const { context } = fixture();
    const cause = new Error("private/path?token=secret");
    const dispatch = createHostReadDispatcher({
      environmentId: "fixture-host",
      environment: {
        describe: async () => {
          throw cause;
        },
      },
      projects: { list: async () => [] },
    });
    const error = await dispatch
      .dispatch("environment.describe", {}, context)
      .catch((value) => value);
    expect(error).toBeInstanceOf(HostDispatchError);
    expect(error).toMatchObject({
      code: "service-unavailable",
      message: "Host read could not be completed.",
      cause,
    });
  });
});
