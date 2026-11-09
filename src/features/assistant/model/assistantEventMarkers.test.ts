import { expect, it } from "vitest";
import { stripAssistantEventMarkers } from "./assistantEventMarkers";

it("removes the event marker from a daily note line and keeps the visible text", () => {
  expect(
    stripAssistantEventMarkers(
      "- 13:52 UTC · The job was submitted to the goal planner. <!-- assistant-event:8b786068-abc_DEF -->",
    ),
  ).toBe("- 13:52 UTC · The job was submitted to the goal planner.");
});

it("removes every marker across lines and leaves text without markers unchanged", () => {
  const body =
    "- 09:00 UTC · First <!-- assistant-event:a1 -->\n- 09:05 UTC · Second <!--assistant-event:b2-->\nPlain line";
  expect(stripAssistantEventMarkers(body)).toBe(
    "- 09:00 UTC · First\n- 09:05 UTC · Second\nPlain line",
  );
  expect(stripAssistantEventMarkers("No markers here")).toBe("No markers here");
});
