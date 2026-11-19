import { hostToolRequest } from "../connections/model/hostFeatureClient";
import { watchNativeDesktopControl } from "./desktopControlIndicator";
import {
  DesktopControlRequestValidationSchema,
  DesktopControlResponseSchema,
  type DesktopControlRequest,
} from "../../shared/model/host-contracts/desktop-control";
import {
  DesktopHelperRequestSchema,
  DesktopHelperResponseSchema,
  type DesktopHelperRequest,
} from "../../shared/model/host-contracts/desktop-helper";

export async function desktopControlRequest(input: DesktopControlRequest) {
  const request = DesktopControlRequestValidationSchema.parse(input);
  const response = DesktopControlResponseSchema.parse(
    await hostToolRequest("", "desktop.control.v1", "desktop.request", request, { kind: "local" }),
  );
  // The native indicator watcher retires while control is off; a saved settings change or
  // resume is what can turn it on, so wake it only then.
  if (request.op === "configure" || request.op === "resume") void watchNativeDesktopControl();
  return response;
}
export async function desktopHelperRequest(input: DesktopHelperRequest) {
  return DesktopHelperResponseSchema.parse(
    await hostToolRequest(
      "",
      "desktop.control.v1",
      "desktop.helper.request",
      DesktopHelperRequestSchema.parse(input),
      { kind: "local" },
    ),
  );
}
