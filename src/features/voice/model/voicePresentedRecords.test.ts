import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { presentedSpecs } from "./voicePresentedCatalog";
import { presentedDrawn, presentedOmitted } from "./voicePresentedCoverage";
import { describePresentedCatalog } from "./voicePresentedDiscovery";
import { compilePresentedProgram } from "./voicePresentedProgram";
import { presentedResultProblems, VoicePresentedResultSchema } from "./voicePresentedResult";

const problems = (blocks: unknown[]) => {
  const parsed = VoicePresentedResultSchema.safeParse({ title: "T", blocks });
  return parsed.error ? presentedResultProblems(parsed.error) : "";
};

const sharedCatalog = readFileSync(
  new URL("../../../../docs/reference/ui-components.md", import.meta.url),
  "utf8",
);
const sharedNames = [...sharedCatalog.matchAll(/^\| \[(\w+)\]/gm)].map((match) => match[1]!);

it("places every shared component exactly once: drawn by a presented component or omitted for one reason", () => {
  const drawn = Object.keys(presentedDrawn);
  const omitted = Object.values(presentedOmitted).flat();
  expect(sharedNames).toHaveLength(157);
  expect([...drawn, ...omitted].sort()).toEqual([...sharedNames].sort());
  expect(new Set([...drawn, ...omitted]).size).toBe(sharedNames.length);
});

it("draws each shared component with a catalog component that exists, and leaves none unexplained", () => {
  const names = new Set(presentedSpecs.map((spec) => spec.name));
  for (const [shared, presented] of Object.entries(presentedDrawn))
    expect(names.has(presented), `${shared} -> ${presented}`).toBe(true);
  // A presented component either stands for a shared one or is one of these layout compositions.
  const drawnBy = new Set<string>(Object.values(presentedDrawn));
  const compositions = ["Stack", "Grid", "Section", "List", "Tab"];
  for (const spec of presentedSpecs)
    if (spec.group !== "observed" && !compositions.includes(spec.name))
      expect(drawnBy.has(spec.name), spec.name).toBe(true);
});

it("describes the new components with their exact props and a bound value", () => {
  const { components } = describePresentedCatalog({
    names: ["DateRangePicker", "Combobox", "RowList", "JsonViewer"],
  }) as { components: { name: string; fieldValue?: string; example: unknown }[] };
  expect(components.map((entry) => entry.fieldValue)).toEqual([
    "value",
    "value",
    "value",
    undefined,
  ]);
  expect(components.every((entry) => entry.example)).toBe(true);
});

it("takes a period only as ordered local dates, and a date-time only without a zone", () => {
  const field = (type: string, value: unknown) => [{ type, id: "p", label: "P", value }];
  expect(problems(field("DateRangePicker", { start: "2026-11-24", end: "2026-11-24" }))).toBe("");
  expect(problems(field("DateRangePicker", { start: "2026-11-25", end: "2026-11-24" }))).toContain(
    "end day is before",
  );
  expect(problems(field("DateRangePicker", { start: "2026-13-01", end: "2026-13-02" }))).not.toBe(
    "",
  );
  expect(problems(field("DateRangePicker", { start: "2026-11-24" }))).not.toBe("");
  expect(
    problems(field("DateTimeRangePicker", { start: "2026-11-24T09:00", end: "2026-11-24T09:00" })),
  ).toContain("after the start");
  expect(
    problems(
      field("DateTimeRangePicker", { start: "2026-11-24T09:00Z", end: "2026-11-25T09:00Z" }),
    ),
  ).not.toBe("");
  expect(problems(field("DateTimePicker", "2026-11-24T09:30"))).toBe("");
  expect(problems(field("DateTimePicker", "2026-11-24 09:30"))).not.toBe("");
  expect(problems(field("DateTimePicker", "2026-11-24T09:30:15"))).not.toBe("");
});

