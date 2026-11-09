// @vitest-environment jsdom
import { createContext, runInContext } from "node:vm";
import { beforeEach, expect, it } from "vitest";
import { CONTROL_SCRIPT } from "./web-control";

beforeEach(() => {
  const ids = new Set(
    [...CONTROL_SCRIPT.matchAll(/(?:\$\(|bind\()'([^']+)'/g)].map((match) => match[1]),
  );
  document.body.innerHTML = [...ids].map((id) => `<div id="${id}"></div>`).join("");
});

function page(allowCustom = true, preserveCustomWhitespace = false) {
  const fixture = {
    runId: "original-run",
    status: "running",
    session: {
      blocks: [],
      pendingQuestion: {
        requestId: 1,
        questions: [
          {
            id: "q",
            prompt: "Pick one",
            allowCustom,
            preserveCustomWhitespace,
            options: [{ id: "a", label: "A" }],
          },
        ],
      },
    },
  };
  const context = createContext({
    document,
    fixture,
    structuredClone,
    clearTimeout,
    setTimeout,
    addEventListener() {},
  });
  runInContext(CONTROL_SCRIPT, context);
  runInContext(
    "environment={};sessionId='original-session';snapshot=fixture;command=async value=>{globalThis.sent=value};readSession=async()=>{};render()",
    context,
  );
  return context;
}

it("retains choice notes on refresh, sends original selection and request identity", async () => {
  const context = page();
  let input = document.querySelector("input[type=radio]") as HTMLInputElement;
  input.checked = true;
  input.dispatchEvent(new Event("change"));
  let note = document.querySelector("textarea")!;
  expect(note.parentElement?.hidden).toBe(false);
  note.value = "  Keep this constraint  ";
  note.dispatchEvent(new Event("input"));
  runInContext("render()", context);
  input = document.querySelector("input[type=radio]") as HTMLInputElement;
  note = document.querySelector("textarea")!;
  expect(input.checked).toBe(true);
  expect(note.value).toBe("  Keep this constraint  ");
  runInContext("sessionId='replacement-session';snapshot={runId:'replacement-run'}", context);
  await (document.querySelector("#questions button") as HTMLButtonElement).onclick!(
    new MouseEvent("click"),
  );
  expect(context.sent).toMatchObject({
    sessionId: "original-session",
    runId: "original-run",
    requestId: 1,
    reply: { kind: "answered", answers: { q: ["a"] }, notes: { q: "Keep this constraint" } },
  });
});

it.each([
  [false, false],
  [true, true],
])("omits notes for schema-limited questions: %s/%s", (allowCustom, preserveCustomWhitespace) => {
  page(allowCustom, preserveCustomWhitespace);
  expect(document.querySelector("textarea")).toBeNull();
});

it("does not send a stale connection question", async () => {
  const context = page();
  runInContext("environment={}", context);
  await (document.querySelector("#questions button") as HTMLButtonElement).onclick!(
    new MouseEvent("click"),
  );
  expect(context.sent).toBeUndefined();
  expect(document.querySelector("#error")?.textContent).toContain("connection changed");
});

it.each([false, true])(
  "recognizes stable Other IDs and excludes stale custom-only notes (literal=%s)",
  async (literal) => {
    const context = page();
    context.literal = literal;
    runInContext(
      "fixture.session.pendingQuestion.questions[0].options.push({id:'provider-other',label:' Other ',literal});render()",
      context,
    );
    const choices = document.querySelectorAll<HTMLInputElement>("input[type=radio]");
    choices[0].checked = true;
    choices[0].dispatchEvent(new Event("change"));
    const note = document.querySelector("textarea")!;
    note.value = "Existing note";
    note.dispatchEvent(new Event("input"));
    choices[1].checked = true;
    choices[1].dispatchEvent(new Event("change"));
    expect(note.parentElement?.hidden).toBe(!literal);
    await (document.querySelector("#questions button") as HTMLButtonElement).onclick!(
      new MouseEvent("click"),
    );
    expect(context.sent.reply).toEqual({
      kind: "answered",
      answers: { q: ["provider-other"] },
      custom: {},
      ...(literal ? { notes: { q: "Existing note" } } : {}),
    });
  },
);

it("retires stale question lineages for the same session and retains another session draft", () => {
  const context = page();
  runInContext(
    "questionDrafts.set(JSON.stringify(['another-session']),{notes:{q:'Keep'}});fixture.session.pendingQuestion.requestId=2;render();",
    context,
  );
  expect(runInContext("questionDrafts.size", context)).toBe(2);
  expect(
    runInContext("[...questionDrafts.keys()].some(key=>JSON.parse(key)[3]===1)", context),
  ).toBe(false);
  expect(
    runInContext("questionDrafts.get(JSON.stringify(['another-session'])).notes.q", context),
  ).toBe("Keep");
});
