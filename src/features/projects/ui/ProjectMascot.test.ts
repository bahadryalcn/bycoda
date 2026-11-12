import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ProjectMascot } from "./ProjectMascot";

describe("code-art project icon", () => {
  it("renders actual text with semantic metadata and its own color", () => {
    const html = renderToStaticMarkup(
      createElement(ProjectMascot, { project: "web", name: "weave" }),
    );
    expect(html).toContain('data-project-icon-label="Web / Frontend"');
    expect(html).toContain("<text");
    expect(html).toContain("clipPath");
    expect(html).toContain("#60a5fa");
    expect(html).not.toContain("bycoda-sigil-active");
  });
  it("keeps project color overrides and separate SVG clip references", () => {
    const html = renderToStaticMarkup(
      createElement(
        "div",
        null,
        createElement(ProjectMascot, { project: "one", color: "#123456" }),
        createElement(ProjectMascot, { project: "two", color: "#654321" }),
      ),
    );
    expect(html).toContain("#123456");
    expect(html).toContain("#654321");
    const ids = [...html.matchAll(/<clipPath id="([^"]+)"/g)].map((match) => match[1]);
    expect(new Set(ids).size).toBe(2);
    for (const id of ids) expect(html).toContain(`url(#${id})`);
  });
  it("tone gives the symbol a shared ink instead of its palette; color still wins", () => {
    const toned = renderToStaticMarkup(
      createElement(ProjectMascot, { project: "web", name: "weave", tone: "muted" }),
    );
    expect(toned).toContain('data-tone="muted"');
    expect(toned).not.toContain("#60a5fa");
    expect(toned).toContain("--sigil-hi:currentColor");
    const colored = renderToStaticMarkup(
      createElement(ProjectMascot, { project: "web", tone: "muted", color: "#123456" }),
    );
    expect(colored).not.toContain("data-tone");
    expect(colored).toContain("#123456");
  });
});
