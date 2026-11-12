import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { SkillPicker } from "./SkillPicker";
import type { SkillGroupPickerItem } from "../model/skillGroupPicker";
it("renders groups as selectable rows with available skill counts", () => {
  const group: SkillGroupPickerItem = {
    kind: "template",
    scope: "template",
    source: "bycoda",
    name: "Build",
    invocation: "group-build",
    templateId: "skill-group:1",
    groupId: "1",
    description: "2 skills",
    body: "",
  };
  const html = renderToStaticMarkup(
    createElement(SkillPicker, {
      skills: [group],
      query: "",
      active: 0,
      creating: false,
      cwd: "",
      showCreate: false,
      onActive: vi.fn(),
      onPick: vi.fn(),
      onStartCreate: vi.fn(),
      onCancelCreate: vi.fn(),
      onCreate: vi.fn(),
    }),
  );
  expect(html).toContain("Skill groups");
  expect(html).toContain("/group-build");
  expect(html).toContain("2 skills");
  expect(html).toContain('aria-selected="true"');
});
