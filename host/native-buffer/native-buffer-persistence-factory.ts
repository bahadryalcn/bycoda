import { dirname, join } from "node:path";
import type { NativeBufferPersistence } from "../ports/native-buffer-persistence";
import type { HostStore } from "../store";
import { createNativeBufferCompositePersistence } from "./native-buffer-composite-persistence";
import {
  createNativeBufferGitPersistence,
  type NativeBufferGitPersistence,
} from "./native-buffer-git-persistence";
import { registerNativeBufferGitStore } from "./native-buffer-git-registry";
import { createNativeBufferPersistenceStore } from "./native-buffer-persistence-store";

type Options = {
  /** Test seam: replaces the git half. */
  git?: NativeBufferGitPersistence;
  warn?: (message: string) => void;
};

/**
 * Git store (primary) with the SQL store as legacy fallback; plain SQL store when `git`
 * is not available. The choice is made once, on first use, and logged once.
 */
export function createNativeBufferPersistence(
  store: HostStore,
  options: Options = {},
): NativeBufferPersistence {
  const sql = createNativeBufferPersistenceStore(store);
  const git =
    options.git ??
    createNativeBufferGitPersistence({
      gitDir: join(dirname(store.attachmentDir), "native-buffer-store.git"),
      clocks: sql,
    });
  let chosen: Promise<NativeBufferPersistence> | undefined;
  const choose = () =>
    (chosen ??= (async () => {
      if (await git.available().catch(() => false)) {
        registerNativeBufferGitStore(store, git);
        return createNativeBufferCompositePersistence({ primary: git, legacy: sql });
      }
      (options.warn ?? console.warn)(
        "Native buffer git store unavailable (git not found); using the SQL native buffer store.",
      );
      return sql;
    })());
  return {
    readClock: (id) => choose().then((p) => p.readClock(id)),
    initializeClock: (s, a) => choose().then((p) => p.initializeClock(s, a)),
    advanceClock: (e, n, a) => choose().then((p) => p.advanceClock(e, n, a)),
    read: (key, limit) => choose().then((p) => p.read(key, limit)),
    directoryView: () => choose().then((p) => p.directoryView()),
    hasEntry: (d, n, v) => choose().then((p) => p.hasEntry(d, n, v)),
    entries: (d, a, l, v) => choose().then((p) => p.entries(d, a, l, v)),
    complete: (b) => choose().then((p) => p.complete(b)),
    readCertificate: (r, l) => choose().then((p) => p.readCertificate(r, l)),
  };
}
