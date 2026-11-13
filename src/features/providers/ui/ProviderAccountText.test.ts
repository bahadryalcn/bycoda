// @vitest-environment happy-dom
import { act, createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { ProviderAccountSubtitle } from "./ProviderAccountSubtitle";
import { AccountStatusLabel } from "./ProviderAccountUsage";
import { createRoot } from "react-dom/client";
import { accountStatus } from "../model/accountUsage";
import { useLocale } from "../../../shared/i18n";
import { setLanguagePreference } from "../../../shared/i18n";

const identity = { plan: "Pro", email: undefined } as never;

it("ProviderAccountSubtitle adds no type attribute without a role", () => {
  const html = renderToStaticMarkup(
    createElement(ProviderAccountSubtitle, { identity, className: "x" }),
  );
  expect(html).not.toContain("data-");
  expect(html).toContain("inline-flex min-w-0 items-baseline gap-1 x");
});

it("ProviderAccountSubtitle takes size, tone and truncate, also on the fallback", () => {
  for (const props of [{ identity }, { identity: null, fallback: "No account" }]) {
    const html = renderToStaticMarkup(
      createElement(ProviderAccountSubtitle, {
        ...props,
        size: "micro",
        tone: "muted",
        truncate: true,
      }),
    );
    expect(html).toContain('data-size="micro"');
    expect(html).toContain('data-tone="muted"');
    expect(html).toContain('data-truncate="true"');
  }
});

it("wraps complete long plan and fallback identities when account details request it", () => {
  const plan = "Enterprise Research and Development Workspace";
  const html = renderToStaticMarkup(
    createElement(ProviderAccountSubtitle, {
      identity: { plan } as never,
      wrap: true,
      truncate: true,
    }),
  );
  expect(html).toContain(plan);
  expect(html).toContain('data-wrap="anywhere"');
  expect(html).toContain("flex-wrap");
  expect(html).not.toContain('data-truncate="true"');
  expect(
    renderToStaticMarkup(
      createElement(ProviderAccountSubtitle, { identity: null, fallback: plan, wrap: true }),
    ),
  ).toContain('data-wrap="anywhere"');
});

const status = { tone: "ready", label: "Ready", detail: "back in 3m" } as never;

it("uses spacing in wrapping account details without leaving a separator on its own line", () => {
  const identity = { plan: "Enterprise Research", email: "review@northwind.example.com" } as never;
  const wrapped = renderToStaticMarkup(
    createElement(ProviderAccountSubtitle, { identity, wrap: true }),
  );
  const compact = renderToStaticMarkup(createElement(ProviderAccountSubtitle, { identity }));
  expect(wrapped).not.toContain("·");
  expect(compact).toContain("·");
});

it("translates account readiness in Turkish", async () => {
  await setLanguagePreference("tr");
  try {
    expect(renderToStaticMarkup(createElement(AccountStatusLabel, { status }))).toContain("Hazır");
  } finally {
    await setLanguagePreference("en");
  }
});

it("AccountStatusLabel keeps its detail ink by default and takes the new roles", () => {
  const plain = renderToStaticMarkup(createElement(AccountStatusLabel, { status }));
  expect(plain).toContain('data-tone="muted"');
  expect(plain).not.toContain('data-size="micro"');
  const roled = renderToStaticMarkup(
    createElement(AccountStatusLabel, { status, size: "micro", tone: "danger", truncate: true }),
  );
  expect(roled).toContain('data-size="micro"');
  expect(roled).toContain('data-tone="danger"');
  expect(roled).toContain('data-truncate="true"');
});

it("updates derived account details after language changes without remounting", async () => {
  const now = 1000;
  const Status = ({ percent }: { percent: number }) => {
    useLocale();
    return createElement(AccountStatusLabel, {
      status: accountStatus(
        {
          provider: "claude",
          status: "ok",
          error: null,
          updatedAt: now,
          resetCredits: null,
          session: { usedPercent: percent, resetsAt: now + 7200000, windowMinutes: 300 },
          weekly: null,
          monthly: null,
        },
        now,
      ),
    });
  };
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement("div");
  const root = createRoot(host);
  try {
    await act(async () => root.render(createElement(Status, { percent: 84 })));
    expect(host.textContent).toContain("16% left");
    await act(async () => {
      await setLanguagePreference("tr");
    });
    expect(host.textContent).toContain("%16 kaldı");
    expect(host.textContent).not.toContain("left");
    await act(async () => root.render(createElement(Status, { percent: 100 })));
    expect(host.textContent).toContain("sonra sıfırlanır");
    expect(host.textContent).not.toContain("back in");
  } finally {
    await act(async () => {
      root.unmount();
      await setLanguagePreference("en");
    });
  }
});
