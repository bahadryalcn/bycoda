import { describe, expect, it } from "vitest";
import type { ServerBindings } from "./bindings";
import { createServerBindings } from "./dependencies";

type Readers = Parameters<typeof createServerBindings>[0];
type Writers = Parameters<typeof createServerBindings>[1];

function bind(readers: Partial<Readers>, writers: Partial<Writers> = {}) {
  // Each fixture exercises only its named ports; missing ports must stay unread.
  return createServerBindings(readers as Readers, writers as Writers);
}

describe("server composition closure bindings", () => {
  it("does not read a forward service until its original callback runs", () => {
    let tasks: ServerBindings["tasks"];
    let reads = 0;
    const dependencies = bind({
      tasks: () => {
        reads++;
        return tasks;
      },
    });
    const callback = () => dependencies.tasks;
    expect(reads).toBe(0);

    tasks = { ready: Promise.resolve() } as ServerBindings["tasks"];
    expect(callback()).toBe(tasks);
    const replacement = { ready: Promise.resolve() } as ServerBindings["tasks"];
    tasks = replacement;
    expect(callback()).toBe(replacement);
    expect(reads).toBe(2);
  });

  it("shares the shutdown flag with an already accepted request", () => {
    const http = { closing: false };
    const dependencies = bind(
      { closing: () => http.closing },
      {
        closing: (value) => {
          http.closing = value;
        },
      },
    );
    const acceptedRequest = { closing: () => dependencies.closing };

    expect(acceptedRequest.closing()).toBe(false);
    dependencies.closing = true;
    expect(http.closing).toBe(true);
    expect(acceptedRequest.closing()).toBe(true);
  });

  it("retains the current heartbeat barrier across asynchronous lease updates", async () => {
    let effects = Promise.resolve();
    const dependencies = bind(
      { heartbeatEffects: () => effects },
      {
        heartbeatEffects: (value) => {
          effects = value;
        },
      },
    );
    const events: string[] = [];
    dependencies.heartbeatEffects = dependencies.heartbeatEffects.then(() => {
      events.push("accepted heartbeat");
    });
    effects = effects.then(() => {
      events.push("next heartbeat");
    });

    expect(dependencies.heartbeatEffects).toBe(effects);
    await dependencies.heartbeatEffects;
    expect(events).toEqual(["accepted heartbeat", "next heartbeat"]);
  });
});
