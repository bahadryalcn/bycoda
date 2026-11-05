import type { HarnessEvent } from "./types";
/** Hold readings until success; only providers with a post-compact reading mark it as such. */
export function compactionContextEvents(emit: (event: HarnessEvent) => void) {
  let reading: Extract<HarnessEvent, { type: "context.compacted" }> = { type: "context.compacted" };
  return {
    onEvent(event: HarnessEvent) {
      if (event.type === "context.compacted") reading = event;
      else if (event.type !== "context") emit(event);
    },
    complete() {
      emit(reading);
    },
  };
}

export function isReplayAcceptingEvent(event: HarnessEvent): boolean {
  return ["turn.started", "message.delta", "reasoning.delta", "tool.started"].includes(event.type);
}
