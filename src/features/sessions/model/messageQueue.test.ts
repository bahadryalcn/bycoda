import { describe, expect, it } from "vitest";
import { appendPreparingHandoff } from "./handoff";
import {
  appendQueuedMessage,
  canDispatchQueuedHead,
  dequeueQueuedMessage,
  isEditingQueuedHead,
  moveQueuedMessage,
  queuedHead,
  queuedMessageForSubmit,
  queuedModelTarget,
  queuedSteerRoute,
  queuedTargetSummary,
  reorderQueuedMessages,
  reorderSessionQueue,
  resolveFollowUpRoute,
  holdUndeliveredFollowUp,
  sentQueuedMessage,
} from "./messageQueue";
import { catalogModelsFor, defaultModelSettings, modelEffortSetting } from "./models";
import { HARNESSES, newSession, type QueuedMessage, type Session } from "./session";

function queued(id: string, text = id): QueuedMessage {
  return { id, text, attachments: [] };
}

it("holds unknown delivery for both explicit Steer and automatic dispatch", () => {
  const session = chat({
    queueStatus: "active",
    queuedMessages: [{ ...queued("unknown"), deliveryUnknown: true }],
  });
  expect(canDispatchQueuedHead(session)).toBe(false);
  expect(queuedMessageForSubmit(session, "unknown", "steer")).toBeUndefined();
});

function chat(patch: Partial<Session> = {}): Session {
  return {
    ...newSession("claude", "/tmp/project"),
    queuedMessages: [queued("a", "first"), queued("b", "second")],
    queueStatus: "active",
    ...patch,
  };
}

it.each(["paused", "restored"] as const)(
  "appending a follow-up preserves a %s queue",
  (queueStatus) => {
    const message = { ...queued("new"), modelTarget: queuedModelTarget(chat()) };
    const next = appendQueuedMessage(chat({ busy: true, queueStatus }), message);
    expect(next.queueStatus).toBe(queueStatus);
    expect(next.queuedMessages).toEqual([queued("a", "first"), queued("b", "second"), message]);
    expect(canDispatchQueuedHead({ ...next, busy: false })).toBe(false);
    expect(appendQueuedMessage(next, message)).toBe(next);
  },
);

it.each(["plan", "orchestrate"] as const)(
  "does not steer or duplicate a busy queued %s",
  (intent) => {
    const message = { ...queued("plan"), intent };
    const session = chat({ busy: true, queuedMessages: [message] });
    expect(queuedMessageForSubmit(session, message.id, "steer")).toBeUndefined();
    expect(appendQueuedMessage(session, message)).toBe(session);
    expect(queuedMessageForSubmit({ ...session, busy: false }, message.id, "steer")).toBe(message);
  },
);

it("holds an undelivered follow-up after Stop and removes only its optimistic row", () => {
  const message = queued("unsent", "Please change direction");
  const held = holdUndeliveredFollowUp(
    chat({
      blocks: [
        { id: "previous", role: "assistant", text: "Working" },
        { id: "optimistic", role: "user", text: message.text },
      ],
    }),
    message,
    "optimistic",
  );
  expect(held.blocks.map((block) => block.id)).toEqual(["previous"]);
  expect(held.queuedMessages).toContainEqual(message);
  expect(held.queueStatus).toBe("paused");
  expect(canDispatchQueuedHead(held)).toBe(false);
  expect(holdUndeliveredFollowUp(held, message).queuedMessages).toHaveLength(3);
});

it("snapshots model settings and retains them through reordering", () => {
  const session = chat({ model: "chosen", modelSettings: { effort: "high" } });
  const modelTarget = queuedModelTarget(session);
  session.modelSettings.effort = "low";
  const queue = [queued("a"), { ...queued("b"), modelTarget }];
  const changed = chat({
    model: "later",
    modelSettings: { effort: "low" },
    queuedMessages: reorderQueuedMessages(queue, ["b", "a"]),
  });
  expect(queuedMessageForSubmit(changed, "b", "dispatch")?.modelTarget).toEqual({
    harness: session.harness,
    model: "chosen",
    modelSettings: { effort: "high" },
  });
  expect(queuedMessageForSubmit(changed, "b", "steer")?.modelTarget).toEqual(modelTarget);
  // An explicit Steer sends the row whatever model or provider it was saved for.
  expect(queuedMessageForSubmit({ ...changed, busy: true }, "b", "steer")?.id).toBe("b");
  expect(
    queuedMessageForSubmit(
      { ...changed, busy: true, runningModelTarget: { ...modelTarget, harness: "codex" } },
      "b",
      "steer",
    )?.id,
  ).toBe("b");
});

