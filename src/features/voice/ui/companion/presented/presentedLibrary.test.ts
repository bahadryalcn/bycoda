import { createParser } from "@openuidev/react-lang";
import { expect, it } from "vitest";
import { presentedSpecs } from "../../../model/voicePresentedCatalog";
import { compilePresentedProgram } from "../../../model/voicePresentedProgram";
import { VoicePresentedResultSchema } from "../../../model/voicePresentedResult";
import { presentedLibrary, presentedViewMap } from "./presentedLibrary";
import { workResultEntries } from "./workResultEntries";

type LibrarySchema = { $defs: Record<string, { properties?: Record<string, unknown> }> };
const schema = presentedLibrary.toJSONSchema() as unknown as LibrarySchema;

it("has exactly one view for each catalog component, and none without a spec", () => {
  expect(Object.keys(presentedViewMap).sort()).toEqual(
    presentedSpecs.map((spec) => spec.name).sort(),
  );
  expect(new Set(presentedSpecs.map((spec) => spec.name)).size).toBe(presentedSpecs.length);
});

it("registers every catalog component with its props in spec order", () => {
  for (const spec of presentedSpecs) {
    const definition = schema.$defs[spec.name];
    expect(definition, spec.name).toBeDefined();
    expect(Object.keys(definition!.properties ?? {}), spec.name).toEqual([
      ...Object.keys(spec.props.shape),
      ...(spec.children ? ["children"] : []),
    ]);
  }
});

it("agrees with each work result entry about its name and props", () => {
  const childKeys = new Set(["sections", "options"]);
  for (const entry of workResultEntries) {
    const spec = presentedSpecs.find((item) => item.name === entry.spec.name);
    expect(spec, entry.spec.name).toBeDefined();
    expect(Object.keys(entry.spec.props.shape).filter((key) => !childKeys.has(key))).toEqual(
      Object.keys(spec!.props.shape),
    );
    expect(Boolean(spec!.children), entry.spec.name).toBe(
      Object.keys(entry.spec.props.shape).some((key) => childKeys.has(key)),
    );
  }
});

it("parses every catalog example into a complete OpenUI program", () => {
  const parser = createParser(presentedLibrary.toJSONSchema(), "PresentedAnswer");
  for (const spec of presentedSpecs) {
    const { program } = compilePresentedProgram(
      VoicePresentedResultSchema.parse({ title: spec.name, blocks: [spec.example] }),
    );
    const result = parser.parse(program);
    expect(result.meta.errors, `${spec.name}\n${program}`).toEqual([]);
    expect(result.meta.unresolved, spec.name).toEqual([]);
    expect(result.meta.orphaned, spec.name).toEqual([]);
  }
});

it("never lets model text become program source", () => {
  const hostile = 'x") \n$boom = "y"\nroot = Evil("z" // @present(0, {})';
  const { program } = compilePresentedProgram(
    VoicePresentedResultSchema.parse({ title: hostile, blocks: [{ type: "Text", text: hostile }] }),
  );
  const result = createParser(presentedLibrary.toJSONSchema(), "PresentedAnswer").parse(program);
  expect(result.meta.errors).toEqual([]);
  expect(program.split("\n")).toHaveLength(2);
  expect(result.root?.props.title).toBe(hostile);
});
