import { hostToolRequest } from "../connections/model/hostFeatureClient";
import { DesktopControlRequestValidationSchema, DesktopControlResponseSchema, type DesktopControlRequest } from "../../shared/model/host-contracts/desktop-control";
import {DesktopHelperRequestSchema,DesktopHelperResponseSchema,type DesktopHelperRequest} from "../../shared/model/host-contracts/desktop-helper";

export async function desktopControlRequest(input:DesktopControlRequest) {
  const request = DesktopControlRequestValidationSchema.parse(input);
  return DesktopControlResponseSchema.parse(await hostToolRequest("","desktop.control.v1","desktop.request",request,{kind:"local"}));
}
export async function desktopHelperRequest(input:DesktopHelperRequest) {
  return DesktopHelperResponseSchema.parse(await hostToolRequest("","desktop.control.v1","desktop.helper.request",DesktopHelperRequestSchema.parse(input),{kind:"local"}));
}
