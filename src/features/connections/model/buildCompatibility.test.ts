import { expect, it } from "vitest";
import { localHostCompatibility } from "./buildCompatibility";
import type { BuildIdentity } from "../../workspaces/model/contracts";
import type { HostDescriptor } from "./protocol";

const stamp = (host: string) => ({ components: { host }, version: "1.0.0" }) as BuildIdentity;
const descriptor = (buildIdentity?: BuildIdentity) =>
  ({
    capabilities: ["workspaces.managed.v1", "workspaces.policy.v1"],
    buildIdentity,
  }) as HostDescriptor;
it("detects capability mismatch independently from unknown source identity", () => {
  expect(localHostCompatibility(null, { capabilities: [] } as unknown as HostDescriptor)).toBe(
    "capabilities",
  );
  expect(localHostCompatibility(null, descriptor())).toBeNull();
});
it("distinguishes same-version source builds by the bundled Host component", () => {
  expect(localHostCompatibility(stamp("a"), descriptor(stamp("b")))).toBe("identity");
  expect(localHostCompatibility(stamp("a"), descriptor(stamp("a")))).toBeNull();
  expect(localHostCompatibility(stamp("a"), descriptor())).toBeNull();
});
