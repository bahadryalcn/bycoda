import { expect, it, vi } from "vitest";
import { createSubscriptionsRuntime } from "./subscriptions";

it("does not refresh sibling session streams when another session of the project changes", () => {
  const versions = { project: 1, scope: 1, a: 1, b: 1 };
  let notify!: () => void;
  const store = {
    environmentId: "env",
    unattributedChangeVersion: 0,
    projectVersion: () => versions.project,
    versions: {
      scope: () => versions.scope,
      session: (id: string) => (id === "a" ? versions.a : versions.b),
    },
    subscribeChanges: (listener: () => void) => {
      notify = listener;
      return () => undefined;
    },
    subscribeAuthorityChanges: () => () => undefined,
    subscribeAuthorizationChanges: () => () => undefined,
  };
  const noop = { onDelete: undefined, onChange: undefined };
  const runtime = createSubscriptionsRuntime({
    engine: { store },
    tasks: noop,
    goals: noop,
    automations: noop,
    stewards: noop,
    hostNotes: noop,
    crews: { definitions: noop, agents: noop, runs: noop },
    desktop: { live: noop },
    signal: { notify: () => undefined },
  } as never);
  const invalidate = vi.spyOn(runtime.subscriptionHub, "invalidate");
  runtime.streamProjects.set("a", "p");
  runtime.streamProjects.set("b", "p");
  runtime.streamProjectVersions.set("p", 1);
  runtime.streamProjectScopes.set("p", 1);
  runtime.streamSessionVersions.set("a", 1);
  runtime.streamSessionVersions.set("b", 1);

  versions.a = 2; // "a" streams: its save moves its own version, nothing else
  notify();
  expect(invalidate).toHaveBeenCalledWith({ kind: "session", sessionId: "a" });
  expect(invalidate).not.toHaveBeenCalledWith({ kind: "session", sessionId: "b" });

  invalidate.mockClear();
  versions.project = 2; // list-visible change of "a"
  versions.a = 3;
  notify();
  expect(invalidate).toHaveBeenCalledWith({ kind: "project", projectId: "p" });
  expect(invalidate).not.toHaveBeenCalledWith({ kind: "session", sessionId: "b" });

  invalidate.mockClear();
  versions.project = 3; // unattributed change inside the project
  versions.scope = 2;
  notify();
  expect(invalidate).toHaveBeenCalledWith({ kind: "session", sessionId: "b" });
  runtime.unsubscribeChanges();
});
