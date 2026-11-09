import { expect, it } from "vitest";
import { MatchText, matchPositions, MAX_MATCH_POSITIONS } from "./MatchText";

it("bounds dense long-line highlighting while retaining every original character", () => {
  const text = "a ".repeat(32_768);
  const positions = matchPositions(text, "a");
  expect(positions).toHaveLength(MAX_MATCH_POSITIONS);
  const spans = MatchText({ text, positions, active: true }) as { props: { children: string } }[];
  expect(spans.length).toBeLessThanOrEqual(257);
  expect(spans.map((span) => span.props.children).join("")).toBe(text);
});

it("preserves exact fuzzy positions, Unicode and inactive text", () => {
  const text = "a😀béd";
  const spans = MatchText({ text, positions: [5, 0, 0, -1, 999], active: true }) as {
    props: { children: string; className?: string };
  }[];
  expect(spans.map((span) => span.props.children).join("")).toBe(text);
  expect(spans.filter((span) => span.props.className).map((span) => span.props.children)).toEqual([
    "a",
    "d",
  ]);
  expect(MatchText({ text, positions: [], active: false })).toBe(text);
});
