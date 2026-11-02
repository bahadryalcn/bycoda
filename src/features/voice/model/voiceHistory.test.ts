import { expect, it, vi } from "vitest";
import { VoiceHistoryBindings } from "./voiceHistory";
import type {
  AssistantRequest,
  AssistantResponse,
  AssistantThread,
} from "../../../shared/model/host-contracts/assistant";
function fixture() {
  const request = vi.fn(async (input: AssistantRequest): Promise<AssistantResponse> => {
    if (input.op === "projects.list")
      return {
        projects: [
          { id: "canonical-a", path: "C:/Alpha", name: "Alpha" },
          { id: "canonical-b", path: "C:/Beta", name: "Beta" },
        ],
      };
    if (input.op === "threads.open")
      return { thread: { id: input.projectId ?? "global", summary: "" } as AssistantThread };
    return { messages: [] };
  });
  return { request, bindings: new VoiceHistoryBindings(request) };
}
it("opens each canonical local project once without substituting a path for projectId", async () => {
  const f = fixture();
  expect((await f.bindings.open(false, "c:\\Alpha\\"))?.thread.id).toBe("canonical-a");
  await f.bindings.open(false, "C:/Alpha");
  await f.bindings.open(false, "C:/Beta");
  expect(
    f.request.mock.calls.filter(([input]) => input.op === "threads.open").map(([input]) => input),
  ).toEqual([
    { op: "threads.open", projectId: "canonical-a" },
    { op: "threads.open", projectId: "canonical-b" },
  ]);
});
it("uses a captured remote transport without local RPCs or guessed IDs", async () => {
  const f = fixture();
  const remote=vi.fn(async(input:AssistantRequest):Promise<AssistantResponse>=>input.op==="projects.list"?{projects:[{id:"actual-remote",path:"remote://paired/repo",name:"repo"}]}:input.op==="threads.open"?{thread:{id:"remote-thread"} as AssistantThread}:{messages:[]});
  const bindings=new VoiceHistoryBindings(f.request,()=>({key:"paired:project",remote:true,request:remote}));
  expect((await bindings.open(false, "remote://paired/repo")).thread.id).toBe("remote-thread");
  expect(f.request).not.toHaveBeenCalled();
});
it("allows the real local global thread while excluding remote session associations", async () => {
  const f = fixture();
  expect((await f.bindings.open(true, "remote://paired/repo"))?.thread.id).toBe("global");
  expect(f.request.mock.calls[0][0]).toEqual({ op: "threads.open" });
});
it("retries failed local canonical lookup instead of caching unavailable authority", async () => {
  const f = fixture();
  f.request.mockRejectedValueOnce(new Error("Host unavailable"));
  await expect(f.bindings.open(false, "C:/Alpha")).rejects.toThrow("Host unavailable");
  expect((await f.bindings.open(false, "C:/Alpha"))?.thread.id).toBe("canonical-a");
});
