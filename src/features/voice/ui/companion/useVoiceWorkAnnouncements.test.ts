// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { VoiceUpdate } from "../../model/voiceWorkAnnouncements";
import {
  VoiceWorkLedger,
  type VoiceWorkEntry,
  type VoiceWorkStorage,
} from "../../model/voiceWorkLedger";
import { useVoiceWorkAnnouncements } from "./useVoiceWorkAnnouncements";

let root: Root;
let container: HTMLDivElement;
let announce: ((update: VoiceUpdate) => void) | undefined;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function memoryLedger() {
  let saved: VoiceWorkEntry[] = [];
  const storage: VoiceWorkStorage = {
    load: () => saved,
    save: (entries) => {
      saved = [...entries];
    },
  };
  return new VoiceWorkLedger({ storage });
}

type Props = Parameters<typeof useVoiceWorkAnnouncements>[0];
function Probe(props: Props) {
  announce = useVoiceWorkAnnouncements(props);
  return null;
}

function started(ledger: VoiceWorkLedger, tool = "app_tool_call") {
  const id = ledger.start({
    tool,
    action: tool === "app_tool_call" ? "workspace.sessions.create" : undefined,
    args: { prompt: "build", submit: true },
    request: "build a game",
  })!;
  ledger.settle(id, { status: "accepted", sessionId: "s1", title: "Snake game" });
}

it("announces finished work once the gate opens, on the client that is live then", async () => {
  const ledger = memoryLedger();
  started(ledger);
  const deliver = vi.fn((_update: VoiceUpdate) => true);
  const render = (props: Partial<Props>) =>
    act(async () =>
      root.render(
        createElement(Probe, {
          ledger,
          sessions: [{ id: "s1", busy: true }],
          jobs: [],
          open: false,
          deliver,
          ...props,
        }),
      ),
    );
  await render({});
  await render({ sessions: [{ id: "s1", busy: false }] });
  expect(deliver).not.toHaveBeenCalled();
  expect(ledger.entries()[0]?.progress).toBe("finished");
  await render({ sessions: [{ id: "s1", busy: false }], open: true });
  expect(deliver).toHaveBeenCalledOnce();
  expect(deliver.mock.calls[0]?.[0]).toMatchObject({ id: expect.stringContaining(":finished") });
  expect(deliver.mock.calls[0]?.[0].data).toContain("Snake game");
});

it("keeps an update no client could take and delivers it when the gate reopens", async () => {
  const ledger = memoryLedger();
  const deliver = vi.fn((_update: VoiceUpdate) => false);
  const props = { ledger, sessions: [], jobs: [], deliver };
  await act(async () => root.render(createElement(Probe, { ...props, open: true })));
  await act(async () => announce?.({ id: "u1", data: "data", speech: "speech" }));
  expect(deliver).toHaveBeenCalledOnce();
  deliver.mockReturnValue(true);
  await act(async () => root.render(createElement(Probe, { ...props, open: false })));
  await act(async () => root.render(createElement(Probe, { ...props, open: true })));
  expect(deliver).toHaveBeenCalledTimes(2);
  expect(deliver.mock.calls[1]?.[0]).toMatchObject({ id: "u1" });
});

it("skips entries another announcer reports", async () => {
  const ledger = memoryLedger();
  started(ledger, "submit_work");
  const deliver = vi.fn((_update: VoiceUpdate) => true);
  const props = {
    ledger,
    jobs: [],
    open: true,
    deliver,
    skip: (entry: VoiceWorkEntry) => entry.tool === "submit_work",
  };
  await act(async () =>
    root.render(createElement(Probe, { ...props, sessions: [{ id: "s1", busy: true }] })),
  );
  await act(async () =>
    root.render(createElement(Probe, { ...props, sessions: [{ id: "s1", busy: false }] })),
  );
  expect(ledger.entries()[0]?.progress).toBe("finished");
  expect(deliver).not.toHaveBeenCalled();
});
