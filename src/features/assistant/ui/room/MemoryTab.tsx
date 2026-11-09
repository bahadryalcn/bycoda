import { AssistantMemoryPanel } from "../AssistantMemoryPanel";
import type { AssistantSnapshot } from "../../../../shared/model/host-contracts/assistant";
import { t } from "../../../../shared/i18n";
import { useAssistantRoom } from "./assistantRoomContext";

export function MemoryTab({ snapshot }: { snapshot: AssistantSnapshot }) {
  const room = useAssistantRoom();
  const {
    environmentId,
    assistantRequest,
    view,
    query,
    setQuery,
    pending,
    setConfirm,
    setUndo,
    memorySearching,
    memoryEntries,
    setMemoryEdit,
    mutate,
    errorFor,
  } = room;

  return (
    <>
      {view === "Memory" && (
        <AssistantMemoryPanel
          entries={memoryEntries}
          ruleCount={snapshot.memory.filter((entry) => entry.kind === "rule").length}
          query={query}
          searching={memorySearching}
          pending={Boolean(pending)}
          searchError={errorFor("memory.search")}
          errorFor={errorFor}
          onQuery={setQuery}
          onAdd={() => setMemoryEdit("new")}
          onEdit={setMemoryEdit}
          onToggle={(entry, active) =>
            mutate(entry.id, t("Saving..."), {
              op: "memory.save",
              id: entry.id,
              kind: entry.kind,
              text: entry.text,
              scope: entry.scope,
              source: entry.source,
              quote: entry.quote,
              forbiddenTerms: entry.forbiddenTerms,
              expectedVersion: entry.version,
              active,
            })
          }
          onDelete={(entry) =>
            setConfirm({
              title: t("Delete memory?"),
              message: entry.text,
              confirmLabel: t("Delete"),
              onConfirm: async () => {
                await assistantRequest({
                  op: "memory.delete",
                  id: entry.id,
                  expectedVersion: entry.version,
                });
                setUndo({
                  id: `memory:${entry.id}`,
                  label: entry.text,
                  environmentId,
                });
              },
            })
          }
        />
      )}
    </>
  );
}
