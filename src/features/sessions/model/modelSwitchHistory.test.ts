import { describe, expect, it } from "vitest";
import {
  isHandoffCoveredBySwitch,
  sanitizeModelSwitch,
  withModelSwitch,
  withoutDeferredSwitch,
  type ModelSwitchState,
} from "./modelSwitchHistory";
import type { Block, Session } from "./session";
import { groupTurnItems } from "./transcriptActivity";
import { TranscriptTurnCache } from "./transcriptTurnCache";

const work: ModelSwitchState = { harness: "claude", account: "work", model: "Opus 5.5" };
const personal: ModelSwitchState = { harness: "claude", account: "Personal", model: "Opus 5.5" };
const codex: ModelSwitchState = { harness: "codex", account: "Personal", model: "GPT-5.5" };

function session(blocks: Block[], extra: Partial<Session> = {}): Session {
  return { id: "s", blocks, ...extra } as Session;
}

const user = (id = "u"): Block => ({ id, role: "user", text: "Fix it" });
const answer = (id = "a"): Block => ({ id, role: "assistant", text: "Done" });
const switches = (s: Session) => s.blocks.filter((block) => block.modelSwitch);
const states = (block: Block | undefined) =>
  block?.modelSwitch?.steps.map(({ harness, account, model, note }) => ({
    harness,
    account,
    model,
    ...(note ? { note } : {}),
  }));

describe("withModelSwitch", () => {
  it("records nothing before the conversation starts or when nothing changed", () => {
    const empty = session([]);
    expect(withModelSwitch(empty, work, personal, "x")).toBe(empty);
    const started = session([user(), answer()]);
    expect(withModelSwitch(started, work, work, "x")).toBe(started);
  });

  it("folds switches with no message between into one row", () => {
    let s = session([user(), answer()]);
    s = withModelSwitch(s, work, personal, "Continuing with Personal", 1);
    s = withModelSwitch(s, personal, work, "Continuing with work", 2);
    s = withModelSwitch(s, work, codex, "Continuing with Codex", 3);
    expect(switches(s)).toHaveLength(1);
    expect(states(switches(s)[0])).toEqual([work, personal, work, codex]);
    expect(switches(s)[0].role).toBe("system");
    expect(switches(s)[0].text).toBe("Continuing with Codex");
    expect(switches(s)[0].modelSwitch?.steps.map((step) => step.at)).toEqual([1, 1, 2, 3]);
  });

  it("folds across status rows but starts a new row once the conversation moves on", () => {
    let s = session([user(), answer()]);
    s = withModelSwitch(s, work, personal, "x");
    s = { ...s, blocks: [...s.blocks, { id: "st", role: "system", text: "Signed in" }] };
    s = withModelSwitch(s, personal, work, "x");
    expect(switches(s)).toHaveLength(1);
    s = { ...s, blocks: [...s.blocks, user("u2"), answer("a2")] };
    s = withModelSwitch(s, work, personal, "x");
    expect(switches(s)).toHaveLength(2);
    expect(states(switches(s)[1])).toEqual([work, personal]);
  });

  it("settles a waiting pick when it applies instead of adding a step", () => {
    let s = session([user()], { nextProviderAccountId: "personal" });
    s = withModelSwitch(s, work, { ...personal, note: "deferred" }, "x");
    expect(states(switches(s)[0])).toEqual([work, { ...personal, note: "deferred" }]);
    s = { ...s, blocks: [...s.blocks, answer(), user("u2")] };
    const settled = withModelSwitch(s, work, personal, "Continuing with Personal");
    expect(switches(settled)).toHaveLength(1);
    expect(states(switches(settled)[0])).toEqual([work, personal]);
    const summary = withModelSwitch(s, work, { ...personal, note: "summary" }, "x");
    expect(states(switches(summary)[0])).toEqual([work, { ...personal, note: "summary" }]);
  });

  it("drops a waiting pick that was withdrawn or replaced", () => {
    let s = session([user()], { nextProviderAccountId: "personal" });
    s = withModelSwitch(s, work, { ...personal, note: "deferred" }, "x");
    const withdrawn = withModelSwitch({ ...s, nextProviderAccountId: undefined }, work, work, "x");
    expect(switches(withdrawn)).toHaveLength(0);
    const third: ModelSwitchState = { ...work, account: "Team" };
    const replaced = withModelSwitch(s, work, { ...third, note: "deferred" }, "x");
    expect(states(switches(replaced)[0])).toEqual([work, { ...third, note: "deferred" }]);
  });

  it("keeps earlier steps when a failed waiting pick is removed", () => {
    let s = session([user()], { nextProviderAccountId: "personal" });
    s = withModelSwitch(s, work, codex, "x");
    s = withModelSwitch(s, codex, { ...codex, account: "work", note: "deferred" }, "x");
    expect(states(switches(withoutDeferredSwitch(s))[0])).toEqual([work, codex]);
    const plain = withModelSwitch(session([user()]), work, codex, "x");
    expect(withoutDeferredSwitch(plain)).toBe(plain);
  });
});

describe("transcript placement", () => {
  it("keeps the switch row out of the status trail", () => {
    const s = withModelSwitch(session([user(), answer()]), work, personal, "x");
    const items = groupTurnItems(s.blocks, { settled: true });
    expect(items.at(-1)).toMatchObject({
      type: "block",
      block: { modelSwitch: expect.anything() },
    });
  });

  it("hides a finished handoff divider the switch row already names", () => {
    const switched = withModelSwitch(session([user(), answer()]), work, codex, "x");
    const handoff = (status: "ready" | "failed", to: "codex" | "gemini" = "codex"): Block => ({
      id: `h-${status}-${to}`,
      role: "handoff",
      text: "brief",
      handoff: { from: "claude", to, status },
    });
    const blocks = [...switched.blocks, handoff("ready"), user("u2")];
    expect(isHandoffCoveredBySwitch(blocks, blocks.length - 2)).toBe(true);
    const failed = [...switched.blocks, handoff("failed"), user("u2")];
    expect(isHandoffCoveredBySwitch(failed, failed.length - 2)).toBe(false);
    const other = [...switched.blocks, handoff("ready", "gemini")];
    expect(isHandoffCoveredBySwitch(other, other.length - 1)).toBe(false);
    const legacy = [user(), answer(), handoff("ready")];
    expect(isHandoffCoveredBySwitch(legacy, 2)).toBe(false);

    const cache = new TranscriptTurnCache();
    expect(
      cache
        .group(blocks)
        .flat()
        .some((block) => block.role === "handoff"),
    ).toBe(false);
    expect(
      cache
        .group(failed)
        .flat()
        .some((block) => block.role === "handoff"),
    ).toBe(true);
  });
});

describe("sanitizeModelSwitch", () => {
  it("keeps valid steps and rejects malformed history", () => {
    expect(
      sanitizeModelSwitch({
        steps: [
          { harness: "claude", account: " work ", model: "Opus 5.5", at: 1 },
          { harness: "nope", model: "X", at: 2 },
          { harness: "codex", model: "GPT-5.5", at: 3, note: "summary" },
          { harness: "codex", model: "", at: 4 },
        ],
      }),
    ).toEqual({
      steps: [
        { harness: "claude", account: "work", model: "Opus 5.5", at: 1 },
        { harness: "codex", model: "GPT-5.5", at: 3, note: "summary" },
      ],
    });
    expect(sanitizeModelSwitch({ steps: [{ harness: "claude", model: "A", at: 1 }] })).toBe(
      undefined,
    );
    expect(sanitizeModelSwitch("bad")).toBeUndefined();
  });
});
