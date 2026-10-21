import { useRef, useState } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { Modal } from "../../../shared/ui/Modal";
import { Alert } from "../../../shared/ui/Alert";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { TextareaField } from "../../../shared/ui/TextareaField";
import type { BackgroundSessionTarget } from "../../tasks/model/backgroundSession";
import type { CrewRun } from "../model/crew";
import type { useProjectCrews } from "../model/crewClient";
import { Bot, Settings, SlidersHorizontal, type IconComponent } from "../../../shared/ui/icons";
import { CrewEditor, type CrewEditorView } from "./CrewEditor";

const VIEWS: { id: CrewEditorView; label: string; icon: IconComponent }[] = [
  { id: "general", label: "General", icon: Settings },
  { id: "team", label: "Team", icon: Bot },
  { id: "limits", label: "Limits", icon: SlidersHorizontal },
];

/** A crew's settings: a page list on the left, one editor kept across pages. */
export function CrewEditDialog({
  cwd,
  crewId,
  createScope,
  initialView = "general",
  onClose,
}: {
  cwd: string;
  crewId?: string;
  createScope?: "project" | "global";
  initialView?: CrewEditorView;
  onClose: () => void;
}) {
  useLocale();
  const [view, setView] = useState<CrewEditorView>(initialView);
  return (
    <Modal title={t("Crew settings")} size="lg" onClose={onClose}>
      <div className="flex min-h-[min(560px,70vh)] max-sm:flex-col">
        <nav
          aria-label={t("Crew settings")}
          className="flex shrink-0 flex-col gap-px border-e border-(--ui-tone-neutral-border) p-2 sm:w-40 max-sm:flex-row max-sm:border-e-0 max-sm:border-b"
        >
          {VIEWS.map(({ id, label, icon: Icon }) => (
            <Button
              key={id}
              variant="item"
              motion="none"
              selected={view === id}
              aria-current={view === id ? "page" : undefined}
              onClick={() => setView(id)}
            >
              <Icon className="size-3.5 shrink-0" aria-hidden />
              <span className="min-w-0 flex-1 truncate text-start">{t(label)}</span>
            </Button>
          ))}
        </nav>
        <div className="min-w-0 flex-1 p-4">
          <CrewEditor cwd={cwd} crewId={crewId} createScope={createScope} view={view} />
        </div>
      </div>
    </Modal>
  );
}

export function StartCrewDialog({
  cwd,
  state,
  definitionId: initialDefinition,
  onOpen,
  onEdit,
  onClose,
}: {
  cwd: string;
  state: ReturnType<typeof useProjectCrews>;
  definitionId?: string;
  onOpen?: (target: BackgroundSessionTarget) => void | Promise<void>;
  /** Opens the editor for the chosen crew. */
  onEdit?: (definitionId: string) => void;
  onClose: () => void;
}) {
  useLocale();
  const data = state.data;
  const [definitionId, setDefinitionId] = useState(
    initialDefinition ?? data?.definitions[0]?.id ?? "",
  );
  const [prompt, setPrompt] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const pendingGate = useRef(false);
  const startRequest = useRef<{ signature: string; id: string } | null>(null);
  const start = async () => {
    if (pendingGate.current) return;
    pendingGate.current = true;
    setPending(true);
    setError("");
    try {
      const signature = JSON.stringify([definitionId, prompt]);
      if (startRequest.current?.signature !== signature)
        startRequest.current = { signature, id: crypto.randomUUID() };
      const run = await state.call<CrewRun>("crews.start", {
        definitionId,
        prompt,
        requestId: startRequest.current.id,
      });
      if (run.error) throw new Error(run.error);
      onClose();
      if (run.coordinatorSessionId && onOpen && data)
        await onOpen({
          cwd,
          machineId: data.machine.id,
          projectId: data.project.id,
          sessionId: run.coordinatorSessionId,
        });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      pendingGate.current = false;
      setPending(false);
    }
  };
  return (
    <Modal
      title={t("Start crew")}
      onClose={() => {
        if (!pending) onClose();
      }}
      size="md"
    >
      <div className="flex flex-col gap-3 p-4">
        {error && <Alert tone="danger">{error}</Alert>}
        <SearchableSelect
          label={t("Crew")}
          value={definitionId}
          options={
            data?.definitions.map((d) => ({
              value: d.id,
              label: d.name,
              description: d.projectId ? t("This project") : t("All projects on this host"),
            })) ?? []
          }
          onChange={setDefinitionId}
          disabled={pending}
        />
        <TextareaField
          label={t("Crew assignment")}
          placeholder={t("What should this crew deliver?")}
          value={prompt}
          disabled={pending}
          onChange={(e) => setPrompt(e.target.value)}
        />
        <div className="flex justify-end gap-2">
          {onEdit && definitionId ? (
            <Button variant="ghost" onClick={() => onEdit(definitionId)} disabled={pending}>
              {t("Edit crew")}
            </Button>
          ) : null}
          <Button
            variant="primary"
            disabled={!definitionId || !prompt.trim() || pending}
            loading={pending}
            onClick={() => void start()}
          >
            {t("Start crew")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
