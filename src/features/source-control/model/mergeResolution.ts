import { invertedEffects, isolateHistory } from "@codemirror/commands";
import { diff } from "@codemirror/merge";
import {
  ChangeSet,
  StateEffect,
  StateField,
  Transaction,
  type EditorState,
} from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { conflictReplacement, findConflictBlocks, type ConflictSide } from "./conflictMarkers";

export type MergeRegion = {
  id: number;
  from: number;
  to: number;
  ours: string;
  theirs: string;
  /** Pending text restored by Reset, and where it came from. */
  initial: string;
  origin: "base" | "ours";
  choice: ConflictSide | "manual" | null;
};
export type MergeChoice = ConflictSide | "manual" | "reset";
export type MergeResolution = { regions: readonly MergeRegion[]; active: number };
export const setMergeResolution = StateEffect.define<MergeResolution>();

/** Regions belong to the result buffer, not to mutable marker offsets. */
export const mergeResolutionField = StateField.define<MergeResolution>({
  create: () => ({ regions: [], active: 0 }),
  update(value, tr) {
    let next = value;
    if (tr.docChanged) {
      let spansRegions = false;
      tr.changes.iterChangedRanges((from, to) => {
        if (value.regions.filter((region) => from <= region.to && to >= region.from).length > 1)
          spansRegions = true;
      });
      // Paste/replace-all may describe the entire file as one replacement. Use
      // its actual edits so a later source choice cannot swallow other hunks.
      const changes = spansRegions
        ? ChangeSet.of(
            diff(tr.startState.doc.toString(), tr.newDoc.toString(), { scanLimit: 1000 }).map(
              (change) => ({
                from: change.fromA,
                to: change.toA,
                insert: tr.newDoc.sliceString(change.fromB, change.toB),
              }),
            ),
            tr.startState.doc.length,
          )
        : tr.changes;
      next = {
        ...value,
        regions: value.regions.map((region) => {
          let touched = false;
          changes.iterChangedRanges((from, to) => {
            if (
              (from < region.to && to > region.from) ||
              (from === to && from >= region.from && from <= region.to)
            )
              touched = true;
          });
          return {
            ...region,
            choice: touched && region.choice !== null ? "manual" : region.choice,
            from: changes.mapPos(region.from, -1),
            to: changes.mapPos(region.to, 1),
          };
        }),
      };
    }
    for (const effect of tr.effects) if (effect.is(setMergeResolution)) next = effect.value;
    if (tr.selection && !tr.effects.some((effect) => effect.is(setMergeResolution))) {
      const region = next.regions.find(
        (item) => tr.newSelection.main.head >= item.from && tr.newSelection.main.head <= item.to,
      );
      if (region && region.id !== next.active) next = { ...next, active: region.id };
    }
    return next;
  },
});

export const mergeResolutionHistory = invertedEffects.of((tr) => {
  if (
    !tr.docChanged &&
    !tr.effects.some(
      (effect) =>
        effect.is(setMergeResolution) &&
        effect.value.regions !== tr.startState.field(mergeResolutionField).regions,
    )
  )
    return [];
  return [setMergeResolution.of(tr.startState.field(mergeResolutionField))];
});

/** Use the common ancestor for untouched conflict results when it is available.
 * Nonconflicting, already-merged text always comes from the working file. */
export function createMergeResolution(markers: string, base?: string | null) {
  const text = markers.replace(/\r\n?/g, "\n");
  const blocks = findConflictBlocks(text);
  const oursText = blocks.reduceRight(
    (out, block) =>
      out.slice(0, block.from) + conflictReplacement(text, block, "ours") + out.slice(block.to),
    text,
  );
  const ancestor = base?.replace(/\r\n?/g, "\n");
  const toBase =
    ancestor == null
      ? null
      : ChangeSet.of(
          diff(oursText, ancestor, { scanLimit: 1000 }).map((change) => ({
            from: change.fromA,
            to: change.toA,
            insert: ancestor.slice(change.fromB, change.toB),
          })),
          oursText.length,
        );
  let result = "";
  let cursor = 0;
  let oursOffset = 0;
  const regions: MergeRegion[] = [];
  for (const [id, block] of blocks.entries()) {
    const context = text.slice(cursor, block.from);
    result += context;
    oursOffset += context.length;
    const ours = conflictReplacement(text, block, "ours");
    const theirs = conflictReplacement(text, block, "theirs");
    const origin = block.base || (toBase && ancestor != null) ? "base" : "ours";
    let initial = block.base
      ? text.slice(block.base.from, block.base.to)
      : toBase && ancestor != null
        ? ancestor.slice(toBase.mapPos(oursOffset, -1), toBase.mapPos(oursOffset + ours.length, 1))
        : ours;
    if (!block.endsWithNewline) initial = initial.replace(/\n$/, "");
    regions.push({
      id,
      from: result.length,
      to: result.length + initial.length,
      ours,
      theirs,
      initial,
      origin,
      choice: null,
    });
    result += initial;
    oursOffset += ours.length;
    cursor = block.to;
  }
  return {
    doc: result + text.slice(cursor),
    resolution: { regions, active: 0 } satisfies MergeResolution,
  };
}

export function mergeResolution(state: EditorState) {
  return state.field(mergeResolutionField);
}

export function chooseMergeRegion(view: EditorView, id: number, side: MergeChoice) {
  const state = mergeResolution(view.state);
  const region = state.regions.find((item) => item.id === id);
  if (!region) return;
  const insert =
    side === "manual"
      ? view.state.sliceDoc(region.from, region.to)
      : side === "reset"
        ? region.initial
        : side === "ours"
          ? region.ours
          : side === "theirs"
            ? region.theirs
            : region.ours + region.theirs;
  const changes = view.state.changes({ from: region.from, to: region.to, insert });
  // Map surrounding regions with boundary affinity that never consumes a neighbour.
  const regions = state.regions.map((item) =>
    item.id === id
      ? { ...item, to: item.from + insert.length, choice: side === "reset" ? null : side }
      : {
          ...item,
          from: changes.mapPos(item.from, item.id < id ? -1 : 1),
          to: changes.mapPos(item.to, item.id < id ? -1 : 1),
        },
  );
  view.dispatch({
    changes,
    effects: [
      setMergeResolution.of({ regions, active: id }),
      EditorView.scrollIntoView(region.from, { y: "center" }),
    ],
    annotations: isolateHistory.of("full"),
    userEvent: "input.merge",
  });
}

export function selectMergeRegion(view: EditorView, id: number) {
  const state = mergeResolution(view.state);
  const region = state.regions.find((item) => item.id === id);
  if (!region) return;
  view.dispatch({
    effects: [
      setMergeResolution.of({ ...state, active: id }),
      EditorView.scrollIntoView(region.from, { y: "center" }),
    ],
    selection: { anchor: region.from },
    annotations: Transaction.addToHistory.of(false),
  });
}

/** Accept a source for this file in one undoable transaction, preserving context edits. */
export function chooseAllMergeRegions(view: EditorView, side: "ours" | "theirs") {
  const state = mergeResolution(view.state);
  const changes = state.regions.map((region) => ({
    from: region.from,
    to: region.to,
    insert: region[side],
  }));
  let offset = 0;
  const regions = state.regions.map((region) => {
    const from = region.from + offset;
    const to = from + region[side].length;
    offset += region[side].length - (region.to - region.from);
    return { ...region, from, to, choice: side };
  });
  view.dispatch({
    changes,
    effects: setMergeResolution.of({ ...state, regions }),
    annotations: isolateHistory.of("full"),
    userEvent: "input.merge",
  });
}
