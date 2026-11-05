import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { LoadingText } from "./LoadingText";

it("renders a text-only status without a spinner or extra wrapper", () => {
  expect(
    renderToStaticMarkup(
      <LoadingText presentation="text" className="status-note">
        Still loading
      </LoadingText>,
    ),
  ).toBe('<p role="status" class="status-note">Still loading</p>');
});
