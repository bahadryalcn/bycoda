import { Button } from "../../../shared/ui/Button";
import { TextField } from "../../../shared/ui/TextField";
import { t, useLocale } from "../../../shared/i18n/git";
import { useActionState, useEffect, useMemo, useRef, useState } from "react";
import { useProjectBranchesState } from "../hooks/useProjectBranches";
import { LAYER } from "../../../shared/lib/layers";
import { createWorktree, type Worktree } from "../model/worktrees";
import { prettyCwd } from "../../../shared/lib/paths";
import { Modal } from "../../../shared/ui/Modal";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { Loader } from "../../../shared/ui/icons";

export function CreateWorktreeDialog({
  cwd,
  baseCwd,
  defaultRoot,
  onCreated,
  onCancel,
}: {
  cwd: string;
  baseCwd: string;
  defaultRoot?: string;
  onCreated: (tree: Worktree) => void | Promise<void>;
  onCancel: () => void;
}) {
  const locale = useLocale();
  const { branches, settled } = useProjectBranchesState(baseCwd, true);
  // The picker only presents the lookup: git is still answering, or answered without a branch list.
  const branchLoading = !settled;
  const branchError =
    settled && !branches ? t("Couldn’t load branches for this project.") : undefined;
  const [name, setName] = useState("");
  const [base, setBase] = useState("HEAD");
  const [existing, setExisting] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (existing) return;
    const frame = requestAnimationFrame(() => input.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [existing]);
  const localBranches = useMemo(
    () =>
      (branches?.branches ?? [])
        .filter((branch) => !branch.remote)
        .map((branch) => ({ value: branch.name, label: branch.name })),
    [branches],
  );
  const baseOptions = useMemo(
    () => [
      {
        value: "HEAD",
        label: t("Current commit{p0}", {
          p0: branches?.current ? ` (${branches.current})` : "",
        }),
        keywords: "HEAD current commit",
      },
      ...(branches?.branches ?? []).map((branch) => {
        const ref = branch.remote ? `${branch.remote}/${branch.name}` : branch.name;
        return { value: ref, label: ref };
      }),
    ],
    [locale, branches],
  );
  const [error, submit, busy] = useActionState<string | undefined, FormData>(async () => {
    if (!name.trim()) return;
    try {
      const tree = await createWorktree(baseCwd, name.trim(), base, existing);
      await onCreated(tree);
    } catch (err) {
      return String(err);
    }
  }, undefined);
  return (
    <Modal
      languageDomain="git"
      title={t("Create worktree")}
      size="sm"
      onClose={() => {
        if (!busy) onCancel();
      }}
    >
      <form className="flex flex-col gap-4 p-4" action={submit}>
        <p className="text-[12px] text-[var(--ui-text-secondary)]">
          {t("An independent working copy of ")}
          {prettyCwd(cwd)}
          {t(". Existing uncommitted changes stay in their current working copy.")}
        </p>
        <SearchableSelect
          label={t("Branch type")}
          visibleLabel
          disabled={busy}
          value={existing ? "existing" : "new"}
          options={[
            {
              value: "new",
              get label() {
                return t("Create a new branch");
              },
            },
            {
              value: "existing",
              get label() {
                return t("Use an existing local branch");
              },
            },
          ]}
          onChange={(value) => {
            setExisting(value === "existing");
            setName("");
          }}
          searchPlaceholder="Search options…"
          layer={LAYER.dialogPopover}
        />
        {existing ? (
          <SearchableSelect
            label={t("Existing branch")}
            visibleLabel
            value={name}
            disabled={busy}
            options={localBranches}
            loading={branchLoading}
            loadingLabel={t("Loading branches…")}
            error={branchError}
            onChange={setName}
            placeholder={t("Choose a branch…")}
            searchPlaceholder="Search local branches…"
            emptyLabel="No matching local branches"
            layer={LAYER.dialogPopover}
          />
        ) : (
          <TextField
            label={t("New branch name")}
            aria-label={t("New branch name")}
            ref={input}
            value={name}
            disabled={busy}
            placeholder={t("feature/my-task")}
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => setName(e.target.value)}
          />
        )}
        {!existing && (
          <SearchableSelect
            label={t("Start from")}
            visibleLabel
            value={base}
            disabled={busy}
            options={baseOptions}
            loading={branchLoading}
            loadingLabel={t("Loading branches…")}
            error={branchError}
            onChange={setBase}
            searchPlaceholder="Search branches and refs…"
            layer={LAYER.dialogPopover}
          />
        )}
        {defaultRoot && (
          <p className="break-all text-[11px] text-[var(--ui-text-muted)]">
            {t("Created in ")}
            {prettyCwd(defaultRoot)}
          </p>
        )}
        {error && (
          <p role="alert" className="text-[12px] text-danger">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" motion="none" type="button" disabled={busy} onClick={onCancel}>
            {t("Cancel")}
          </Button>
          <Button
            variant="primary"
            motion="none"
            type="submit"
            disabled={busy || !name.trim()}
            className="inline-flex items-center gap-1.5"
          >
            {busy && <Loader className="size-3.5 animate-spin" />}
            {t("Create worktree")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
