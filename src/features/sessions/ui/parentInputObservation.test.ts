// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  beginParentInputClosure,
  captureParentInputs,
  useParentInputClosure,
  type ParentInputHandle,
} from "../data/parentInputClosure";

type HarnessProps = {
  sessionId: string;
  pending: unknown;
  draft: string;
  /** Changes on every render without touching any producer field (a streamed token). */
  tick: number;
};

let root: Root;
let container: HTMLDivElement;
let sessionId: string;
let handle: ParentInputHandle | undefined;

function Harness({ sessionId: id, pending, draft }: HarnessProps) {
  handle = useParentInputClosure({
    kind: "session-parent",
    sessionId: id,
    stableKeys: ["pendingQuestion"],
    snapshot: () => ({ pendingQuestion: pending, draft }),
  });
  return null;
}

/** A plain record whose deep reads are counted, standing in for a large question record. */
function countedQuestion(text: string) {
  let reads = 0;
  const value = new Proxy(
    { text, answers: Array.from({ length: 8 }, (_, index) => ({ index })) },
    {
      ownKeys(target) {
        reads++;
        return Reflect.ownKeys(target);
      },
    },
  );
  return { value, reads: () => reads, reset: () => (reads = 0) };
}

async function render(props: HarnessProps) {
  await act(async () => root.render(createElement(Harness, props)));
}

async function hookSnapshots(id: string) {
  const lease = await captureParentInputs(id);
  try {
    return lease.snapshots.filter((entry) => entry.kind === "session-parent");
  } finally {
    lease.release();
  }
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  sessionId = `observe-${crypto.randomUUID()}`;
  handle = undefined;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it("skips the deep compare on unrelated renders yet still revokes a closure for a real producer change", async () => {
  const question = countedQuestion("question");
  await render({ sessionId, pending: question.value, draft: "a", tick: 0 });
  const close = beginParentInputClosure(sessionId, { owner: {}, timeoutMs: 5000 });
  question.reset();
  for (let tick = 1; tick <= 5; tick++)
    await render({ sessionId, pending: question.value, draft: "a", tick });
  expect(question.reads()).toBe(0);
  expect(close.current()).toBe(true);
  // The same pending reference with a changed unlisted key is still an input change.
  await render({ sessionId, pending: question.value, draft: "b", tick: 6 });
  expect(close.current()).toBe(false);
  close.release();
  const next = beginParentInputClosure(sessionId, { owner: {}, timeoutMs: 5000 });
  await render({ sessionId, pending: countedQuestion("answered").value, draft: "b", tick: 7 });
  expect(next.current()).toBe(false);
  next.release();
});

it("keeps one handle but a fresh input identity and observation when the session changes", async () => {
  const question = countedQuestion("question");
  await render({ sessionId, pending: question.value, draft: "a", tick: 0 });
  const firstHandle = handle!;
  const firstIdentity = firstHandle.identity();
  expect(firstIdentity).not.toBeNull();
  const other = `${sessionId}-other`;
  await render({ sessionId: other, pending: question.value, draft: "a", tick: 1 });
  expect(handle).toBe(firstHandle);
  expect(handle!.identity()).not.toBe(firstIdentity);
  // The old registration was retired; the new one observed the same reference from scratch.
  expect(await hookSnapshots(sessionId)).toHaveLength(0);
  const [entry] = await hookSnapshots(other);
  expect(entry.snapshot.draft).toBe("a");
  expect(entry.snapshot.pendingQuestion).toMatchObject({ text: "question" });
  const close = beginParentInputClosure(other, { owner: {}, timeoutMs: 5000 });
  await render({
    sessionId: other,
    pending: countedQuestion("answered").value,
    draft: "a",
    tick: 2,
  });
  expect(close.current()).toBe(false);
  close.release();
});

it("retires on unmount without stranding a pending admission", async () => {
  const question = countedQuestion("question");
  await render({ sessionId, pending: question.value, draft: "a", tick: 0 });
  const admitted = handle!.admit();
  expect(admitted).not.toBeNull();
  expect(await hookSnapshots(sessionId)).toHaveLength(1);
  await act(async () => root.unmount());
  root = createRoot(container);
  expect(await hookSnapshots(sessionId)).toHaveLength(0);
  expect(admitted!.settled).toBe(false);
  admitted!.finish();
  expect(admitted!.settled).toBe(true);
  // A later mount of the same session starts clean: nothing from the retired owner leaks.
  await render({ sessionId, pending: question.value, draft: "z", tick: 1 });
  const [entry] = await hookSnapshots(sessionId);
  expect(entry.snapshot.draft).toBe("z");
});
