import { describe, expect, it } from "vitest";
import { resolveTaskTitle } from "./taskTitle";

describe("resolveTaskTitle", () => {
  it("trims explicit titles, rejects overlong explicit titles and never falls back for them", () => {
    expect(resolveTaskTitle("  A task  ", "Other title")).toBe("A task");
    expect(resolveTaskTitle("a".repeat(201), "Other title")).toBe("");
  });

  it("uses the first readable line and leaves paths, mentions and inline code intact", () => {
    const prompt =
      "/review\n[File: main.ts; ref=attachment-1]\n\n# Fix **the** [parser](https://example.com) in `$run` at /src/main.ts @alice\nAnother line";
    expect(resolveTaskTitle("", prompt)).toBe("Fix the parser in $run at /src/main.ts @alice");
  });

  it("keeps references and Markdown marks inside literal code", () => {
    expect(resolveTaskTitle("", "```text\n/review [File: main.ts; ref=id] **literal**\n```")).toBe(
      "/review [File: main.ts; ref=id] **literal**",
    );
    expect(resolveTaskTitle("", "    /review [File: main.ts; ref=id]")).toBe(
      "/review [File: main.ts; ref=id]",
    );
  });

  it("derives from a structured task objective without leaking the JSON envelope", () => {
    expect(
      resolveTaskTitle(
        "",
        JSON.stringify({
          schema: "bycoda.task.v1",
          objective: "## Fix the preview",
          deliverables: [],
          acceptance: [],
          constraints: [],
          verification: [],
        }),
      ),
    ).toBe("Fix the preview");
  });

  it("returns empty for tokens, blank lines and formatting alone", () => {
    expect(resolveTaskTitle(" ", "/review\n---\n[File: main.ts; ref=id]\n\u200B")).toBe("");
  });

  it("caps only at complete graphemes within the Host's UTF-16 limit", () => {
    expect(resolveTaskTitle("", "a".repeat(199) + "e\u0301")).toBe("a".repeat(199));
    expect(resolveTaskTitle("", "a".repeat(198) + "😀z")).toBe("a".repeat(198) + "😀");
  });
});