it("lets Steer send rows saved for another model or provider", () => {
  const modelTarget = queuedModelTarget(
    chat({ model: "running", modelSettings: { effort: "high" } }),
  );
  const session = chat({
    busy: true,
    model: "later",
    modelSettings: { effort: "low" },
    runningModelTarget: modelTarget,
    queuedMessages: [
      { ...queued("a"), modelTarget },
      {
        ...queued("b"),
        modelTarget: { ...modelTarget, modelSettings: { effort: "low" } },
      },
    ],
  });
  expect(queuedMessageForSubmit(session, "a", "steer")?.id).toBe("a");
  expect(queuedMessageForSubmit(session, "b", "steer")?.id).toBe("b");
  const otherProvider = {
    ...queued("c"),
    modelTarget: { harness: "codex" as const, model: "gpt", modelSettings: {} },
  };
  expect(
    queuedMessageForSubmit(
      { ...session, queuedMessages: [...session.queuedMessages!, otherProvider] },
      "c",
      "steer",
    )?.id,
  ).toBe("c");
});

it("treats a selection with its defaults filled in as the same Steer target", () => {
  const model = catalogModelsFor("claude").find((entry) =>
    entry.settings?.some((setting) => setting.options.length > 1),
  );
  if (!model) throw new Error("expected a Claude model with a choice setting");
  const defaults = defaultModelSettings(model);
  const running = { harness: "claude" as const, model: model.id, modelSettings: defaults };
  const session = chat({
    busy: true,
    model: model.id,
    modelSettings: defaults,
    runningModelTarget: running,
    queuedMessages: [{ ...queued("a"), modelTarget: { ...running, modelSettings: {} } }],
  });
  expect(queuedSteerRoute(session, session.queuedMessages![0], false)).toBe("join");
  expect(queuedMessageForSubmit(session, "a", "steer")?.id).toBe("a");
  const setting = model.settings!.find((entry) => entry.options.length > 1)!;
  const changed = setting.options.find((option) => option.value !== defaults[setting.id])!.value;
  const differing = {
    ...queued("b"),
    modelTarget: { ...running, modelSettings: { ...defaults, [setting.id]: changed } },
  };
  expect(queuedSteerRoute(session, differing, false)).toBe("restart");
  expect(queuedSteerRoute(session, differing, true)).toBe("join");
  expect(queuedSteerRoute({ ...session, busy: false }, differing, false)).toBe("join");
});

it("routes Steer by the provider and model a row was queued for", () => {
  const running = { harness: "claude" as const, model: "claude:opus", modelSettings: {} };
  const session = chat({ busy: true, runningModelTarget: running });
  const row = (modelTarget: QueuedMessage["modelTarget"]) => ({ ...queued("x"), modelTarget });
  expect(queuedSteerRoute(session, row(undefined), false)).toBe("join");
  expect(queuedSteerRoute(session, row(running), false)).toBe("join");
  expect(queuedSteerRoute(session, row({ ...running, model: "claude:sonnet" }), true)).toBe(
    "restart",
  );
  expect(
    queuedSteerRoute(session, row({ harness: "codex", model: "gpt", modelSettings: {} }), true),
  ).toBe("switch");
});

it("summarizes the model and effort a row was queued for", () => {
  const model = HARNESSES.flatMap((harness) => catalogModelsFor(harness)).find((entry) =>
    modelEffortSetting(entry),
  );
  if (!model) throw new Error("expected a catalog model with an effort setting");
  const effort = modelEffortSetting(model)!;
  const choice = effort.options.at(-1)!;
  expect(
    queuedTargetSummary({
      harness: model.harness,
      model: model.id,
      modelSettings: { [effort.id]: choice.value },
    }),
  ).toEqual({ model: model.name, effort: choice.label });
});

