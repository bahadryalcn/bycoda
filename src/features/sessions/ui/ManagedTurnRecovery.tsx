import { createContext, useContext, useRef, useState } from "react";
import { useT } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { recoverNativeManagedTurn } from "../../workspaces/model/nativeManagedTurn";

export const ManagedTurnRecoveryContext = createContext<
  { sessionId: string; errorId: string } | undefined
>(undefined);

/** Recovery never starts execution or clears history; only the Host can release the fence. */
export function ManagedTurnRecovery({ blockId }: { blockId: string }) {
  const target = useContext(ManagedTurnRecoveryContext);
  const t = useT();
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<{ released: boolean; message: string }>();
  const running = useRef(false);
  if (!target || target.errorId !== blockId) return null;
  return (
    <div
      className="flex min-w-0 flex-col items-start gap-1.5 pt-2 font-sans"
      data-managed-turn-recovery
    >
      {!result?.released ? (
        <Button
          variant="secondary"
          size="sm"
          motion="none"
          loading={pending}
          loadingLabel={t("Checking stuck turn")}
          onClick={async () => {
            if (running.current) return;
            running.current = true;
            setPending(true);
            setResult(undefined);
            try {
              const state = await recoverNativeManagedTurn(target.sessionId);
              setResult({
                released: state.released,
                message: state.released
                  ? t("Stuck turn reset. You can send again.")
                  : state.reason ||
                    t(
                      "This turn is still fenced. The Host could not confirm that no execution occurred.",
                    ),
              });
            } catch (error) {
              setResult({ released: false, message: String(error) });
            } finally {
              running.current = false;
              setPending(false);
            }
          }}
        >
          {t("Reset stuck turn")}
        </Button>
      ) : null}
      {result ? (
        <p
          role="status"
          className="min-w-0 whitespace-pre-wrap break-words text-ui-caption text-(--ui-text-secondary)"
        >
          {result.message}
        </p>
      ) : null}
    </div>
  );
}
