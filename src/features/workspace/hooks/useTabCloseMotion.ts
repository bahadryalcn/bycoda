import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { loadTabAnimationsEnabled } from "../../settings/model/settings";

export type TabMotionEntry<T extends { id: string }> = {
  id: string;
  item: T;
  closing: boolean;
  opening: boolean;
  width: number;
};

function reducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function orderWithClosingTabs(
  oldOrder: readonly string[],
  liveIds: readonly string[],
  closingIds: ReadonlySet<string>,
) {
  const order = [...liveIds];
  for (const id of oldOrder) {
    if (!closingIds.has(id) || order.includes(id)) continue;
    const oldIndex = oldOrder.indexOf(id);
    let insertAt = 0;
    for (let index = oldIndex - 1; index >= 0; index -= 1) {
      const previous = order.indexOf(oldOrder[index]);
      if (previous >= 0) {
        insertAt = previous + 1;
        break;
      }
    }
    order.splice(insertAt, 0, id);
  }
  return order;
}

function idleEntry<T extends { id: string }>(item: T): TabMotionEntry<T> {
  return { id: item.id, item, closing: false, opening: false, width: 0 };
}

export function useTabCloseMotion<T extends { id: string }>(
  items: readonly T[],
  onNode?: (id: string, node: HTMLElement | null) => void,
) {
  const measureRef = useRef(new Map<string, number>());
  const nodesRef = useRef(new Map<string, HTMLElement>());
  const callbacksRef = useRef(new Map<string, (node: HTMLElement | null) => void>());
  const onNodeRef = useRef(onNode);
  onNodeRef.current = onNode;
  const observersRef = useRef(new Map<string, ResizeObserver>());
  const idsKey = items.map((item) => item.id).join("\0");
  const [trackedKey, setTrackedKey] = useState(idsKey);
  const [entries, setEntries] = useState(() => items.map(idleEntry));

  let rendered = entries;

  if (idsKey !== trackedKey) {
    const nextIds = items.map((item) => item.id);
    const nextById = new Map(items.map((item) => [item.id, item]));
    const liveEntries = entries.filter((entry) => !entry.closing);
    const previousIds = liveEntries.map((entry) => entry.id);
    const nextIdSet = new Set(nextIds);
    const replaceAll =
      previousIds.length > 0 && nextIds.length > 0 && previousIds.every((id) => !nextIdSet.has(id));
    const skipMotion = reducedMotion() || !loadTabAnimationsEnabled();

    if (replaceAll || skipMotion) {
      rendered = items.map(idleEntry);
    } else {
      const closing = entries.filter((entry) => entry.closing && !nextIdSet.has(entry.id));
      const closingIds = new Set(closing.map((entry) => entry.id));
      for (const entry of liveEntries) {
        if (nextIdSet.has(entry.id)) continue;
        closing.push({
          ...entry,
          closing: true,
          opening: false,
          width: measureRef.current.get(entry.id) ?? 0,
        });
        closingIds.add(entry.id);
      }
      const closingById = new Map(closing.map((entry) => [entry.id, entry]));
      const liveById = new Map(liveEntries.map((entry) => [entry.id, entry]));
      const order = orderWithClosingTabs(
        entries.map((entry) => entry.id),
        nextIds,
        closingIds,
      );
      rendered = order.flatMap((id) => {
        const item = nextById.get(id);
        if (!item) {
          const entry = closingById.get(id);
          return entry ? [entry] : [];
        }
        const previous = liveById.get(id);
        return [
          {
            id,
            item,
            closing: false,
            opening: previous ? previous.opening : previousIds.length > 0,
            width: 0,
          },
        ];
      });
    }

    setTrackedKey(idsKey);
    setEntries(rendered);
  }

  const setTabNode = useCallback((id: string, node: HTMLElement | null) => {
    if ((nodesRef.current.get(id) ?? null) === node) return;
    observersRef.current.get(id)?.disconnect();
    observersRef.current.delete(id);
    if (node) nodesRef.current.set(id, node);
    else nodesRef.current.delete(id);
    onNodeRef.current?.(id, node);
    if (!node) return;
    const record = () => {
      if (nodesRef.current.get(id) !== node) return;
      const width = node.getBoundingClientRect().width;
      if (width > 1) measureRef.current.set(id, width);
    };
    record();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(record);
    observer.observe(node);
    observersRef.current.set(id, observer);
  }, []);

  const tabRef = useCallback(
    (id: string) => {
      let callback = callbacksRef.current.get(id);
      if (!callback) {
        callback = (node: HTMLElement | null) => setTabNode(id, node);
        callbacksRef.current.set(id, callback);
      }
      return callback;
    },
    [setTabNode],
  );
  const tabNode = useCallback((id: string) => nodesRef.current.get(id) ?? null, []);

  useLayoutEffect(() => {
    const retained = new Set(rendered.map((entry) => entry.id));
    for (const id of callbacksRef.current.keys()) {
      if (retained.has(id)) continue;
      callbacksRef.current.delete(id);
      measureRef.current.delete(id);
    }
  });

  useLayoutEffect(
    () => () => {
      for (const observer of observersRef.current.values()) observer.disconnect();
    },
    [],
  );

  const finishMotion = useCallback((id: string) => {
    setEntries((current) => {
      const entry = current.find((candidate) => candidate.id === id);
      if (entry?.closing) {
        measureRef.current.delete(id);
        return current.filter((candidate) => candidate.id !== id);
      }
      return current.map((candidate) =>
        candidate.id === id ? { ...candidate, opening: false } : candidate,
      );
    });
  }, []);

  const currentById = new Map(items.map((item) => [item.id, item]));
  const displayed = rendered.map((entry) => ({
    ...entry,
    item: currentById.get(entry.id) ?? entry.item,
  }));

  return {
    displayed,
    tabRef,
    tabNode,
    finishMotion,
  };
}
