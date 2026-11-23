import { errorText } from "../../../shared/lib/errors";
import { surfaceAttributes } from "../../../shared/ui/Surface";
import { Code } from "../../../shared/ui/Code";
import { Text } from "../../../shared/ui/Text";
import { useRef, useState } from "react";
import { t, useLocale } from "../../../shared/i18n";
import { Modal } from "../../../shared/ui/Modal";
import { Button } from "../../../shared/ui/Button";
import { Heading } from "../../../shared/ui/Heading";
import { Disclosure } from "../../../shared/ui/Disclosure";
import { TextField } from "../../../shared/ui/TextField";
import { Select } from "../../../shared/ui/Select";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { InlineError, InlineMessage } from "../../../shared/ui/InlineError";
import { openExternal } from "../../../platform/tauri/openExternal";
import { useRetainedState } from "../../../shared/hooks/useRetainedState";
import { pathKey } from "../../../shared/lib/paths";
import { RECOMMENDED_SKILLS, type RecommendedSkill } from "../model/recommendedSkills";
import { Popover } from "../../../shared/ui/Popover";
import { InfoPopover } from "../../../shared/ui/InfoPopover";
import { SegmentedControl } from "../../../shared/ui/SegmentedControl";
import type { SkillMachine as Machine } from "../model/skillLibrary";
import {
  officialSkillInstallCommand,
  SKILLS_CLI_REFERENCE,
  SKILLS_CLI_REQUIREMENTS,
} from "../model/skillInstallRecipe";
import { CopyButton } from "../../../shared/ui/CopyButton";
import {
  installRecommendedSkill,
  recommendedSkillInstallStatus,
  type SkillInstallRequest,
  type SkillInstallResult,
} from "../model/skillInstallation";
import styles from "./RecommendedSkills.module.css";

type Attempt = { request: SkillInstallRequest; result: SkillInstallResult };
type CatalogView = "available" | "installed" | "all";

/** A catalog skill counts as installed when a skill with its name or folder name is discovered. */
function installedOn(skill: RecommendedSkill, names: ReadonlySet<string> | undefined): boolean {
  const folder = skill.skillPath.split("/").pop() ?? "";
  return (
    !!names && (names.has(skill.name.toLocaleLowerCase()) || names.has(folder.toLocaleLowerCase()))
  );
}
const PROVIDERS = [
  ["claude", "Claude"],
  ["codex", "Codex"],
  ["cursor", "Cursor"],
  ["opencode", "OpenCode"],
  ["pi", "Pi"],
  ["omp", "OMP"],
  ["fx", "FX"],
  ["grok", "Grok"],
  ["hermes", "Hermes"],
  ["antigravity", "Antigravity"],
] as const;

