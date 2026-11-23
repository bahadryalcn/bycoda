import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

const CSS = readFileSync("src/features/crews/ui/MemberAvatar.css", "utf8");
const TSX = readFileSync("src/features/crews/ui/MemberAvatar.tsx", "utf8");

it("does not inject a style element or keyframes into each avatar", () => {
  expect(TSX).not.toContain("<style");
  expect(TSX).not.toContain("@keyframes");
  expect(TSX).toContain('import "./MemberAvatar.css"');
});

it("defines the blink keyframes once, scoped to the eye class", () => {
  expect(CSS.match(/@keyframes member-avatar-blink/g)).toHaveLength(1);
  expect(CSS).toMatch(/\.member-avatar-eye\s*\{[^}]*animation: member-avatar-blink/);
});

it("stops the blink clock with decorative motion off or the window hidden", () => {
  expect(CSS).toMatch(
    /html:is\(\[data-decorative-motion="off"\], \[data-window-visible="off"\]\) \.member-avatar-eye\s*\{\s*animation: none;/,
  );
});

it("keeps the reduced-motion request for the eyes", () => {
  expect(CSS).toMatch(
    /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.member-avatar-eye\s*\{\s*animation: none;/,
  );
});

it("keeps the activity marker on eyes only when active", () => {
  expect(TSX).toContain(
    'className={active && isAvatarEye(rect) ? "member-avatar-eye" : undefined}',
  );
});
