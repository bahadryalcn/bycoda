import { expect, it, vi } from "vitest";
import { callVisualConversationTool } from "./conversation-visual-tools";

vi.mock("../../src/features/settings/data/backgrounds/three-runtime.generated", () => ({
  THREE_RUNTIME: "x".repeat(2_000_000),
}));

it("rejects a three background whose bundled runtime pushes it over the byte limit", async () => {
  const saveBackground = vi.fn();
  await expect(
    callVisualConversationTool(
      process.cwd(),
      "visuals.saveBackground",
      {
        title: "Big",
        runtime: "three",
        html: "é".repeat(60_000),
        target: "global",
        confirmed: true,
      },
      () => true,
      { saveBackground },
    ),
  ).rejects.toThrow(/after bundling the Three\.js runtime; the limit is 2 MiB/);
  expect(saveBackground).not.toHaveBeenCalled();
});
