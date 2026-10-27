/** Discover Host build inputs without executing the build script or writing bundles. */
import { build } from "esbuild";
import ts from "@typescript/typescript6";
import { readFile, readdir } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const slash = (value) => value.replaceAll("\\", "/");
const isTest = (name) => /(?:^|\/)(?:__tests__|tests)(?:\/|$)|\.(?:test|spec)\./.test(name);

export function hostBuildPlans(source) {
  const tree = ts.createSourceFile(
    "host/build.mjs",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  if (tree.parseDiagnostics.length) throw new Error("Cannot parse Host build configuration");
  const constants = new Map();
  function value(node) {
    if (ts.isStringLiteralLike(node)) return node.text;
    if (ts.isNumericLiteral(node)) return Number(node.text);
    if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
    if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
    if (ts.isIdentifier(node) && constants.has(node.text)) return constants.get(node.text);
    if (ts.isArrayLiteralExpression(node)) return node.elements.map(value);
    if (ts.isObjectLiteralExpression(node)) {
      const result = {};
      for (const property of node.properties) {
        if (ts.isSpreadAssignment(property)) Object.assign(result, value(property.expression));
        else if (ts.isPropertyAssignment(property))
          result[property.name.text] = value(property.initializer);
        else throw new Error("Unsupported dynamic Host build option");
      }
      return result;
    }
    throw new Error(
      "Unsupported dynamic Host build configuration; update input discovery before caching",
    );
  }
  const plans = [];
  function visit(node) {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      ts.isObjectLiteralExpression(node.initializer)
    )
      constants.set(node.name.text, value(node.initializer));
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "build"
    ) {
      if (node.arguments.length !== 1) throw new Error("Unsupported Host build invocation");
      const plan = value(node.arguments[0]);
      if (
        !Array.isArray(plan.entryPoints) ||
        !plan.entryPoints.length ||
        plan.entryPoints.some((entry) => typeof entry !== "string") ||
        typeof plan.outfile !== "string"
      )
        throw new Error("Host build entrypoints/output must be explicit");
      plans.push(plan);
    }
    ts.forEachChild(node, visit);
  }
  visit(tree);
  if (!plans.length) throw new Error("No Host build entrypoints found");
  return plans;
}

export async function discoverHostInputs(root) {
  root = resolve(root);
  const local = (name) => {
    const normalized = slash(relative(root, resolve(root, name.split("?")[0])));
    if (!normalized || normalized.startsWith("../") || isAbsolute(normalized))
      throw new Error("Host build input escaped the frozen source");
    return normalized;
  };
  const plans = hostBuildPlans(await readFile(resolve(root, "host/build.mjs"), "utf8"));
  const inputs = new Set([
    "host/build.mjs",
    "host/tsconfig.json",
    "tsconfig.json",
    "package.json",
    "scripts/build/host-inputs.mjs",
  ]);
  const outputs = new Set();
  for (const plan of plans) {
    const output = local(plan.outfile);
    if (!output.startsWith("build/host/")) throw new Error("Unexpected Host build output");
    outputs.add(output);
    if (plan.sourcemap) outputs.add(`${output}.map`);
    const result = await build({
      ...plan,
      absWorkingDir: root,
      write: false,
      metafile: true,
      logLevel: "silent",
    });
    for (const name of Object.keys(result.metafile.inputs)) {
      const input = local(name);
      // Locked dependencies are represented by the updater's install-input key.
      if (!input.startsWith("node_modules/")) inputs.add(input);
    }
  }
  // Files loaded/copied dynamically cannot all be inferred from static imports.
  // Retain every non-test Host resource (workers, guards, skills and package code),
  // while shared src/ code is included only through the real esbuild graph.
  async function resources(directory) {
    for (const entry of await readdir(resolve(root, directory), { withFileTypes: true })) {
      const name = `${directory}/${entry.name}`;
      if (isTest(name) || entry.name === "node_modules" || entry.name === "__pycache__") continue;
      if (entry.isDirectory()) await resources(name);
      else if (entry.isFile()) inputs.add(name);
      else throw new Error("Linked Host resource requires explicit input ownership");
    }
  }
  await resources("host");
  return {
    schemaVersion: 1,
    inputs: [...inputs].sort(),
    outputs: [...outputs].sort(),
    entryPoints: [...new Set(plans.flatMap((plan) => plan.entryPoints.map(local)))].sort(),
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(
    process.argv[2] ?? resolve(dirname(fileURLToPath(import.meta.url)), "../.."),
  );
  process.stdout.write(`${JSON.stringify(await discoverHostInputs(root))}\n`);
}
