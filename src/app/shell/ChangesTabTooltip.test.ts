import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { changesTooltipDetails } from "./ChangesTabTooltip";
import { boundTranslator, setLanguagePreference } from "../../shared/i18n";
import { boundFormat } from "../../shared/i18n/boundFormat";

afterEach(async () => setLanguagePreference("en"));

const render = (details: ReturnType<typeof changesTooltipDetails>) =>
  details.map((line) => renderToStaticMarkup(createElement(Fragment, null, line)));

describe("changesTooltipDetails", () => {
  it("splits the checkout and colours the churn", () => {
    const [scope, stats] = render(
      changesTooltipDetails({
        translate: boundTranslator(),
        format: boundFormat(),
        scope: { title: "main", folder: "upstream", branch: true, session: true },
        files: 543,
        additions: 20563,
        deletions: 8788,
      }),
    );
    expect(scope).toContain("main");
    expect(scope).toContain("upstream");
    expect(scope).toContain("This session");
    expect(stats).toContain("543 files");
    expect(stats).toMatch(/data-side="added">\+20,563/);
    expect(stats).toMatch(/data-side="removed">−8,788/);
  });

  it("shows the project path instead of the checkout and omits empty stats", () => {
    const lines = render(
      changesTooltipDetails({
        translate: boundTranslator(),
        format: boundFormat(),
        scope: { title: "main" },
        path: "G:/repo",
        files: 0,
        additions: 0,
        deletions: 0,
      }),
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("G:/repo");
    expect(lines[0]).not.toContain("main");
  });
});

it("uses the selected app language for file and line counts", async () => {
  await setLanguagePreference("tr");
  const [, stats] = render(
    changesTooltipDetails({
      scope: { title: "main", session: true },
      files: 1234,
      additions: 20563,
      deletions: 8788,
      translate: boundTranslator(),
      format: boundFormat(),
    }),
  );
  expect(stats).toContain("1.234 dosya");
  expect(stats).toContain("+20.563");
  expect(stats).toContain("−8.788");
});
