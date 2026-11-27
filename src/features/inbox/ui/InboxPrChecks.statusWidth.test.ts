// @vitest-environment happy-dom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { getLanguagePreference, setLanguagePreference } from "../../../shared/i18n";
import { InboxPrChecks } from "./InboxPrChecks";

it("lets a long translated check status expand beyond the minimum column width", async () => {
  const previous = getLanguagePreference();
  await setLanguagePreference("de");
  try {
    const rows = document.createElement("div");
    rows.innerHTML = renderToStaticMarkup(
      createElement(InboxPrChecks, {
        onRefresh: () => {},
        view: {
          checks: {
            headOid: "abc",
            checks: [
              {
                name: "ci/build",
                workflow: "Build",
                state: "fail",
                url: null,
                startedAt: null,
                completedAt: null,
              },
            ],
          },
          loading: false,
          refreshing: false,
          stale: false,
          error: null,
          refresh: () => {},
        },
      }),
    );
    const status = rows.querySelector(".min-w-14");
    expect(status?.textContent).toBe("Fehlgeschlagen");
    expect(status?.classList.contains("whitespace-nowrap")).toBe(true);
    expect(status?.classList.contains("w-14")).toBe(false);
    expect(status?.classList.contains("w-24")).toBe(false);
  } finally {
    await setLanguagePreference(previous);
  }
});
