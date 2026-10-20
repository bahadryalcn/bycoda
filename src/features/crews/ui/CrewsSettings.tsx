import { useEffect, useState } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { SegmentedControl } from "../../../shared/ui/SegmentedControl";
import { Button } from "../../../shared/ui/Button";
import { TextField } from "../../../shared/ui/TextField";
import { TextareaField } from "../../../shared/ui/TextareaField";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import {
  Bot,
  Shield,
  CodeBlock,
  AiIdea,
  ChevronRight,
  ChevronLeft,
  Plus,
} from "../../../shared/ui/icons";
import { Alert } from "../../../shared/ui/Alert";
import { Group, Row, Select, Toggle } from "../../settings/ui/settingsControls";
import {
  defaultCrewPolicy,
  type CrewDefinition,
  type CrewAgent,
  type CrewCandidate,
  type CrewRole,
} from "../model/crew";
import { useProjectCrews, type ProjectCrews } from "../model/crewClient";

// Like note drafts, these survive navigation for the lifetime of this window.
// Host + project identity prevents a draft leaking into another connection.
const crewDrafts = new Map<
  string,
  {
    selectedDraft: CrewDefinition | null;
    drafts: Record<string, CrewDefinition>;
  }
>();

export function CrewsSettings({ cwd }: { cwd: string }) {
  useLocale();
  const state = useProjectCrews(cwd);
  if (!state.data)
    return (
      <Alert tone={state.error ? "warning" : "info"}>
        {state.error ? state.error.message : t("Loading crews…")}
        <Button variant="ghost" onClick={() => void state.refetch()}>
          {t("Retry")}
        </Button>
      </Alert>
    );
  const draftKey = JSON.stringify([state.data.machine.id, state.data.project.id]);
  return (
    <ConnectedCrewsSettings key={draftKey} draftKey={draftKey} state={state} data={state.data} />
  );
}

