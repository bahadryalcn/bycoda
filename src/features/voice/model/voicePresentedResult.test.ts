import { expect, it } from "vitest";
import { presentedSpecs } from "./voicePresentedCatalog";
import { describePresentedCatalog, presentedCatalogTool } from "./voicePresentedDiscovery";
import { compilePresentedProgram } from "./voicePresentedProgram";
import {
  presentedResultProblems,
  presentVoiceResultTool,
  VoicePresentedResultSchema,
} from "./voicePresentedResult";

const parse = (input: unknown) => VoicePresentedResultSchema.safeParse(input);
const base = { title: "Test results", summary: "Two packages finished." };

it("renders a single content block from an already prepared voice call", () => {
  const content = { kind: "notes", items: ["First result"] };
  const parsed = parse({ title: "Results", summary: "One note", content });
  expect(parsed.data).toEqual({
    title: "Results",
    summary: "One note",
    blocks: [{ type: "List", items: ["First result"] }],
  });
  expect(parse({ title: "Results", summary: "One note", content, blocks: [content] }).success).toBe(
    false,
  );
});

it("maps every earlier block kind onto the component of the same meaning", () => {
  const parsed = parse({
    ...base,
    blocks: [
      { kind: "text", text: "Hello" },
      {
        kind: "comparison",
        items: [
          { label: "A", value: "1" },
          { label: "B", value: "2" },
        ],
      },
      {
        kind: "chart",
        items: [
          { label: "A", value: 1 },
          { label: "B", value: 2 },
        ],
      },
      { kind: "copy", label: "Cmd", text: "pnpm build" },
      {
        kind: "actions",
        items: [
          { label: "Usage", action: "workspace.usage.open", input: { period: "month-to-date" } },
        ],
      },
    ],
  });
  expect(parsed.success).toBe(true);
  expect(parsed.data?.blocks?.map((block) => block.type)).toEqual([
    "Text",
    "DescriptionList",
    "BarChart",
    "CopyBlock",
    "Stack",
  ]);
  expect(parsed.data?.blocks?.[3]).toMatchObject({ text: "pnpm build" });
  expect(parsed.data?.blocks?.[4]?.children?.[0]).toMatchObject({
    type: "Button",
    label: "Usage",
    action: { action: "workspace.usage.open", input: { period: "month-to-date" } },
  });
});

it("needs a summary or at least one block", () => {
  expect(parse({ title: "Empty" }).success).toBe(false);
  expect(parse({ title: "Only text", blocks: [{ type: "Text", text: "Hi" }] }).success).toBe(true);
});

it("rejects likely credentials, unknown parts and unbounded data", () => {
  expect(parse({ ...base, summary: "API_KEY=example-only-value" }).success).toBe(false);
  expect(parse({ ...base, action: "open_browser" }).success).toBe(false);
  expect(
    parse({ ...base, blocks: [{ type: "List", items: Array(13).fill("Example") }] }).success,
  ).toBe(false);
  expect(
    parse({
      ...base,
      blocks: [{ type: "CopyBlock", label: "Key", text: "password: hunter2-hunter2" }],
    }).success,
  ).toBe(false);
  expect(
    parse({ ...base, blocks: [{ type: "CopyBlock", label: "Big", text: "x ".repeat(2100) }] })
      .success,
  ).toBe(false);
  expect(
    parse({ ...base, blocks: [{ type: "CopyBlock", label: "Blank", text: "  \n " }] }).success,
  ).toBe(false);
  expect(parse({ ...base, blocks: [{ type: "Script", text: "x" }] }).success).toBe(false);
  expect(parse({ ...base, blocks: [{ type: "Text", text: "x", html: "<b>" }] }).success).toBe(
    false,
  );
});

it("keeps copyable text exactly as sent", () => {
  const text = "Line one\n  indented line two\n";
  expect(
    parse({ ...base, blocks: [{ type: "CopyBlock", label: "Draft", text }] }).data?.blocks?.[0],
  ).toMatchObject({ text });
});

it("accepts every catalog example, and each one compiles", () => {
  for (const spec of presentedSpecs) {
    const parsed = parse({ title: spec.name, blocks: [spec.example] });
    expect(parsed.error ? presentedResultProblems(parsed.error) : "", spec.name).toBe("");
    expect(compilePresentedProgram(parsed.data!).program).toContain(`= ${spec.example.type}(`);
  }
});

