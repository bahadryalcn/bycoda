// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { TokenAmountField } from "./TokenAmountField";

vi.mock("../../../../shared/ui/Popover", () => ({
  popupListClassName: "",
  Popover: ({ children }: { children: React.ReactNode }) => createElement("div", null, children),
}));

function type(input: HTMLInputElement, text: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, text);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

async function mount(props: Partial<Parameters<typeof TokenAmountField>[0]> = {}) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const onChange = vi.fn();
  const onInvalidChange = vi.fn();
  await act(async () =>
    root.render(
      createElement(TokenAmountField, {
        label: "Daily tokens",
        value: "",
        onChange,
        onInvalidChange,
        ...props,
      }),
    ),
  );
  const input = container.querySelector("input")!;
  return {
    input,
    onChange,
    onInvalidChange,
    unmount: async () => {
      await act(async () => root.unmount());
      container.remove();
    },
  };
}

it("keeps typed text while focused and commits only on blur", async () => {
  const field = await mount();
  await act(async () => field.input.focus());
  await act(async () => type(field.input, "0"));
  expect(field.input.value).toBe("0");
  await act(async () => type(field.input, "0.5M"));
  expect(field.input.value).toBe("0.5M");
  expect(field.onChange).not.toHaveBeenCalled();
  await act(async () => field.input.blur());
  expect(field.onChange).toHaveBeenCalledWith("500000");
  await field.unmount();
});

it("reports an unparsable amount and clears the report when it unmounts", async () => {
  const field = await mount({ value: "1000000" });
  await act(async () => field.input.focus());
  await act(async () => type(field.input, "abc"));
  await act(async () => field.input.blur());
  expect(field.onChange).not.toHaveBeenCalled();
  expect(field.onInvalidChange).toHaveBeenLastCalledWith(true);
  await field.unmount();
  expect(field.onInvalidChange).toHaveBeenLastCalledWith(false);
});