export function RecommendedSkills({
  cwd,
  machines,
  installed,
  onInstalled,
  onClose,
}: {
  cwd: string;
  machines: Machine[];
  /** Lower-cased discovered skill names per machine key (`local` or environment id). */
  installed: ReadonlyMap<string, ReadonlySet<string>>;
  onInstalled: () => void;
  onClose: () => void;
}) {
  useLocale();
  const key = `recommended:${pathKey(cwd)}`;
  const [query, setQuery] = useRetainedState(`${key}:query`, "");
  const [scope, setScope] = useRetainedState<"user" | "project">(`${key}:scope`, "user");
  const [provider, setProvider] = useRetainedState<SkillInstallRequest["provider"]>(
    `${key}:provider`,
    "all",
  );
  const [machineId, setMachineId] = useRetainedState(`${key}:machine`, "local");
  const [view, setView] = useRetainedState<CatalogView>(`${key}:view`, "available");
  const [attempts, updateAttempts] = useState<Record<string, Attempt>>(() => {
    try {
      const parsed: unknown = JSON.parse(sessionStorage.getItem(`${key}:attempts`) ?? "{}");
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
      return Object.fromEntries(
        Object.entries(parsed).filter(([, value]) => {
          const attempt = value as Partial<Attempt> | null;
          return (
            attempt &&
            typeof attempt.request?.requestId === "string" &&
            typeof attempt.request.skillId === "string" &&
            typeof attempt.result?.status === "string"
          );
        }),
      );
    } catch {
      return {};
    }
  });
  function setAttempts(change: (current: Record<string, Attempt>) => Record<string, Attempt>) {
    updateAttempts((current) => {
      const next = change(current);
      try {
        sessionStorage.setItem(`${key}:attempts`, JSON.stringify(next));
      } catch {
        /* Backend still refuses duplicate destinations. */
      }
      return next;
    });
  }
  const [busy, setBusy] = useState<string | null>(null);
  const [checkingStatus, setCheckingStatus] = useState(false);
  const pending = useRef(false);
  const targetAnchor = useRef<HTMLButtonElement>(null);
  const [targetOpen, setTargetOpen] = useState(false);
  const [linkError, setLinkError] = useState("");
  const selectedMachine = machines.find((machine) => machine.environmentId === machineId);
  const targetCwd =
    machineId === "local" ? (cwd.startsWith("remote://") ? "" : cwd) : (selectedMachine?.cwd ?? "");
  const missingMachine = machineId !== "local" && !selectedMachine;
  const targetKey = `${machineId}:${targetCwd}:${scope}:${provider}`;
  const here = installed.get(machineId);
  const matching = RECOMMENDED_SKILLS.filter((skill) =>
    `${skill.name} ${skill.description} ${skill.category} ${t(skill.description)} ${t(skill.category)}`
      .toLocaleLowerCase()
      .includes(query.trim().toLocaleLowerCase()),
  );
  const installedCount = matching.filter((skill) => installedOn(skill, here)).length;
  // A skill installed from this list stays in place so its result and path remain visible.
  const shown = matching.filter(
    (skill) =>
      view === "all" ||
      (view === "installed"
        ? installedOn(skill, here)
        : !installedOn(skill, here) || !!attempts[`${targetKey}:${skill.id}`]),
  );
  const progressLabel = checkingStatus ? t("Checking…") : t("Installing…");
  const elsewhere = (skill: RecommendedSkill) =>
    [{ environmentId: "local", name: t("This computer") }, ...machines]
      .filter(
        (machine) =>
          machine.environmentId !== machineId &&
          installedOn(skill, installed.get(machine.environmentId)),
      )
      .map((machine) => machine.name)
      .join(", ");

  async function install(skillId: string, inspect: boolean) {
    if (pending.current || missingMachine || (scope === "project" && !targetCwd)) return;
    pending.current = true;
    setBusy(skillId);
    setCheckingStatus(inspect);
    const attemptKey = `${targetKey}:${skillId}`;
    const request: SkillInstallRequest = attempts[attemptKey]?.request ?? {
      requestId: crypto.randomUUID(),
      skillId,
      scope,
      provider,
      cwd: targetCwd,
    };
    const addressed = machineId === "local" ? undefined : machineId;
    const update = (result: SkillInstallResult) =>
      setAttempts((current) => ({ ...current, [attemptKey]: { request, result } }));
    update({ requestId: request.requestId, skillId, status: "pending" });
    try {
      const result = inspect
        ? await recommendedSkillInstallStatus(request, addressed)
        : await installRecommendedSkill(request, addressed);
      update(result);
      if (result.status === "installed") onInstalled();
    } catch (error) {
      update({
        requestId: request.requestId,
        skillId,
        status: "unknown",
        error: errorText(error),
      });
    } finally {
      pending.current = false;
      setBusy(null);
    }
  }

  return (
    <Modal
      title={t("Recommended skills")}
      size="xl"
      fitViewport
      initialFocus='input[type="search"]'
      onClose={onClose}
    >
      <div className={styles.catalog}>
        <div className={styles.controls}>
          <Button
            ref={targetAnchor}
            variant="secondary"
            aria-haspopup="dialog"
            aria-expanded={targetOpen}
            onClick={() => setTargetOpen((open) => !open)}
          >
            {t("Install to…")}
          </Button>
          {/* The target is spelled out only when it differs from the defaults the button implies. */}
          {machineId !== "local" || scope !== "user" || provider !== "all" ? (
            <Text size="secondary" tone="secondary" leading="inherit" truncate className="min-w-0">
              {[
                selectedMachine?.name ?? t("This computer"),
                scope === "user" ? t("Global · all projects") : t("This project"),
                provider === "all"
                  ? t("All providers")
                  : (PROVIDERS.find(([value]) => value === provider)?.[1] ?? provider),
              ].join(" · ")}
            </Text>
          ) : null}
          <InfoPopover width={360}>
            <p>
              {t(
                "Ranked by general usefulness. Download directly from the author's repository; bycoda does not redistribute skill files.",
              )}
            </p>
            <p>
              {t(
                "Existing skills are never replaced. Provider permissions and disabled-skill settings still apply. Extra tools or accounts may be required by the author.",
              )}
            </p>
            <p>{t(SKILLS_CLI_REQUIREMENTS)}</p>
            <Button
              variant="link"
              onClick={() => {
                void openExternal(SKILLS_CLI_REFERENCE).catch((error: unknown) =>
                  setLinkError(errorText(error)),
                );
              }}
            >
              {t("Installer reference")}
            </Button>
          </InfoPopover>
        </div>
        {targetOpen ? (
          <Popover
            anchor={targetAnchor}
            kind="dialog"
            variant="panel"
            width={320}
            aria-label={t("Install to…")}
            onDismiss={() => setTargetOpen(false)}
            className="flex flex-col gap-3"
          >
            {/* Computer and scope are choices only when there is something to choose between. */}
            {machines.length || machineId !== "local" ? (
              <Select
                label={t("Computer")}
                value={machineId}
                disabled={!!busy}
                options={[
                  { value: "local", label: t("This computer") },
                  ...machines.map((machine) => ({
                    value: machine.environmentId,
                    label: machine.name,
                  })),
                ]}
                onValueChange={setMachineId}
              />
            ) : null}
            {targetCwd || scope === "project" ? (
              <Select
                label={t("Installation scope")}
                value={scope}
                disabled={!!busy}
                options={[
                  { value: "user", label: t("Global · all projects") },
                  { value: "project", label: t("This project"), disabled: !targetCwd },
                ]}
                onValueChange={(value) => setScope(value as "user" | "project")}
              />
            ) : null}
            <div className={styles.provider}>
              <Text size="secondary" tone="primary" weight="medium" leading="inherit">
                {t("Provider")}
              </Text>
              <SearchableSelect
                hideLabel
                label={t("Provider")}
                value={provider}
                disabled={!!busy}
                options={[
                  { value: "all", label: t("All providers") },
                  ...PROVIDERS.map(([value, label]) => ({ value, label })),
                ]}
                onChange={(value) => setProvider(value as SkillInstallRequest["provider"])}
              />
            </div>
          </Popover>
        ) : null}
        {missingMachine ? (
          <InlineError>{t("The selected computer is no longer connected.")}</InlineError>
        ) : null}
        {scope === "project" && !targetCwd ? (
          <InlineMessage tone="warning">
            {t("Choose an open project on this computer to install a project skill.")}
          </InlineMessage>
        ) : null}
        {linkError ? <InlineError>{linkError}</InlineError> : null}
        <TextField
          label={t("Search recommended skills")}
          hideLabel
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("Search recommended skills")}
        />
        <SegmentedControl
          label={t("Show recommended skills")}
          value={view}
          options={[
            { value: "available", label: t("Not installed") },
            {
              value: "installed",
              label: t("Installed ({p0})", { p0: installedCount }),
            },
            { value: "all", label: t("All") },
          ]}
          onValueChange={(next) => setView(next as CatalogView)}
        />
        <ol className={styles.list}>
          {shown.map((skill) => {
            const result = attempts[`${targetKey}:${skill.id}`]?.result;
            const unresolved = result?.status === "pending" || result?.status === "unknown";
            const present = installedOn(skill, here) || result?.status === "installed";
            const other = elsewhere(skill);
            return (
              <li
                key={skill.id}
                {...surfaceAttributes({ frame: "pane", edge: "block-start" }, styles.row)}
                data-installed={present || undefined}
              >
                <div className={styles.content}>
                  <div className={styles.title}>
                    <Heading size="item" level={3}>
                      {skill.name}
                    </Heading>
                    <Text size="caption" tone="secondary" leading="inherit">
                      {[t(skill.category), other ? t("On {p0}", { p0: other }) : ""]
                        .filter(Boolean)
                        .join(" · ")}
                    </Text>
                  </div>
                  <Text as="p" size="secondary" leading="normal">
                    {t(skill.description)}
                  </Text>
                  <Disclosure
                    size="sm"
                    className={styles.recipe}
                    summary={t("Installation command")}
                  >
                    <Code variant="block" className="break-all whitespace-pre-wrap">
                      {officialSkillInstallCommand(skill)}
                    </Code>
                    <CopyButton
                      variant="ghost"
                      label={t("Copy")}
                      text={() => officialSkillInstallCommand(skill)}
                      resetKeys={[skill]}
                      onCopyError={(error) => setLinkError(errorText(error))}
                    />
                  </Disclosure>
                  {skill.note ? (
                    <Text as="p" size="secondary" leading="normal">
                      {t(skill.note)}
                    </Text>
                  ) : null}
                  <Button
                    variant="link"
                    onClick={() => {
                      void openExternal(skill.sourceUrl).catch((error: unknown) =>
                        setLinkError(errorText(error)),
                      );
                    }}
                  >
                    {skill.repository.replace("https://github.com/", "")}
                  </Button>
                  {result?.status === "installed" && result.path ? (
                    <Text size="caption" tone="secondary" leading="inherit" className={styles.path}>
                      {result.path}
                    </Text>
                  ) : null}
                  {result?.error ? (
                    result.status === "unknown" ? (
                      <InlineMessage tone="warning">{result.error}</InlineMessage>
                    ) : (
                      <InlineError>{result.error}</InlineError>
                    )
                  ) : null}
                  {unresolved && busy !== skill.id ? (
                    <InlineMessage tone="warning">
                      {t("Installation result is not confirmed. Check status before retrying.")}
                    </InlineMessage>
                  ) : null}
                  {result?.status === "failed" ? (
                    <Button
                      variant="ghost"
                      disabled={!!busy}
                      onClick={() =>
                        setAttempts((current) => {
                          const next = { ...current };
                          delete next[`${targetKey}:${skill.id}`];
                          return next;
                        })
                      }
                    >
                      {t("Dismiss")}
                    </Button>
                  ) : null}
                </div>
                <Button
                  variant={unresolved ? "secondary" : "primary"}
                  loading={busy === skill.id}
                  loadingLabel={progressLabel}
                  disabled={
                    !!busy ||
                    missingMachine ||
                    (scope === "project" && !targetCwd) ||
                    present ||
                    result?.status === "failed"
                  }
                  aria-label={
                    unresolved
                      ? t("Check installation of {p0}", { p0: skill.name })
                      : t("Install {p0}", { p0: skill.name })
                  }
                  onClick={() => {
                    void install(skill.id, unresolved).catch((error: unknown) => {
                      pending.current = false;
                      setBusy(null);
                      setLinkError(errorText(error));
                    });
                  }}
                >
                  {busy === skill.id
                    ? progressLabel
                    : present
                      ? t("Installed")
                      : unresolved
                        ? t("Check status")
                        : t("Install")}
                </Button>
              </li>
            );
          })}
        </ol>
        {!shown.length ? (
          <Text as="p" size="secondary" leading="relaxed" className={styles.note}>
            {view === "available" && matching.length
              ? t("Every matching skill is already installed on the selected computer.")
              : t("No matching skills")}
          </Text>
        ) : null}
      </div>
    </Modal>
  );
}
