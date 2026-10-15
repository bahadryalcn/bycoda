// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { newSession, type Session } from "../../../features/sessions/model/session";
import { useUsageLimitResume } from "./useWorkspaceUsage";
it("retains reset timers across unrelated stream updates and reacts to reset changes", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const limited: Session = {
    ...newSession("codex", "/fixture"),
    usageLimit: { resetsAt: Date.now() + 60_000, resumeAtReset: true },
  };
  const ordinary = newSession("codex", "/fixture");
  const sessionsRef = { current: [limited, ordinary] };
  const deps = {
    sessionsRef,
    movingSessionIds: { current: new Set<string>() },
    windowTransferPending: false,
    windowTransferPendingRef: { current: false },
    movingWindows: new Set<string>(),
    onUsageLimitResume: vi.fn(),
  };
  const container = document.createElement("div");
  const root = createRoot(container);
  function Probe({ sessions }: { sessions: Session[] }) {
    sessionsRef.current = sessions;
    useUsageLimitResume({ ...deps, sessions });
    return null;
  }
  const clear = vi.spyOn(window, "clearTimeout");
  try {
    await act(async () => root.render(createElement(Probe, { sessions: [limited, ordinary] })));
    clear.mockClear();
    await act(async () =>
      root.render(
        createElement(Probe, {
          sessions: [
            { ...limited, blocks: [...limited.blocks] },
            { ...ordinary, title: "stream update" },
          ],
        }),
      ),
    );
    expect(clear).not.toHaveBeenCalled();
    await act(async () =>
      root.render(
        createElement(Probe, {
          sessions: [
            { ...limited, usageLimit: { ...limited.usageLimit, resetsAt: Date.now() + 90_000 } },
            ordinary,
          ],
        }),
      ),
    );
    expect(clear).toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});
