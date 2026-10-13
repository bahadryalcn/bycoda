import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import { EditorState, type Extension } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, keymap, type DecorationSet } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import { readTextFile, statFiles } from "../../../platform/tauri/fs";
import { joinPath, parentPath, pathKey } from "../../../shared/lib/paths";
import { parseJsonc } from "../../projects/model/codeWorkspace";
import type { OpenFileFn } from "../../search/model/search";
import { languageForPath } from "./editorLanguage";

type Reference = { offset: number } | { module: string; name?: string };
const MAX_SOURCE = 512 * 1024;
const SCOPES =
  /^(Script|Block|FunctionDeclaration|FunctionExpression|ArrowFunction|MethodDeclaration|ForStatement|CatchClause|ClassDeclaration|ClassExpression)$/;

function ancestor(node: SyntaxNode | null, name: string): SyntaxNode | null {
  for (; node; node = node.parent) if (node.name === name) return node;
  return null;
}

function moduleOf(state: EditorState, node: SyntaxNode): string | null {
  const literal = node.getChild("String");
  return literal ? state.sliceDoc(literal.from + 1, literal.to - 1) : null;
}

function importedReference(state: EditorState, node: SyntaxNode): Reference | null {
  const declaration = ancestor(node, "ImportDeclaration");
  if (!declaration) return null;
  const module = moduleOf(state, declaration);
  if (!module) return null;
  const group = ancestor(node, "ImportGroup");
  if (!group) return { module, name: "default" };
  // Named imports may rename the exported symbol; namespaces open the module.
  if (state.sliceDoc(group.from, group.to).startsWith("*")) return { module };
  const original = node.prevSibling?.name === "as" ? node.prevSibling.prevSibling : node;
  return { module, name: original ? state.sliceDoc(original.from, original.to) : undefined };
}