describe("queuedHead", () => {
  it("returns the first queued follow-up", () => {
    expect(queuedHead(chat())?.id).toBe("a");
    expect(queuedHead(chat({ queuedMessages: undefined }))).toBeUndefined();
  });
});

describe("isEditingQueuedHead", () => {
  it("is true only when the head row is the one being edited", () => {
    expect(isEditingQueuedHead(chat())).toBe(false);
    expect(isEditingQueuedHead(chat({ editingQueuedMessageId: "a" }))).toBe(true);
    expect(isEditingQueuedHead(chat({ editingQueuedMessageId: "b" }))).toBe(false);
  });
});

describe("canDispatchQueuedHead", () => {
  it("dispatches an idle session with a queued head", () => {
    expect(canDispatchQueuedHead(chat())).toBe(true);
  });

  it("holds while the session is busy, paused, or resuming", () => {
    expect(canDispatchQueuedHead(chat({ busy: true }))).toBe(false);
    expect(canDispatchQueuedHead(chat({ queueStatus: "paused" }))).toBe(false);
    expect(canDispatchQueuedHead(chat({ queueStatus: "resuming" }))).toBe(false);
  });

  it("holds while the last turn is stopped at a usage limit", () => {
    expect(canDispatchQueuedHead(chat({ usageLimit: { resetsAt: 1_000 } }))).toBe(false);
  });

  it("holds only when the head item is being edited", () => {
    expect(canDispatchQueuedHead(chat({ editingQueuedMessageId: "a" }))).toBe(false);
    expect(canDispatchQueuedHead(chat({ editingQueuedMessageId: "b" }))).toBe(true);
  });

  it("does not dispatch during a preparing handoff", () => {
    const preparing = appendPreparingHandoff(
      chat({ queuedMessages: [queued("a")] }),
      "claude",
      "cursor",
    );
    expect(canDispatchQueuedHead(preparing)).toBe(false);
  });

  it("does not dispatch an empty queue", () => {
    expect(canDispatchQueuedHead(chat({ queuedMessages: undefined }))).toBe(false);
  });
});

describe("dequeueQueuedMessage", () => {
  it("drops the id and clears queue state when the last item goes", () => {
    const one = chat({ queuedMessages: [queued("a")], queueStatus: "active" });
    expect(dequeueQueuedMessage(one, "a")).toMatchObject({
      queuedMessages: undefined,
      queueStatus: undefined,
    });
  });

  it("keeps editing another row after the head is sent", () => {
    const next = dequeueQueuedMessage(chat({ editingQueuedMessageId: "b" }), "a");
    expect(next.queuedMessages?.map((message) => message.id)).toEqual(["b"]);
    expect(next.editingQueuedMessageId).toBe("b");
    expect(next.queueStatus).toBe("active");
  });
});

describe("queuedMessageForSubmit", () => {
  it("only auto-dispatches the idle head", () => {
    expect(queuedMessageForSubmit(chat(), "a", "dispatch")?.id).toBe("a");
    expect(queuedMessageForSubmit(chat(), "b", "dispatch")).toBeUndefined();
    expect(queuedMessageForSubmit(chat({ busy: true }), "a", "dispatch")).toBeUndefined();
  });

  it("hands back the queued text and attachments as queued, so tokens keep their numbers", () => {
    const attachments = [
      { id: "a", name: "one.png", mimeType: "image/png", kind: "image", size: 1 },
      { id: "b", name: "notes.md", mimeType: "text/plain", kind: "file", size: 1 },
      { id: "c", name: "two.png", mimeType: "image/png", kind: "image", size: 1 },
    ] as const;
    const message = {
      ...queued("q", "[image2] vs [image1] and [file1]"),
      attachments: [...attachments],
    };
    const session = chat({ queuedMessages: [message] });
    for (const mode of ["dispatch", "steer"] as const) {
      const out = queuedMessageForSubmit(session, "q", mode)!;
      expect(out.text).toBe("[image2] vs [image1] and [file1]");
      expect(out.attachments.map((file) => file.id)).toEqual(["a", "b", "c"]);
    }
  });

  it("lets Steer target any remaining row, including while busy or paused", () => {
    expect(queuedMessageForSubmit(chat({ busy: true }), "b", "steer")?.id).toBe("b");
    expect(queuedMessageForSubmit(chat({ queueStatus: "paused" }), "a", "steer")?.id).toBe("a");
    expect(queuedMessageForSubmit(chat(), "missing", "steer")).toBeUndefined();
  });
});

