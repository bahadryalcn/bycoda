import { resolveWorkspaceFileReference } from "../../../shared/lib/paths";

type MarkdownNode = {
  type: string;
  url?: string;
  value?: string;
  children?: MarkdownNode[];
};

// Parse only complete citations in prose. Code examples and incomplete streaming
// fragments stay literal; generated links use the same path checks as Markdown.
function fileCitationNodes(value: string, cwd?: string): MarkdownNode[] {
  const nodes: MarkdownNode[] = [];
  const citations =
    /:codex-file-citation\{((?:[^{}"']|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')*)\}|\uE200visualize\uE202(\{[^\uE201]*\})\uE201/g;
  let offset = 0;
  for (const match of value.matchAll(citations)) {
    const attributes: Record<string, string> = {};
    let rest = "";
    if (match[2]) {
      try {
        const payload: unknown = JSON.parse(match[2]);
        if (
          !payload ||
          typeof payload !== "object" ||
          !("path" in payload) ||
          typeof payload.path !== "string"
        )
          continue;
        attributes.path = payload.path;
        if (!/\.html?$/i.test(attributes.path)) continue;
      } catch {
        continue;
      }
    } else
      rest = match[1].replace(
        /([\w-]+)\s*=\s*("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')/g,
        (_, key: string, quoted: string) => {
          // Markdown already decoded escapes. Do not interpret native Windows
          // separators such as \t and \r as JSON control characters.
          attributes[key] = quoted.slice(1, -1);
          return "";
        },
      );
    const path = attributes.path;
    if (rest.trim() || !path || !resolveWorkspaceFileReference(path, cwd)) continue;
    if (match.index > offset) nodes.push({ type: "text", value: value.slice(offset, match.index) });
    const label = path.replace(/\\/g, "/").split("/").pop() || path;
    nodes.push({
      type: "link",
      url: path,
      children: [{ type: "text", value: label }],
    });
    offset = match.index + match[0].length;
  }
  if (offset < value.length) nodes.push({ type: "text", value: value.slice(offset) });
  return nodes;
}

/** Normalize local file links before URL sanitizing; keep all other URLs intact. */
export function remarkWorkspaceFileLinks({ cwd }: { cwd?: string }) {
  function visit(node: MarkdownNode) {
    if (node.type !== "link" && node.type !== "linkReference" && node.children) {
      node.children = node.children.flatMap((child) => {
        if (child.type !== "text" || !child.value) return [child];
        // Standalone path lines are common in agent replies, including Windows
        // paths containing spaces. Leave ordinary prose and web URLs untouched.
        return fileCitationNodes(child.value, cwd).flatMap((part) => {
          if (part.type !== "text") return [part];
          return (part.value ?? "").split(/(\n)/).map((value): MarkdownNode => {
            const candidate = value.trim();
            if (
              /^(?:[A-Za-z]:[\\/]|~[\\/]|%[A-Za-z_][A-Za-z0-9_]*(?:\(x86\))?%[\\/]|\/(?!\/))/i.test(
                candidate,
              ) &&
              resolveWorkspaceFileReference(candidate, cwd)
            ) {
              return {
                type: "link",
                url: candidate,
                children: [{ type: "text", value }],
              };
            }
            return { type: "text", value };
          });
        });
      });
    }
    if ((node.type === "link" || node.type === "definition") && node.url) {
      const file = resolveWorkspaceFileReference(node.url, cwd);
      if (file) {
        const remoteRoot = cwd ? /^remote:\/\/[^/]+\//.exec(cwd)?.[0] : undefined;
        const localPath =
          remoteRoot && file.path.startsWith(remoteRoot)
            ? file.path.slice(remoteRoot.length)
            : file.path;
        const path = localPath.startsWith("/") ? localPath : `/${localPath}`;
        let href = path.split("/").map(encodeURIComponent).join("/");
        // Preserve a UNC path as a path, not a protocol-relative web origin.
        if (href.startsWith("//")) href = `/%2F${href.slice(2)}`;
        const target = file.navigation;
        node.url =
          href + (target ? `:${target.line}${target.column ? `:${target.column}` : ""}` : "");
      }
    }
    if (node.type !== "link" && node.type !== "linkReference") {
      for (const child of node.children ?? []) visit(child);
    }
  }
  return visit;
}
