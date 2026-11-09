// @vitest-environment happy-dom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { RemoteSessionContent, RemoteSessionFrame } from "./RemoteSessionFrame";

it("keeps delegated notices and controls visible without filling the parent pane", () => {
  const html = renderToStaticMarkup(
    createElement(RemoteSessionFrame, {
      compact: true,
      children: [
        createElement("div", { role: "alert", key: "error" }, "Connection failed"),
        createElement(RemoteSessionContent, {
          compact: true,
          key: "content",
          children: createElement("button", null, "Retry"),
        }),
      ],
    }),
  );
  expect(html).toContain("Connection failed");
  expect(html).toContain("Retry");
  expect(html).not.toContain("h-full");
  expect(html).not.toContain("flex-1");
});

it("retains the full session layout by default", () => {
  const html = renderToStaticMarkup(
    createElement(RemoteSessionFrame, {
      children: createElement(RemoteSessionContent, { children: "Chat" }),
    }),
  );
  expect(html).toContain("h-full");
  expect(html).toContain("flex-1");
});
