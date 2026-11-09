import type { HostStore } from "../store";

const gitStores = new WeakMap<HostStore, { gc(): Promise<unknown> }>();
/** Set by the persistence factory when a Host runs on the git store. */
export const registerNativeBufferGitStore = (store: HostStore, git: { gc(): Promise<unknown> }) =>
  gitStores.set(store, git);
/** The git store a Host uses, if any; the maintenance pass runs its gc. */
export const nativeBufferGitStoreFor = (store: HostStore) => gitStores.get(store);
