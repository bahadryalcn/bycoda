import { useEffect, useRef, useState } from "react";
import { useT } from "../../../../shared/i18n";
import { Button } from "../../../../shared/ui/Button";
import { WandSparkles } from "../../../../shared/ui/icons";
import { useModelSource } from "../../../sessions/public/modelSource";
import type { OrderDraft } from "../../model/modelRoutingDraft";
import { applySmartSetup, setupCandidates, type SetupCandidate } from "../../model/smartSetup";
import { refineSetupCandidates } from "../../model/smartSetupAi";

/**
 * One reversible draft edit: adds every available account and model, sorts the order and creates
 * the pools. Persistence stays with the version-bound Save. Failures reach the owner through the
 * draft editor's error line.
 */
export function SmartSetupAction({
  variant = "primary",
  onEdit,
}: {
  variant?: "primary" | "secondary";
  onEdit: (operation: (draft: OrderDraft) => OrderDraft) => void;
}) {
  const t = useT();
  const source = useModelSource();
  const [running, setRunning] = useState(false);
  const abort = useRef<AbortController | null>(null);
  // The edit lands after an async step, so it must use the editor of the latest render.
  const latestEdit = useRef(onEdit);
  useEffect(() => {
    latestEdit.current = onEdit;
  }, [onEdit]);
  // Unmounting abandons a running refinement instead of editing a draft that is gone.
  useEffect(() => () => abort.current?.abort(), []);
  async function run() {
    const controller = new AbortController();
    abort.current = controller;
    setRunning(true);
    let candidates: SetupCandidate[] = [];
    let failure: unknown;
    try {
      candidates = setupCandidates(source);
      if (candidates.length)
        candidates = (await refineSetupCandidates(candidates, { signal: controller.signal }))
          .candidates;
    } catch (cause) {
      failure = cause;
    }
    if (controller.signal.aborted) return;
    setRunning(false);
    const names = {
      smartest: t("Smartest"),
      balanced: t("Balanced"),
      fast: t("Fast"),
      work: t("Work"),
      personal: t("Personal"),
    };
    latestEdit.current((draft) => {
      if (failure) throw failure;
      if (!candidates.length)
        throw new Error("No available provider models found. Check Providers and try again.");
      return applySmartSetup(draft, candidates, names);
    });
  }
  return (
    <Button
      variant={variant}
      size="sm"
      startIcon={<WandSparkles className="icon-sm" />}
      loading={running}
      loadingLabel={t("Setting up…")}
      onClick={() => void run()}
    >
      {t("Smart setup")}
    </Button>
  );
}
