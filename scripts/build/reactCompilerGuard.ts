import { parseSync, traverse, types as t } from "@babel/core";
import type { NodePath, PluginObj } from "@babel/core";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * React Compiler memoizes a call whose inputs it can see do not change. Code that
 * reads state React cannot see would then keep a stale value: the module `t()` reads
 * the current locale, `loadX()` helpers read localStorage, `Date.now()` the clock,
 * a module `let` whatever was last assigned. This pass runs before the compiler and
 * marks each function that reaches such a read during render "use no memo".
 * Everything else still compiles; `useT()` gives components a `t` that is safe.
 */

const SOURCE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../src");
const I18N = /[\\/]src[\\/]shared[\\/]i18n[\\/]/;
const STORAGE = new Set(["localStorage", "sessionStorage"]);
const CLOCKS: Record<string, string[]> = {
  Date: ["now"],
  Math: ["random"],
  performance: ["now"],
};
/** Hooks whose callback runs after render, and handlers that only run on events. */
const DEFERRED_HOOKS = new Set([
  "useEffect",
  "useLayoutEffect",
  "useInsertionEffect",
  "useCallback",
  "useEffectEvent",
  "useStableCallback",
]);
/** Hooks that keep their arguments themselves: an initial value, a snapshot reader
 * React calls, or a body memoized on its own dependency list. */
const KEEPING_HOOKS = new Set([
  "useState",
  "useReducer",
  "useRef",
  "useSyncExternalStore",
  "useMemo",
]);

function hookCall(path: NodePath | null | undefined, hooks: Set<string>) {
  return (
    !!path?.isCallExpression() &&
    t.isIdentifier(path.node.callee) &&
    hooks.has(path.node.callee.name)
  );
}

type Module = {
  file: string;
  program: NodePath<t.Program>;
  tainted: Set<string>;
  exports: Map<string, string>;
  reexports: Map<string, { file: string; name: string }>;
  stars: string[];
};

const modules = new Map<string, Module | null>();
/** What made the last `readsHiddenState` call true, for the opt-out report. */
let lastReason = "";
/** Why each tainted top-level name is tainted, keyed `file#name`. */
const reasons = new Map<string, string>();

/** Debugging aid: the chain of reads that makes an export of `file` unsafe. */
export function explainExport(file: string, name: string, depth = 6): string[] {
  const module = analyze(file);
  const local = module?.exports.get(name) ?? name;
  const reason = reasons.get(`${file}#${local}`);
  if (!reason || depth === 0) return reason ? [reason] : [];
  const imported = /^(\S+) \(from ([^)]+)\)/.exec(reason);
  const target = imported && resolveImport(file, imported[2]);
  const sameFile = /^(\S+) \(this file\)/.exec(reason);
  return [
    `${file.replace(SOURCE_ROOT, "src")}#${name}: ${reason}`,
    ...(target
      ? explainExport(target, imported[1], depth - 1)
      : sameFile
        ? explainExport(file, sameFile[1], depth - 1)
        : []),
  ];
}
const analyzing = new Set<string>();

function resolveImport(from: string, specifier: string): string | undefined {
  const base = specifier.startsWith("@/")
    ? resolve(SOURCE_ROOT, specifier.slice(2))
    : specifier.startsWith(".")
      ? resolve(dirname(from), specifier)
      : undefined;
  if (!base) return undefined;
  for (const suffix of ["", ".ts", ".tsx", "/index.ts", "/index.tsx"]) {
    const file = base + suffix;
    if (/\.[jt]sx?$/.test(file) && existsSync(file)) return file;
  }
  return undefined;
}

function parseModule(file: string): NodePath<t.Program> | undefined {
  const ast = parseSync(readFileSync(file, "utf8"), {
    filename: file,
    babelrc: false,
    configFile: false,
    sourceType: "module",
    parserOpts: { plugins: ["typescript", "jsx"] },
  });
  if (!ast) return undefined;
  let program: NodePath<t.Program> | undefined;
  traverse(ast, {
    Program(path: NodePath<t.Program>) {
      program = path;
      path.stop();
    },
  });
  return program;
}

function isHookName(name: string) {
  return /^use[A-Z0-9]/.test(name);
}

/** Whether an imported binding reads hidden state when called or read. */
function importTainted(file: string, path: NodePath<t.ImportDeclaration>, local: string) {
  if (path.node.importKind === "type") return false;
  const specifier = path.node.specifiers.find((item) => item.local.name === local);
  if (!specifier || (t.isImportSpecifier(specifier) && specifier.importKind === "type"))
    return false;
  const target = resolveImport(file, path.node.source.value);
  if (!target) return false;
  const imported = t.isImportSpecifier(specifier)
    ? t.isIdentifier(specifier.imported)
      ? specifier.imported.name
      : specifier.imported.value
    : t.isImportDefaultSpecifier(specifier)
      ? "default"
      : "*";
  if (I18N.test(target)) return !isHookName(imported) && /^[a-z*]/.test(imported);
  if (isHookName(imported) || /^[A-Z]/.test(imported)) return false;
  return exportTainted(target, imported);
}

