import { expect, it, vi } from "vitest";
import {
  forgetSessionCommands,
  getReportedCommands,
  reportSessionCommands,
  subscribeReportedCommands,
} from "./reportedCommands";

it("forgets only the requested session and notifies its subscribers", () => {
  const changed = vi.fn();
  const otherChanged = vi.fn();
  const release = subscribeReportedCommands("forgotten", changed);
  const releaseOther = subscribeReportedCommands("retained", otherChanged);
  reportSessionCommands("forgotten", [{ name: "first", kind: "command" }]);
  reportSessionCommands("retained", [{ name: "second", kind: "skill" }]);
  changed.mockClear();
  otherChanged.mockClear();
  forgetSessionCommands("forgotten");
  forgetSessionCommands("forgotten");
  expect(getReportedCommands("forgotten")).toEqual([]);
  expect(getReportedCommands("retained")).toEqual([{ name: "second", kind: "skill" }]);
  expect(changed).toHaveBeenCalledTimes(1);
  expect(otherChanged).not.toHaveBeenCalled();
  release();
  releaseOther();
  forgetSessionCommands("retained");
});
