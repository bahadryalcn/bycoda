import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import type { CrewAgent } from "../model/crew";
import type { ProjectCrews } from "../model/crewClient";
import { CrewMemberTable, crewSections } from "./CrewMemberTable";

vi.mock("../model/crewModelPools", () => ({
  useCrewModelPools: () => ({ supported: false, pools: [], loading: false, error: null }),
}));
vi.mock("./MemberModelPicker", () => ({ MemberModelPicker: () => "Model picker" }));
vi.mock("./MemberAvatar", () => ({ MemberAvatar: () => null }));

it("stacks the model below the member name and limits long metadata in narrow rows", () => {
  const agents: CrewAgent[] = [
    {
      id: "a1",
      name: "Build Pipeline Specialist",
      groups: ["long-build-pipeline-specialist-group"],
      role: "specialist",
      instructions: "",
      selection: "fixed",
      candidates: [],
    },
  ];
  const issues = { members: {} };
  const html = renderToStaticMarkup(
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
  expect(html).toContain("@container/member-row");
  // A short roster has no selection column.
  expect(html).toContain(
    "@min-[28rem]/member-row:grid-cols-[minmax(0,1fr)_minmax(8rem,14rem)_auto]",
  );
  expect(html).not.toContain("Select Build Pipeline Specialist");
  expect(html).not.toContain("Search members");
  expect(html).toMatch(/<div class="[^"]*row-start-2[^"]*">Model picker<\/div>/);
  expect(html).toMatch(/max-w-\[50%\][^>]*>[\s\S]*long-build-pipeline-specialist-group/);
});

it("offers selection and search only for a long roster", () => {
  const agents: CrewAgent[] = Array.from({ length: 7 }, (_, index) => ({
    id: `a${index}`,
    name: `Member ${index}`,
    role: "specialist",
    instructions: "",
    selection: "fixed",
    candidates: [],
  }));
  const issues = { members: {} };
  const html = renderToStaticMarkup(
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
  expect(html).toContain("Select Member 0");
  expect(html).toContain("Search members");
  expect(html).toContain(
    "@min-[28rem]/member-row:grid-cols-[auto_minmax(0,1fr)_minmax(8rem,14rem)_auto]",
  );
});
