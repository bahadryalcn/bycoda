import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Block } from "../model/session";
import { AgentTranscript } from "./AgentTranscript";

const render = (blocks: Block[]) =>
  renderToStaticMarkup(createElement(AgentTranscript, { blocks, busy: false }));

const file = {
  id: "pdf",
  name: "guide.pdf",
  kind: "file" as const,
  mimeType: "application/pdf",
  size: 1024,
};

describe("answered agent question", () => {
  const blocks: Block[] = [
    { id: "u", role: "user", text: "Make a page", durationMs: 4_000 },
    {
      id: "ask",
      role: "tool",
      text: "AskUserQuestion",
      tool: { kind: "AskUserQuestion", status: "completed" },
    },
    {
      id: "q",
      role: "user",
      text: "Which theme?\nLight",
      questionAnswers: [{ prompt: "Which theme?", answers: ["Light"] }],
    },
    { id: "a", role: "assistant", text: "Done." },
  ];

  it("stays one turn: one footer, no raw tool row, the question card in place", () => {
    const markup = render(blocks);

    expect(markup.match(/aria-label="Copy response"/g)).toHaveLength(1);
    expect(markup).not.toContain("AskUserQuestion");
    expect(markup).toContain("data-question-answer");
    expect(markup).toContain("Which theme?");
  });
});

describe("user turn layout", () => {
  it("puts attachments above the bubble and draws no empty bubble for a bare attachment", () => {
    const markup = render([{ id: "u", role: "user", text: "", attachments: [file] }]);

    expect(markup).toContain("user-message-attachments");
    expect(markup).not.toContain("user-message-bubble");
  });

  it("keeps the attachments before the bubble when text is sent with them", () => {
    const markup = render([{ id: "u", role: "user", text: "Read this", attachments: [file] }]);

    expect(markup.indexOf("user-message-attachments")).toBeLessThan(
      markup.indexOf("user-message-bubble"),
    );
  });

  it("places the actions under the bubble with the time leading", () => {
    const markup = render([{ id: "u", role: "user", text: "Hello", startedAt: Date.now() }]);

    const actions = markup.indexOf("user-message-actions");
    expect(actions).toBeGreaterThan(-1);
    expect(actions).toBeGreaterThan(markup.indexOf("user-message-bubble"));
    expect(markup.indexOf("<time")).toBeGreaterThan(actions);
    expect(markup.indexOf("<time")).toBeLessThan(markup.indexOf('aria-label="Copy message"'));
  });

  it("shows the stopped badge and the draft footer under the bubble, not inside it", () => {
    const stopped = render([{ id: "u", role: "user", text: "Stop", turnOutcome: "stopped" }]);
    expect(stopped.indexOf("user-message-bubble")).toBeLessThan(stopped.indexOf("Stopped by you"));

    const draft = render([
      { id: "d", role: "user", text: "Later", draft: true, followUpDelivery: "undelivered" },
    ]);
    expect(draft).toContain("Not delivered");
    expect(draft.indexOf("Later")).toBeLessThan(draft.indexOf("Not delivered"));
  });
});
