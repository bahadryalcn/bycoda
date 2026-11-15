import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { motionTokens } from "./motion-tokens";

const css = readFileSync("src/styles/index.css", "utf8");
const read = (name: string) => css.match(new RegExp(`^\\s*${name}:\\s*([^;]+);`, "m"))?.[1]?.trim();

it("derives the JS durations from the CSS motion roles", () => {
  expect(read("--motion-duration-fast")).toBe(`${motionTokens.duration.fast * 1000}ms`);
  expect(read("--motion-duration-standard")).toBe(`${motionTokens.duration.standard * 1000}ms`);
});

it("uses the CSS easing curve for standard, enter and exit", () => {
  const curve = `cubic-bezier(${motionTokens.ease.standard.join(", ")})`;
  expect(read("--motion-ease-standard")).toBe(curve);
  expect(motionTokens.ease.enter).toBe(motionTokens.ease.standard);
  expect(motionTokens.ease.exit).toBe(motionTokens.ease.standard);
});