function exportTainted(file: string, name: string, seen = new Set<string>()): boolean {
  const key = `${file}#${name}`;
  if (seen.has(key)) return false;
  seen.add(key);
  const module = analyze(file);
  if (!module) return false;
  if (name === "*") return module.tainted.size > 0;
  const local = module.exports.get(name);
  if (local !== undefined) return module.tainted.has(local);
  const forwarded = module.reexports.get(name);
  if (forwarded) return exportTainted(forwarded.file, forwarded.name, seen);
  return module.stars.some((star) => exportTainted(star, name, seen));
}

/** Reads of hidden state inside `path`, skipping callbacks that run after render. */
function readsHiddenState(
  file: string,
  path: NodePath,
  program: NodePath<t.Program>,
  tainted: Set<string>,
  renderOnly: boolean,
): boolean {
  let found = false;
  const deferred = (inner: NodePath) => {
    if (!renderOnly || !inner.isFunction()) return false;
    const parent = inner.parentPath;
    if (parent?.isCallExpression() && t.isIdentifier(parent.node.callee))
      return DEFERRED_HOOKS.has(parent.node.callee.name) && parent.node.arguments[0] === inner.node;
    if (parent?.isJSXExpressionContainer() && parent.parentPath?.isJSXAttribute()) {
      const name = parent.parentPath.node.name;
      return t.isJSXIdentifier(name) && /^on[A-Z]/.test(name.name);
    }
    if (parent?.isVariableDeclarator() && t.isIdentifier(parent.node.id))
      return /^(on|handle)[A-Z]/.test(parent.node.id.name);
    return false;
  };
  path.traverse({
    Function(inner) {
      if (deferred(inner)) inner.skip();
    },
    CallExpression(call) {
      if (renderOnly && hookCall(call, KEEPING_HOOKS)) call.skip();
    },
    Identifier(ref) {
      if (found || !ref.isReferencedIdentifier()) return;
      const name = ref.node.name;
      // A handler passed to an event prop is called later, not during render.
      const container = ref.parentPath;
      if (
        renderOnly &&
        container?.isJSXExpressionContainer() &&
        container.parentPath?.isJSXAttribute() &&
        t.isJSXIdentifier(container.parentPath.node.name) &&
        /^on[A-Z]/.test(container.parentPath.node.name.name)
      )
        return;
      const binding = ref.scope.getBinding(name);
      if (!binding) {
        if (STORAGE.has(name)) {
          found = true;
          lastReason = name;
        }
        return;
      }
      if (binding.scope !== program.scope) return;
      if (binding.kind === "module") {
        const declaration = binding.path.parentPath;
        if (declaration?.isImportDeclaration() && importTainted(file, declaration, name)) {
          found = true;
          lastReason = `${name} (from ${declaration.node.source.value})`;
        }
      } else if ((binding.kind === "let" || binding.kind === "var") && !binding.constant) {
        found = true;
        lastReason = `module let ${name}`;
      } else if (tainted.has(name) && !isHookName(name) && !/^[A-Z]/.test(name)) {
        // A hook's result is reactive and a component renders itself; each is
        // guarded where it is defined, as imported ones are.
        found = true;
        lastReason = `${name} (this file)`;
      }
      if (found) {
        lastReason += `:${ref.node.loc?.start.line ?? 0}`;
        ref.stop();
      }
    },
    MemberExpression(member) {
      if (found) return;
      const { object, property } = member.node;
      if (
        t.isIdentifier(object) &&
        t.isIdentifier(property) &&
        !member.scope.getBinding(object.name) &&
        CLOCKS[object.name]?.includes(property.name)
      ) {
        found = true;
        lastReason = `${object.name}.${property.name}:${member.node.loc?.start.line ?? 0}`;
        member.stop();
      }
    },
    NewExpression(expression) {
      const callee = expression.node.callee;
      if (
        !found &&
        t.isIdentifier(callee, { name: "Date" }) &&
        expression.node.arguments.length === 0 &&
        !expression.scope.getBinding("Date")
      ) {
        found = true;
        lastReason = `new Date():${expression.node.loc?.start.line ?? 0}`;
        expression.stop();
      }
    },
  });
  return found;
}

type TopLevel = { name: string; path: NodePath };

function topLevel(program: NodePath<t.Program>): TopLevel[] {
  const items: TopLevel[] = [];
  for (const statement of program.get("body")) {
    const declaration =
      statement.isExportNamedDeclaration() || statement.isExportDefaultDeclaration()
        ? (statement.get("declaration") as NodePath)
        : statement;
    if (declaration.isFunctionDeclaration() && declaration.node.id)
      items.push({ name: declaration.node.id.name, path: declaration });
    else if (declaration.isClassDeclaration() && declaration.node.id)
      items.push({ name: declaration.node.id.name, path: declaration });
    else if (declaration.isVariableDeclaration())
      for (const declarator of declaration.get("declarations"))
        if (t.isIdentifier(declarator.node.id))
          items.push({ name: declarator.node.id.name, path: declarator });
  }
  return items;
}

