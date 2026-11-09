import { expect, it, vi } from "vitest";

const engine = vi.hoisted(() => ({
  initialize: vi.fn(),
  render: vi.fn(async (id: string) => ({ svg: `<svg id="${id}"/>` })),
}));
vi.mock("mermaid", () => ({ default: engine }));

import { createLazyMermaidPlugin } from "./mermaidPlugin";

it("initializes mermaid once per distinct config, not once per diagram", async () => {
  engine.initialize.mockClear();
  const plugin = createLazyMermaidPlugin({ config: { theme: "dark" } });
  const dark = { startOnLoad: false, securityLevel: "strict", theme: "dark" } as const;
  const light = { ...dark, theme: "default" } as const;

  await plugin.getMermaid(dark).render("a", "graph TD; A-->B");
  await plugin.getMermaid({ ...dark }).render("b", "graph TD; B-->C");
  await plugin.getMermaid({ ...dark }).render("c", "graph TD; C-->D");
  expect(engine.initialize).toHaveBeenCalledTimes(1);

  await plugin.getMermaid(light).render("d", "graph TD; D-->E");
  await plugin.getMermaid({ ...light }).render("e", "graph TD; E-->F");
  expect(engine.initialize).toHaveBeenCalledTimes(2);
  expect(engine.initialize).toHaveBeenLastCalledWith(expect.objectContaining({ theme: "default" }));

  await plugin.getMermaid({ ...dark }).render("f", "graph TD; F-->G");
  expect(engine.initialize).toHaveBeenCalledTimes(3);
  expect(engine.render).toHaveBeenCalledTimes(6);
});