describe("resolveFollowUpRoute", () => {
  const base = {
    busy: true,
    intent: "default" as const,
    operatorCommand: false,
    backgroundTaskCount: 0,
    backgroundOnly: false,
  };

  it("dispatches when the session is idle, whatever else is set", () => {
    expect(resolveFollowUpRoute({ ...base, busy: false, requested: "queue" })).toBe("dispatch");
  });

  it("steers by default while busy", () => {
    expect(resolveFollowUpRoute(base)).toBe("steer");
  });

  it("honours explicit steer and queue actions", () => {
    expect(resolveFollowUpRoute({ ...base, requested: "queue" })).toBe("queue");
    expect(resolveFollowUpRoute({ ...base, requested: "steer" })).toBe("steer");
  });

  it("always queues while a worktree prepares and for plan, orchestrate and operator", () => {
    expect(resolveFollowUpRoute({ ...base, worktreePreparing: true, requested: "steer" })).toBe(
      "queue",
    );
    expect(resolveFollowUpRoute({ ...base, intent: "plan", requested: "steer" })).toBe("queue");
    expect(resolveFollowUpRoute({ ...base, intent: "orchestrate" })).toBe("queue");
    expect(
      resolveFollowUpRoute({
        ...base,
        operatorCommand: true,
        requested: "steer",
      }),
    ).toBe("queue");
  });

  it("steers when background tasks are open and nothing asked for a queue", () => {
    expect(resolveFollowUpRoute({ ...base, backgroundTaskCount: 1 })).toBe("steer");
    expect(
      resolveFollowUpRoute({
        ...base,
        backgroundTaskCount: 2,
        backgroundOnly: true,
      }),
    ).toBe("steer");
  });

  it("honours an explicit queue beside a background task while the agent is still working", () => {
    expect(resolveFollowUpRoute({ ...base, backgroundTaskCount: 1, requested: "queue" })).toBe(
      "queue",
    );
  });

  it("never parks an explicit queue behind background-only work", () => {
    expect(
      resolveFollowUpRoute({
        ...base,
        backgroundTaskCount: 1,
        backgroundOnly: true,
        requested: "queue",
      }),
    ).toBe("steer");
  });
});

describe("restored queue", () => {
  const gone = {
    id: "f1",
    name: "a.png",
    mimeType: "image/png",
    kind: "image" as const,
    size: 1,
    missing: true,
  };

  it("waits for the user instead of draining an idle session", () => {
    expect(canDispatchQueuedHead(chat({ queueStatus: "restored" }))).toBe(false);
  });

  it("holds a head whose attachment is gone, for dispatch and steer alike", () => {
    const session = chat({
      queuedMessages: [{ ...queued("a", "see [image1]"), attachments: [gone] }, queued("b")],
    });
    expect(canDispatchQueuedHead(session)).toBe(false);
    expect(queuedMessageForSubmit(session, "a", "steer")).toBeUndefined();
    expect(queuedMessageForSubmit(session, "b", "steer")?.id).toBe("b");
  });

  it("goes back to draining once a row is sent from it", () => {
    const sent = sentQueuedMessage(chat({ queueStatus: "restored" }), "a");
    expect(sent.queueStatus).toBe("active");
    expect(sent.queuedMessages?.map((message) => message.id)).toEqual(["b"]);
    expect(canDispatchQueuedHead(sent)).toBe(true);
  });

  it("does not wake a paused queue when a row is sent", () => {
    expect(sentQueuedMessage(chat({ queueStatus: "paused" }), "a").queueStatus).toBe("paused");
  });

  it("removing a restored row keeps the queue waiting", () => {
    expect(dequeueQueuedMessage(chat({ queueStatus: "restored" }), "a").queueStatus).toBe(
      "restored",
    );
  });
});

