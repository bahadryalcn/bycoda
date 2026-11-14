import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { SkillPicker } from "./SkillPicker";
import type { SkillGroupPickerItem } from "../model/skillGroupPicker";
import type { Skill } from "../model/skills";

const group: SkillGroupPickerItem = {
  kind: "template",
  scope: "template",
  source: "bycoda",
  name: "Build",
  invocation: "group-build",
  templateId: "skill-group:1",
  groupId: "1",
  memberCount: 2,
  members: ["alpha", "beta"],
  description: "alpha, beta",
  body: "",
};

const fileSkill: Skill = {
  kind: "file",
  scope: "project",
  source: "agents",
  name: "alpha",
  invocation: "alpha",
  description: "Alpha skill",
  path: "/tmp/alpha/SKILL.md",
};

const template: Skill = {
  kind: "template",
  scope: "template",
  source: "bycoda",
  name: "Plain",
  invocation: "plain",
  description: "Plain template",
  templateId: "template:1",
  body: "",
};

function render(skills: Skill[]): string {
  return renderToStaticMarkup(
    createElement(SkillPicker, {
      skills,
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
}

const count = (html: string, text: string) => html.split(text).length - 1;

it("renders groups as selectable rows with member count and member list", () => {
  const html = render([group]);
  expect(html).toContain("Skill groups");
  expect(html).toContain("/group-build");
  expect(count(html, "2 skills")).toBe(1);
  expect(count(html, "alpha, beta")).toBe(1);
  expect(html).toContain('aria-selected="true"');
});

it("headings follow section changes between groups, commands and templates", () => {
  const html = render([group, fileSkill, template]);
  const groups = html.indexOf(">Skill groups<");
  const commands = html.indexOf(">Commands and skills<");
  const templates = html.indexOf(">Templates<");
  expect(groups).toBeGreaterThan(-1);
  expect(commands).toBeGreaterThan(groups);
  expect(templates).toBeGreaterThan(commands);
});

it("renders no commands heading when the list starts with a command row", () => {
  const html = render([fileSkill, template]);
  expect(html).not.toContain(">Commands and skills<");
  expect(html).toContain(">Templates<");
});