/** Syntax-based navigation only: do not guess member types or unrelated project symbols. */
export function referenceAt(state: EditorState, position: number): Reference | null {
  if (state.doc.length > MAX_SOURCE) return null;
  const tree = ensureSyntaxTree(state, state.doc.length, 100) ?? syntaxTree(state);
  const node = tree.resolveInner(position, -1);
  if (node.name === "String") {
    if (node.parent && /^(ImportDeclaration|ExportDeclaration)$/.test(node.parent.name)) {
      return { module: state.sliceDoc(node.from + 1, node.to - 1) };
    }
    const call = ancestor(node, "CallExpression") ?? ancestor(node, "DynamicImport");
    if (call && /^(import|require)\s*\(/.test(state.sliceDoc(call.from, node.from))) {
      return { module: state.sliceDoc(node.from + 1, node.to - 1) };
    }
    return null;
  }
  if (!/^(VariableName|VariableDefinition|TypeName|TypeDefinition|JSXIdentifier)$/.test(node.name))
    return null;
  const direct = importedReference(state, node);
  if (direct) return direct;
  const name = state.sliceDoc(node.from, node.to);
  for (let scope: SyntaxNode | null = node.parent; scope; scope = scope.parent) {
    if (!SCOPES.test(scope.name)) continue;
    const definitions: SyntaxNode[] = [];
    scope.cursor().iterate((cursor) => {
      const candidate = cursor.node;
      if (candidate.from === scope!.from && candidate.to === scope!.to) return;
      if (
        /^(VariableDefinition|TypeDefinition)$/.test(candidate.name) &&
        state.sliceDoc(candidate.from, candidate.to) === name
      )
        definitions.push(candidate);
      if (SCOPES.test(candidate.name)) {
        // Declarations bind in the enclosing scope, their bodies do not.
        if (/^(FunctionDeclaration|ClassDeclaration)$/.test(candidate.name)) {
          const id = candidate.getChild("VariableDefinition");
          if (id && state.sliceDoc(id.from, id.to) === name) definitions.push(id);
        }
        return false;
      }
    });
    const preceding = definitions.filter((d) => d.from <= position);
    const definition = preceding[preceding.length - 1] ?? definitions[0];
    if (definition) return importedReference(state, definition) ?? { offset: definition.from };
  }
  return null;
}

type CompilerConfig = {
  compilerOptions?: { baseUrl?: string; paths?: Record<string, string[]> };
};
type ResolverIO = { read: typeof readTextFile; stat: typeof statFiles };
const defaultIO: ResolverIO = { read: readTextFile, stat: statFiles };
const EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs", ".json"];

async function existingModule(base: string, io: ResolverIO): Promise<string | null> {
  const candidates = [base];
  // TypeScript's explicit .js import can point at a .ts source file.
  if (/\.(js|jsx|mjs|cjs)$/.test(base)) {
    const replacement = base.replace(/\.(js|jsx|mjs|cjs)$/, "");
    const sourceExtensions = base.endsWith(".mjs")
      ? [".mts"]
      : base.endsWith(".cjs")
        ? [".cts"]
        : [".ts", ".tsx"];
    candidates.unshift(...sourceExtensions.map((ext) => replacement + ext));
  }
  candidates.push(
    ...EXTENSIONS.map((ext) => base + ext),
    ...EXTENSIONS.map((ext) => joinPath(base, "index" + ext)),
  );
  const entries = await io.stat(candidates);
  return entries.find((entry) => entry.mtimeMs !== null && !entry.isDir)?.path ?? null;
}

/** Read configuration as data; never load or execute project configuration code. */
export async function resolveEditorModule(
  cwd: string,
  path: string,
  module: string,
  io = defaultIO,
): Promise<string | null> {
  if (module.startsWith(".")) return existingModule(joinPath(parentPath(path), module), io);
  // Configs can be nested in a monorepo. Resolve aliases relative to their owner.
  let directory = parentPath(path);
  const seen = new Set<string>();
  while (!seen.has(pathKey(directory))) {
    seen.add(pathKey(directory));
    for (const filename of ["tsconfig.json", "jsconfig.json"]) {
      try {
        const configPath = joinPath(directory, filename);
        const raw = await io.read(configPath);
        if (raw.length > MAX_SOURCE) continue;
        const config = parseJsonc(raw) as CompilerConfig;
        const options = config?.compilerOptions;
        const base = joinPath(directory, options?.baseUrl ?? ".");
        for (const [pattern, targets] of Object.entries(options?.paths ?? {})) {
          if (!Array.isArray(targets)) continue;
          const star = pattern.indexOf("*");
          const matches =
            star < 0
              ? module === pattern
              : module.startsWith(pattern.slice(0, star)) &&
                module.endsWith(pattern.slice(star + 1));
          if (!matches) continue;
          const capture =
            star < 0 ? "" : module.slice(star, module.length - (pattern.length - star - 1));
          for (const target of targets) {
            if (typeof target !== "string") continue;
            const resolved = await existingModule(joinPath(base, target.replace("*", capture)), io);
            if (resolved) return resolved;
          }
        }
        if (options?.baseUrl) {
          const resolved = await existingModule(joinPath(base, module), io);
          if (resolved) return resolved;
        }
      } catch {
        /* Missing or invalid configs are not navigation targets. */
      }
    }
    if (pathKey(directory) === pathKey(cwd)) break;
    directory = parentPath(directory);
  }
  // Local packages can expose a declaration/source entry. No package code runs.
  const packageName = module.startsWith("@")
    ? module.split("/").slice(0, 2).join("/")
    : module.split("/")[0];
  const packageRoot = joinPath(cwd, "node_modules/" + packageName);
  if (module !== packageName) return existingModule(joinPath(cwd, "node_modules/" + module), io);
  try {
    const pkg = JSON.parse(await io.read(joinPath(packageRoot, "package.json")));
    for (const field of ["types", "typings", "module", "main"]) {
      if (typeof pkg[field] !== "string") continue;
      const resolved = await existingModule(joinPath(packageRoot, pkg[field]), io);
      if (resolved) return resolved;
    }
  } catch {
    /* Not an installed package. */
  }
  return existingModule(packageRoot, io);
}

function exportedReference(state: EditorState, name: string): Reference | null {
  let result: Reference | null = null;
  syntaxTree(state).iterate({
    enter(cursor) {
      if (result !== null) return false;
      if (cursor.name !== "ExportDeclaration") return;
      const node = cursor.node;
      const text = state.sliceDoc(node.from, node.to);
      if (name === "default" && /^export\s+default\b/.test(text)) {
        const definition =
          node.getChild("FunctionDeclaration")?.getChild("VariableDefinition") ??
          node.getChild("ClassDeclaration")?.getChild("VariableDefinition");
        const identifier = node.getChild("VariableName");
        result = identifier
          ? referenceAt(state, identifier.to)
          : { offset: definition?.from ?? node.from };
      } else {
        const group = node.getChild("ExportGroup");
        if (group) {
          for (let child = group.firstChild; child; child = child.nextSibling) {
            if (child.name !== "VariableName") continue;
            const alias = child.nextSibling?.name === "as" ? child.nextSibling.nextSibling : null;
            const exported = alias ?? child;
            if (state.sliceDoc(exported.from, exported.to) === name) {
              const module = moduleOf(state, node);
              result = module
                ? { module, name: state.sliceDoc(child.from, child.to) }
                : referenceAt(state, child.to);
            }
            if (alias) child = alias;
          }
        }
        node.cursor().iterate((child) => {
          if (
            /^(VariableDefinition|TypeDefinition)$/.test(child.name) &&
            state.sliceDoc(child.from, child.to) === name
          )
            result = { offset: child.from };
        });
      }
    },
  });
  return result;
}

async function definitionTarget(
  cwd: string,
  path: string,
  reference: { module: string; name?: string },
  seen = new Set<string>(),
): Promise<{ path: string; line: number; column: number } | null> {
  const target = await resolveEditorModule(cwd, path, reference.module);
  if (!target) return null;
  const fallback = { path: target, line: 1, column: 1 };
  if (!reference.name || seen.size >= 8) return fallback;
  const key = pathKey(target) + ":" + reference.name;
  if (seen.has(key)) return fallback;
  seen.add(key);
  const source = await readTextFile(target);
  if (source.length > MAX_SOURCE) return fallback;
  const language = await languageForPath(target);
  const state = EditorState.create({ doc: source, extensions: language ? [language] : [] });
  ensureSyntaxTree(state, state.doc.length, 100);
  const exported = exportedReference(state, reference.name);
  if (exported && "module" in exported)
    return (await definitionTarget(cwd, target, exported, seen)) ?? fallback;
  if (exported && "offset" in exported) {
    const location = state.doc.lineAt(exported.offset);
    return { path: target, line: location.number, column: exported.offset - location.from + 1 };
  }
  return fallback;
}

export function editorNavigation(cwd: string, path: string, openFile: OpenFileFn): Extension {
  let request = 0;
  let disposed = false;
  const navigate = (view: EditorView, position: number): boolean => {
    const reference = referenceAt(view.state, position);
    if (!reference) return false;
    const token = ++request;
    if ("offset" in reference) {
      view.dispatch({ selection: { anchor: reference.offset }, scrollIntoView: true });
      view.focus();
      return true;
    }
    const document = view.state.doc;
    void (async () => {
      const target = await definitionTarget(cwd, path, reference);
      if (!target) return;
      if (token === request && !disposed && view.state.doc === document)
        openFile(target.path, { line: target.line, column: target.column }, { exact: true });
    })().catch(() => {
      /* Unreadable targets leave the current editor intact. */
    });
    return true;
  };
  const linkHint = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet = Decoration.none;
      constructor(readonly view: EditorView) {}
      clear() {
        if (!this.decorations.size) return;
        this.decorations = Decoration.none;
        this.view.dispatch({});
      }
      update(update: { docChanged: boolean }) {
        if (update.docChanged) this.decorations = Decoration.none;
      }
    },
    {
      decorations: (plugin) => plugin.decorations,
      eventHandlers: {
        mousemove(event) {
          const position = this.view.posAtCoords({ x: event.clientX, y: event.clientY });
          if (
            !(event.ctrlKey || event.metaKey) ||
            event.altKey ||
            event.shiftKey ||
            position === null ||
            !referenceAt(this.view.state, position)
          ) {
            this.clear();
          } else {
            const node = syntaxTree(this.view.state).resolveInner(position, -1);
            let unchanged = false;
            this.decorations.between(node.from, node.to, (from, to) => {
              if (from === node.from && to === node.to) unchanged = true;
            });
            if (unchanged) return;
            this.decorations = Decoration.set([
              Decoration.mark({ class: "cm-definition-link" }).range(node.from, node.to),
            ]);
            this.view.dispatch({});
          }
        },
        mouseleave() {
          this.clear();
        },
        keyup(event) {
          if (!(event.ctrlKey || event.metaKey)) this.clear();
        },
        blur() {
          this.clear();
        },
      },
    },
  );
  return [
    ViewPlugin.define(() => ({
      destroy() {
        disposed = true;
        request++;
      },
    })),
    linkHint,
    EditorView.baseTheme({
      "@media (hover: hover) and (pointer: fine)": {
        ".cm-definition-link": {
          cursor: "pointer",
          textDecoration: "underline",
          textUnderlineOffset: "3px",
        },
        ".cm-definition-link:active": { textDecorationThickness: "2px" },
      },
    }),
    EditorView.domEventHandlers({
      mousedown(event, view) {
        if (
          event.button !== 0 ||
          !(event.ctrlKey || event.metaKey) ||
          event.altKey ||
          event.shiftKey
        )
          return false;
        const position = view.posAtCoords({ x: event.clientX, y: event.clientY });
        if (position === null || !navigate(view, position)) return false;
        event.preventDefault();
        return true;
      },
    }),
    keymap.of([{ key: "F12", run: (view) => navigate(view, view.state.selection.main.head) }]),
  ];
}
