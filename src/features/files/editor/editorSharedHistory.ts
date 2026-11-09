import {
  history,
  historyField,
  isolateHistory,
  redo,
  redoDepth,
  redoSelection,
  undo,
  undoDepth,
  undoSelection,
} from "@codemirror/commands";
import {
  Annotation,
  EditorState,
  Facet,
  Prec,
  Transaction,
  type ChangeSet,
  type Extension,
  type StateCommand,
  type Text,
} from "@codemirror/state";
import { EditorView, keymap, ViewPlugin, type ViewUpdate } from "@codemirror/view";

/**
 * One live document per file, shared by every editor open on it, the way a
 * text model is shared by a file's editor and its diff view.
 *
 * A file can be open in several editors at once, for example its own tab and
 * its "Working Tree" review tab. A hub per file holds the shared text and the
 * only undo history that matters: every edit typed into one editor reaches the
 * others at once, and undo/redo in any of them pops that shared history. The
 * editor that made an edit owns saving it; the others are told when it reached
 * the disk, so they never read their own file's save as a conflict.
 *
 * An editor whose text differs from the hub (it was busy closing when an edit
 * arrived, or it holds a recovered draft) neither records into nor undoes from
 * the hub until a reload brings it level. Typing into such an editor starts a
 * fresh shared document from its text, since its draft and the hub's split.
 */

type SharedOrigin =
  /** An undo/redo of the shared history, replayed in the editor that ran it. */
  | "replay"
  /** Another editor's edit, mirrored here. That editor saves it. */
  | "peer";

const sharedOrigin = Annotation.define<SharedOrigin>();

/** Whether `tr` mirrors another editor's edit, which that editor will save. */
export function isSharedPeerChange(tr: Transaction): boolean {
  return tr.annotation(sharedOrigin) === "peer";
}

/** How the owning editor takes part in the shared document. */
export type SharedDocumentHooks = {
  /** Runs a change that comes from another editor (through any input gate). */
  external?: (apply: () => void) => void;
  /** Another editor on this file, sharing this text, wrote `doc` to disk. */
  saved?: (doc: Text) => void;
  /**
   * Another editor on this file closed, perhaps before saving the shared text.
   * Returns whether this editor took over saving it.
   */
  peerLeft?: () => boolean;
};

const sharedHistoryKey = Facet.define<string, string | null>({
  combine: (values) => values[0] ?? null,
});

const sharedHistoryHooks = Facet.define<SharedDocumentHooks, SharedDocumentHooks>({
  combine: (values) => values[0] ?? {},
});

type Hub = {
  state: EditorState;
  /** Bumped on every document change, so peers can cache that they match. */
  version: number;
  peers: Set<SharedHistoryPeer>;
  /** Bumped whenever an editor joins, to tell a rebuild from a close. */
  joins: number;
};

const hubs = new Map<string, Hub>();

function hubState(source: EditorState, carryHistory: boolean): EditorState {
  const carried = carryHistory ? source.field(historyField, false) : undefined;
  return EditorState.create({
    doc: source.doc,
    selection: source.selection,
    extensions: [
      EditorState.allowMultipleSelections.of(true),
      history(),
      carried ? historyField.init(() => carried) : [],
    ],
  });
}

function historyAnnotations(tr: Transaction): Annotation<unknown>[] {
  const annotations: Annotation<unknown>[] = [];
  const time = tr.annotation(Transaction.time);
  if (time !== undefined) annotations.push(Transaction.time.of(time));
  const userEvent = tr.annotation(Transaction.userEvent);
  if (userEvent !== undefined) annotations.push(Transaction.userEvent.of(userEvent));
  const addToHistory = tr.annotation(Transaction.addToHistory);
  if (addToHistory !== undefined) annotations.push(Transaction.addToHistory.of(addToHistory));
  const isolate = tr.annotation(isolateHistory);
  if (isolate !== undefined) annotations.push(isolateHistory.of(isolate));
  return annotations;
}

class SharedHistoryPeer {
  readonly hub: Hub | null;
  /** The document last known to equal the hub's at `syncedVersion`. */
  private synced: Text | null = null;
  private syncedVersion = -1;

