// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { VoiceWorkLedger } from "../../model/voiceWorkLedger";
import { useVoiceWorkEntries } from "./useVoiceWorkEntries";

let root: Root;
let container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function Probe({ ledger }: { ledger: VoiceWorkLedger }) {
  const entries = useVoiceWorkEntries(ledger);
  return createElement("span", null, entries.map((entry) => entry.status).join(","));
}

it("follows ledger changes", async () => {
  const ledger = new VoiceWorkLedger({ storage: { load: () => [], save: () => {} } });
  await act(async () => root.render(createElement(Probe, { ledger })));
  expect(container.textContent).toBe("");
  let id = "";
  await act(async () => {
    id = ledger.start({ tool: "give_jobs", args: { jobs: [] }, request: "save a note" })!;
  });
  expect(container.textContent).toBe("running");
  await act(async () => void ledger.settle(id, { status: "accepted", jobIds: ["j1"] }));
  expect(container.textContent).toBe("done");
});