/** Top-level names whose value or body reads hidden state, to a fixed point. */
function taint(file: string, program: NodePath<t.Program>): Set<string> {
  const tainted = new Set<string>();
  const items = topLevel(program);
  let changed = true;
  while (changed) {
    changed = false;
    for (const item of items) {
      if (tainted.has(item.name)) continue;
      if (readsHiddenState(file, item.path, program, tainted, false)) {
        tainted.add(item.name);
        reasons.set(`${file}#${item.name}`, lastReason);
        changed = true;
      }
    }
  }
  return tainted;
}

function analyze(file: string): Module | null {
  const known = modules.get(file);
  if (known !== undefined) return known;
  if (analyzing.has(file)) return null;
  analyzing.add(file);
  let module: Module | null = null;
  try {
    const program = parseModule(file);
    if (program) {
      module = {
        file,
        program,
        tainted: new Set(),
        exports: new Map(),
        reexports: new Map(),
        stars: [],
      };
      for (const statement of program.get("body")) {
        if (statement.isExportNamedDeclaration()) {
          const source = statement.node.source
            ? resolveImport(file, statement.node.source.value)
            : undefined;
          for (const specifier of statement.node.specifiers) {
            if (!t.isExportSpecifier(specifier)) continue;
            const exported = t.isIdentifier(specifier.exported)
              ? specifier.exported.name
              : specifier.exported.value;
            if (statement.node.source) {
              if (source)
                module.reexports.set(exported, { file: source, name: specifier.local.name });
            } else module.exports.set(exported, specifier.local.name);
          }
          const declaration = statement.node.declaration;
          if (t.isFunctionDeclaration(declaration) && declaration.id)
            module.exports.set(declaration.id.name, declaration.id.name);
          else if (t.isVariableDeclaration(declaration))
            for (const item of declaration.declarations)
              if (t.isIdentifier(item.id)) module.exports.set(item.id.name, item.id.name);
        } else if (statement.isExportAllDeclaration()) {
          const source = resolveImport(file, statement.node.source.value);
          if (source) module.stars.push(source);
        } else if (statement.isExportDefaultDeclaration()) {
          const declaration = statement.node.declaration;
          if (t.isIdentifier(declaration)) module.exports.set("default", declaration.name);
          else if (
            (t.isFunctionDeclaration(declaration) || t.isClassDeclaration(declaration)) &&
            declaration.id
          )
            module.exports.set("default", declaration.id.name);
        }
      }
      modules.set(file, module);
      module.tainted = taint(file, program);
    }
  } catch {
    module = null;
  } finally {
    analyzing.delete(file);
  }
  modules.set(file, module);
  return module;
}

/** Functions the compiler may compile: named components and hooks, and functions
 * handed to memo/forwardRef. */
function compilable(path: NodePath<t.Function>): boolean {
  const named = (name: string | undefined) => !!name && (/^[A-Z]/.test(name) || isHookName(name));
  if (path.isFunctionDeclaration()) return named(path.node.id?.name);
  const parent = path.parentPath;
  if (parent?.isVariableDeclarator() && t.isIdentifier(parent.node.id))
    return named(parent.node.id.name);
  if (parent?.isCallExpression()) {
    const callee = parent.node.callee;
    const name = t.isIdentifier(callee)
      ? callee.name
      : t.isMemberExpression(callee) && t.isIdentifier(callee.property)
        ? callee.property.name
        : "";
    return name === "memo" || name === "forwardRef";
  }
  return path.isFunctionExpression() && named(path.node.id?.name);
}

function optOut(path: NodePath<t.Function>) {
  let body = path.get("body");
  if (!body.isBlockStatement()) {
    body.replaceWith(t.blockStatement([t.returnStatement(body.node as t.Expression)]));
    body = path.get("body");
  }
  const block = body.node as t.BlockStatement;
  block.directives = block.directives.filter((item) => item.value.value !== "use memo");
  if (!block.directives.some((item) => item.value.value === "use no memo"))
    block.directives.unshift(t.directive(t.directiveLiteral("use no memo")));
}

/** Babel plugin; list it before the React Compiler preset. With `annotation`, only
 * files that opt in with "use memo" are examined. */
export function reactCompilerGuard({ annotation = false }: { annotation?: boolean } = {}) {
  return (): PluginObj => ({
    name: "bycoda-react-compiler-guard",
    visitor: {
      Program(program, state) {
        const file = state.filename;
        if (!file) return;
        if (annotation && !/["']use memo["']/.test(state.file.code)) return;
        const tainted = taint(file, program);
        const report = process.env.BYCODA_COMPILER_GUARD_REPORT === "1";
        program.traverse({
          Function(path) {
            if (!compilable(path)) return;
            if (readsHiddenState(file, path, program, tainted, true)) {
              optOut(path);
              if (report)
                console.warn(
                  `[compiler-guard] ${file}:${path.node.loc?.start.line ?? 0} use no memo: ${lastReason}`,
                );
            }
            path.skip();
          },
        });
      },
    },
  });
}
