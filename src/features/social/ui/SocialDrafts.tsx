import { Alert } from "../../../shared/ui/Alert";
import { TextareaField } from "../../../shared/ui/TextareaField";
import { Checkbox } from "../../../shared/ui/Checkbox";
import { Button } from "../../../shared/ui/Button";
import { useEffect, useState } from "react";
import { XMediaFields } from "./XMediaFields";
import { socialRows } from "../model/socialWorkspace";
import type {
  SocialDraft,
  SocialDraftApprovalInput,
  SocialPolicy,
  SocialSnapshot,
} from "../model/social";
import type { SocialClient } from "../model/socialClient";
import {
  effectiveSocialPolicy,
  DEFAULT_SOCIAL_POLICIES,
  socialCharacterCount,
  socialLimit,
} from "../model/socialPolicy";
import { HARNESS_TITLE } from "../../sessions/model/session";
import { Notice, StatusBadge, statuses, time, type Run } from "./socialShared";

export function DraftList({
  drafts,
  client,
  run,
  snapshot,
}: {
  drafts: SocialDraft[];
  client: SocialClient;
  run: Run;
  snapshot?: SocialSnapshot;
}) {
  return (
    <div>
      {drafts.map((draft) => (
        <Draft key={draft.id} draft={draft} client={client} run={run} snapshot={snapshot} />
      ))}
    </div>
  );
}

