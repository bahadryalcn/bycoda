import { describe, expect, it } from "vitest";
import { recordedActionLabel } from "./recordedActionLabels";

describe("recordedActionLabel", () => {
  it("labels known tool actions from their metadata", () => {
    expect(recordedActionLabel("tasks.get")).toBe("Get task");
    expect(recordedActionLabel("notes.list")).toBe("List notes");
  });

  it("never reverses or guesses from an unknown id; shows the generic label instead", () => {
    expect(recordedActionLabel("list.all")).toBe("Recorded action");
    expect(recordedActionLabel("notes.search")).toBe("Recorded action");
    expect(recordedActionLabel("constructor")).toBe("Recorded action");
  });
});
