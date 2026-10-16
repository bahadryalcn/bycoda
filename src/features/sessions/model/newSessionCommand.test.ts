import { describe, expect, it } from "vitest";
import { isNewSessionCommand } from "./newSessionCommand";

describe("isNewSessionCommand", () => {
  it.each(["/new", " /NEW\n", "\t/new "])("matches standalone %j", (text) => {
    expect(isNewSessionCommand(text)).toBe(true);
  });

  it.each(["/new task", "/newer", "Explain /new", "```\n/new\n```", ""])(
    "preserves ordinary prompt %j",
    (text) => expect(isNewSessionCommand(text)).toBe(false),
  );
});
