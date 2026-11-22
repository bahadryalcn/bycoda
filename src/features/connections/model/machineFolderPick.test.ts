// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { pickFolders } from "../../../platform/tauri/fs";
import {
  PICK_MACHINE_FOLDER_EVENT,
  pickFolderOnMachine,
  type MachineFolderRequest,
} from "./machineFolderPick";

vi.mock("../../../platform/tauri/fs", () => ({ pickFolders: vi.fn() }));

const listeners: Array<(event: Event) => void> = [];
function host(onRequest: (request: MachineFolderRequest) => void) {
  const listener = (event: Event) => {
    const request = (event as CustomEvent<MachineFolderRequest>).detail;
    request.claim();
    onRequest(request);
  };
  window.addEventListener(PICK_MACHINE_FOLDER_EVENT, listener);
  listeners.push(listener);
}

beforeEach(() => vi.mocked(pickFolders).mockReset());
afterEach(() => {
  for (const listener of listeners.splice(0))
    window.removeEventListener(PICK_MACHINE_FOLDER_EVENT, listener);
});

it("picks one local folder through the OS picker", async () => {
  vi.mocked(pickFolders).mockResolvedValue(["C:/code/app"]);
  await expect(pickFolderOnMachine({ kind: "local" })).resolves.toBe("C:/code/app");
  expect(vi.mocked(pickFolders).mock.calls[0]?.[1]).toBe(false);
});

it.each([[[]], [["/"]], [["C:/"]]])(
  "treats %j from the local picker as cancelled",
  async (picked) => {
    vi.mocked(pickFolders).mockResolvedValue(picked);
    await expect(pickFolderOnMachine({ kind: "local" })).resolves.toBeUndefined();
  },
);

it("asks the folder browser of that machine and returns its registered project key", async () => {
  let seen: MachineFolderRequest | undefined;
  host((request) => {
    seen = request;
    request.settle("remote://env/home/me/app");
  });
  await expect(pickFolderOnMachine({ kind: "remote", machineId: "m2" })).resolves.toBe(
    "remote://env/home/me/app",
  );
  expect(seen?.machineId).toBe("m2");
  expect(vi.mocked(pickFolders)).not.toHaveBeenCalled();
});

it("resolves undefined when the browser is cancelled", async () => {
  host((request) => request.settle(undefined));
  await expect(pickFolderOnMachine({ kind: "remote", machineId: "m2" })).resolves.toBeUndefined();
});

it("rejects when nothing can show the browser, so the draft is not silently retargeted", async () => {
  await expect(pickFolderOnMachine({ kind: "remote", machineId: "m2" })).rejects.toThrow(
    /not available/i,
  );
});

it("settles a request once; a late second answer is ignored", async () => {
  let request!: MachineFolderRequest;
  host((value) => {
    request = value;
  });
  const result = pickFolderOnMachine({ kind: "remote", machineId: "m2" });
  request.settle("remote://env/a");
  request.settle("remote://env/b");
  await expect(result).resolves.toBe("remote://env/a");
});
