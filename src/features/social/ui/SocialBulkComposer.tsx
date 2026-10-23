import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { NativeSelect } from "../../../shared/ui/Select";
import { NativeSearchableSelect } from "../../../shared/ui/NativeSearchableSelect";
import { TextField } from "../../../shared/ui/TextField";
import { TextareaField } from "../../../shared/ui/TextareaField";
import { Button } from "../../../shared/ui/Button";
import { t, useLocale, getLocale } from "../../../shared/i18n";
import { useEffect, useRef, useState } from "react";
import type { HostProject } from "../../connections/model/protocol";
import type { SocialPolicy, SocialSnapshot } from "../model/social";
import type { SocialClient } from "../model/socialClient";
import { socialCharacterCount } from "../model/socialPolicy";
import { DraftList } from "./SocialDrafts";
import { Notice, StatusBadge, names, type Run } from "./socialShared";
import {
  planBulkDrafts,
  prepareBulkDrafts,
  readBulkPolicies,
  type BulkKind,
  type BulkOptions,
  type BulkResult,
  type BulkTarget,
} from "./socialBulk";

export function SocialBulkComposer({
  client,
  snapshot,
  projects,
  run,
  targets,
  initialProject = "",
  replyOnly = false,
  content,
  onContentChange,
}: {
  client: SocialClient;
  snapshot: SocialSnapshot;
  projects: HostProject[];
  run: Run;
  targets: BulkTarget[];
  initialProject?: string;
  replyOnly?: boolean;
  content?: { text: string; factIds: string[] };
  onContentChange?: (value: { text: string; factIds: string[] }) => void;
}) {
  useLocale();
  const [kind, setKind] = useState<BulkKind>(replyOnly ? "reply" : "message");
  const [projectId, setProjectId] = useState(initialProject || projects[0]?.id || "");
  const [localText, setLocalText] = useState("");
  const [localFactIds, setLocalFactIds] = useState<string[]>([]);
  const text = content?.text ?? localText;
  const factIds = content?.factIds ?? localFactIds;
  const changeContent = (value: { text: string; factIds: string[] }) => {
    if (onContentChange) onContentChange(value);
    else {
      setLocalText(value.text);
      setLocalFactIds(value.factIds);
    }
  };
  const [postIds, setPostIds] = useState<Record<string, string>>({});
  const [policies, setPolicies] = useState<Record<string, SocialPolicy>>({});
  const [policyErrors, setPolicyErrors] = useState<Record<string, string>>({});
  const [policyAttempt, setPolicyAttempt] = useState(0);
  const [rows, setRows] = useState<BulkResult[]>([]);
  const [batch, setBatch] = useState<BulkOptions>();
  const [previousPreparations, setPreviousPreparations] = useState<
    { text: string; rows: BulkResult[] }[]
  >([]);
  const [busy, setBusy] = useState(false);
  const active = useRef(false);
  const previousBatch = useRef<BulkOptions | undefined>(undefined);
  const accountKey = [...new Set(targets.map((target) => target.accountId))].sort().join("|");
  useEffect(() => {
    let cancelled = false;
    setPolicies({});
    setPolicyErrors({});
    void readBulkPolicies(
      client,
      accountKey
        .split("|")
        .filter(Boolean)
        .map((accountId) => ({ key: accountId, accountId, contactId: "" })),
    ).then((result) => {
      if (!cancelled) {
        setPolicies(result.policies);
        setPolicyErrors(result.errors);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [client, accountKey, policyAttempt]);
  const options: BulkOptions = { kind, targets, projectId, text, postIds, factIds };
  const plan = planBulkDrafts(options, snapshot, projects, policies, policyErrors);
  const eligible = plan.filter((item) => !item.reason);
  const ready =
    targets.length > 0 &&
    targets.every((target) => policies[target.accountId] || policyErrors[target.accountId]) &&
    targets.some((target) => policies[target.accountId]);
  const count = socialCharacterCount(text);
  const singleThread =
    replyOnly && targets.length === 1
      ? snapshot.threads.find((thread) => thread.id === targets[0].threadId)
      : undefined;
  const facts = singleThread
    ? (snapshot.profiles.find((profile) => profile.projectId === singleThread.projectId)?.facts ??
      [])
    : [];
  const success = rows.filter((row) => row.status === "succeeded").length;
  const failed = rows.filter((row) => row.status === "failed").length;
  const skipped = rows.filter((row) => row.status === "skipped").length;
  const recipientSignature = (items: BulkTarget[]) =>
    JSON.stringify(
      [
        ...new Set(
          items.map((item) =>
            JSON.stringify([item.key, item.accountId, item.contactId, item.threadId ?? ""]),
          ),
        ),
      ].sort(),
    );
  const recipientsChanged =
    !!batch && recipientSignature(targets) !== recipientSignature(batch.targets);
  const selectionTitle = replyOnly
    ? targets.length === 1
      ? t("1 conversation selected")
      : t("{p0} conversations selected", { p0: targets.length })
    : targets.length === 1
      ? t("1 contact selected")
      : t("{p0} contacts selected", { p0: targets.length });
  const eligibleAccounts = [
    ...new Set(
      eligible.flatMap((item) => {
        const account = snapshot.accounts.find((entry) => entry.id === item.target.accountId);
        return account ? [account.name] : [];
      }),
    ),
  ];
  const submitBlocker = busy
    ? ""
    : !targets.length
      ? t("Select contacts or conversations from the list first.")
      : !ready
        ? t("Account limits are loading.")
        : !eligible.length
          ? t("No recipient is eligible. Review the recipient checks.")
          : "";
  const prepareCurrentSelection = () => {
    if (!batch || busy) return;
    setPreviousPreparations((current) => [...current, { text: batch.text, rows: [...rows] }]);
    previousBatch.current = undefined;
    setBatch(undefined);
    setRows([]);
    changeContent({ text: batch.text, factIds: batch.factIds ?? [] });
  };
  const start = async (retry = false) => {
    if (active.current) return;
    const frozen = retry
      ? batch
      : { ...options, targets: [...targets], postIds: { ...postIds }, factIds: [...factIds] };
    if (!frozen) return;
    const unchanged =
      previousBatch.current && JSON.stringify(previousBatch.current) === JSON.stringify(frozen);
    const previousRows = retry
      ? rows
      : unchanged
        ? rows.filter((row) => row.status !== "skipped")
        : [];
    active.current = true;
    setBusy(true);
    if (!retry) setBatch(frozen);
    previousBatch.current = frozen;
    try {
      await run(async () => {
        const prepared = await prepareBulkDrafts(
          client,
          frozen,
          snapshot,
          projects,
          previousRows,
          setRows,
        );
        if (!prepared.some((row) => row.status === "succeeded")) {
          throw new Error(
            prepared.some((row) => row.status === "failed")
              ? t(
                  "No draft could be prepared. Check each recipient's result and retry the failed drafts.",
                )
              : t(
                  "No eligible recipient was found. Review the recipient checks and edit the content or selection.",
                ),
          );
        }
      }, t("Draft preparation finished. Check each recipient's result below."));
    } finally {
      active.current = false;
      setBusy(false);
    }
  };
  return (
    <div className="social-bulk-composer">
      {!batch ? (
        <form
          className="social-form"
          onSubmit={(event) => {
            event.preventDefault();
            void start();
          }}
        >
          <Notice kind="info" title={selectionTitle}>
            {t(
              "Review the text and recipients. You can approve and send the prepared drafts individually.",
            )}
          </Notice>
          {!replyOnly ? (
            <>
              <label>
                {t("Action")}
                <NativeSelect
                  value={kind}
                  onChange={(event) => setKind(event.target.value as BulkKind)}
                >
                  <option value="message">{t("New message")}</option>
                  <option value="comment">{t("Comment on post")}</option>
                </NativeSelect>
              </label>
              <label>
                {t("Project")}
                <NativeSearchableSelect
                  label={t("Project")}
                  options={[
                    { value: "", label: t("Select a project"), disabled: true },
                    ...projects.map((project) => ({
                      value: project.id,
                      label: project.name || project.cwd,
                    })),
                  ]}
                  value={projectId}
                  onChange={(event) => setProjectId(event.target.value)}
                  required
                />
              </label>
            </>
          ) : null}
          {facts.length ? (
            <label>
              {t("Prepared fact (optional)")}
              <SearchableSelect
                value=""
                disabled={!ready}
                label={t("Prepared fact (optional)")}
                options={[
                  { value: "", label: t("Select a fact") },
                  ...facts.map((fact) => ({ value: fact.id, label: fact.topic })),
                ]}
                onChange={(nextValue) => {
                  const fact = facts.find((item) => item.id === nextValue);
                  if (fact && ready) changeContent({ text: fact.text, factIds: [fact.id] });
                }}
                searchLocale={getLocale()}
              />
            </label>
          ) : null}
          {kind === "comment" ? (
            <fieldset className="social-bulk-posts">
              <legend>{t("Post to comment on for each contact")}</legend>
              {targets.map((target) => {
                const contact = snapshot.contacts.find((item) => item.id === target.contactId);
                const account = snapshot.accounts.find((item) => item.id === target.accountId);
                const posts = [
                  ...new Set(
                    snapshot.threads
                      .filter(
                        (thread) =>
                          thread.contactId === target.contactId &&
                          thread.accountId === target.accountId,
                      )
                      .flatMap((thread) => (thread.platformPostId ? [thread.platformPostId] : [])),
                  ),
                ];
                return (
                  <div key={target.key}>
                    <TextField
                      label={t("{p0} · post ID", { p0: contact?.name ?? t("Contact not found") })}
                      list={`posts-${target.key}`}
                      value={postIds[target.key] ?? ""}
                      onChange={(event) =>
                        setPostIds((current) => ({ ...current, [target.key]: event.target.value }))
                      }
                      maxLength={300}
                      placeholder={t("Post ID on the platform")}
                    />
                    <datalist id={`posts-${target.key}`}>
                      {posts.map((id) => (
                        <option key={id} value={id} />
                      ))}
                    </datalist>
                    {account?.platform === "x" ? (
                      <small>
                        {t("Enter the number that follows status/ in the X post link.")}
                      </small>
                    ) : null}
                  </div>
                );
              })}
            </fieldset>
          ) : null}
          <div>
            <TextareaField
              label={replyOnly ? t("Reply text") : t("Content")}
              required
              rows={5}
              value={text}
              disabled={!ready}
              onChange={(event) => changeContent({ text: event.target.value, factIds: [] })}
            />
            <small>
              {t("{p0} characters", { p0: count })}
              {plan.some((item) => item.limit !== undefined)
                ? ` · ${t("Account limits are in the recipient list")}`
                : ""}
            </small>
          </div>
          {!targets.length ? (
            <Notice kind="info">
              {t("Select contacts or conversations from the list first.")}
            </Notice>
          ) : !ready || Object.keys(policyErrors).length ? (
            <Notice kind={Object.keys(policyErrors).length ? "warning" : "loading"}>
              {Object.keys(policyErrors).length
                ? t(
                    "Accounts whose limits could not be loaded are skipped. You can continue with the other accounts.",
                  )
                : t("Loading account content limits…")}
              {Object.keys(policyErrors).length ? (
                <Button
                  variant="secondary"
                  type="button"
                  onClick={() => setPolicyAttempt((attempt) => attempt + 1)}
                >
                  {t("Reload limits")}
                </Button>
              ) : null}
            </Notice>
          ) : null}
          <div className="social-batch-results">
            <h3>
              {t("Recipient check")}{" "}
              <small>
                {t("{p0} eligible · {p1} not eligible", {
                  p0: eligible.length,
                  p1: plan.length - eligible.length,
                })}
              </small>
            </h3>
            {plan.map((item) => {
              const account = snapshot.accounts.find(
                (account) => account.id === item.target.accountId,
              );
              return (
                <article key={item.target.key}>
                  <div>
                    <strong>{item.name}</strong>
                    <span className="social-muted">
                      {account?.name} · {account ? names[account.platform] : ""}
                      {item.limit !== undefined
                        ? ` · ${t("Up to {p0} characters", { p0: item.limit })}`
                        : ""}
                    </span>
                  </div>
                  <StatusBadge
                    status={item.reason ? "review" : "available"}
                    label={item.reason ? t("Not ready") : t("Eligible")}
                  />
                  {item.reason ? <p>{item.reason}</p> : null}
                </article>
              );
            })}
          </div>
          {submitBlocker ? (
            <small className="social-muted" role="status">
              {submitBlocker}
            </small>
          ) : null}
          <div className="social-actions">
            <Button
              type="submit"
              variant="primary"
              loading={busy}
              disabled={busy || !eligible.length || !ready}
            >
              {eligible.length > 1
                ? t("Prepare {p0} drafts", { p0: eligible.length })
                : t("Save draft")}
            </Button>
            {eligible.length ? (
              <small className="social-muted">
                {t("Drafts for {p0} of {p1} recipients · {p2} · nothing is sent", {
                  p0: eligible.length,
                  p1: plan.length,
                  p2: eligibleAccounts.join(", "),
                })}
              </small>
            ) : null}
          </div>
        </form>
      ) : (
        <>
          {recipientsChanged ? (
            <Notice kind="info" title={t("Recipient selection changed.")}>
              {t("These results belong to the previous preparation.")}
              <Button
                variant="secondary"
                loading={busy}
                type="button"
                disabled={busy || !targets.length}
                onClick={prepareCurrentSelection}
              >
                {t("Prepare for the new selection")}
              </Button>
            </Notice>
          ) : null}
          <Notice
            kind={busy ? "loading" : failed || skipped ? "warning" : "success"}
            title={busy ? t("Preparing drafts…") : t("Preparation result")}
          >
            {t("{p0} ready · {p1} skipped · {p2} failed", {
              p0: success,
              p1: skipped,
              p2: failed,
            })}
          </Notice>
          <p className="social-message">{batch.text}</p>
          <div className="social-batch-results" aria-live="polite">
            {rows.map((row) => (
              <article key={row.target.key}>
                <strong>{row.name}</strong>
                <StatusBadge
                  status={row.status === "skipped" ? "review" : row.status}
                  label={
                    {
                      queued: t("Waiting"),
                      running: t("Preparing"),
                      succeeded: t("Draft ready"),
                      skipped: t("Skipped"),
                      failed: t("Failed"),
                    }[row.status]
                  }
                />
                {row.reason ? <p>{row.reason}</p> : null}
              </article>
            ))}
          </div>
          <div className="social-actions">
            {failed ? (
              <Button
                type="button"
                variant="secondary"
                loading={busy}
                disabled={busy}
                onClick={() => void start(true)}
              >
                {failed === 1
                  ? t("Retry only the failed draft")
                  : t("Retry only the {p0} failed drafts", { p0: failed })}
              </Button>
            ) : null}
            {!recipientsChanged ? (
              <Button
                type="button"
                variant="secondary"
                loading={busy}
                disabled={busy}
                onClick={() => {
                  setBatch(undefined);
                  changeContent(
                    success && !failed
                      ? { text: "", factIds: [] }
                      : { text: batch.text, factIds: batch.factIds ?? [] },
                  );
                  setPolicyAttempt((attempt) => attempt + 1);
                }}
              >
                {success && !failed ? t("Prepare new content") : t("Edit content")}
              </Button>
            ) : null}
          </div>
          <DraftList
            drafts={rows.flatMap((row) =>
              row.draft
                ? [snapshot.drafts.find((draft) => draft.id === row.draft?.id) ?? row.draft]
                : [],
            )}
            client={client}
            run={run}
            snapshot={snapshot}
          />
        </>
      )}
      {previousPreparations.map((preparation, index) => (
        <details key={index} className="social-settings">
          <summary>
            {t("Previous preparation · {p0} recipients · {p1} drafts", {
              p0: preparation.rows.length,
              p1: preparation.rows.filter((row) => row.status === "succeeded").length,
            })}
          </summary>
          <p className="social-message">{preparation.text}</p>
          <div className="social-batch-results">
            {preparation.rows.map((row) => (
              <article key={row.target.key}>
                <strong>{row.name}</strong>
                <StatusBadge
                  status={row.status}
                  label={row.status === "succeeded" ? t("Draft ready") : undefined}
                />
                {row.reason ? <p>{row.reason}</p> : null}
              </article>
            ))}
          </div>
          <DraftList
            drafts={preparation.rows.flatMap((row) =>
              row.draft
                ? [snapshot.drafts.find((draft) => draft.id === row.draft?.id) ?? row.draft]
                : [],
            )}
            client={client}
            run={run}
            snapshot={snapshot}
          />
        </details>
      ))}
    </div>
  );
}
