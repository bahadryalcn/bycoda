import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { LoadingText } from "./LoadingText";

it("renders a text-only status without a spinner or extra wrapper", () => {
  expect(
    renderToStaticMarkup(
      <LoadingText presentation="text" delay={false} className="status-note">
        Still loading
      </LoadingText>,
    ),
  ).toBe('<p role="status" class="status-note">Still loading</p>');
});

it("renders nothing inline, and an unannounced box when filling, until the delay has passed", () => {
  expect(renderToStaticMarkup(<LoadingText>Loading branches…</LoadingText>)).toBe("");
  const fill = renderToStaticMarkup(<LoadingText layout="fill">Loading…</LoadingText>);
  expect(fill).toContain('aria-hidden="true"');
  expect(fill).not.toContain('role="status"');
});