  constructor(
    readonly view: EditorView,
    private readonly key: string | null,
  ) {
    if (!key) {
      this.hub = null;
      return;
    }
    let hub = hubs.get(key);
    if (!hub) {
      // A rebuilt editor carries its history, so the first peer seeds the hub.
      hub = { state: hubState(view.state, true), version: 0, peers: new Set(), joins: 0 };
      hubs.set(key, hub);
    }
    hub.peers.add(this);
    hub.joins += 1;
    this.hub = hub;
    this.inSync(view.state.doc);
  }

  private get hooks(): SharedDocumentHooks {
    return this.view.state.facet(sharedHistoryHooks);
  }

  /** Whether `doc` is the hub's current text; caches a positive answer. */
  inSync(doc: Text): boolean {
    const hub = this.hub;
    if (!hub) return false;
    return this.matches(doc, hub.state.doc, hub.version);
  }

  /** Whether `doc` equals the hub text `hubDoc` of `version`. */
  private matches(doc: Text, hubDoc: Text, version: number): boolean {
    if (doc === this.synced && this.syncedVersion === version) return true;
    if (!doc.eq(hubDoc)) return false;
    this.synced = doc;
    this.syncedVersion = version;
    return true;
  }

  update(update: ViewUpdate) {
    for (const tr of update.transactions) this.record(tr);
  }

  private record(tr: Transaction) {
    const hub = this.hub;
    // The hub already holds what it sent here; `run`/`receive` sync the cache.
    if (!hub || tr.annotation(sharedOrigin) || (!tr.docChanged && !tr.selection)) return;
    if (!this.inSync(tr.startState.doc)) {
      // Reloads and other bookkeeping only bring a stale editor level.
      if (!tr.docChanged || tr.annotation(Transaction.addToHistory) === false) return;
      hub.state = hubState(tr.startState, false);
      hub.version += 1;
    }
    const before = hub.state.doc;
    const beforeVersion = hub.version;
    hub.state = hub.state.update({
      changes: tr.changes,
      selection: tr.newSelection,
      annotations: historyAnnotations(tr),
    }).state;
    if (!tr.docChanged) return;
    hub.version += 1;
    this.synced = tr.state.doc;
    this.syncedVersion = hub.version;
    // Reloads reach every editor from the disk; mirroring one would read as an
    // unsaved edit in the others.
    if (tr.annotation(Transaction.addToHistory) === false) return;
    this.share(before, beforeVersion, tr.changes, tr.annotation(Transaction.userEvent));
  }

  /** Mirror a change of the hub text `before` into every other level editor. */
  private share(before: Text, version: number, changes: ChangeSet, userEvent?: string) {
    for (const peer of this.hub?.peers ?? []) {
      if (peer !== this) peer.receive(before, version, changes, userEvent);
    }
  }

  private receive(before: Text, version: number, changes: ChangeSet, userEvent?: string) {
    const apply = () => {
      // A gated editor runs these later, in order; each applies only to the
      // text it was made for.
      if (!this.matches(this.view.state.doc, before, version)) return;
      this.view.dispatch({
        changes,
        annotations: [
          sharedOrigin.of("peer"),
          Transaction.addToHistory.of(false),
          ...(userEvent ? [Transaction.userEvent.of(userEvent)] : []),
        ],
      });
      this.inSync(this.view.state.doc);
    };
    const { external } = this.hooks;
    if (external) external(apply);
    else apply();
  }

  /** Runs `command` against the shared history and replays its result here. */
  run(command: StateCommand): boolean {
    const hub = this.hub;
    const view = this.view;
    if (!hub) return command(view);
    if (view.state.readOnly) return false;
    // This editor's text is not the shared one: there is nothing to pop here.
    if (!this.inSync(view.state.doc)) return true;
    let replay: Transaction | null = null;
    command({
      state: hub.state,
      dispatch: (tr) => {
        replay = tr;
      },
    });
    if (!replay) return true;
    const tr: Transaction = replay;
    const before = hub.state.doc;
    const beforeVersion = hub.version;
    hub.state = tr.state;
    if (tr.docChanged) hub.version += 1;
    const userEvent = tr.annotation(Transaction.userEvent) ?? "undo";
    view.dispatch({
      changes: tr.changes,
      selection: tr.selection,
      scrollIntoView: true,
      annotations: [
        sharedOrigin.of("replay"),
        Transaction.addToHistory.of(false),
        Transaction.userEvent.of(userEvent),
      ],
    });
    this.inSync(view.state.doc);
    if (tr.docChanged) this.share(before, beforeVersion, tr.changes, userEvent);
    return true;
  }

