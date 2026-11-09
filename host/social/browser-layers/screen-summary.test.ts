import { describe, expect, it } from "vitest";
import { isSafeCandidateSelector, summarizeScreen } from "./screen-summary";
import { domPage } from "./test-support";

describe("summarizeScreen", () => {
  const html = `
    <h1>Sign in to continue</h1>
    <form>
      <input name="email" value="owner@example.com" />
      <input type="password" name="pw" value="hunter2" />
      <button>Log in</button>
    </form>
    <div role="dialog"><button type="button">Accept all</button><button type="button" disabled>Later</button></div>
    <div role="alert">Wrong password</div>`;

  it("reports labels and errors but never field values, cookies or query strings", async () => {
    const { page, interactions } = domPage("https://x.example/login?session=abc123", html);
    const { summary } = await summarizeScreen(page);
    const serialized = JSON.stringify(summary);
    expect(summary.url).toBe("https://x.example/login");
    expect(serialized).not.toContain("hunter2");
    expect(serialized).not.toContain("owner@example.com");
    expect(serialized).not.toContain("abc123");
    expect(summary.headings).toContain("Sign in to continue");
    expect(summary.errors).toContain("Wrong password");
    expect(interactions.click).not.toHaveBeenCalled();
    expect(interactions.fill).not.toHaveBeenCalled();
  });

  it("offers only non-submit, enabled buttons as candidates, each with a selector that matches exactly one element", async () => {
    const { page, window } = domPage("https://x.example/", html);
    const { candidates } = await summarizeScreen(page);
    expect(candidates.map((item) => item.label)).toEqual(["Accept all"]);
    const [candidate] = candidates;
    expect(isSafeCandidateSelector(candidate!.selector)).toBe(true);
    expect(window.document.querySelectorAll(candidate!.selector)).toHaveLength(1);
  });

  it("refuses selectors that are not structural paths", () => {
    expect(isSafeCandidateSelector("button")).toBe(false);
    expect(isSafeCandidateSelector("html > body:nth-child(1) > a[href=x]")).toBe(false);
    expect(isSafeCandidateSelector("html > body:nth-child(1) > button:nth-child(2)")).toBe(true);
  });
});
