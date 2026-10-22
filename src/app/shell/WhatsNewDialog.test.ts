import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import packageJson from "../../../package.json?raw";

const identity = vi.hoisted(() => ({
  repositoryUrl: null,
  releaseNotesUrl: null as string | null,
}));
vi.mock("../../shared/lib/productIdentity", () => ({
  PRODUCT_IDENTITY: identity,
}));

vi.mock("../../shared/lib/appName", () => ({ appName: () => "Test Product Native" }));
vi.mock("../../shared/ui/Modal", () => ({
  Modal: ({ description }: { description: string }) => createElement("section", null, description),
}));

import { WhatsNewBody, WhatsNewDialog } from "./WhatsNewDialog";

describe("WhatsNewBody", () => {
  beforeEach(() => {
    identity.releaseNotesUrl = null;
  });

  it("shows current notes with no GitHub link while its URL is unset", () => {
    const markup = renderToStaticMarkup(createElement(WhatsNewBody, { version: "0.5.56" }));
    expect(markup).toContain("Workspace and terminal");
    expect(markup).not.toContain("have not been added yet");
    expect(markup).not.toContain("View release on GitHub");
  });

  it("renders the configured GitHub release link", () => {
    identity.releaseNotesUrl = "https://github.com/example/bycoda/releases/tag/v0.5.56";
    const markup = renderToStaticMarkup(createElement(WhatsNewBody, { version: "0.5.56" }));
    expect(markup).toContain(`href="${identity.releaseNotesUrl}"`);
    expect(markup).toContain("View release on GitHub");
  });

  it("explains missing notes inside the release view", () => {
    const markup = renderToStaticMarkup(createElement(WhatsNewBody, { version: "99.0.0" }));
    expect(markup).toContain("Release notes for this version have not been added yet.");
  });

  it("renders the version notes without the changelog heading", () => {
    const { version } = JSON.parse(packageJson) as { version: string };
    const markup = renderToStaticMarkup(createElement(WhatsNewBody, { version }));

    expect(markup).toContain("whats-new-md");
    expect(markup).toContain(`What&#x27;s new in Test Product Native ${version}`);
    expect(markup).not.toContain(`## [${version}]`);
  });

  it("uses the runtime product name in release dialog chrome", () => {
    const markup = renderToStaticMarkup(
      createElement(WhatsNewDialog, { version: "99.0.0", onClose: vi.fn() }),
    );
    expect(markup).toContain("Test Product Native 99.0.0");
    expect(markup).not.toContain("Bycoda");
  });
});
