import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ActionHost } from "./ActionHost";

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
