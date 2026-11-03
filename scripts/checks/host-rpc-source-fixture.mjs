/** Pure source inspection for contract tests; never routes or authorizes RPCs. */
import assert from "node:assert/strict";
import ts from "@typescript/typescript6";

const method = /^[a-zA-Z][a-zA-Z0-9]*(?:[._][a-zA-Z0-9]+)+$/;
// Consecutive candidate/transport reads share one AST, never an unbounded cache.
let previous;
function parse(source, filename = "fixture.ts") {
  if (previous?.source === source && previous.filename === filename) return previous.file;
  const file = ts.createSourceFile(
    filename,
    source,
    ts.ScriptTarget.Latest,
    true,
    filename.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  previous = { source, filename, file };
  return file;
}
function literal(node) {
  return node && ts.isStringLiteralLike(node) && node.text.includes(".") && method.test(node.text)
    ? node.text
    : undefined;
}
function inputMethod(node) {
  return (
    ts.isPropertyAccessExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === "input" &&
    node.name.text === "method"
  );
}

export function declaredTypeKeys(source, name) {
  const declaration = parse(source).statements.find(
    (node) => ts.isTypeAliasDeclaration(node) && node.name.text === name,
  );
  assert(
    declaration && ts.isTypeLiteralNode(declaration.type),
    `Missing declared object type: ${name}`,
  );
  return declaration.type.members
    .map((member) => {
      assert(
        ts.isPropertySignature(member) &&
          member.name &&
          (ts.isIdentifier(member.name) || ts.isStringLiteral(member.name)),
        `Unsupported field in ${name}`,
      );
      return member.name.text;
    })
    .sort();
}

export function rpcDispatchLiterals(source) {
  const methods = new Set();
  const add = (node) => {
    const name = literal(node);
    if (name) methods.add(name);
  };
  function visit(node) {
    if (ts.isSwitchStatement(node) && inputMethod(node.expression)) {
      for (const clause of node.caseBlock.clauses)
        if (ts.isCaseClause(clause)) add(clause.expression);
    }
    if (
      ts.isBinaryExpression(node) &&
      [
        ts.SyntaxKind.EqualsEqualsToken,
        ts.SyntaxKind.EqualsEqualsEqualsToken,
        ts.SyntaxKind.ExclamationEqualsToken,
        ts.SyntaxKind.ExclamationEqualsEqualsToken,
      ].includes(node.operatorToken.kind)
    ) {
      if (inputMethod(node.left)) add(node.right);
      if (inputMethod(node.right)) add(node.left);
    }
    ts.forEachChild(node, visit);
  }
  visit(parse(source));
  return [...methods];
}

/** Call arguments and RPC `method` envelopes, excluding schema/operation data. */
export function rpcCallLiterals(source, filename) {
  if (!/["'`][a-zA-Z][a-zA-Z0-9_.]*\.[a-zA-Z0-9_.]+["'`]/.test(source)) return [];
  const methods = new Set();
  const add = (node) => {
    const name = literal(node);
    if (name) methods.add(name);
  };
  function visit(node) {
    if (
      ts.isCallExpression(node) &&
      !(ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "literal")
    ) {
      for (const argument of node.arguments) {
        add(argument);
        if (ts.isObjectLiteralExpression(argument))
          for (const property of argument.properties) {
            if (
              ts.isPropertyAssignment(property) &&
              (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) &&
              property.name.text === "method"
            )
              add(property.initializer);
          }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(parse(source, filename));
  return [...methods];
}

/** Known transport calls retain unknown literals, so missing registrations fail. */
export function remoteRpcCallLiterals(source, filename) {
  if (
    ![
      "remoteRequest",
      "remote_request",
      "sendHostRequest",
      "hostFeatureRequest",
      "hostToolRequest",
    ].some((name) => source.includes(name))
  )
    return [];
  const file = parse(source, filename),
    methods = new Set();
  const positions = new Map([
    ["remoteRequest", 1],
    ["sendHostRequest", 1],
    ["hostFeatureRequest", 2],
    ["hostToolRequest", 2],
  ]);
  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const entry of bindings.elements) {
      const position = positions.get(entry.propertyName?.text ?? entry.name.text);
      if (position !== undefined) positions.set(entry.name.text, position);
    }
  }
  const add = (node) => {
    const name = literal(node);
    if (name) methods.add(name);
  };
  function visit(node) {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const position = positions.get(node.expression.text);
      if (position !== undefined) add(node.arguments[position]);
      if (
        node.expression.text === "invoke" &&
        node.arguments[0] &&
        ts.isStringLiteral(node.arguments[0]) &&
        node.arguments[0].text === "remote_request"
      ) {
        const envelope = node.arguments[1];
        if (envelope && ts.isObjectLiteralExpression(envelope))
          for (const property of envelope.properties) {
            if (
              ts.isPropertyAssignment(property) &&
              (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) &&
              property.name.text === "method"
            )
              add(property.initializer);
          }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  return [...methods];
}