function Draft({
  draft,
  client,
  run,
  snapshot,
}: {
  draft: SocialDraft;
  client: SocialClient;
  run: Run;
  snapshot?: SocialSnapshot;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(draft.text);
  const [factIds, setFactIds] = useState(draft.factIds);
  const [media, setMedia] = useState(draft.media ?? []);
  const [mediaBusy, setMediaBusy] = useState(false);
  const [editPolicy, setEditPolicy] = useState<SocialPolicy>();
  const [policyError, setPolicyError] = useState("");
  const [policyAttempt, setPolicyAttempt] = useState(0);
  const facts =
    snapshot?.profiles.find((profile) => profile.projectId === draft.projectId)?.facts ?? [];
  const missingFacts = snapshot
    ? factIds.filter((id) => !facts.some((fact) => fact.id === id))
    : [];
  const account = snapshot?.accounts.find((item) => item.id === draft.accountId);
  useEffect(() => {
    if (!editing || !account) return;
    let cancelled = false;
    setEditPolicy(undefined);
    setPolicyError("");
    void client
      .request<{ effective: SocialPolicy }>("policy.get", { accountId: account.id })
      .then((result) => {
        if (!cancelled) setEditPolicy(result.effective);
      })
      .catch(() => {
        if (!cancelled) setPolicyError("Hesap sınırları alınamadı.");
      });
    return () => {
      cancelled = true;
    };
  }, [editing, account?.id, client, policyAttempt]);
  const contact =
    snapshot &&
    socialRows(snapshot.contacts, snapshot.related?.contacts).find(
      (item) => item.id === draft.contactId,
    );
  const thread =
    snapshot &&
    socialRows(snapshot.threads, snapshot.related?.threads).find(
      (item) => item.id === draft.threadId,
    );
  const job =
    snapshot &&
    socialRows(snapshot.jobs, snapshot.related?.jobs).find(
      (item) => item.draftId === draft.id && item.status !== "cancelled",
    );
  const generating =
    draft.generation?.status === "running" || draft.generation?.status === "queued";
  const limit = account
    ? socialLimit(
        editPolicy ??
          effectiveSocialPolicy(snapshot?.policies ?? DEFAULT_SOCIAL_POLICIES, account.platform),
        draft.kind === "comment"
          ? "comment"
          : draft.kind === "reply" && thread?.kind === "comment"
            ? "comment"
            : "message",
      )
    : undefined;
  const count = socialCharacterCount(text);
  const disabledReason = job
    ? `Gönderim durumu: ${statuses[job.status]}.`
    : limit && socialCharacterCount(draft.text) > limit
      ? "Taslak geçerli karakter sınırını aşıyor. Metni düzenleyin."
      : generating
        ? "AI taslağı hazırlıyor."
        : draft.reviewReason
          ? draft.reviewReason
          : contact?.optedOut
            ? "Bu kişi iletişim istemiyor."
            : thread?.replyAllowed === false
              ? "Platform bu konuşmaya yanıt verilmesine izin vermiyor."
              : thread?.replyUntil && thread.replyUntil <= Date.now()
                ? "Bu konuşmanın yanıt süresi doldu."
                : snapshot && (!snapshot.hostOnline || snapshot.stopped || !snapshot.sendingEnabled)
                  ? "Gönderim kapalı. Otomasyonlar bölümündeki gönderim kontrollerini kullanın."
                  : snapshot && (!account?.connected || account.paused)
                    ? "Hesap bağlı değil veya durdurulmuş. Hesaplar bölümünü kontrol edin."
                    : "";
  return (
    <article className="social-preview">
      <div className="social-record-heading">
        <strong>
          {draft.kind === "message" ? "Mesaj" : draft.kind === "comment" ? "Yorum" : "Yanıt"}{" "}
          taslağı
        </strong>
        <StatusBadge
          status={job?.status ?? (generating ? "running" : draft.reviewReason ? "review" : "draft")}
          label={
            job
              ? statuses[job.status]
              : generating
                ? "Hazırlanıyor"
                : draft.reviewReason
                  ? "İnceleme gerekli"
                  : "Taslak hazır"
          }
        />
      </div>
      <p className="social-muted">
        {account?.name ?? draft.accountId} · {contact?.name ?? "Konuşmadaki kişi"}
        {` · ${time(draft.createdAt)}`}
      </p>
      {draft.generation ? (
        <p className="social-muted">
          Ajan: {HARNESS_TITLE[draft.generation.agent.provider]} ·{" "}
          {draft.generation.agent.model || "varsayılan model"} ·{" "}
          {
            {
              queued: "Üretim bekliyor",
              running: "Üretiliyor",
              completed: "Üretildi",
              review: "İnceleme gerekiyor",
            }[draft.generation.status]
          }
        </p>
      ) : null}
      {draft.media?.length ? (
        <p role="status">
          Ekler:{" "}
          {draft.media.some((item) => item.kind === "video")
            ? "1 video"
            : `${draft.media.length} görsel`}
        </p>
      ) : null}
      {editing ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (mediaBusy) return;
            void (async () => {
              if (
                await run(async () => {
                  const { effective } = await client.request<{ effective: SocialPolicy }>(
                    "policy.get",
                    { accountId: draft.accountId },
                  );
                  const latestLimit = socialLimit(
                    effective,
                    draft.kind === "message" || thread?.kind === "message" ? "message" : "comment",
                  );
                  if (latestLimit !== undefined && socialCharacterCount(text) > latestLimit)
                    throw new Error(`Metin ${latestLimit} karakter sınırını aşıyor.`);
                  return client.request("drafts.update", {
                    id: draft.id,
                    text,
                    factIds,
                    ...(account?.platform === "x" ? { media } : {}),
                  });
                }, "Taslak güncellendi. Yeni içerik gönderim için yeniden onaylanmalı.")
              )
                setEditing(false);
            })();
          }}
        >
          <label>
            Taslak metni
            <TextareaField
              hideLabel
              label="Taslak metni"
              aria-label="Taslak metni"
              required
              rows={4}
              value={text}
              disabled={!!account && !editPolicy}
              onChange={(event) => setText(event.target.value)}
            />
          </label>
          <details className="social-settings">
            <summary>Bilgi kaynakları (isteğe bağlı)</summary>
            {facts.map((fact) => (
              <label className="social-inline-check" key={fact.id}>
                <Checkbox
                  checked={factIds.includes(fact.id)}
                  onChange={(event) =>
                    setFactIds((current) =>
                      event.target.checked
                        ? [...current, fact.id]
                        : current.filter((id) => id !== fact.id),
                    )
                  }
                />
                {fact.topic}
              </label>
            ))}
            {missingFacts.length ? (
              <p role="status">
                Bu taslağın bazı kaynak bilgileri silinmiş. Güncel bir bilgi seçin veya silinen
                bağlantıları kaldırın.
              </p>
            ) : null}
            {factIds.length ? (
              <Button variant="secondary" type="button" onClick={() => setFactIds([])}>
                Bilgi bağlantılarını kaldır
              </Button>
            ) : (
              <p className="social-muted">Bu taslak belirli bir kaynak bilgiye bağlı değil.</p>
            )}
          </details>
          {account && !editPolicy ? (
            <Notice kind={policyError ? "error" : "loading"}>
              {policyError || "Hesap sınırları yükleniyor…"}
              {policyError ? (
                <Button
                  variant="secondary"
                  type="button"
                  onClick={() => setPolicyAttempt((attempt) => attempt + 1)}
                >
                  Yeniden dene
                </Button>
              ) : null}
            </Notice>
          ) : null}
          <p className="social-muted" role="status">
            {count}
            {limit ? ` / ${limit}` : ""} karakter
          </p>
          {limit && count > limit ? (
            <Alert tone="danger">Karakter sınırını {count - limit} karakter aştınız.</Alert>
          ) : null}
          {account?.platform === "x" &&
          !(
            account.connection === "browser" &&
            (draft.kind === "message" || thread?.kind === "message")
          ) ? (
            <XMediaFields
              value={media}
              client={client}
              onChange={setMedia}
              onBusyChange={setMediaBusy}
              message={draft.kind === "message" || thread?.kind === "message"}
            />
          ) : null}
          <div className="social-actions">
            <Button
              type="submit"
              variant="primary"

              disabled={
                mediaBusy ||
                !text.trim() ||
                (!!limit && count > limit) ||
                !!missingFacts.length ||
                (!!account && !editPolicy)
              }
            >
              Değişiklikleri kaydet
            </Button>
            <Button variant="secondary" type="button" onClick={() => setEditing(false)}>
              Vazgeç
            </Button>
          </div>
        </form>
      ) : (
        <p className="social-message">{draft.text || "Taslak hazırlanıyor…"}</p>
      )}
      {disabledReason && !job ? (
        <Notice kind={draft.reviewReason || contact?.optedOut ? "warning" : "info"}>
          {disabledReason}
        </Notice>
      ) : null}
      {job?.error ? (
        <Notice
          kind={job.status === "review" ? "warning" : job.status === "failed" ? "error" : "info"}
        >
          {job.error}
        </Notice>
      ) : null}
      {job?.url ? (
        <a href={job.url} target="_blank" rel="noreferrer">
          Platformda görüntüle
        </a>
      ) : null}
      {!editing ? (
        <div className="social-actions">
          <Button
            type="submit"
            variant="secondary"
            disabled={!!job || draft.generation?.status === "running"}
            onClick={() => {
              setText(draft.text);
              setFactIds(draft.factIds);
              setMedia(draft.media ?? []);
              setEditing(true);
            }}
          >
            Düzenle
          </Button>
          <Button
            type="submit"
            variant="primary"

            disabled={!!disabledReason || !draft.text.trim()}
            onClick={() =>
              void run(async () => {
                const reviewedDraft = structuredClone(draft);
                const { effective } = await client.request<{ effective: SocialPolicy }>(
                  "policy.get",
                  { accountId: draft.accountId },
                );
                const latestLimit = socialLimit(
                  effective,
                  draft.kind === "message" || thread?.kind === "message" ? "message" : "comment",
                );
                if (latestLimit !== undefined && socialCharacterCount(draft.text) > latestLimit)
                  throw new Error(
                    `Metin ${latestLimit} karakter sınırını aşıyor. Taslağı düzenleyin.`,
                  );
                await client.request("drafts.approve", {
                  id: reviewedDraft.id,
                  reviewedDraft,
                } satisfies SocialDraftApprovalInput);
                await client.request(
                  `${draft.kind === "reply" ? "replies" : draft.kind === "message" ? "messages" : "comments"}.send`,
                  { id: draft.id },
                );
              }, "Taslak onaylandı ve gönderim kuyruğuna eklendi.")
            }
          >
            Onayla ve gönderim kuyruğuna ekle
          </Button>
        </div>
      ) : null}
    </article>
  );
}
