import { expect, it, vi } from "vitest";
import { loadWindowSurface, readHostToolsWindow } from "./hostToolsWindow";

const search = (value: unknown) => `?hostTools=${encodeURIComponent(JSON.stringify(value))}`;

it.each(["devices", "browser", "servers", "logs", "resources"])("preserves detached tool tab %s", (initialTab) => {
  expect(readHostToolsWindow(search({ cwd: "/repo", sessionId: "one", title: "Project", initialTab }))).toMatchObject({ initialTab });
});

it("ignores an unknown detached tool tab", () => {
  expect(readHostToolsWindow(search({ cwd: "/repo", sessionId: "one", title: "Project", initialTab: "unknown" }))?.initialTab).toBeUndefined();
});

it("preserves the project, originating composer and target without UI dependencies", () => {
  const payload = {
    cwd: "remote://mac/repo",
    sessionId: "host-session",
    composerSessionId: "composer-session",
    composerWindow: "main",
    title: "Project",
    onlyTab: "logs",
    initialMachine: "machine:mac",
  };
  expect(readHostToolsWindow(search(payload))).toEqual(payload);
  expect(
    readHostToolsWindow(search({ ...payload, onlyTab: "untrusted", initialMachine: "other" })),
  ).toMatchObject({ onlyTab: undefined, initialMachine: "project" });
});

it.each([null, {}, { cwd: " ", sessionId: "one", title: "Project" }])(
  "rejects invalid host-tool roles: %j",
  (payload) => expect(readHostToolsWindow(search(payload))).toBeNull(),
);

it("never calls the App loader for a host-tools window", async () => {
  const workspace = vi.fn(async () => "workspace");
  const tools = vi.fn(async () => "tools");
  const role = readHostToolsWindow(search({ cwd: "/repo", sessionId: "one", title: "Project" }));
  expect(await loadWindowSurface(role, workspace, tools)).toBe("tools");
  expect(workspace).not.toHaveBeenCalled();
  expect(tools).toHaveBeenCalledOnce();
  expect(await loadWindowSurface(null, workspace, tools)).toBe("workspace");
  expect(workspace).toHaveBeenCalledOnce();
  expect(tools).toHaveBeenCalledOnce();
});

it("preserves a remote browser destination when opening the owning-host preview", () => {
  expect(
    readHostToolsWindow(
      search({
        cwd: "remote://mac/repo",
        sessionId: "",
        title: "localhost:5173",
        initialTab: "browser",
        initialUrl: "https://localhost:5173/nested?x=1#here",
      }),
    ),
  ).toMatchObject({
    cwd: "remote://mac/repo",
    initialTab: "browser",
    initialUrl: "https://localhost:5173/nested?x=1#here",
  });
});
