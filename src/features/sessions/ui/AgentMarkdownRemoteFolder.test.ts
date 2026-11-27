// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AgentMarkdown } from "./AgentMarkdown";
import { TranscriptToolPaths } from "./TranscriptToolPaths";
import { openErrorDetails } from "./errorDetails.fixture";

async function rawDetails(scope: ParentNode = document): Promise<string> {
  const trigger = scope.querySelector<HTMLButtonElement>('button[aria-label^="Details"]');
  if (!trigger) return "";
  await act(async () => trigger.click());
  return (
    document.querySelector<HTMLElement>('[role="dialog"][aria-label^="Details"]')?.textContent ?? ""
  );
}

const actions = vi.hoisted(() => ({
  browseDirectory: vi.fn(),
  revealPath: vi.fn(),
  openPathWithDefaultApp: vi.fn(),
  isLocalDirectory: vi.fn(),
  openLiveRemoteFolder: vi.fn(),
  statFiles: vi.fn(),
}));
vi.mock("../../../platform/tauri/fs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../platform/tauri/fs")>()),
  ...actions,
}));
let root: Root;
let container: HTMLDivElement;
const onOpenFile = vi.fn();
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  localStorage.clear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  actions.isLocalDirectory.mockResolvedValue(true);
  actions.openLiveRemoteFolder.mockResolvedValue(undefined);
  actions.browseDirectory.mockImplementation(async (path: string, containing = false) => {
    if (containing && path.endsWith("/özet.md")) path = path.slice(0, path.lastIndexOf("/"));
    if (path === "remote://env/repo/assets")
      return {
        path,
        parent: "remote://env/repo",
        canOpenFiles: true,
        entries: [
          { name: "özet.md", path: `${path}/özet.md`, isDir: false },
          { name: "images", path: `${path}/images`, isDir: true },
        ],
      };
    if (path === "remote://env/repo/assets/images")
      return { path, parent: "remote://env/repo/assets", canOpenFiles: true, entries: [] };
    throw new Error("Not a directory");
  });
  actions.statFiles.mockImplementation(async (paths: string[]) =>
    paths.map((path) => ({
      path,
      mtimeMs:
        path === "remote://env/repo/assets/özet.md" ||
        path === "remote://env/C:/Users/alice/.bycoda-build/packages/bycoda.exe"
          ? 1
          : null,
      isDir: path === "remote://env/repo/assets" || path === "remote://env/repo/assets/images",
    })),
  );
});

it("browses a Windows build folder outside projects and keeps its files out of the editor", async () => {
  const directory = "remote://env/C:/Users/alice/.bycoda-build/packages";
  actions.browseDirectory.mockImplementation(async (path: string, containing = false) => {
    if (containing && path === `${directory}/bycoda.exe`) path = directory;
    if (path === directory)
      return {
        path,
        parent: "remote://env/C:/Users/alice/.bycoda-build",
        canOpenFiles: false,
        entries: [
          { name: "bycoda.exe", path: `${path}/bycoda.exe`, isDir: false },
          { name: "archive", path: `${path}/archive`, isDir: true },
        ],
      };
    if (path === `${directory}/archive`)
      return { path, parent: directory, canOpenFiles: false, entries: [] };
    throw new Error("Not a directory");
  });
  await render("[Installer](C:/Users/alice/.bycoda-build/packages/bycoda.exe)");
  await revealFromMenu();
  const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
  expect(actions.browseDirectory).toHaveBeenCalledWith(`${directory}/bycoda.exe`, true);
  expect(dialog.textContent).toContain(directory);
  expect(dialog.textContent).toContain("outside registered projects");
  const installer = [...dialog.querySelectorAll("button")].find(
    (button) => button.textContent === "bycoda.exe",
  )!;
  expect(installer.disabled || installer.getAttribute("aria-disabled") === "true").toBe(true);
  await act(async () => installer.click());
  expect(onOpenFile).not.toHaveBeenCalled();
  await act(async () =>
    [...dialog.querySelectorAll("button")]
      .find((button) => button.textContent === "archive")!
      .click(),
  );
  expect(dialog.textContent).toContain(`${directory}/archive`);
  await act(async () =>
    dialog.querySelector<HTMLButtonElement>('[aria-label="Parent folder"]')!.click(),
  );
  expect(dialog.textContent).toContain("bycoda.exe");
  expect(actions.openPathWithDefaultApp).not.toHaveBeenCalled();
});

