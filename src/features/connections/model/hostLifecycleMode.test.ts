import { expect, it } from "vitest";
import {
  hostModeSwitchView,
  sshSetupSuccessNotice,
  type HostModeStatus,
} from "./hostLifecycleMode";

const base: HostModeStatus = {
  mode: "app",
  registered: false,
  mismatch: false,
  switchSupported: true,
};

it("maps each mode to the switch", () => {
  expect(hostModeSwitchView(base)).toEqual({ checked: false, unsupported: false });
  expect(hostModeSwitchView({ ...base, mode: "service", registered: true }).checked).toBe(true);
});

it("reports a pending switch, an unsupported Host and errors", () => {
  expect(hostModeSwitchView({ ...base, pendingMode: "service" }).pending).toBe("service");
  expect(hostModeSwitchView({ ...base, switchSupported: false }).unsupported).toBe(true);
  expect(hostModeSwitchView({ ...base, lastError: "Refused." }).error).toBe("Refused.");
  expect(hostModeSwitchView({ ...base, mismatch: true }).error).toContain("repair");
  // The native error wins over the generic mismatch text.
  expect(hostModeSwitchView({ ...base, mismatch: true, lastError: "Refused." }).error).toBe(
    "Refused.",
  );
});

it("says a machine stays reachable only when setup enabled its service", () => {
  expect(sshSetupSuccessNotice("Done.", {}, "Mac")).toBe("Done.");
  expect(sshSetupSuccessNotice("Done.", { enabledBackgroundService: true }, "Mac")).toBe(
    "Done. Mac was set to stay reachable when bycoda is closed.",
  );
});
