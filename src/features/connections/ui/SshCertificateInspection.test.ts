// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { SshCertificateInspection } from "./SshCertificateInspection";
import { inspectSshCertificate } from "../model/sshCertificate";
vi.mock("../model/sshCertificate", () => ({ inspectSshCertificate: vi.fn() }));
let root: ReturnType<typeof createRoot>, container: HTMLDivElement;
const metadata = {
  certificateType: "user" as const,
  fingerprint: "SHA256:public",
  serial: "1",
  validity: "forever",
  principals: ["alice"],
};
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.mocked(inspectSshCertificate).mockReset();
  container = document.createElement("div");
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  vi.unstubAllGlobals();
});
const render = (reference: string, disabled = false) =>
  act(async () => root.render(createElement(SshCertificateInspection, { reference, disabled })));
it("inspects only explicitly and hides results on path changes without a new inspection", async () => {
  vi.mocked(inspectSshCertificate).mockResolvedValue(metadata);
  await render("public-one");
  expect(inspectSshCertificate).not.toHaveBeenCalled();
  await act(async () => container.querySelector("button")!.click());
  expect(inspectSshCertificate).toHaveBeenCalledExactlyOnceWith("public-one");
  expect(container.textContent).toContain("SHA256:public");
  expect(container.querySelector("details")?.open).toBe(false);
  await render("public-two");
  expect(container.textContent).not.toContain("SHA256:public");
  expect(inspectSshCertificate).toHaveBeenCalledTimes(1);
});
it("rejects late results even if the path changes back and blocks duplicate/saving actions", async () => {
  let resolve!: (value: typeof metadata) => void;
  vi.mocked(inspectSshCertificate).mockImplementation(
    () =>
      new Promise((done) => {
        resolve = done;
      }),
  );
  await render("public-one");
  await act(async () => {
    container.querySelector("button")!.click();
    container.querySelector("button")!.click();
  });
  expect(inspectSshCertificate).toHaveBeenCalledTimes(1);
  await render("public-two");
  await render("public-one");
  await act(async () => resolve(metadata));
  expect(container.textContent).not.toContain("SHA256:public");
  await render("public-one", true);
  expect(container.querySelector("button")?.disabled).toBe(true);
});
it("shows only a generic recoverable error, never the native rejection contents", async () => {
  vi.mocked(inspectSshCertificate).mockRejectedValue(new Error("secret-native-path-or-data"));
  await render("public-one");
  await act(async () => container.querySelector("button")!.click());
  expect(container.querySelector('[role="alert"]')?.textContent).toBe(
    "Couldn’t inspect the public SSH certificate.",
  );
  expect(container.textContent).not.toContain("secret-native-path-or-data");
});