it("does not navigate above a remote Windows drive root", async () => {
  actions.browseDirectory.mockResolvedValue({
    path: "remote://env/C:/",
    parent: null,
    canOpenFiles: false,
    entries: [],
  });
  await render("[Drive](C:/)");
  await act(async () => container.querySelector("a")!.click());
  const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
  const parent = dialog.querySelector<HTMLButtonElement>('[aria-label="Parent folder"]')!;
  expect(parent.disabled || parent.getAttribute("aria-disabled") === "true").toBe(true);
});

it("reports a failed folder request without guessing a different parent", async () => {
  actions.browseDirectory.mockRejectedValue(new Error("The machine disconnected"));
  await render("[Summary](/repo/assets/özet.md)");
  await revealFromMenu();
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  const alert = document.querySelector<HTMLElement>('[role="alert"]')!;
  expect(alert.textContent).toContain("Couldn’t open the file in its default app");
  expect(await rawDetails(alert)).toContain("The machine disconnected");
  expect(actions.browseDirectory).not.toHaveBeenCalledWith("remote://env/repo/assets");
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});
async function render(text: string) {
  await act(async () =>
    root.render(
      createElement(AgentMarkdown, {
        text,
        cwd: "remote://env/repo",
        onOpenFile,
      }),
    ),
  );
}
/** Opens the file link's context menu and picks the in-app "Open containing folder" action. */
async function revealFromMenu() {
  await act(async () =>
    container
      .querySelector("a")!
      .dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })),
  );
  const reveal = [
    ...document.querySelectorAll<HTMLElement>('[role="menu"] [role="menuitem"]'),
  ].find((item) => item.textContent?.startsWith("Open containing folder in "))!;
  await act(async () => reveal.click());
}
it("recognizes existing bare and relative folders while leaving protocol methods as code", async () => {
  await render("`assets/images` and `currentTime/read` and `assets` and `someVariable`");
  const codes = [...container.querySelectorAll("code")];
  expect(codes[0].getAttribute("role")).toBe("link");
  expect(codes[1].getAttribute("role")).toBeNull();
  expect(codes[2].getAttribute("role")).toBe("link");
  expect(codes[3].getAttribute("role")).toBeNull();
});

it("browses remote folders and opens their files at exact paths", async () => {
  await render("`/repo/assets`");
  await act(async () => container.querySelector<HTMLElement>('code[role="link"]')!.click());
  const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
  expect(dialog.textContent).toContain("özet.md");
  expect(onOpenFile).not.toHaveBeenCalled();
  const file = [...dialog.querySelectorAll("button")].find(
    (button) => button.textContent === "özet.md",
  )!;
  await act(async () => file.click());
  expect(onOpenFile).toHaveBeenCalledWith("remote://env/repo/assets/özet.md", undefined, {
    exact: true,
  });
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});
it("opens a bare remote file beside files the session's tools touched", async () => {
  const expected = "remote://env/tools/bykit/src/read.rs";
  actions.statFiles.mockImplementation(async (paths: string[]) =>
    paths.map((path) => ({ path, mtimeMs: path === expected ? 1 : null })),
  );
  await act(async () =>
    root.render(
      createElement(
        TranscriptToolPaths.Provider,
        { value: () => ["remote://env/tools/bykit/src/port.rs"] },
        createElement(AgentMarkdown, {
          text: "Now the outline work in `read.rs`.",
          cwd: "remote://env/repo",
          onOpenFile,
        }),
      ),
    ),
  );
  await act(async () => container.querySelector<HTMLElement>('code[role="link"]')!.click());
  expect(actions.browseDirectory).toHaveBeenCalledWith(expected);
  expect(onOpenFile).toHaveBeenCalledWith(expected, undefined);
});
it("opens a remote file's containing folder from the context menu", async () => {
  await render("[Summary](/repo/assets/özet.md)");
  await revealFromMenu();
  const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
  expect(dialog.textContent).toContain("remote://env/repo/assets");
  const folder = [...dialog.querySelectorAll("button")].find(
    (button) => button.textContent === "images",
  )!;
  await act(async () => folder.click());
  expect(dialog.textContent).toContain("This folder is empty");
  expect(actions.revealPath).not.toHaveBeenCalled();
  expect(actions.openPathWithDefaultApp).not.toHaveBeenCalled();
});

