// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

const fetchCatalog = vi.hoisted(() => vi.fn());
vi.mock("../model/localVoiceClient", () => ({
  localVoiceBackend: { transcriptionModels: fetchCatalog },
}));
import { useTranscriptionModels } from "./useTranscriptionModels";

function Consumer({ enabled }: { enabled: boolean }) {
  const query = useTranscriptionModels(enabled);
  return createElement("span", null, query.data?.[0]?.label ?? "pending");
}

it("shares one in-flight catalog request and refreshes when reopened", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  let finish!: (value: { id: string; label: string }[]) => void;
  fetchCatalog.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const render = (enabled: boolean) =>
    root.render(
      createElement(
        "div",
        null,
        createElement(Consumer, { enabled: true }),
        createElement(Consumer, { enabled }),
      ),
    );
  try {
    await act(async () => render(true));
    expect(fetchCatalog).toHaveBeenCalledTimes(1);
    await act(async () => finish([{ id: "vendor/model", label: "First" }]));
    await vi.waitFor(() => expect(container.textContent).toContain("First"));
    fetchCatalog.mockResolvedValueOnce([{ id: "vendor/new", label: "Next" }]);
    await act(async () => render(false));
    await act(async () => render(true));
    await vi.waitFor(() => expect(fetchCatalog).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(container.textContent).toContain("Next"));
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    vi.resetAllMocks();
  }
});
