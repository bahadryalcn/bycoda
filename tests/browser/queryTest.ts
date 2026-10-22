import { createElement, type ComponentType } from "react";
import { QueryClientProvider, focusManager, notifyManager } from "@tanstack/react-query";
import { afterEach, beforeEach } from "vitest";
import { createAppQueryClient } from "../../src/shared/lib/queryClient";

/** Isolate each suite's host reads while keeping a single client across remounts. */
export function withQueryClient<P extends object>(Component: ComponentType<P>) {
  const client = createAppQueryClient();
  beforeEach(() => {
    // Complete observer notifications inside async act, including fake-timer suites.
    notifyManager.setScheduler(queueMicrotask);
    client.clear();
    focusManager.setFocused(true);
  });
  afterEach(() => {
    client.clear();
    focusManager.setFocused(undefined);
    notifyManager.setScheduler((callback) => setTimeout(callback, 0));
  });
  return function QueryTest(props: P) {
    return createElement(QueryClientProvider, { client }, createElement(Component, props));
  };
}