function ConnectedCrewsSettings({
  state,
  data,
  draftKey,
}: {
  state: ReturnType<typeof useProjectCrews>;
  data: ProjectCrews;
  draftKey: string;
}) {
  useLocale();
  const [selectedDraft, setDraft] = useState<CrewDefinition | null>(
    () => crewDrafts.get(draftKey)?.selectedDraft ?? null,
  );
  const [drafts, setDrafts] = useState<Record<string, CrewDefinition>>(
    () => crewDrafts.get(draftKey)?.drafts ?? {},
  );
  useEffect(() => {
    crewDrafts.set(draftKey, { selectedDraft, drafts });
  }, [draftKey, selectedDraft, drafts]);
  const [page, setPage] = useState("team");
  const [memberPage, setMemberPage] = useState("role");
  const [selectedMember, setSelectedMember] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [libraryAgent, setLibraryAgent] = useState("");
  const [inspection, setInspection] = useState<
    Record<
      string,
      {
        model: string;
        imageGeneration?: boolean;
        observations: { count: number; passed: number; accepted: number };
      }[]
    >
  >({});
  const draft = selectedDraft ?? data.definitions[0] ?? null;
  const latest = data.definitions.find((definition) => definition.id === draft?.id);
  const conflict = !!draft?.updatedAt && !!latest && latest.updatedAt !== draft.updatedAt;
  const catalog = Object.values(data.catalog.models).flatMap((models) => models ?? []);
  const options = catalog.map((model) => ({
    value: `${model.harness}/${model.id}`,
    label: model.name,
    description: model.harness,
  }));
  const candidate = (value: string): CrewCandidate | undefined => {
    const model = catalog.find((m) => `${m.harness}/${m.id}` === value);
    return model
      ? { id: value, harness: model.harness, model: model.id, modelSettings: {}, capabilities: {} }
      : undefined;
  };
  const edit = (value: CrewDefinition) => {
    if (draft) setDrafts((current) => ({ ...current, [draft.id]: structuredClone(draft) }));
    setDraft(structuredClone(drafts[value.id] ?? value));
    setSelectedMember(null);
    setPage("team");
    setMemberPage("role");
    setError("");
    setSaved(false);
  };
  const update = (patch: Partial<CrewDefinition>) => {
    if (draft) {
      setDraft({ ...draft, ...patch });
      setSaved(false);
    }
  };
  const member = (id: string, patch: Partial<CrewAgent>) => {
    if (draft) update({ agents: draft.agents.map((a) => (a.id === id ? { ...a, ...patch } : a)) });
  };
  const create = () => {
    const make = (name: string, role: CrewRole): CrewAgent => ({
      id: crypto.randomUUID(),
      name,
      role,
      instructions: "",
      selection: "fixed",
      candidates: options[0] ? [candidate(options[0].value)!] : [],
    });
    edit({
      id: crypto.randomUUID(),
      name: t("New crew"),
      projectId: data.project.id,
      agents: [
        make(t("Coordinator"), "coordinator"),
        make(t("Backend"), "specialist"),
        make(t("UI"), "specialist"),
        make(t("Reviewer"), "reviewer"),
      ],
      policy: { ...defaultCrewPolicy },
      updatedAt: 0,
    });
  };
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0 flex-1 basis-56">
          <SearchableSelect
            label={t("Your crews")}
            value={draft?.id ?? ""}
            options={Object.values({
              ...Object.fromEntries(data.definitions.map((d) => [d.id, d])),
              ...drafts,
              ...(draft ? { [draft.id]: draft } : {}),
            }).map((d) => ({
              value: d.id,
              label: d.name,
              description: !d.updatedAt
                ? t("Unsaved crew")
                : d.projectId
                  ? t("This project")
                  : t("All projects on this host"),
            }))}
            disabled={pending}
            onChange={(id) => {
              const d = drafts[id] ?? data.definitions.find((d) => d.id === id);
              if (d) edit(d);
            }}
          />
        </div>
        <Button onClick={create} disabled={pending} startIcon={<Plus className="size-3.5" />}>
          {t("New crew")}
        </Button>
        {draft && (
          <Button
            disabled={pending}
            onClick={() =>
              edit({
                ...structuredClone(draft),
                id: crypto.randomUUID(),
                name: t("{p0} copy", { p0: draft.name }),
                updatedAt: 0,
              })
            }
          >
            {t("Duplicate crew")}
          </Button>
        )}
      </div>
      {error && <Alert tone="danger">{error}</Alert>}
      {conflict && (
        <Alert tone="warning">
          <p>
            {t(
              "This crew changed in another session. Keep your edits as a new crew or discard them to load the latest version.",
            )}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={pending}
              onClick={() => {
                if (!draft) return;
                setDrafts((current) => {
                  const next = { ...current };
                  delete next[draft.id];
                  return next;
                });
                setDraft({ ...draft, id: crypto.randomUUID(), updatedAt: 0 });
                setError("");
                setSaved(false);
              }}
            >
              {t("Keep edits as new crew")}
            </Button>
            <Button
              disabled={pending}
              onClick={() => {
                if (!latest) return;
                setDrafts((current) => {
                  const next = { ...current };
                  delete next[latest.id];
                  return next;
                });
                setDraft(structuredClone(latest));
                setSelectedMember(null);
                setError("");
                setSaved(false);
              }}
            >
              {t("Discard edits and load latest")}
            </Button>
          </div>
        </Alert>
      )}
      {!draft ? (
        <div className="flex flex-col items-start gap-2 rounded-lg border border-(--ui-tone-neutral-border) p-6">
          <Bot className="size-6 text-(--ui-text-secondary)" aria-hidden />
          <h3 className="text-base font-semibold">{t("Build your team")}</h3>
          <p className="text-sm text-(--ui-text-secondary)">
            {t(
              "One coordinator, specialist agents and an independent reviewer. Start with a ready-made team and choose their models.",
            )}
          </p>
          <Button onClick={create}>{t("Create your first crew")}</Button>
        </div>
      ) : (
        <fieldset
          key={draft.id}
          disabled={pending}
          className="flex min-w-0 flex-col gap-4 border-0 p-0"
        >
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-(--ui-tone-neutral-border) pb-4">
            <div>
              <h3 className="text-lg font-semibold tracking-tight">{draft.name}</h3>
              <p className="mt-1 text-xs text-(--ui-text-secondary)">
                {t("{p0} members", { p0: draft.agents.length })} ·{" "}
                {draft.projectId ? t("This project") : t("All projects on this host")}
              </p>
            </div>
            <Button
              variant="primary"
              disabled={pending || conflict}
              loading={pending}
              onClick={async () => {
                setPending(true);
                setError("");
                try {
                  const definition = await state.call<CrewDefinition>("crews.save", {
                    definition: draft,
                    expectedUpdatedAt: draft.updatedAt || undefined,
                  });
                  setDrafts((current) => {
                    const next = { ...current };
                    delete next[draft.id];
                    return next;
                  });
                  setDraft(definition);
                  const retained = { ...drafts };
                  delete retained[draft.id];
                  // A save may finish after navigation. Do not overwrite a
                  // newer draft entered in a subsequently mounted settings view.
                  if (crewDrafts.get(draftKey)?.selectedDraft === selectedDraft)
                    crewDrafts.set(draftKey, { selectedDraft: definition, drafts: retained });
                  setSaved(true);
                } catch (reason) {
                  setError(reason instanceof Error ? reason.message : String(reason));
                  void state.refetch();
                } finally {
                  setPending(false);
                }
              }}
            >
              {saved ? t("Saved") : t("Save crew")}
            </Button>
          </div>
          <SegmentedControl
            label={t("Crew view")}
            value={page}
            options={[
              { value: "team", label: t("Team") },
              { value: "work", label: t("Working style") },
              { value: "general", label: t("Crew settings") },
            ]}
            onValueChange={setPage}
          />
          {page === "team" && (
            <div className="flex min-w-0 flex-col gap-4">
              {!selectedMember && (
                <>
                  {" "}
                  <section aria-label={t("Team members")} className="flex flex-col gap-2">
                    <div className="flex items-center justify-between gap-2">
                      <h4 className="text-sm font-semibold">{t("Team members")}</h4>
                      <Button
                        variant="ghost"
                        startIcon={<Plus className="size-3.5" />}
                        onClick={() => {
                          const id = crypto.randomUUID();
                          update({
                            agents: [
                              ...draft.agents,
                              {
                                id,
                                name: t("Specialist"),
                                role: "specialist",
                                instructions: "",
                                selection: "fixed",
                                candidates: options[0] ? [candidate(options[0].value)!] : [],
                              },
                            ],
                          });
                          setSelectedMember(id);
                          setMemberPage("role");
                        }}
                      >
                        {t("Add member")}
                      </Button>
                    </div>
                    <div className="overflow-hidden rounded-lg border border-(--ui-tone-neutral-border) divide-y divide-(--ui-tone-neutral-border)">
                      {draft.agents.map((agent) => (
                        <Button
                          key={agent.id}
                          variant="item"
                          motion="none"
                          className="w-full px-3 py-3"
                          selected={selectedMember === agent.id}
                          onClick={() => {
                            setSelectedMember(agent.id);
                            setMemberPage("role");
                          }}
                        >
                          <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-(--ui-surface) text-(--ui-text-secondary)">
                            {agent.role === "reviewer" ? (
                              <Shield className="size-4" aria-hidden />
                            ) : agent.role === "specialist" ? (
                              <CodeBlock className="size-4" aria-hidden />
                            ) : agent.role === "advisor" ? (
                              <AiIdea className="size-4" aria-hidden />
                            ) : (
                              <Bot className="size-4" aria-hidden />
                            )}
                          </span>
                          <span className="min-w-0 flex-1 text-start">
                            <span className="block truncate text-sm font-medium">
                              {agent.name || t("Member")}
                            </span>
                            <span className="block whitespace-normal text-xs text-(--ui-text-secondary)">
                              {t(
                                agent.role === "coordinator"
                                  ? "Plans and coordinates work"
                                  : agent.role === "reviewer"
                                    ? "Checks quality independently"
                                    : agent.role === "advisor"
                                      ? "Gives specialist advice"
                                      : "Delivers assigned work",
                              )}
                            </span>
                          </span>
                          <span
                            className="max-w-[40%] truncate text-xs text-(--ui-text-secondary)"
                            title={agent.candidates
                              .map((c) => `${c.harness} · ${c.model}`)
                              .join("\n")}
                          >
                            {agent.candidates.length
                              ? (agent.selection === "automatic" ? t("Automatic") + " · " : "") +
                                (catalog.find(
                                  (m) =>
                                    m.harness === agent.candidates[0].harness &&
                                    m.id === agent.candidates[0].model,
                                )?.name ?? agent.candidates[0].model)
                              : t("Choose a model")}
                          </span>
                          <ChevronRight className="size-3.5 shrink-0" aria-hidden />
                        </Button>
                      ))}
                    </div>
                  </section>
                  {!!data.agents.length && (
                    <div className="flex flex-wrap items-center gap-2">
                      <SearchableSelect
                        label={t("Agent library")}
                        value={libraryAgent}
                        options={data.agents.map((a) => ({
                          value: a.id,
                          label: a.name,
                          description: `${a.role} · ${a.projectId ? t("Project") : t("Global")}`,
                        }))}
                        onChange={setLibraryAgent}
                      />
                      <Button
                        variant="secondary"
                        disabled={!libraryAgent}
                        onClick={() => {
                          const agent = data.agents.find((a) => a.id === libraryAgent);
                          if (agent)
                            update({
                              agents: [
                                ...draft.agents,
                                { ...structuredClone(agent), id: crypto.randomUUID() },
                              ],
                            });
                        }}
                      >
                        {t("Add from library")}
                      </Button>
                    </div>
                  )}
                </>
              )}
              {draft.agents
                .filter((agent) => agent.id === selectedMember)
                .map((agent) => (
                  <section
                    key={agent.id}
                    id={`crew-member-${agent.id}`}
                    aria-label={t("Edit member")}
                    className="rounded-lg border border-(--ui-tone-neutral-border) p-4"
                  >
                    <div className="mb-4 flex items-center justify-between gap-2">
                      <h4 className="text-sm font-semibold">
                        {t("Edit member")} · {agent.name}
                      </h4>
                      <Button
                        variant="ghost"
                        startIcon={<ChevronLeft className="size-3.5" />}
                        onClick={() => setSelectedMember(null)}
                      >
                        {t("Back to team")}
                      </Button>
                    </div>
                    <SegmentedControl
                      label={t("Member view")}
                      value={memberPage}
                      options={[
                        { value: "role", label: t("Role and instructions") },
                        { value: "models", label: t("Models and capabilities") },
                      ]}
                      onValueChange={setMemberPage}
                    />
                    <div className="flex min-w-0 flex-col gap-2">
                      {memberPage === "role" ? (
                        <div className="flex flex-col gap-3">
                          {" "}
                          <Row label={t("Name")}>
                            <TextField
                              hideLabel
                              label={t("Member name")}
                              value={agent.name}
                              onChange={(e) => member(agent.id, { name: e.target.value })}
                            />
                          </Row>
                          <Row label={t("Role")}>
                            <Select
                              label={t("Role")}
                              value={agent.role}
                              onChange={(value) => member(agent.id, { role: value as CrewRole })}
                              options={[
                                { value: "coordinator", label: t("Coordinator") },
                                { value: "specialist", label: t("Specialist") },
                                { value: "reviewer", label: t("Reviewer") },
                                { value: "advisor", label: t("Advisor") },
                              ]}
                            />
                          </Row>
                          <TextareaField
                            label={t("Member instructions")}
                            placeholder={t("Member instructions")}
                            value={agent.instructions}
                            onChange={(e) => member(agent.id, { instructions: e.target.value })}
                          />
                        </div>
                      ) : (
                        <div className="flex flex-col gap-4">
                          {" "}
                          <Row label={t("Selection")}>
                            <Select
                              label={t("Selection")}
                              value={agent.selection}
                              onChange={(value) =>
                                member(agent.id, { selection: value as CrewAgent["selection"] })
                              }
                              options={[
                                { value: "fixed", label: t("Fixed model") },
                                { value: "automatic", label: t("Automatic") },
                              ]}
                            />
                          </Row>
                          {agent.selection === "automatic" && (
                            <Row label={t("Allowed models")}>
                              <SearchableSelect
                                label={t("Allowed models")}
                                multiple
                                options={options}
                                value={agent.candidates.map((c) => c.id)}
                                onChange={(values) =>
                                  member(agent.id, {
                                    candidates: values.flatMap((v) => {
                                      const previous = agent.candidates.find((c) => c.id === v);
                                      const c = previous ?? candidate(v);
                                      return c ? [c] : [];
                                    }),
                                  })
                                }
                              />
                            </Row>
                          )}
                          {agent.selection === "fixed" && (
                            <Row label={t("Fixed model")}>
                              <SearchableSelect
                                label={t("Fixed model")}
                                options={options}
                                value={agent.candidates[0]?.id ?? ""}
                                onChange={(id) =>
                                  member(agent.id, {
                                    candidates: [
                                      agent.candidates.find((c) => c.id === id) ?? candidate(id)!,
                                      ...agent.candidates.filter((c) => c.id !== id),
                                    ],
                                  })
                                }
                              />
                            </Row>
                          )}
                          {agent.candidates.map((c) => (
                            <div key={c.id} className="flex flex-wrap items-end gap-2">
                              <span className="min-w-0 flex-1 break-words text-sm">
                                {catalog.find((m) => m.id === c.model)?.name ?? c.model}
                              </span>
                              <TextField
                                hideLabel
                                type="number"
                                min={0}
                                label={t("Estimated cost per assignment")}
                                placeholder={t("Estimated cost")}
                                value={c.cost ?? ""}
                                onChange={(e) =>
                                  member(agent.id, {
                                    candidates: agent.candidates.map((item) =>
                                      item.id === c.id
                                        ? {
                                            ...item,
                                            cost:
                                              e.target.value === ""
                                                ? undefined
                                                : Number(e.target.value),
                                          }
                                        : item,
                                    ),
                                  })
                                }
                              />
                              <TextField
                                hideLabel
                                type="number"
                                min={0}
                                max={100}
                                label={t("Owner quality estimate")}
                                placeholder={t("Quality estimate")}
                                value={c.quality ?? ""}
                                onChange={(e) =>
                                  member(agent.id, {
                                    candidates: agent.candidates.map((item) =>
                                      item.id === c.id
                                        ? {
                                            ...item,
                                            quality:
                                              e.target.value === ""
                                                ? undefined
                                                : Number(e.target.value),
                                          }
                                        : item,
                                    ),
                                  })
                                }
                              />
                              <span className="text-xs text-(--ui-text-secondary)">
                                {t("Tool access unverified")}
                              </span>
                              {catalog
                                .find((m) => m.harness === c.harness && m.id === c.model)
                                ?.settings?.map((setting) =>
                                  setting.kind === "select" ? (
                                    <SearchableSelect
                                      key={setting.id}
                                      label={setting.label}
                                      value={c.modelSettings[setting.id] ?? setting.value}
                                      options={setting.options.map((o) => ({
                                        value: o.value,
                                        label: o.label,
                                      }))}
                                      onChange={(value) =>
                                        member(agent.id, {
                                          candidates: agent.candidates.map((item) =>
                                            item.id === c.id
                                              ? {
                                                  ...item,
                                                  modelSettings: {
                                                    ...item.modelSettings,
                                                    [setting.id]: value,
                                                  },
                                                }
                                              : item,
                                          ),
                                        })
                                      }
                                    />
                                  ) : (
                                    <Toggle
                                      key={setting.id}
                                      label={setting.label}
                                      on={(c.modelSettings[setting.id] ?? setting.value) === "true"}
                                      onChange={(value) =>
                                        member(agent.id, {
                                          candidates: agent.candidates.map((item) =>
                                            item.id === c.id
                                              ? {
                                                  ...item,
                                                  modelSettings: {
                                                    ...item.modelSettings,
                                                    [setting.id]: String(value),
                                                  },
                                                }
                                              : item,
                                          ),
                                        })
                                      }
                                    />
                                  ),
                                )}
                            </div>
                          ))}
                          {draft.updatedAt > 0 && (
                            <Button
                              variant="ghost"
                              disabled={pending}
                              onClick={async () => {
                                setPending(true);
                                setError("");
                                try {
                                  const result = await state.call<{
                                    candidates?: {
                                      model: string;
                                      imageGeneration?: boolean;
                                      observations: {
                                        count: number;
                                        passed: number;
                                        accepted: number;
                                      };
                                    }[];
                                  }>("crews.inspect", {
                                    definitionId: draft.id,
                                    memberId: agent.id,
                                  });
                                  setInspection((current) => ({
                                    ...current,
                                    [agent.id]: result.candidates ?? [],
                                  }));
                                } catch (reason) {
                                  setError(
                                    reason instanceof Error ? reason.message : String(reason),
                                  );
                                } finally {
                                  setPending(false);
                                }
                              }}
                            >
                              {t("Inspect saved capabilities")}
                            </Button>
                          )}
                          {inspection[agent.id]?.map((c) => (
                            <p key={c.model} className="text-xs text-(--ui-text-secondary)">
                              {c.model} · {t("Image generation")}:{" "}
                              {t(
                                c.imageGeneration === true
                                  ? "Available"
                                  : c.imageGeneration === false
                                    ? "Unavailable"
                                    : "Unknown",
                              )}{" "}
                              ·{" "}
                              {t("{p0} reviews · {p1} accepted", {
                                p0: c.observations.count,
                                p1: c.observations.accepted,
                              })}
                            </p>
                          ))}
                        </div>
                      )}
                      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-(--ui-tone-neutral-border) pt-3">
                        {" "}
                        <Button
                          variant="ghost"
                          disabled={pending || !agent.candidates.length}
                          onClick={async () => {
                            setPending(true);
                            setError("");
                            try {
                              const previous = data.agents.find(
                                (a) => a.id === agent.id && a.projectId === draft.projectId,
                              );
                              await state.call("crews.agent.save", {
                                agent: {
                                  ...agent,
                                  id:
                                    previous || !data.agents.some((a) => a.id === agent.id)
                                      ? agent.id
                                      : crypto.randomUUID(),
                                  projectId: draft.projectId,
                                },
                                expectedUpdatedAt: previous?.updatedAt,
                              });
                            } catch (reason) {
                              setError(reason instanceof Error ? reason.message : String(reason));
                            } finally {
                              setPending(false);
                            }
                          }}
                        >
                          {t("Save agent to library")}
                        </Button>
                        <Button
                          variant="ghost"
                          onClick={() => {
                            update({ agents: draft.agents.filter((a) => a.id !== agent.id) });
                            setSelectedMember(null);
                          }}
                        >
                          {t("Remove member")}
                        </Button>
                      </div>
                    </div>
                  </section>
                ))}
            </div>
          )}
          {page === "work" && (
            <div className="flex min-w-0 flex-col gap-4">
              {" "}
              <section
                className="flex flex-col gap-3 border-t border-(--ui-tone-neutral-border) pt-4"
                aria-label={t("Working style")}
              >
                <h4 className="text-sm font-semibold">{t("Working style")}</h4>
                <SegmentedControl
                  label={t("Allocation")}
                  value={
                    draft.policy.costWeight !== undefined ||
                    draft.policy.qualityWeight !== undefined
                      ? ""
                      : draft.policy.preset
                  }
                  options={[
                    { value: "economy", label: t("Economy") },
                    { value: "balanced", label: t("Balanced") },
                    { value: "quality", label: t("Quality") },
                  ]}
                  onValueChange={(preset) =>
                    update({
                      policy: {
                        ...draft.policy,
                        preset: preset as typeof draft.policy.preset,
                        costWeight: undefined,
                        qualityWeight: undefined,
                      },
                    })
                  }
                />
                <p className="text-xs text-(--ui-text-secondary)">
                  {t(
                    draft.policy.costWeight !== undefined ||
                      draft.policy.qualityWeight !== undefined
                      ? "Custom weights are active. Choose a preset to reset them."
                      : draft.policy.preset === "economy"
                        ? "Prefer lower cost"
                        : draft.policy.preset === "quality"
                          ? "Prefer higher quality"
                          : "Balance cost and quality",
                  )}
                </p>
                <p className="text-xs text-(--ui-text-secondary)">
                  {t("Used when members have automatic model selection.")}
                </p>
              </section>
              <Group title={t("Limits and budget")}>
                {" "}
                <Row label={t("Parallel assignments")}>
                  <TextField
                    hideLabel
                    type="number"
                    min={1}
                    max={4}
                    label={t("Parallel assignments")}
                    value={draft.policy.maxParallel}
                    onChange={(e) =>
                      update({ policy: { ...draft.policy, maxParallel: Number(e.target.value) } })
                    }
                  />
                </Row>
                <Row label={t("Assignment limit")}>
                  <TextField
                    hideLabel
                    type="number"
                    min={1}
                    max={20}
                    label={t("Assignment limit")}
                    value={draft.policy.maxAssignments}
                    onChange={(e) =>
                      update({
                        policy: { ...draft.policy, maxAssignments: Number(e.target.value) },
                      })
                    }
                  />
                </Row>
                <Row label={t("Minutes per execution")}>
                  <TextField
                    hideLabel
                    type="number"
                    min={1}
                    max={240}
                    label={t("Minutes per execution")}
                    value={draft.policy.maxRunMinutes}
                    onChange={(e) =>
                      update({ policy: { ...draft.policy, maxRunMinutes: Number(e.target.value) } })
                    }
                  />
                </Row>
                <Row label={t("Estimated assignment budget")}>
                  <TextField
                    hideLabel
                    label={t("Estimated assignment budget")}
                    type="number"
                    min={0}
                    value={draft.policy.maxEstimatedCost ?? ""}
                    onChange={(e) =>
                      update({
                        policy: {
                          ...draft.policy,
                          maxEstimatedCost:
                            e.target.value === "" ? undefined : Number(e.target.value),
                        },
                      })
                    }
                  />
                </Row>
                <Row label={t("Minimum quality estimate")}>
                  <TextField
                    hideLabel
                    label={t("Minimum quality estimate")}
                    type="number"
                    min={0}
                    max={100}
                    value={draft.policy.minimumQuality ?? ""}
                    onChange={(e) =>
                      update({
                        policy: {
                          ...draft.policy,
                          minimumQuality:
                            e.target.value === "" ? undefined : Number(e.target.value),
                        },
                      })
                    }
                  />
                </Row>
                <Row label={t("Cost preference weight")}>
                  <TextField
                    hideLabel
                    label={t("Cost preference weight")}
                    type="number"
                    min={0}
                    max={1}
                    step={0.1}
                    value={draft.policy.costWeight ?? ""}
                    onChange={(e) =>
                      update({
                        policy: {
                          ...draft.policy,
                          costWeight: e.target.value === "" ? undefined : Number(e.target.value),
                        },
                      })
                    }
                  />
                </Row>
                <Row label={t("Quality preference weight")}>
                  <TextField
                    hideLabel
                    label={t("Quality preference weight")}
                    type="number"
                    min={0}
                    max={1}
                    step={0.1}
                    value={draft.policy.qualityWeight ?? ""}
                    onChange={(e) =>
                      update({
                        policy: {
                          ...draft.policy,
                          qualityWeight: e.target.value === "" ? undefined : Number(e.target.value),
                        },
                      })
                    }
                  />
                </Row>
              </Group>
              <Group title={t("Permissions")}>
                {" "}
                <Row label={t("Allow unknown cost")}>
                  <Toggle
                    label={t("Allow unknown cost")}
                    on={draft.policy.allowUnknownCost}
                    onChange={(value) =>
                      update({ policy: { ...draft.policy, allowUnknownCost: value } })
                    }
                  />
                </Row>
                <Row label={t("Coordinator handles runtime approvals")}>
                  <Toggle
                    label={t("Coordinator handles runtime approvals")}
                    on={draft.policy.delegateApprovals === true}
                    onChange={(value) =>
                      update({ policy: { ...draft.policy, delegateApprovals: value } })
                    }
                  />
                </Row>
                <Row label={t("Native subagents")}>
                  <Toggle
                    label={t("Native subagents")}
                    on={draft.policy.allowSubagents}
                    onChange={(value) =>
                      update({ policy: { ...draft.policy, allowSubagents: value } })
                    }
                  />
                </Row>
              </Group>{" "}
              <p className="pt-2">
                {t(
                  "Cost and quality values are your estimates. Unknown tool access is never treated as verified. Changes apply to new runs.",
                )}
              </p>
            </div>
          )}
          {page === "general" && (
            <Group title={t("Crew settings")}>
              {" "}
              <Row label={t("Name")}>
                <TextField
                  hideLabel
                  label={t("Crew name")}
                  value={draft.name}
                  disabled={pending}
                  onChange={(e) => update({ name: e.target.value })}
                />
              </Row>
              <Row label={t("Scope")}>
                <Select
                  label={t("Scope")}
                  value={draft.projectId ? "project" : "global"}
                  onChange={(scope) =>
                    update({
                      id: draft.updatedAt ? crypto.randomUUID() : draft.id,
                      updatedAt: 0,
                      projectId: scope === "project" ? data.project.id : undefined,
                    })
                  }
                  options={[
                    { value: "project", label: t("This project") },
                    { value: "global", label: t("All projects on this host") },
                  ]}
                />
              </Row>
            </Group>
          )}
        </fieldset>
      )}
    </div>
  );
}