  depth(measure: (state: EditorState) => number): number {
    if (!this.hub) return measure(this.view.state);
    return this.inSync(this.view.state.doc) ? measure(this.hub.state) : 0;
  }

  /** Tell the editors sharing `doc` that it reached the disk. */
  saved(doc: Text) {
    for (const peer of this.hub?.peers ?? []) {
      if (peer === this || !peer.inSync(peer.view.state.doc)) continue;
      peer.hooks.saved?.(doc);
    }
  }

  destroy() {
    const hub = this.hub;
    const key = this.key;
    if (!hub || !key) return;
    hub.peers.delete(this);
    const joins = hub.joins;
    // A rebuilt editor registers again in the same task: it keeps the history
    // and its own pending save, so nothing is handed over.
    queueMicrotask(() => {
      if (hub.joins !== joins) return;
      if (hub.peers.size === 0) {
        if (hubs.get(key) === hub) hubs.delete(key);
        return;
      }
      // The editors that share the text need one save between them.
      for (const peer of hub.peers) {
        if (peer.inSync(peer.view.state.doc) && peer.hooks.peerLeft?.()) return;
      }
    });
  }
}

const sharedHistoryPlugin = ViewPlugin.define(
  (view) => new SharedHistoryPeer(view, view.state.facet(sharedHistoryKey)),
);

function shared(command: StateCommand) {
  return (view: EditorView) => {
    const peer = view.plugin(sharedHistoryPlugin);
    return peer ? peer.run(command) : command(view);
  };
}

export const sharedUndo = shared(undo);
export const sharedRedo = shared(redo);

export function sharedUndoDepth(view: EditorView): number {
  return view.plugin(sharedHistoryPlugin)?.depth(undoDepth) ?? undoDepth(view.state);
}

export function sharedRedoDepth(view: EditorView): number {
  return view.plugin(sharedHistoryPlugin)?.depth(redoDepth) ?? redoDepth(view.state);
}

/** Call after `view` wrote `doc` to disk, so the other editors adopt it. */
export function sharedDocumentSaved(view: EditorView, doc: Text) {
  view.plugin(sharedHistoryPlugin)?.saved(doc);
}

function documentKey(path: string): string {
  return path.replace(/\\/g, "/");
}

/**
 * Shares this editor's document and undo history with every other editor on
 * `path`. Keeps the editor's own history extension (from the basic setup) in
 * place; the bindings here take precedence over its keymap.
 */
export function editorSharedHistory(path: string, hooks: SharedDocumentHooks = {}): Extension {
  if (!path) return [];
  return [
    sharedHistoryKey.of(documentKey(path)),
    sharedHistoryHooks.of(hooks),
    sharedHistoryPlugin,
    Prec.highest([
      keymap.of([
        { key: "Mod-z", run: sharedUndo, preventDefault: true },
        { key: "Mod-y", mac: "Mod-Shift-z", run: sharedRedo, preventDefault: true },
        { linux: "Ctrl-Shift-z", run: sharedRedo, preventDefault: true },
        { key: "Mod-u", run: shared(undoSelection), preventDefault: true },
        { key: "Alt-u", mac: "Mod-Shift-u", run: shared(redoSelection), preventDefault: true },
      ]),
      EditorView.domEventHandlers({
        beforeinput(event, view) {
          const command =
            event.inputType === "historyUndo"
              ? sharedUndo
              : event.inputType === "historyRedo"
                ? sharedRedo
                : null;
          if (!command) return false;
          event.preventDefault();
          return command(view);
        },
      }),
    ]),
  ];
}
