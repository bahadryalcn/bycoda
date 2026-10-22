import { describe, expect, it } from "vitest";
import { isClearSessionCommand, isNewSessionCommand } from "./newSessionCommand";

describe("isClearSessionCommand", () => {
  it.each(["/clear", " /CLEAR\n", "\t/clear "])("matches standalone %j", (text) => {
    expect(isClearSessionCommand(text)).toBe(true);
  });

  it.each(["/clear task", "/clearer", "Explain /clear", "```\n/clear\n```", ""])(
    "preserves ordinary prompt %j",
    (text) => expect(isClearSessionCommand(text)).toBe(false),
  );
});

describe("isNewSessionCommand", () => {
  it.each(["/new", " /NEW\n", "\t/new "])("matches standalone %j", (text) => {
    expect(isNewSessionCommand(text)).toBe(true);
  });

  it.each(["/new task", "/newer", "Explain /new", "```\n/new\n```", ""])(
    "preserves ordinary prompt %j",
    (text) => expect(isNewSessionCommand(text)).toBe(false),
  );
});