it("opens mapped folders on this computer and reuses the mapping for subfolders", async () => {
  const { saveExplorerMapping } = await import("../../../shared/lib/remoteExplorerPaths");
  saveExplorerMapping("remote://env/repo/assets", "\\\\MacBook\\assets");
  await render("`/repo/assets`");
  await act(async () => container.querySelector<HTMLElement>('code[role="link"]')!.click());
  const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
  const reveal = [...dialog.querySelectorAll("button")].find((button) =>
    /Reveal in|Open in File Manager/.test(button.textContent ?? ""),
  )!;
  await act(async () => reveal.click());
  expect(actions.openPathWithDefaultApp).toHaveBeenLastCalledWith("//MacBook/assets");
  await act(async () =>
    [...dialog.querySelectorAll("button")]
      .find((button) => button.textContent === "images")!
      .click(),
  );
  await act(async () => reveal.click());
  expect(actions.openPathWithDefaultApp).toHaveBeenLastCalledWith("//MacBook/assets/images");
});

it("requests an explicit share mapping and reports OS access failures", async () => {
  await render("`/repo/assets`");
  await act(async () => container.querySelector<HTMLElement>('code[role="link"]')!.click());
  const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
  await act(async () =>
    [...dialog.querySelectorAll("button")]
      .find((button) => /Reveal in|Open in File Manager/.test(button.textContent ?? ""))!
      .click(),
  );
  expect(dialog.textContent).toContain("Same folder on this computer");
  expect(actions.openPathWithDefaultApp).not.toHaveBeenCalled();
  const input = dialog.querySelectorAll("input")[1];
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(
      input,
      "\\\\MacBook\\assets",
    );
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  actions.openPathWithDefaultApp.mockRejectedValueOnce(new Error("Network share unavailable"));
  await act(async () =>
    dialog
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
  );
  expect(actions.openPathWithDefaultApp).toHaveBeenCalledWith("//MacBook/assets");
  expect(openErrorDetails(dialog)).toContain("Network share unavailable");
});

it("reports an unavailable mapped folder before asking the OS to open it", async () => {
  const { saveExplorerMapping } = await import("../../../shared/lib/remoteExplorerPaths");
  saveExplorerMapping("remote://env/repo/assets", "\\\\MacBook\\assets");
  actions.isLocalDirectory.mockResolvedValue(false);
  await render("`/repo/assets`");
  await act(async () => container.querySelector<HTMLElement>('code[role="link"]')!.click());
  const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
  await act(async () =>
    [...dialog.querySelectorAll("button")]
      .find((button) => /Reveal in|Open in File Manager/.test(button.textContent ?? ""))!
      .click(),
  );
  expect(actions.isLocalDirectory).toHaveBeenCalledWith("//MacBook/assets");
  expect(actions.openPathWithDefaultApp).not.toHaveBeenCalled();
  expect(openErrorDetails(dialog)).toContain("The shared folder is unavailable on this computer");
});

it("opens a live read-only folder directly and preserves the share and copy fallbacks", async () => {
  await render("`/repo/assets`");
  await act(async () => container.querySelector<HTMLElement>('code[role="link"]')!.click());
  const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
  const button = [...dialog.querySelectorAll("button")].find(
    (item) => item.textContent === "Open live folder (read-only)",
  )!;
  expect(button.disabled).toBe(false);
  await act(async () => button.click());
  expect(actions.openLiveRemoteFolder).toHaveBeenCalledWith("remote://env/repo/assets");
  expect(actions.openPathWithDefaultApp).not.toHaveBeenCalled();
  expect(dialog.textContent).toContain("Shared folder settings");
  expect(dialog.querySelector('[aria-label="Open local copy: özet.md"]')).not.toBeNull();
  actions.openLiveRemoteFolder.mockRejectedValueOnce(new Error("WebClient is not running"));
  await act(async () => button.click());
  expect(openErrorDetails(dialog)).toContain("WebClient is not running");
});

it("offers local file-manager reveal in the remote context menu", async () => {
  await render("[Summary](/repo/assets/özet.md)");
  await act(async () =>
    container
      .querySelector("a")!
      .dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })),
  );
  const menu = document.querySelector('[role="menu"]')!;
  const reveal = [...menu.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((item) =>
    /^(Reveal in Finder|Reveal in File Explorer|Open containing folder)$/.test(
      item.textContent ?? "",
    ),
  )!;
  expect(reveal).toBeTruthy();
  await act(async () => reveal.click());
  const dialog = document.querySelector('[role="dialog"]')!;
  expect(dialog.textContent).toContain("Same folder on this computer");
  expect(dialog.textContent).toContain("remote://env/repo/assets");
});