it("binds a range, free text and a list under their own ids, with no hidden first choice", () => {
  const parsed = VoicePresentedResultSchema.parse({
    title: "T",
    blocks: [
      {
        type: "Combobox",
        id: "branch",
        label: "B",
        suggestions: [{ value: "main", label: "main" }],
      },
      { type: "RowList", id: "pick", label: "P", rows: [{ value: "a", label: "A" }] },
      {
        type: "DateRangePicker",
        id: "days",
        label: "D",
        value: { start: "2026-11-01", end: "2026-11-24" },
      },
    ],
  });
  const { program, fields } = compilePresentedProgram(parsed);
  expect(fields.map((field) => field.type)).toEqual(["Combobox", "RowList", "DateRangePicker"]);
  expect(program).toContain('$days = {"start": "2026-11-01", "end": "2026-11-24"}');
  expect(program).not.toContain("$branch =");
  expect(program).not.toContain("$pick =");
});

it("shows JSON only when it is bounded, plain and free of credential keys", () => {
  const json = (data: unknown) => [{ type: "JsonViewer", label: "J", data }];
  expect(problems(json({ passed: 42, list: [1, "a", null, true, { deep: 1.5 }] }))).toBe("");
  expect(problems(json("text"))).toBe("");
  expect(problems(json({ password: "x" }))).toContain("looks like a credential");
  expect(problems(json({ nested: { apiKey: "x" } }))).toContain("looks like a credential");
  expect(problems(json({ api_key: "x" }))).toContain("looks like a credential");
  expect(problems(json({ note: "password: hunter2-hunter2" }))).toContain("credential");
  expect(problems(json(JSON.parse('{"__proto__": {"x": 1}}')))).toContain("not allowed");
  expect(problems(json({ constructor: 1 }))).toContain("not allowed");
  expect(problems(json({ a: 1e-7 }))).toContain("plain decimals");
  expect(problems(json({ a: 1e21 }))).toContain("plain decimals");
  expect(problems(json({ a: { b: { c: { d: { e: { f: { g: 1 } } } } } } }))).toContain("Nesting");
  expect(problems(json({ text: "x".repeat(6001) }))).toContain("limited to");
  expect(problems([{ type: "JsonViewer", label: "J" }])).toContain("Send the JSON value");
});

it("refuses malformed records, extra props and any link that leaves https", () => {
  const meter = { type: "UsageMeter", label: "U", limit: 5 };
  for (const bad of [
    { type: "Timeline", label: "T", events: [{ at: "yesterday", title: "x" }] },
    {
      type: "Timeline",
      label: "x",
      events: [{ at: "2026-11-24T09:00:00Z", title: "x", icon: "x" }],
    },
    { type: "StepStrip", label: "S", steps: ["done", "skipped"] },
    { ...meter, limit: 0, segments: [{ label: "a", value: 1 }] },
    { ...meter, segments: Array(5).fill({ label: "a", value: 1 }) },
    {
      type: "ActivityHeatmap",
      label: "H",
      period: "p",
      unit: { one: "a", other: "b" },
      days: [
        { date: "2026-11-24", count: 1 },
        { date: "2026-11-24", count: 2 },
      ],
    },
    { type: "StatusBadge", status: "broken" },
    { type: "Link", label: "x", url: "ftp://example.com" },
    { type: "Link", label: "x", url: "//example.com" },
    { type: "Link", label: "x", url: "https://example.com", target: "_blank" },
    { type: "ClampText", text: "x", lines: 13 },
    { type: "FieldGroup", legend: "x", html: "<b>" },
  ])
    expect(problems([bad]), JSON.stringify(bad)).not.toBe("");
});

it("applies the credential and field rules inside a group and to links", () => {
  const field = { type: "TextField", id: "name", label: "Name" };
  expect(
    problems([
      { type: "FieldGroup", legend: "G", children: [field, { ...field, label: "Again" }] },
    ]),
  ).toContain('Field id "name" is used twice');
  expect(
    problems([{ type: "Link", label: "x", url: "https://example.com/?key=sk-abcdefghijklmnop" }]),
  ).toContain("credential");
  expect(problems([{ type: "ClampText", text: "password: hunter2-hunter2" }])).toContain(
    "credential",
  );
});
