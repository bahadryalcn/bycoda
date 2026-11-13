import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { AgentMarkdown } from "./AgentMarkdown";

vi.mock("../../inbox/ui/InboxMedia", () => ({
  InboxMedia: ({ src, alt }: { src: string; alt?: string }) =>
    createElement("span", { "data-attachment": src }, alt),
}));

it.each([
  "https://acme.atlassian.net/rest/api/3/attachment/content/12?redirect=false",
  "https://github.com/user-attachments/assets/1234",
  "https://uploads.linear.app/org/shot.png",
  "https://gitlab.example/team/repo/uploads/abc/shot.png",
  "https://dev.azure.com/acme/project/_apis/wit/attachments/abc",
])("routes provider attachment links into the shared preview: %s", (url) => {
  const html = renderToStaticMarkup(
    createElement(AgentMarkdown, { text: `[shot.png](<${url}>)`, allowRemoteMedia: true }),
  );
  expect(html).toContain(`data-attachment="${url}"`);
});

it("keeps relative GitLab image embeds and resolves their project", () => {
  const html = renderToStaticMarkup(
    createElement(AgentMarkdown, {
      text: "![shot.png](/uploads/abc/shot.png)",
      allowRemoteMedia: true,
      remoteMediaBaseUrl: "https://gitlab.example/team/repo/-/issues/1",
    }),
  );
  expect(html).toContain('data-attachment="https://gitlab.example/team/repo/uploads/abc/shot.png"');
});

it("does not enable provider downloads in ordinary agent markdown", () => {
  const html = renderToStaticMarkup(
    createElement(AgentMarkdown, {
      text: "[shot](https://github.com/user-attachments/assets/1234)",
    }),
  );
  expect(html).not.toContain("data-attachment");
});

it.each([
  "https://acme.atlassian.net/rest/api/3/attachment/content/12?redirect=false",
  "https://github.com/user-attachments/assets/1234",
  "https://uploads.linear.app/org/shot.png",
  "https://gitlab.example/team/repo/uploads/abc/shot.png",
  "https://dev.azure.com/acme/project/_apis/wit/attachments/abc",
])("keeps absolute provider image embeds available for the authenticated preview: %s", (url) => {
  const html = renderToStaticMarkup(
    createElement(AgentMarkdown, { text: `![shot.png](<${url}>)`, allowRemoteMedia: true }),
  );
  expect(html).toContain(`data-attachment="${url}"`);
});
