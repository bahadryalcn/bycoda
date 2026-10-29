import { useContext } from "react";
import { Button } from "../../../shared/ui/Button";
import { t } from "../../../shared/i18n";
import type { ProgramDetail, SocialProgram } from "../model/socialProgram";
import { SocialBusyContext } from "./socialContext";
import type { Props } from "./socialShared";
import { useSocialPending } from "./useSocialPending";

/** Selectable list of the campaign programs of the current project filter. */
export function ProgramList({
  programs,
  activeId,
  client,
  run,
  onOpen,
}: {
  programs: SocialProgram[];
  activeId?: string;
  client: Props["client"];
  run: Props["run"];
  onOpen: (detail: ProgramDetail) => void;
}) {
  const pendingUi = useSocialPending();
  const socialLocked = useContext(SocialBusyContext);
  return (
    <div className="social-program-list">
      {programs.map((p) => (
        <Button
          variant="tab"
          loading={pendingUi.is(`program.select:${p.id}`)}
          type="button"
          key={p.id}
          disabled={socialLocked}
          aria-pressed={activeId === p.id}
          onClick={() =>
            void pendingUi.run(`program.select:${p.id}`, () =>
              run(async () => {
                onOpen(await client.request<ProgramDetail>("programs.status", { id: p.id }));
              }),
            )
          }
        >
          <strong>{p.name}</strong>
          <span>
            {p.enabled ? t("Active") : p.cancelled ? t("Cancelled") : t("Paused")} · {p.nextSequence}/
            {p.totalPosts ?? "∞"}
          </span>
        </Button>
      ))}
    </div>
  );
}
