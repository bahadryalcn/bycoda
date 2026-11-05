import { useRef, useState } from "react";
import { formatNumber, t, useLocale } from "../../../shared/i18n";
import { Modal } from "../../../shared/ui/Modal";
import { Button } from "../../../shared/ui/Button";
import { TextField } from "../../../shared/ui/TextField";
import { Select } from "../../../shared/ui/Select";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { Alert } from "../../../shared/ui/Alert";
import { Badge } from "../../../shared/ui/Badge";
import { openExternal } from "../../../platform/tauri/openExternal";
import { useRetainedState } from "../../../shared/hooks/useRetainedState";
import { pathKey } from "../../../shared/lib/paths";
import { RECOMMENDED_SKILLS } from "../model/recommendedSkills";
import {
  officialSkillInstallCommand,
  SKILLS_CLI_REFERENCE,
  SKILLS_CLI_REQUIREMENTS,
} from "../model/skillInstallRecipe";
import { copyText } from "../../../platform/tauri/clipboard";
import {
  installRecommendedSkill,
  recommendedSkillInstallStatus,
  type SkillInstallRequest,
  type SkillInstallResult,
} from "../model/skillInstallation";
import styles from "./RecommendedSkills.module.css";

type Machine = { environmentId: string; name: string; cwd: string };
type Attempt = { request: SkillInstallRequest; result: SkillInstallResult };
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
  onInstalled,
  onClose,
}: {
  cwd: string;
  machines: Machine[];
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
  const pending = useRef(false);
  const [linkError, setLinkError] = useState("");
  const selectedMachine = machines.find((machine) => machine.environmentId === machineId);
  const targetCwd =
    machineId === "local" ? (cwd.startsWith("remote://") ? "" : cwd) : (selectedMachine?.cwd ?? "");
  const missingMachine = machineId !== "local" && !selectedMachine;
  const targetKey = `${machineId}:${targetCwd}:${scope}:${provider}`;
  const shown = RECOMMENDED_SKILLS.filter((skill) =>
    `${skill.name} ${skill.description} ${skill.category} ${t(skill.description)} ${t(skill.category)}`
      .toLocaleLowerCase()
      .includes(query.trim().toLocaleLowerCase()),
  );

  async function install(skillId: string, inspect: boolean) {
    if (pending.current || missingMachine || (scope === "project" && !targetCwd)) return;
    pending.current = true;
    setBusy(skillId);
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
        error: error instanceof Error ? error.message : String(error),
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
        <p className={styles.intro}>
          {t(
            "Ranked by general usefulness. Download directly from the author's repository; bycoda does not redistribute skill files.",
          )}
        </p>
        <div className={styles.controls}>
          <Select
            label={t("Computer")}
            visibleLabel
            value={machineId}
            disabled={!!busy}
            options={[
              { value: "local", label: t("This computer") },
              ...machines.map((machine) => ({ value: machine.environmentId, label: machine.name })),
            ]}
            onValueChange={setMachineId}
          />
          <Select
            label={t("Installation scope")}
            visibleLabel
            value={scope}
            disabled={!!busy}
            options={[
              { value: "user", label: t("Global · all projects") },
              { value: "project", label: t("This project"), disabled: !targetCwd },
            ]}
            onValueChange={(value) => setScope(value as "user" | "project")}
          />
          <div className={styles.provider}>
            <span className={styles.label}>{t("Provider")}</span>
            <SearchableSelect
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
        </div>
        <p className={styles.note}>
          {t(
            "Existing skills are never replaced. Provider permissions and disabled-skill settings still apply. Extra tools or accounts may be required by the author.",
          )}
        </p>
        <p className={styles.note}>{t(SKILLS_CLI_REQUIREMENTS)}</p>
        {missingMachine ? (
          <Alert tone="danger" inline>
            {t("The selected computer is no longer connected.")}
          </Alert>
        ) : null}
        {scope === "project" && !targetCwd ? (
          <Alert tone="warning" inline>
            {t("Choose an open project on this computer to install a project skill.")}
          </Alert>
        ) : null}
        {linkError ? (
          <Alert inline tone="danger">
            {linkError}
          </Alert>
        ) : null}
        <TextField
          label={t("Search recommended skills")}
          hideLabel
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("Search recommended skills")}
        />
        <ol className={styles.list}>
          {shown.map((skill) => {
            const result = attempts[`${targetKey}:${skill.id}`]?.result;
            const unresolved = result?.status === "pending" || result?.status === "unknown";
            return (
              <li key={skill.id} className={styles.row}>
                <span className={styles.rank}>
                  {formatNumber(RECOMMENDED_SKILLS.indexOf(skill) + 1)}
                </span>
                <div className={styles.content}>
                  <div className={styles.title}>
                    <h3>{skill.name}</h3>
                    <Badge>{t(skill.category)}</Badge>
                  </div>
                  <p>{t(skill.description)}</p>
                  <details className={styles.recipe}>
                    <summary>{t("Installation command")}</summary>
                    <p>
                      {t(
                        "Runs the public installer, then applies your selected scope and provider.",
                      )}
                    </p>
                    <code>{officialSkillInstallCommand(skill)}</code>
                    <div>
                      <Button
                        variant="ghost"
                        onClick={() => {
                          void copyText(officialSkillInstallCommand(skill)).catch(
                            (error: unknown) =>
                              setLinkError(error instanceof Error ? error.message : String(error)),
                          );
                        }}
                      >
                        {t("Copy")}
                      </Button>
                      <Button
                        variant="link"
                        onClick={() => {
                          void openExternal(SKILLS_CLI_REFERENCE).catch((error: unknown) =>
                            setLinkError(error instanceof Error ? error.message : String(error)),
                          );
                        }}
                      >
                        {t("Installer reference")}
                      </Button>
                    </div>
                  </details>
                  {skill.note ? <p>{t(skill.note)}</p> : null}
                  <Button
                    variant="link"
                    onClick={() => {
                      void openExternal(skill.sourceUrl).catch((error: unknown) =>
                        setLinkError(error instanceof Error ? error.message : String(error)),
                      );
                    }}
                  >
                    {skill.repository.replace("https://github.com/", "")}
                  </Button>
                  {result?.status === "installed" ? (
                    <Alert inline tone="success">
                      {t("Installed")}
                      {result.path ? <span className={styles.path}>{result.path}</span> : null}
                    </Alert>
                  ) : null}
                  {result?.error ? (
                    <Alert inline tone={result.status === "unknown" ? "warning" : "danger"}>
                      {result.error}
                    </Alert>
                  ) : null}
                  {unresolved && busy !== skill.id ? (
                    <Alert inline tone="warning">
                      {t("Installation result is not confirmed. Check status before retrying.")}
                    </Alert>
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
                  disabled={
                    !!busy ||
                    missingMachine ||
                    (scope === "project" && !targetCwd) ||
                    result?.status === "installed" ||
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
                      setLinkError(error instanceof Error ? error.message : String(error));
                    });
                  }}
                >
                  {busy === skill.id
                    ? t("Installing…")
                    : result?.status === "installed"
                      ? t("Installed")
                      : unresolved
                        ? t("Check status")
                        : t("Install")}
                </Button>
              </li>
            );
          })}
        </ol>
        {!shown.length ? <p className={styles.note}>{t("No matching skills.")}</p> : null}
      </div>
    </Modal>
  );
}
