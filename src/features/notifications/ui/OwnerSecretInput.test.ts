// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { OwnerSecretForm } from "./OwnerSecretInput";
import {
  MAX_OWNER_SECRET_LENGTH,
  submitOwnerSecretInput,
  type OwnerSecretInput,
} from "../model/ownerSecretInputs";

vi.mock("../model/ownerSecretInputs", async (original) => ({
  ...(await original<typeof import("../model/ownerSecretInputs")>()),
  submitOwnerSecretInput: vi.fn(() => true),
}));
const request: OwnerSecretInput = {
  id: "synthetic",
  title: "Secret request",
  message: "Synthetic request",
  fieldLabel: "Fixture credential",
  confirmLabel: "Save secret",
  cancelLabel: "Cancel",
  deadline: Date.now() + 60000,
};
let root: Root;
let container: HTMLDivElement;
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.mocked(submitOwnerSecretInput).mockClear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(createElement(OwnerSecretForm, { request })));
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
async function enter(value: string) {
  const input = container.querySelector("input")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  return input;
}
const submit = async () => {
  await act(async () => {
    container
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
};

it("preserves an oversized in-memory draft and explains the limit without submitting or truncating it", async () => {
  const value = "x".repeat(MAX_OWNER_SECRET_LENGTH + 1);
  const input = await enter(value);
  await submit();
  expect(submitOwnerSecretInput).not.toHaveBeenCalled();
  expect(input.value).toBe(value);
  expect(input.type).toBe("password");
  expect(input.getAttribute("aria-invalid")).toBe("true");
  expect(container.textContent).toContain("Secret must be 8192 characters or fewer.");
});

it("accepts a corrected draft with exact whitespace and clears it after submission", async () => {
  await enter("x".repeat(MAX_OWNER_SECRET_LENGTH + 1));
  await submit();
  const input = await enter(" synthetic value ");
  await submit();
  expect(submitOwnerSecretInput).toHaveBeenCalledOnce();
  expect(submitOwnerSecretInput).toHaveBeenCalledWith("synthetic", " synthetic value ");
  expect(input.value).toBe("");
});

it("keeps typed drafts out of browser storage", async () => {
  const write = vi.spyOn(Storage.prototype, "setItem");
  try {
    await enter("synthetic-memory-only-draft");
    expect(write).not.toHaveBeenCalled();
  } finally {
    write.mockRestore();
  }
});
