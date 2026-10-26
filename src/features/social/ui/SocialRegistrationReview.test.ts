// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { SocialClient } from "../model/socialClient";
import type {
  SocialBrowserWorkflow,
  SocialRegistrationReview as Review,
} from "../model/socialBrowser";
import { SocialRegistrationReview } from "./SocialRegistrationReview";

let element: HTMLDivElement, root: Root;
const workflow: SocialBrowserWorkflow = {
  id: "workflow",
  accountId: "page",
  platform: "linkedin",
  intent: "signup",
  status: "awaiting_owner",
  outcome: "unverified",
  createdAt: 1,
  updatedAt: 2,
  expiresAt: Date.now() + 1000000,
};
const observed: Review = {
  reviewId: "review",
  workflowId: "workflow",
  accountId: "page",
  updatedAt: 2,
  expiresAt: Date.now() + 100000,
  platform: "linkedin",
  administrator: { id: "web:linkedin:in:owner", name: "Fixture Owner" },
  fields: {
    displayName: "Bycoda",
    username: "bycoda",
    industry: "Software Development",
    organizationSize: "0–1",
    organizationType: "Self-employed",
  },
  details: [
    { label: "Page name", value: "Bycoda" },
    { label: "Industry", value: "Software Development" },
  ],
  terms: {
    text: "I accept the LinkedIn Page Terms.",
    url: "https://www.linkedin.com/legal/l/page-terms",
  },
  submitLabel: "Create Page",
};
const review = vi.fn(),
  submit = vi.fn(),
  reconcile = vi.fn(),
  tokenConnect = vi.fn(),
  refresh = vi.fn();
const client = {
  browserRegistrationReview: review,
  browserRegistrationSubmit: submit,
  browserRegistrationReconcile: reconcile,
  tokenConnect,
} as unknown as SocialClient;
const render = async (record = workflow) =>
  act(async () =>
    root.render(
      createElement(SocialRegistrationReview, {
        accountId: "page",
        workflow: record,
        client,
        onRefresh: refresh,
      }),
    ),
  );