describe("reordering the queue", () => {
  const ids = (queue: QueuedMessage[]) => queue.map((message) => message.id);
  const three = [queued("a"), queued("b"), queued("c")];
  const gone = {
    id: "f1",
    name: "a.png",
    mimeType: "image/png",
    kind: "image" as const,
    size: 1,
    missing: true,
  };

  it("moves a row to an index and clamps to the queue", () => {
    expect(ids(moveQueuedMessage(three, "c", 0))).toEqual(["c", "a", "b"]);
    expect(ids(moveQueuedMessage(three, "a", 1))).toEqual(["b", "a", "c"]);
    expect(ids(moveQueuedMessage(three, "a", 99))).toEqual(["b", "c", "a"]);
    expect(ids(moveQueuedMessage(three, "c", -4))).toEqual(["c", "a", "b"]);
  });

  it("returns the same queue when nothing moves (keyboard bounds, unknown row)", () => {
    expect(moveQueuedMessage(three, "a", -1)).toBe(three);
    expect(moveQueuedMessage(three, "c", 3)).toBe(three);
    expect(moveQueuedMessage(three, "b", 1)).toBe(three);
    expect(moveQueuedMessage(three, "zz", 0)).toBe(three);
  });

  it("reorders by ids against the live queue", () => {
    expect(ids(reorderQueuedMessages(three, ["c", "b", "a"]))).toEqual(["c", "b", "a"]);
    expect(reorderQueuedMessages(three, ["a", "b", "c"])).toBe(three);
  });

  it("ignores ids that left the queue and keeps rows added since the drag began", () => {
    // The drag saw [a, b, c]; "b" was sent and "d" was added before the drop.
    const live = [queued("a"), queued("c"), queued("d")];
    expect(ids(reorderQueuedMessages(live, ["c", "b", "a"]))).toEqual(["c", "a", "d"]);
    expect(ids(reorderQueuedMessages(live, ["x"]))).toEqual(["a", "c", "d"]);
  });

  it("changes order only: status, edited row and attachments stay as they were", () => {
    const session = chat({
      queuedMessages: [{ ...queued("a"), attachments: [gone] }, queued("b")],
      queueStatus: "restored",
      editingQueuedMessageId: "a",
    });
    const next = reorderSessionQueue(session, ["b", "a"]);
    expect(ids(next.queuedMessages!)).toEqual(["b", "a"]);
    expect(next.queueStatus).toBe("restored");
    expect(next.editingQueuedMessageId).toBe("a");
    expect(next.queuedMessages![1]).toBe(session.queuedMessages![0]);
    expect(canDispatchQueuedHead(next)).toBe(false);
    expect(reorderSessionQueue(session, ["a", "b"])).toBe(session);
  });

  it("does not start a paused queue, and the new head is what drains", () => {
    const paused = reorderSessionQueue(chat({ queueStatus: "paused" }), ["b", "a"]);
    expect(paused.queueStatus).toBe("paused");
    expect(canDispatchQueuedHead(paused)).toBe(false);
    const active = reorderSessionQueue(chat({ queueStatus: "active" }), ["b", "a"]);
    expect(queuedHead(active)?.id).toBe("b");
    expect(queuedMessageForSubmit(active, "a", "dispatch")).toBeUndefined();
    expect(queuedMessageForSubmit(active, "b", "dispatch")?.id).toBe("b");
  });

  it("holds by id: the edit hold follows the edited row, not the head position", () => {
    const editing = chat({ editingQueuedMessageId: "a" });
    expect(isEditingQueuedHead(editing)).toBe(true);
    const moved = reorderSessionQueue(editing, ["b", "a"]);
    expect(isEditingQueuedHead(moved)).toBe(false);
    expect(isEditingQueuedHead(reorderSessionQueue(moved, ["a", "b"]))).toBe(true);
  });
});

it("waits while the host runs the conversation or its turn has not arrived here", () => {
  const session = chat({
    queueStatus: "active",
    queuedMessages: [queued("next")],
  });
  expect(canDispatchQueuedHead(session)).toBe(true);
  expect(canDispatchQueuedHead({ ...session, continuingElsewhere: true })).toBe(false);
  expect(canDispatchQueuedHead({ ...session, adoptedSyncConflict: true })).toBe(false);
});
