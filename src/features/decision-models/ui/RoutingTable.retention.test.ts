// @vitest-environment happy-dom
import { act, createElement } from "react";
import { expect, it, vi } from "vitest";
import { RoutingTable } from "./RoutingTable";
import {
  bodyText,
  clickButton,
  mountDecisionUi,
  setInputValue,
  settleDecisionUi,
  unmountDecisionUi,
} from "./decisionTestDom";
import type { DecisionRouting, DecisionSource } from "../model/decisionTypes";

it.each(["success", "failure"])(
  "retains a pending routing %s across remount and isolates Hosts",
  async (outcome) => {
    const routing: DecisionRouting = { screen_state: { sourceIds: ["s"], threshold: 0.9 } };
    const sources: DecisionSource[] = [
      { id: "s", name: "Source", kind: "local", adapter: "systemone", status: "ready" },
    ];
    let resolve!: (value: unknown) => void;
    let reject!: (reason: Error) => void;
    const onSave = vi.fn(
      () =>
        new Promise((done, fail) => {
          resolve = done;
          reject = fail;
        }),
    );
    const render = (hostId: string) =>
      mountDecisionUi(
        createElement(RoutingTable, { hostId, routing, sources, busy: false, onSave }),
      );
    let mounted = render(`a-${outcome}`);
    await settleDecisionUi();
    clickButton("Customize");
    await settleDecisionUi();
    setInputValue(document.querySelector<HTMLInputElement>('input[inputmode="decimal"]')!, "0.74");
    clickButton("Save routing");
    await settleDecisionUi();
    unmountDecisionUi(mounted);
    mounted = render(`b-${outcome}`);
    await settleDecisionUi();
    clickButton("Customize");
    await settleDecisionUi();
    expect(document.querySelector<HTMLInputElement>('input[inputmode="decimal"]')?.value).toBe(
      "0.90",
    );
    unmountDecisionUi(mounted);
    mounted = render(`a-${outcome}`);
    await settleDecisionUi();
    clickButton("Customize");
    await settleDecisionUi();
    expect(document.querySelector<HTMLInputElement>('input[inputmode="decimal"]')?.value).toBe(
      "0.74",
    );
    expect(onSave).toHaveBeenCalledTimes(1);
    if (outcome === "success")
      await act(async () =>
        resolve({ routing: { screen_state: { sourceIds: ["s"], threshold: 0.74 } } }),
      );
    else await act(async () => reject(new Error("offline")));
    await settleDecisionUi();
    if (outcome === "success") expect(bodyText()).toContain("Saved");
    else {
      expect(bodyText()).toContain("This did not work. Try again.");
      expect(document.querySelector<HTMLInputElement>('input[inputmode="decimal"]')?.value).toBe(
        "0.74",
      );
    }
    unmountDecisionUi(mounted);
  },
);
