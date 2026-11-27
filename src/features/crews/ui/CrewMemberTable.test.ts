import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import type { CrewAgent } from "../model/crew";
import type { ProjectCrews } from "../model/crewClient";
import type { CrewRosterIssues } from "../model/crewRoster";
import { CrewMemberTable, crewSections } from "./CrewMemberTable";

vi.mock("../model/crewModelPools", () => ({
  useCrewModelPools: () => ({ supported: false, pools: [], loading: false, error: null }),
}));
vi.mock("./MemberModelPicker", () => ({ MemberModelPicker: () => null }));
vi.mock("./MemberAvatar", () => ({ MemberAvatar: () => null }));

const specialist: CrewAgent = {
  id: "a1",
  name: "Builder",
  role: "specialist",
  instructions: "",
  selection: "fixed",
  candidates: [],
};

function render(issues: CrewRosterIssues) {
  const agents = [specialist];
  return renderToStaticMarkup(
    createElement(CrewMemberTable, {
      cwd: "/fixture",
      data: {
        agents: [],
        machine: { id: "local" },
        catalog: { models: {}, errors: {} },
      } as unknown as ProjectCrews,
      agents,
      issues,
      sections: crewSections(agents, issues),
      selected: [],
      onSelectedChange: vi.fn(),
      onChange: vi.fn(),
      onRemove: vi.fn(),
      expandedId: null,
      onExpandedChange: vi.fn(),
      onAdd: vi.fn(),
      onStarter: vi.fn(),
      renderDetail: () => null,
      query: "",
      onQueryChange: vi.fn(),
    }),
  );
}

// #561: roster validation errors are assertive InlineError alerts, never polite role="status" text.
it("announces a missing-role issue as an assertive alert", () => {
  const html = render({ coordinator: "missing", reviewer: "missing", members: {} });
  const alerts = [...html.matchAll(/role="alert"[^>]*>([\s\S]*?)<\/div>/g)].map((m) =>
    m[1].replace(/<[^>]*>/g, ""),
  );
  expect(alerts).toEqual(expect.arrayContaining(["Add a coordinator.", "Add a reviewer."]));
  expect(html).not.toMatch(/role="status"[^>]*>[^<]*Add a coordinator/);
});

it("announces the 20-member limit as an assertive alert", () => {
  const html = render({ size: "large", members: {} });
  expect(html).toMatch(/role="alert"[^>]*>[\s\S]*?A crew can have at most 20 members\./);
  expect(html).not.toMatch(/role="status"[^>]*>[^<]*at most 20 members/);
});