it("composes nested layouts with fields, choices and a button that reads them", () => {
  const parsed = parse({
    title: "Usage",
    blocks: [
      {
        type: "Stack",
        children: [
          {
            type: "Card",
            title: "Filters",
            children: [
              {
                type: "SegmentedControl",
                id: "metric",
                label: "Metric",
                options: [
                  { value: "cost", label: "Cost" },
                  { value: "tokens", label: "Tokens" },
                ],
              },
              { type: "NumberField", id: "months", label: "Months", value: 3, min: 1, max: 12 },
              {
                type: "Button",
                label: "Open",
                requires: ["months"],
                action: {
                  action: "workspace.usage.open",
                  input: {
                    period: "monthly-history",
                    metric: { $bind: "metric" },
                    months: { $bind: "months" },
                  },
                },
              },
            ],
          },
        ],
      },
    ],
  });
  expect(parsed.success).toBe(true);
  const { program, fields } = compilePresentedProgram(parsed.data!);
  expect(fields).toEqual([
    { id: "metric", type: "SegmentedControl" },
    { id: "months", type: "NumberField" },
  ]);
  // Bindings become OpenUI variables; the first option is the choice's starting value.
  expect(program).toContain("@present(");
  expect(program).toContain('"metric": $metric');
  expect(program).toContain('"months": $months');
  expect(program).toContain('$metric = "cost"');
  expect(program).toContain("$months = 3");
});

it("refuses a view that cannot work as composed", () => {
  const field = { type: "TextField", id: "name", label: "Name" };
  const button = (input: unknown, extra = {}) => ({
    type: "Button",
    label: "Go",
    action: { action: "workspace.usage.open", input },
    ...extra,
  });
  const problems = (blocks: unknown[]) => {
    const parsed = parse({ title: "T", blocks });
    return parsed.error ? presentedResultProblems(parsed.error) : "";
  };
  expect(problems([field, field])).toContain('Field id "name" is used twice');
  expect(problems([field, button({ q: { $bind: "other" } })])).toContain(
    'No field has the id "other"',
  );
  expect(problems([field, button({ q: { $bind: "name", extra: 1 } })])).toContain(
    "only the $bind key",
  );
  expect(problems([button({}, { requires: ["missing"] })])).toContain(
    'No field has the id "missing"',
  );
  expect(problems([{ type: "Tab", label: "x" }])).toContain("only valid directly inside Tabs");
  expect(problems([{ type: "Tabs", children: [{ type: "Text", text: "x" }] }])).toContain(
    "only Tab nodes",
  );
  expect(problems([{ type: "TextField", id: "Bad-Id", label: "x" }])).toContain("camelCase");
  let deep: unknown = { type: "Text", text: "leaf" };
  for (let level = 0; level < 7; level += 1) deep = { type: "Stack", children: [deep] };
  expect(problems([deep])).toContain("Nesting is limited");
});

it("keeps a work result part inside the root whose filter it reads", () => {
  const problems = (blocks: unknown[]) => {
    const parsed = parse({ title: "T", blocks });
    return parsed.error ? presentedResultProblems(parsed.error) : "";
  };
  expect(problems([{ type: "WorkResultTable", sort: "status" }])).toContain(
    "only valid inside WorkResults",
  );
  expect(
    problems([{ type: "WorkResults", children: [{ type: "WorkStatusFilter", filter: "all" }] }]),
  ).toContain("directly inside WorkStatusCounts");
  expect(
    problems([
      {
        type: "WorkResults",
        children: [
          { type: "Stack", children: [{ type: "WorkResultTable", sort: "status" }] },
          { type: "WorkStatusCounts", children: [{ type: "WorkStatusFilter", filter: "failed" }] },
        ],
      },
    ]),
  ).toBe("");
});

it("tells the model how to compose, discover and bind", () => {
  expect(presentVoiceResultTool.description).toMatch(/again/i);
  expect(presentVoiceResultTool.description).toContain("$bind");
  expect(presentVoiceResultTool.description).toContain("workspace.live_work.catalog");
  for (const spec of presentedSpecs)
    expect(presentVoiceResultTool.description, spec.name).toContain(spec.name);
  expect(presentVoiceResultTool.parameters.properties.blocks.items.properties.type.enum).toEqual(
    presentedSpecs.map((spec) => spec.name),
  );
  expect(presentedCatalogTool.name).toBe("workspace.live_work.catalog");
});

it("describes exact props, nesting and examples for the components asked for", () => {
  const index = describePresentedCatalog({});
  expect(Object.keys((index as { groups: object }).groups)).toEqual(
    expect.arrayContaining(["layout", "fields", "choice", "actions", "observed"]),
  );
  const { components } = describePresentedCatalog({ names: ["Select", "Stack", "Button"] }) as {
    components: {
      name: string;
      props: { properties: Record<string, unknown>; required?: string[] };
      children?: string;
      fieldValue?: string;
      example: unknown;
    }[];
  };
  const select = components.find((entry) => entry.name === "Select")!;
  expect(select.props.required).toEqual(expect.arrayContaining(["id", "label", "options"]));
  expect(select.fieldValue).toBe("value");
  expect(components.find((entry) => entry.name === "Stack")?.children).toBe("any component nodes");
  expect(
    Object.keys(components.find((entry) => entry.name === "Button")!.props.properties),
  ).toEqual(expect.arrayContaining(["label", "action", "requires"]));
  expect(() => describePresentedCatalog({ names: ["Nope"] })).toThrow("Unknown components: Nope");
  expect(() => describePresentedCatalog({ group: "everything" })).toThrow();
});
