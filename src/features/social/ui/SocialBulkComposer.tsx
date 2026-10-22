import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { NativeSelect } from "../../../shared/ui/Select";
import { NativeSearchableSelect } from "../../../shared/ui/NativeSearchableSelect";
import { TextField } from "../../../shared/ui/TextField";
import { Button } from "../../../shared/ui/Button";
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
              ? "Hiçbir taslak hazırlanamadı. Alıcıların sonuçlarını kontrol edip başarısız taslakları yeniden deneyin."
              : "Uygun alıcı bulunamadı. Alıcı kontrollerini inceleyip içeriği veya seçimi düzenleyin.",
          );
        }
      }, "Taslak hazırlama tamamlandı. Her alıcının sonucunu aşağıda kontrol edin.");
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
          <Notice kind="info" title={`${targets.length} ${replyOnly ? "konuşma" : "kişi"} seçili`}>
            Metni ve alıcıları kontrol edin. Hazırlanan taslakları ayrı ayrı onaylayıp
            gönderebilirsiniz.
          </Notice>
          {!replyOnly ? (
            <>
              <label>
                İşlem
                <NativeSelect
                  value={kind}
                  onChange={(event) => setKind(event.target.value as BulkKind)}
                >
                  <option value="message">Yeni mesaj</option>
                  <option value="comment">Gönderiye yorum</option>
                </NativeSelect>
              </label>
              <label>
                Proje
                <NativeSearchableSelect
                  label="Proje"
                  options={[
                    { value: "", label: "Proje seçin", disabled: true },
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
              Hazır bilgi (isteğe bağlı)
              <SearchableSelect
                value=""
                disabled={!ready}
                label={"Hazır bilgi (isteğe bağlı)"}
                options={[
                  { value: "", label: "Bilgi seçin" },
                  ...facts.map((fact) => ({ value: fact.id, label: fact.topic })),
                ]}
                onChange={(nextValue) => {
                  const fact = facts.find((item) => item.id === nextValue);
                  if (fact && ready) changeContent({ text: fact.text, factIds: [fact.id] });
                }}
                searchLocale="tr"
              />
            </label>
          ) : null}
          {kind === "comment" ? (
            <fieldset className="social-bulk-posts">
              <legend>Her kişi için yorum yapılacak gönderi</legend>
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
                  <label key={target.key}>
                    {contact?.name ?? "Kişi"} · gönderi kimliği
                    <TextField
                      hideLabel
                      label={`${contact?.name ?? "Kişi"} gönderi kimliği`}
                      aria-label={`${contact?.name ?? "Kişi"} gönderi kimliği`}
                      list={`posts-${target.key}`}
                      value={postIds[target.key] ?? ""}
                      onChange={(event) =>
                        setPostIds((current) => ({ ...current, [target.key]: event.target.value }))
                      }
                      maxLength={300}
                      placeholder="Platformdaki gönderi kimliği"
                    />
                    <datalist id={`posts-${target.key}`}>
                      {posts.map((id) => (
                        <option key={id} value={id} />
                      ))}
                    </datalist>
                    {account?.platform === "x" ? (
                      <small>
                        X gönderi bağlantısında status/ bölümünden sonra gelen sayıyı girin.
                      </small>
                    ) : null}
                  </label>
                );
              })}
            </fieldset>
          ) : null}
          <label>
            {replyOnly ? "Yanıt" : "İçerik"}
            <TextareaField
              label={replyOnly ? "Yanıt" : "Toplu içerik"}
              hideLabel
              aria-label={replyOnly ? "Yanıt" : "Toplu içerik"}
              required
              rows={5}
              value={text}
              disabled={!ready}
              onChange={(event) => changeContent({ text: event.target.value, factIds: [] })}
            />
            <small>
              {count} karakter
              {plan.some((item) => item.limit !== undefined)
                ? ` · Hesap sınırları alıcı listesinde`
                : ""}
            </small>
          </label>
          {!targets.length ? (
            <Notice kind="info">Önce listeden kişi veya konuşma seçin.</Notice>
          ) : !ready || Object.keys(policyErrors).length ? (
            <Notice kind={Object.keys(policyErrors).length ? "warning" : "loading"}>
              {Object.keys(policyErrors).length
                ? "Sınırları alınamayan hesaplar atlanır. Diğer hesaplar için devam edebilirsiniz."
                : "Hesapların içerik sınırları yükleniyor…"}
              {Object.keys(policyErrors).length ? (
                <Button
                  variant="secondary"
                  type="button"
                  onClick={() => setPolicyAttempt((attempt) => attempt + 1)}
                >
                  Sınırları yeniden yükle
                </Button>
              ) : null}
            </Notice>
          ) : null}
          <div className="social-batch-results">
            <h3>
              Alıcı kontrolü{" "}
              <small>
                {eligible.length} uygun · {plan.length - eligible.length} uygun değil
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
                      {item.limit !== undefined ? ` · En fazla ${item.limit} karakter` : ""}
                    </span>
                  </div>
                  <StatusBadge
                    status={item.reason ? "review" : "available"}
                    label={item.reason ? "Hazır değil" : "Uygun"}
                  />
                  {item.reason ? <p>{item.reason}</p> : null}
                </article>
              );
            })}
          </div>
          <Button
            type="submit"
            variant="primary"
            loading={busy}
            disabled={busy || !eligible.length || !ready}
          >
            {eligible.length > 1 ? `${eligible.length} taslak hazırla` : "Taslak kaydet"}
          </Button>
        </form>
      ) : (
        <>
          {recipientsChanged ? (
            <Notice kind="info" title="Alıcı seçimi değişti.">
              Bu sonuçlar önceki hazırlamaya ait.
              <Button
                variant="secondary"
                loading={busy}
                type="button"
                disabled={busy || !targets.length}
                onClick={prepareCurrentSelection}
              >
                Yeni seçilenler için hazırla
              </Button>
            </Notice>
          ) : null}
          <Notice
            kind={busy ? "loading" : failed || skipped ? "warning" : "success"}
            title={busy ? "Taslaklar hazırlanıyor…" : "Hazırlama sonucu"}
          >
            {success} hazır · {skipped} atlandı · {failed} başarısız
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
                      queued: "Bekliyor",
                      running: "Hazırlanıyor",
                      succeeded: "Taslak hazır",
                      skipped: "Atlandı",
                      failed: "Başarısız",
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
                type="submit"
                variant="secondary"
                loading={busy}
                disabled={busy}
                onClick={() => void start(true)}
              >
                Yalnızca {failed} başarısız taslağı yeniden dene
              </Button>
            ) : null}
            {!recipientsChanged ? (
              <Button
                type="submit"
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
                {success && !failed ? "Yeni içerik hazırla" : "İçeriği düzenle"}
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
            Önceki hazırlama · {preparation.rows.length} alıcı ·{" "}
            {preparation.rows.filter((row) => row.status === "succeeded").length} taslak
          </summary>
          <p className="social-message">{preparation.text}</p>
          <div className="social-batch-results">
            {preparation.rows.map((row) => (
              <article key={row.target.key}>
                <strong>{row.name}</strong>
                <StatusBadge
                  status={row.status}
                  label={row.status === "succeeded" ? "Taslak hazır" : undefined}
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
import { TextareaField } from "../../../shared/ui/TextareaField";
