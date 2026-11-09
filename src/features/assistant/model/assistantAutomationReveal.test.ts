import { expect, it, vi } from "vitest";
import { assistantAutomationProject } from "./assistantAutomationReveal";
const target = { id: "scheduled-report", projectId: "project-a", environmentId: "original-host" };
const projects = [
    { id: "project-a", path: "/owner/project-a" },
    { id: "project-b", path: "/owner/project-b" },
  ],
  rows = [
    { id: "scheduled-report", projectId: "project-a" },
    { id: "same-title-different-id", projectId: "project-b" },
  ];
it("opens the exact canonical automation project through current visibility", () => {
  const visible = vi.fn(() => true);
  expect(
    assistantAutomationProject(target, "original-host", "original-host", projects, rows, visible),
  ).toBe(projects[0]);
  expect(visible).toHaveBeenCalledWith("/owner/project-a");
});
it("refuses a retargeted Host even when automation and project IDs coincide", () => {
  expect(() =>
    assistantAutomationProject(
      target,
      "original-host",
      "replacement-host",
      projects,
      rows,
      () => true,
    ),
  ).toThrow("unavailable");
});
it.each([
  { name: "deleted", automations: [] },
  { name: "moved", automations: [{ id: target.id, projectId: "project-b" }] },
  { name: "title-like unrelated ID", automations: [rows[1]] },
])(
  "refuses $name automation targets without using a title or another project",
  ({ automations }) => {
    expect(() =>
      assistantAutomationProject(
        target,
        "original-host",
        "original-host",
        projects,
        automations,
        () => true,
      ),
    ).toThrow("unavailable");
  },
);
it("rechecks the actual project's live privacy state after reads settle", () => {
  let visible = true;
  const canOpen = () => visible;
  visible = false;
  expect(() =>
    assistantAutomationProject(target, "original-host", "original-host", projects, rows, canOpen),
  ).toThrow("unavailable");
});
