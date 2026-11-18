import { Window } from "happy-dom";
import { expect, it, vi } from "vitest";
import type { BrowserPage } from "./social-browser";
import { readFacebookMonetization } from "./social-browser-facebook-monetization";

async function fixture(url: string, html: string, run: (page: BrowserPage) => Promise<void>) {
  const window = new Window({ url });
  Object.defineProperty(window.HTMLElement.prototype, "getClientRects", {
    configurable: true,
    value: () => [{}],
  });
  window.document.body.innerHTML = html;
  const page = {
    goto: vi.fn(async () => {}),
    evaluate: vi.fn(async (expression: string) => window.eval(expression)),
    click: vi.fn(),
    fill: vi.fn(),
  } as unknown as BrowserPage;
  try {
    await run(page);
    expect(page.click).not.toHaveBeenCalled();
    expect(page.fill).not.toHaveBeenCalled();
  } finally {
    await window.happyDOM.close();
  }
}
const noWait = async () => {};
const overview = "https://business.facebook.com/latest/monetization?asset_id=123";

it("reads only allowlisted programs on the selected Page", async () => {
  await fixture(
    overview,
    `<main><h1>Monetization</h1>
    <a aria-current="page" href="?asset_id=123">My Page</a>
    <section><h2>Stars</h2><p>Active</p><p>Estimated earnings: $15.00</p></section>
    <section><h2>Bonuses</h2><p>Invited</p><p>Synthetic account number 12345</p></section>
  </main>`,
    async (page) => {
      await expect(readFacebookMonetization(page, "123", noWait)).resolves.toEqual({
        source: "business_suite",
        programs: [
          { program: "stars", status: "active", earnings: "$15.00" },
          { program: "bonuses", status: "invited" },
        ],
      });
    },
  );
});

it.each(["https://business.facebook.com/latest/payouts?asset_id=123", overview])(
  "refuses a payout or mismatched Page view",
  async (url) => {
    await fixture(
      url,
      '<main><h1>Monetization</h1><a aria-current="page" href="?asset_id=987">Other Page</a></main>',
      async (page) => {
        await expect(readFacebookMonetization(page, "123", noWait)).rejects.toMatchObject({
          code: "denied",
        });
      },
    );
  },
);

it("stops at the login handoff", async () => {
  await fixture("https://www.facebook.com/login/?next=private", "", async (page) => {
    await expect(readFacebookMonetization(page, "123", noWait)).rejects.toMatchObject({
      code: "needs_human",
    });
  });
});
