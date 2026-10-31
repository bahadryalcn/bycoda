// @vitest-environment happy-dom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, expect, it, vi } from "vitest";
import { HandoffDivider } from "./AgentTranscriptActivity";
import { newSession, type Block } from "../model/session";
import { RetryFailedTurn } from "./RetryFailedTurn";
import alertStyles from "../../../shared/ui/arc/alert/alert.module.css";
import buttonStyles from "../../../shared/ui/Button.module.css";
import arcButtonStyles from "../../../shared/ui/arc/button/button.module.css";

const captures: string[] = [];

vi.mock("../../../shared/i18n", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../shared/i18n")>()),
  useT: () => (key: string, values?: Record<string, string>) =>
    key.replace(/\{(\w+)\}/g, (_, name: string) => values?.[name] ?? name),
}));

it.each(["failed", "cancelled"] as const)(
  "shows %s handoff as terminal without claiming a successful continuation",
  (status) => {
    const block: Block = {
      id: "switch",
      role: "handoff",
      text: "",
      handoff: { from: "claude", to: "grok", status },
    };
    const node = document.createElement("div");
    node.innerHTML = renderToStaticMarkup(createElement(HandoffDivider, { block }));
    const feedback = node.querySelector('[role="status"]');
    expect(feedback).not.toBeNull();
    expect(feedback?.textContent).toContain(status === "failed" ? "Failed" : "Cancelled");
    expect(feedback?.getAttribute("aria-live")).toBe("polite");
    expect(node.innerHTML).not.toContain("Continued with");
    expect(node.innerHTML).not.toContain("Preparing a handoff");
    const source = { from: "claude" as const, fromModel: "claude:sonnet-4.6", fromSettings: {} };
    const session = {
      ...newSession("grok", "/fixture"),
      pendingSwitch: source,
      blocks: [
        block,
        { id: "request", role: "user" as const, text: "Continue the original parser task." },
        {
          id: "failure",
          role: "system" as const,
          text: "Original provider cleanup unknown",
          notice: "error" as const,
        },
      ],
    };
    const retry = renderToStaticMarkup(
      createElement(RetryFailedTurn, { session, onSubmit: () => false }),
    );
    expect(retry).toContain("Retry");
    captures.push(`<section data-scenario="${status}">${node.innerHTML}${retry}</section>`);
  },
);

afterAll(async () => {
  if (process.env.BYCODA_CAPTURE_PROVIDER_SWITCH !== "1") return;
  const { readFile, writeFile } = await import("node:fs/promises");
  await writeFile(
    "temp/verification/2026-10-31-provider-switch/feedback-markup.html",
    captures.join("\n"),
  );
  const modules = {
    "src/shared/ui/arc/alert/alert.module.css": alertStyles,
    "src/shared/ui/Button.module.css": buttonStyles,
    "src/shared/ui/arc/button/button.module.css": arcButtonStyles,
  };
  const classes: Record<string, Record<string, string>> = {};
  for (const [file, names] of Object.entries(modules)) {
    const css = await readFile(file, "utf8");
    const keys = [
      ...new Set([...css.matchAll(/\.([A-Za-z_][A-Za-z0-9_-]*)/g)].map((match) => match[1])),
    ];
    classes[file] = Object.fromEntries(keys.map((name) => [name, names[name]]));
  }
  await writeFile(
    "temp/verification/2026-10-31-provider-switch/feedback-module-classes.json",
    JSON.stringify(classes),
  );
});
