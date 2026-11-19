import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

/**
 * Views that live in resizable panes adapt to the width of their own pane, not the window, so an
 * open side panel or the rail narrows them too. The widths are the original breakpoints, unchanged;
 * only the thing they measure moved. `viewport` lists the width media queries that stay on purpose
 * because the content is a modal sized by the window.
 */
const room = "src/features/assistant/ui";
const panes = [
  { css: `${room}/room/RoomShell.module.css`, container: "assistant-room", widths: [720] },
  { css: `${room}/room/RoomTabs.module.css`, container: "assistant-room", widths: [540] },
  { css: `${room}/room/TodayTab.module.css`, container: "assistant-room", widths: [900] },
  { css: `${room}/room/Conversation.module.css`, container: "assistant-room", widths: [900] },
  { css: `${room}/AssistantOwnerQuestions.module.css`, container: "assistant-room", widths: [720] },
  { css: `${room}/AssistantHistory.module.css`, container: "assistant-room", widths: [540] },
  { css: `${room}/AssistantMemoryPanel.module.css`, container: "assistant-room", widths: [540] },
  { css: `${room}/AssistantView.module.css`, container: "assistant-room", widths: [600, 720] },
  {
    css: "src/features/workspaces/ui/WorkspacePolicySettings.module.css",
    container: "workspace-policy",
    widths: [640, 560],
  },
  {
    css: "src/features/tasks/ui/sprints.css",
    container: "sprint-pane",
    widths: [560],
    // The sprint editor is a Modal: its budget rows follow the window.
    viewport: [560],
  },
  {
    css: "src/features/social/ui/command/command.css",
    container: "command-screen",
    widths: [800],
  },
];

const numbers = (css: string, pattern: RegExp) =>
  [...css.matchAll(pattern)].map((match) => Number(match[1])).sort((a, b) => a - b);
const ascending = (values: number[]) => [...values].sort((a, b) => a - b);

for (const pane of panes) {
  it(`${pane.css} measures ${pane.container}, not the window`, () => {
    const css = readFileSync(pane.css, "utf8");
    expect(
      numbers(css, new RegExp(`@container ${pane.container} \\(max-width:\\s*(\\d+)px\\)`, "g")),
    ).toEqual(ascending(pane.widths));
    expect(numbers(css, /@media[^{]*\(max-width:\s*(\d+)px\)/g)).toEqual(
      ascending(pane.viewport ?? []),
    );
  });
}

it("declares each pane container once, on the pane root", () => {
  const declaring = {
    "assistant-room": `${room}/room/RoomShell.module.css`,
    "workspace-policy": "src/features/workspaces/ui/WorkspacePolicySettings.module.css",
    "sprint-pane": "src/features/tasks/ui/sprints.css",
    "command-screen": "src/features/social/ui/command/command.css",
  };
  for (const [name, file] of Object.entries(declaring)) {
    const css = readFileSync(file, "utf8");
    expect(css.match(new RegExp(`container:\\s*${name}\\s*/\\s*inline-size`, "g"))).toHaveLength(1);
  }
  // The room root is the <main> the whole assistant view renders inside.
  expect(readFileSync(`${room}/room/RoomShell.module.css`, "utf8")).toMatch(
    /\.room \{\s*container: assistant-room \/ inline-size;/,
  );
});
