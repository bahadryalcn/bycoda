import { useState, type SetStateAction } from "react";
import { socialQueryScope } from "../../model/socialQuery";
import type { SocialClient } from "../../model/socialClient";
import { emptyDraft, type ContentDraft } from "./contentDraft";

type WorkspaceDraft = {
  draft: ContentDraft;
  baseline: ContentDraft;
  open: boolean;
  busy?: boolean;
  uploading?: boolean;
  notice?: { tone: "success" | "warning"; text: string };
};

const fresh = (): WorkspaceDraft => {
  const draft = emptyDraft();
  return { draft, baseline: draft, open: false };
};

/** Local work belongs to its original Host/project, including delayed save completions. */
export function useContentDraft(client: SocialClient, projectId?: string) {
  const key = JSON.stringify([...socialQueryScope(client), projectId ?? ""]);
  const [workspaces, setWorkspaces] = useState<Record<string, WorkspaceDraft>>({});
  const current = workspaces[key] ?? fresh();
  const update = (change: (value: WorkspaceDraft) => WorkspaceDraft) =>
    setWorkspaces((all) => ({ ...all, [key]: change(all[key] ?? fresh()) }));
  const setDraft = (next: SetStateAction<ContentDraft>) =>
    update((value) => ({
      ...value,
      draft: typeof next === "function" ? next(value.draft) : next,
    }));
  const setOpen = (open: boolean) => update((value) => ({ ...value, open }));
  const setNotice = (notice: WorkspaceDraft["notice"]) => update((value) => ({ ...value, notice }));
  const setBusy = (busy: boolean) => update((value) => ({ ...value, busy }));
  const setUploading = (uploading: boolean) => update((value) => ({ ...value, uploading }));
  const loadDraft = (draft: ContentDraft) =>
    update((value) => ({ ...value, draft, baseline: draft }));
  const reset = () => update(() => fresh());
  return {
    key,
    ...current,
    dirty: JSON.stringify(current.draft) !== JSON.stringify(current.baseline),
    setDraft,
    setOpen,
    setNotice,
    setBusy,
    setUploading,
    loadDraft,
    reset,
  };
}
