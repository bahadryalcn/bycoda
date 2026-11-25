import { defineRule, TESTS } from "../define-rule.mjs";

const textProps = new Set(["title", "description", "message", "label", "children"]);
const isErrorLike = (node) =>
  node?.type === "Identifier" &&
  (/^(e|err|error|cause|reason)$/i.test(node.name) || node.name.endsWith("Error"));

const feedbackSinks = new Set([
  "Alert",
  "InlineError",
  "InlineMessage",
  "Text",
  "SettingsFeedback",
  "FailureState",
]);
const errorField = /^(?:error|failure|budgetStop)$|(?:Error|Failure)$/;
const isNamedError = (node) =>
  node?.type === "Identifier" && (/^(?:err|error)$/i.test(node.name) || errorField.test(node.name));
const unwrap = (node) => (node?.type === "ChainExpression" ? node.expression : node);
const isErrorValue = (node) => {
  node = unwrap(node);
  return (
    isErrorLike(node) ||
    isNamedError(node) ||
    (node?.type === "MemberExpression" &&
      errorField.test(node.computed ? node.property.value : node.property.name))
  );
};

function rendersError(node, bare = false, trace = () => null) {
  if (!node) return false;
  switch (node.type) {
    case "Identifier":
      return trace(node) ?? (bare === "coerced" ? isErrorValue(node) : bare && isNamedError(node));
    case "MemberExpression":
      return (
        isErrorValue(node) ||
        (!node.computed && node.property.name === "message" && isErrorValue(node.object))
      );
    case "CallExpression": {
      const { callee, arguments: args } = node;
      return (
        (callee.type === "Identifier" &&
          (callee.name === "errorText" ||
            (callee.name === "String" && rendersError(args[0], "coerced", trace)))) ||
        (callee.type === "MemberExpression" &&
          !callee.computed &&
          callee.property.name === "toString" &&
          isErrorValue(callee.object))
      );
    }
    case "TemplateLiteral":
      return node.expressions.some((expression) => rendersError(expression, "coerced", trace));
    case "ConditionalExpression":
      return (
        rendersError(node.consequent, bare, trace) || rendersError(node.alternate, bare, trace)
      );
    case "LogicalExpression":
      return (
        (node.operator !== "&&" && rendersError(node.left, bare, trace)) ||
        rendersError(node.right, bare, trace)
      );
    case "ChainExpression":
    case "TSAsExpression":
    case "TSNonNullExpression":
    case "TSSatisfiesExpression":
      return rendersError(node.expression, bare, trace);
    default:
      return false;
  }
}

/** `toast.show(...)` or `<anything>.toast.show(...)`, the imperative path used from .ts hooks. */
function isToastShow(node) {
  const callee = node.callee;
  if (callee.type !== "MemberExpression" || callee.computed || callee.property.name !== "show")
    return false;
  const target = callee.object;
  return (
    (target.type === "Identifier" && target.name === "toast") ||
    (target.type === "MemberExpression" && !target.computed && target.property.name === "toast")
  );
}

export default defineRule({
  files: ["src/**/*.ts", "src/**/*.tsx"],
  ignores: [...TESTS, "**/*.spec.ts", "**/*.spec.tsx", "src/shared/ui/ErrorDetails*"],
  message:
    "Show what happened in a translated title and put raw error text in the shared ErrorDetails, or use the existing describe/present error helpers. See K1.",
  create(context, report) {
    const setters = new Map();
    const sinks = [];
    const importedSinks = new Map();
    function binding(node) {
      const source = context.sourceCode;
      for (let scope = source.getScope(node); scope; scope = scope.upper) {
        const definition = scope.set.get(node.name)?.defs[0];
        if (definition) return definition.node;
      }
      return null;
    }
    function trace(node, seen) {
      const declaration = binding(node);
      if (!declaration) return null;
      if (seen.has(declaration)) return false;
      if (declaration.type === "CatchClause") return true;
      if (declaration.type !== "VariableDeclarator") return null;
      const next = new Set([...seen, declaration]);
      const check = (value) => rendersError(value, true, (reference) => trace(reference, next));
      if (declaration.id.type === "Identifier") {
        const value = declaration.init;
        const call = value?.type === "MemberExpression" ? unwrap(value.object) : value;
        if (
          call?.type === "CallExpression" &&
          /^(?:t$|(?:describe|present).*Error)/.test(call.callee.name ?? "")
        )
          return false;
        if (value?.type === "Literal") return false;
        return check(value) || null;
      }
      const [state, setter] = declaration.id.elements ?? [];
      const hook = declaration.init?.callee;
      const hookName = hook?.name ?? hook?.property?.name;
      return (
        (state?.name === node.name &&
          setter?.type === "Identifier" &&
          hookName === "useState" &&
          (check(declaration.init.arguments[0]) || setters.get(declaration)?.some(check))) ||
        null
      );
    }
    function raw(node, bare) {
      return rendersError(node, bare, (reference) => trace(reference, new Set()));
    }
    function feedbackName(element) {
      const name = element?.openingElement?.name ?? element?.name;
      if (name?.type !== "JSXIdentifier") return false;
      return feedbackSinks.has(importedSinks.get(name.name) ?? name.name);
    }
    return {
      ImportDeclaration(node) {
        if (!/(?:^|\/)shared\/ui(?:\/|$)/.test(node.source.value)) return;
        for (const specifier of node.specifiers) {
          const name = specifier.imported?.name ?? node.source.value.split("/").at(-1);
          importedSinks.set(specifier.local.name, name);
        }
      },
      "Program:exit"() {
        for (const { node, bare } of sinks) if (raw(node, bare)) report(node);
      },
      CallExpression(node) {
        if (node.callee.type === "Identifier") {
          const declaration = binding(node.callee);
          const setter = declaration?.id?.elements?.[1];
          if (setter?.name === node.callee.name) {
            if (!setters.has(declaration)) setters.set(declaration, []);
            setters.get(declaration).push(node.arguments[0]);
          }
        }
        if (!isToastShow(node) || node.arguments[0]?.type !== "ObjectExpression") return;
        for (const property of node.arguments[0].properties) {
          if (
            property.type === "Property" &&
            !property.computed &&
            textProps.has(property.key.name ?? property.key.value)
          ) {
            sinks.push({ node: property.value, bare: false });
          }
        }
      },
      JSXExpressionContainer(node) {
        const parent = node.parent;
        if (
          parent.type === "JSXElement" ||
          parent.type === "JSXFragment" ||
          (parent.type === "JSXAttribute" && textProps.has(parent.name.name))
        ) {
          sinks.push({
            node: node.expression,
            bare: feedbackName(parent.type === "JSXAttribute" ? parent.parent : parent),
          });
        }
      },
    };
  },
});