const button = (name: string) =>
  Array.from(element.querySelectorAll("button")).find((e) => e.textContent === name)!;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  element = document.createElement("div");
  document.body.append(element);
  root = createRoot(element);
  review.mockReset().mockResolvedValue(observed);
  submit.mockReset().mockResolvedValue(undefined);
  reconcile.mockReset().mockResolvedValue(undefined);
  tokenConnect.mockReset().mockResolvedValue(undefined);
  refresh.mockReset().mockResolvedValue(undefined);
});
afterEach(async () => {
  await act(async () => root.unmount());
  element.remove();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("shows observed administrator/details/terms before explicit consent and exact reviewed submission", async () => {
  await render();
  expect(review).not.toHaveBeenCalled();
  expect(submit).not.toHaveBeenCalled();
  await act(async () => button("Review final Page creation").click());
  expect(review).toHaveBeenCalledWith("page", "workflow", 2);
  expect(element.textContent).toContain("Fixture Owner");
  expect(element.textContent).toContain("Bycoda");
  expect(element.querySelector("a")?.href).toBe(observed.terms.url);
  expect(button("Create Page").disabled).toBe(true);
  await act(async () => element.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
  expect(button("Create Page").disabled).toBe(false);
  await act(async () => button("Create Page").click());
  expect(submit).toHaveBeenCalledExactlyOnceWith("page", "workflow", 2, "review");
  expect(refresh).toHaveBeenCalledOnce();
});
it("invalidates observed consent when workflow revision changes", async () => {
  await render();
  await act(async () => button("Review final Page creation").click());
  await act(async () => element.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
  await render({ ...workflow, updatedAt: 3 });
  expect(button("Create Page")).toBeUndefined();
  expect(submit).not.toHaveBeenCalled();
});
it("holds unknown submissions and exposes no automatic retry control", async () => {
  await render({
    ...workflow,
    registrationSubmission: { id: "attempt", state: "unknown", attemptedAt: 3 },
  });
  expect(element.textContent).toContain("automatic resubmission is held");
  expect(element.querySelectorAll("button")).toHaveLength(0);
  expect(review).not.toHaveBeenCalled();
  expect(submit).not.toHaveBeenCalled();
});
it("does not display a delayed review after its workflow revision changed", async () => {
  let resolve!: (value: Review) => void;
  review.mockImplementationOnce(
    () =>
      new Promise<Review>((done) => {
        resolve = done;
      }),
  );
  await render();
  await act(async () => button("Review final Page creation").click());
  await render({ ...workflow, updatedAt: 3 });
  await act(async () => resolve(observed));
  expect(element.textContent).not.toContain("Fixture Owner");
  expect(button("Create Page")).toBeUndefined();
});

it("does not submit an expired review even after explicit consent", async () => {
  review.mockResolvedValue({ ...observed, expiresAt: Date.now() - 1 });
  await render();
  await act(async () => button("Review final Page creation").click());
  await act(async () => element.querySelector<HTMLInputElement>('input[type="checkbox"]')?.click());
  const create = button("Create Page");
  expect(!create || create.disabled).toBe(true);
  await act(async () => create?.click());
  expect(submit).not.toHaveBeenCalled();
});
it("invalidates an idle review when its deadline passes and prevents the approved final action", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-26T12:00:00Z"));
  review.mockResolvedValue({ ...observed, expiresAt: Date.now() + 1000 });
  await render();
  await act(async () => button("Review final Page creation").click());
  await act(async () => element.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
  const create = button("Create Page");
  expect(create.disabled).toBe(false);
  await act(async () => vi.advanceTimersByTime(1001));
  expect(button("Create Page")).toBeUndefined();
  await act(async () => create.click());
  expect(submit).not.toHaveBeenCalled();
});

it("prevents duplicate submission while its exact attempt is pending", async () => {
  let resolve!: () => void;
  submit.mockImplementationOnce(
    () =>
      new Promise<void>((done) => {
        resolve = done;
      }),
  );
  await render();
  await act(async () => button("Review final Page creation").click());
  await act(async () => element.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
  const create = button("Create Page");
  await act(async () => {
    create.click();
    create.click();
  });
  expect(submit).toHaveBeenCalledTimes(1);
  expect(button("Create Page")).toBeUndefined();
  await act(async () => resolve());
  expect(refresh).toHaveBeenCalledTimes(1);
});

it("rejects a returned review for a different account before showing its terms", async () => {
  review.mockResolvedValue({ ...observed, accountId: "different-page" });
  await render();
  await act(async () => button("Review final Page creation").click());
  expect(element.querySelector('[role="alert"]')).toBeTruthy();
  expect(element.textContent).not.toContain("Fixture Owner");
  expect(element.querySelector('input[type="checkbox"]')).toBeNull();
  expect(submit).not.toHaveBeenCalled();
});

const unresolved = (state: "unknown" | "attempting" = "unknown"): SocialBrowserWorkflow => ({
  ...workflow,
  status: state === "attempting" ? "interrupted" : "awaiting_owner",
  registrationSubmission: {
    id: "held-attempt",
    state,
    attemptedAt: 3,
    expectedResourceDigest: "a".repeat(64),
  },
});
async function existingPage(value: string) {
  const input = element.querySelector<HTMLInputElement>('input[inputmode="numeric"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
it.each(["unknown", "attempting"] as const)(
  "offers only read-only recovery of a retained %s Page attempt and keeps connection separate",
  async (state) => {
    await render(unresolved(state));
    expect(element.textContent).toContain("automatic resubmission is held");
    expect(button("Review final Page creation")).toBeUndefined();
    expect(element.querySelector('input[type="checkbox"]')).toBeNull();
    expect(element.querySelector("a")).toBeNull();
    expect(button("Verify existing Page").disabled).toBe(true);
    await existingPage("145372363");
    await act(async () => button("Verify existing Page").click());
    expect(reconcile).toHaveBeenCalledExactlyOnceWith("page", "workflow", 2, "145372363");
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(review).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
    expect(tokenConnect).not.toHaveBeenCalled();
    // A read invocation does not optimistically turn a held attempt into a created resource.
    expect(element.querySelector("a")).toBeNull();
    await render({
      ...workflow,
      updatedAt: 3,
      registrationSubmission: {
        ...unresolved(state).registrationSubmission!,
        state: "created",
        resourceId: "145372363",
        resourceUrl: "https://www.linkedin.com/company/145372363/",
      },
    });
    expect(element.querySelector("a")?.href).toBe("https://www.linkedin.com/company/145372363/");
    expect(element.textContent).toContain("Connect the account separately");
    expect(element.querySelectorAll("button")).toHaveLength(0);
    expect(tokenConnect).not.toHaveBeenCalled();
  },
);
it("blocks malformed, negative, leading-zero and nonnumeric resource identifiers before a recovery call", async () => {
  await render(unresolved());
  for (const value of [
    "",
    "0",
    "00145372363",
    "-145372363",
    "1e9",
    "1.5",
    "145372363/admin",
    "https://www.linkedin.com/company/145372363/",
    "1".repeat(21),
    "1".repeat(26),
  ]) {
    await existingPage(value);
    expect(button("Verify existing Page").disabled).toBe(true);
    await act(async () => button("Verify existing Page").click());
  }
  expect(reconcile).not.toHaveBeenCalled();
  expect(review).not.toHaveBeenCalled();
  expect(submit).not.toHaveBeenCalled();
});
it("prevents duplicate recovery while its exact read is pending", async () => {
  let done!: () => void;
  reconcile.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        done = resolve;
      }),
  );
  await render(unresolved());
  await existingPage("145372363");
  const verify = button("Verify existing Page");
  await act(async () => {
    verify.click();
    verify.click();
  });
  expect(reconcile).toHaveBeenCalledTimes(1);
  expect(element.querySelector<HTMLInputElement>('input[inputmode="numeric"]')!.disabled).toBe(
    true,
  );
  expect(refresh).not.toHaveBeenCalled();
  expect(submit).not.toHaveBeenCalled();
  await act(async () => done());
  expect(refresh).toHaveBeenCalledTimes(1);
});
it("keeps a mismatched resource held after Host rejection and exposes no Create or terms action", async () => {
  reconcile.mockRejectedValueOnce(new Error("Resource digest or administrator mismatch"));
  await render(unresolved());
  await existingPage("999999999");
  await act(async () => button("Verify existing Page").click());
  expect(element.querySelector('[role="alert"]')).not.toBeNull();
  expect(element.textContent).toContain("automatic resubmission is held");
  expect(element.querySelector("a")).toBeNull();
  expect(element.querySelector('input[type="checkbox"]')).toBeNull();
  expect(button("Review final Page creation")).toBeUndefined();
  expect(button("Create Page")).toBeUndefined();
  expect(refresh).toHaveBeenCalledTimes(1);
  expect(review).not.toHaveBeenCalled();
  expect(submit).not.toHaveBeenCalled();
});
it("clears a prepared recovery identifier when its workflow revision changes", async () => {
  await render(unresolved());
  await existingPage("145372363");
  expect(button("Verify existing Page").disabled).toBe(false);
  await render({ ...unresolved(), updatedAt: 4 });
  expect(element.querySelector<HTMLInputElement>('input[inputmode="numeric"]')!.value).toBe("");
  expect(button("Verify existing Page").disabled).toBe(true);
  expect(reconcile).not.toHaveBeenCalled();
});
it("does not offer recovery while an original submission is still actively attempting", async () => {
  await render({ ...unresolved("attempting"), status: "awaiting_owner" });
  expect(button("Verify existing Page")).toBeUndefined();
  expect(button("Review final Page creation")).toBeUndefined();
  expect(element.querySelectorAll("button,input")).toHaveLength(0);
  expect(reconcile).not.toHaveBeenCalled();
  expect(submit).not.toHaveBeenCalled();
});
