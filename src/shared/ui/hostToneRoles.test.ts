import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ActionHost } from "./ActionHost";
import { ParticleText } from "./ParticleText";

function attrs(html: string): Record<string, string> {
  const open = html.match(/<[a-z]+([^>]*)>/)?.[1] ?? "";
  return Object.fromEntries([...open.matchAll(/([\w-]+)="([^"]*)"/g)].map((m) => [m[1], m[2]]));
}

describe("ActionHost ink and size", () => {
  const host = (props: object) => renderToStaticMarkup(createElement(ActionHost, props, "row"));

  it("adds no type attribute when no role is passed", () => {
    const a = attrs(host({ className: "x" }));
    expect(a).not.toHaveProperty("data-tone");
    expect(a).not.toHaveProperty("data-size");
    expect(a.class).toMatch(/^\S*host\S* x$|x/);
  });

  it("tone sets data-tone on the host and keeps the caller's classes for state rules", () => {
    const a = attrs(host({ tone: "muted", className: "group-hover:text-red-500" }));
    expect(a["data-tone"]).toBe("muted");
    expect(a.class).toContain("group-hover:text-red-500");
  });

  it("takes a computed tone", () => {
    const selected = true;
    expect(attrs(host({ tone: selected ? "primary" : "secondary" }))["data-tone"]).toBe("primary");
  });

  it("size sets data-size", () => {
    expect(attrs(host({ size: "secondary" }))["data-size"]).toBe("secondary");
  });
});

describe("ParticleText roles", () => {
  const render = (props: object) =>
    renderToStaticMarkup(createElement(ParticleText, { text: "Title", ...props }));
  const inner = (html: string) => attrs(html.slice(html.indexOf("<span", 5)));

  it("renders the title span without type attributes by default", () => {
    const a = inner(render({ className: "extra" }));
    expect(a).not.toHaveProperty("data-tone");
    expect(a).not.toHaveProperty("data-size");
    expect(a.class).toContain("min-w-0 flex-1");
    expect(a.class).toContain("extra");
    expect(a.class).not.toContain("line-clamp");
  });

  it("size and tone become Text role attributes", () => {
    const a = inner(render({ size: "secondary", tone: "primary" }));
    expect(a["data-size"]).toBe("secondary");
    expect(a["data-tone"]).toBe("primary");
  });

  it("weight and leading become Text role attributes", () => {
    const a = inner(render({ weight: "medium", leading: "snug" }));
    expect(a["data-weight"]).toBe("medium");
    expect(a["data-leading"]).toBe("snug");
  });

  it("lines clamps the title", () => {
    expect(inner(render({ lines: 1 })).class).toContain("line-clamp-1");
    expect(inner(render({ lines: 2 })).class).toContain("line-clamp-2");
  });
});
