import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/features/onboarding/ui/OnboardingDialog.tsx", "utf8");

describe("onboarding projects footer (#1196)", () => {
  it("keeps Skip import rendered instead of mounting it only when something is selected", () => {
    expect(source).not.toMatch(/!summary && selected\.size/);
  });

  it("never turns the import button into Finish setup while nothing is selected", () => {
    expect(source).not.toMatch(/summary \|\| !selected\.size/);
    expect(source).toMatch(/disabled=\{busy \|\| \(!summary && !selected\.size\)\}/);
  });

  it("reserves the Finish and Import labels so the primary button width stays stable", () => {
    expect(source).toMatch(/reserveLabels=\{\[/);
  });

  it("uses full translated templates instead of trailing-colon fragments and hand-built counts", () => {
    expect(source).not.toMatch(/t\("[^"]*: "\)/);
    expect(source).not.toMatch(/\$\{progress\?\.(done|total)/);
  });

  it("shows the import status once, as the live text", () => {
    expect(source.match(/t\("Importing conversations: \{p0\} \/ \{p1\}"/g)).toHaveLength(1);
    expect(source).not.toMatch(/label=\{t\("Importing conversations/);
  });
});
