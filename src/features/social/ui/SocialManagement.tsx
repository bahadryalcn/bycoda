import { Alert } from "../../../shared/ui/Alert";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { TextField } from "../../../shared/ui/TextField";
import { Button } from "../../../shared/ui/Button";
import { NativeSelect } from "../../../shared/ui/Select";
import { NativeSearchableSelect } from "../../../shared/ui/NativeSearchableSelect";
import { Checkbox } from "../../../shared/ui/Checkbox";
import { SearchInput } from "../../../shared/ui/SearchInput";
import { useState } from "react";
import { SocialContactHistory } from "./SocialHistoryPage";
import { useSocialWorkspaceFilter } from "./useSocialWorkspaceFilter";
import { JobHistory } from "./SocialHistory";
import type { SocialContact, SocialSnapshot, SocialThread } from "../model/social";
import type { SocialClient } from "../model/socialClient";
import { REMOTE_PROVIDERS } from "../../connections/model/protocol";
import { HARNESS_TITLE } from "../../sessions/model/session";
import { DEFAULT_SOCIAL_POLICIES, effectiveSocialPolicy } from "../model/socialPolicy";
import { DraftList } from "./SocialDrafts";
import { SocialBulkComposer } from "./SocialBulkComposer";
import { contactTarget } from "./socialBulk";
import {
  Empty,
  Notice,
  StatusBadge,
  Composer,
  closeComposer,
  Projects,
  field,
  names,
  time,
  type Props,
  type Run,
} from "./socialShared";
export function Audience({
  client,
  snapshot,
  projects,
  initialProject,
  run,
  onFilterChange,
}: Props) {
  const [selectedProjects, setSelectedProjects] = useState<string[]>(
    initialProject ? [initialProject] : [],
  );
  const [selectedId, setSelectedId] = useState("");
  const [checkedIds, setCheckedIds] = useState<string[]>([]);
  const selected = snapshot.contacts.find((contact) => contact.id === selectedId);
  const [query, setQuery] = useState("");
  const [segment, setSegment] = useState("");
  const [accountFilter, setAccountFilter] = useState("");
  const hostFiltered = useSocialWorkspaceFilter(
    snapshot,
    "contacts",
    {
      query,
      segmentId: segment,
      accountId: accountFilter,
    },
    onFilterChange,
  );
  const selectedSegment = snapshot.segments.find((item) => item.id === segment);
  const contacts = snapshot.contacts.filter(
    (contact) =>
      hostFiltered ||
      ((!accountFilter || contact.accountId === accountFilter) &&
        (!selectedSegment ||
          ((!selectedSegment.language || selectedSegment.language === contact.language) &&
            selectedSegment.tags.every((tag) => contact.tags.includes(tag)) &&
            selectedSegment.projectIds.some((id) => contact.projectIds.includes(id)))) &&
        `${contact.name} ${contact.platformId} ${contact.tags.join(" ")}`
          .toLocaleLowerCase()
          .includes(query.toLocaleLowerCase())),
  );
  return (
    <div className="social-page">
      <p className="social-page-intro">
        Kişi veya grup seçin, mesaj ve yorum taslaklarını hazırlayın.
      </p>
      <Composer title="Kişi ekle">
        <ContactForm
          client={client}
          snapshot={snapshot}
          projects={projects}
          initialProject={initialProject}
          run={run}
        />
      </Composer>
      <Composer title="Segment oluştur">
        <form
          className="social-form"
          onSubmit={(event) => {
            const form = event.currentTarget;
            const data = field(event);
            void (async () => {
              if (
                await run(
                  () =>
                    client.request("segments.create", {
                      name: data.get("name"),
                      projectIds: selectedProjects,
                      tags: String(data.get("tags") ?? "")
                        .split(",")
                        .map((item) => item.trim())
                        .filter(Boolean),
                      ...(data.get("language") ? { language: data.get("language") } : {}),
                    }),
                  "Kişi grubu oluşturuldu. Segment filtresinden seçebilirsiniz.",
                )
              ) {
                form.reset();
                closeComposer(form);
              }
            })();
          }}
        >
          <h3>Segment oluştur</h3>
          <label>
            Ad
            <TextField hideLabel label="" name="name" maxLength={200} required />
          </label>
          <label>
            Kullanıcının verdiği etiketler
            <TextField hideLabel label="" name="tags" placeholder="Virgülle ayırın" />
          </label>
          <label>
            Dil
            <TextField hideLabel label="" name="language" maxLength={30} placeholder="tr" />
          </label>
          <Projects
            projects={projects}
            selected={selectedProjects}
            onChange={setSelectedProjects}
          />
          <Button
            type="submit"
            variant="secondary"
            disabled={
              !selectedProjects.length ||
              selectedProjects.some((id) => !projects.some((project) => project.id === id))
            }
          >
            Segment kaydet
          </Button>
        </form>
      </Composer>
      <div className="social-columns">
        <section>
          <h2>
            Kişiler <small>{contacts.length}</small>
          </h2>
          <label>
            Kişi veya etiket ara
            <SearchInput
              appearance="field"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <label>
            Segment
            <SearchableSelect
              value={segment}
              label={"Segment"}
              options={[
                { value: "", label: "Tüm kişiler" },
                ...snapshot.segments.map((item) => ({
                  value: item.id,
                  label: item.name,
                })),
              ]}
              onChange={(nextValue) => setSegment(nextValue)}
              searchLocale="tr"
            />
          </label>
          <label>
            Hesap
            <SearchableSelect
              value={accountFilter}
              label={"Hesap"}
              options={[
                { value: "", label: "Tüm hesaplar" },
                ...snapshot.accounts.map((account) => ({
                  value: account.id,
                  label: account.name,
                })),
              ]}
              onChange={(nextValue) => setAccountFilter(nextValue)}
              searchLocale="tr"
            />
          </label>
          <label className="social-select-all">
            <Checkbox
              aria-label="Görünen tüm kişileri seç"
              checked={
                contacts.length > 0 && contacts.every((contact) => checkedIds.includes(contact.id))
              }
              disabled={!contacts.length}
              onChange={(event) =>
                setCheckedIds(event.target.checked ? contacts.map((contact) => contact.id) : [])
              }
            />
            Görünen tüm kişileri seç ({contacts.length})
          </label>
          <div className="social-bulk-toolbar">
            <span>
              {checkedIds.filter((id) => contacts.some((contact) => contact.id === id)).length} kişi
              seçili
            </span>
            <Button
              variant="secondary"
              type="button"
              disabled={!checkedIds.length}
              onClick={() => setCheckedIds([])}
            >
              Seçimi temizle
            </Button>
          </div>
          <Composer title="Seçili kişilere mesaj veya yorum hazırla">
            <SocialBulkComposer
              client={client}
              snapshot={snapshot}
              projects={projects}
              initialProject={initialProject}
              run={run}
              targets={contacts
                .filter((contact) => checkedIds.includes(contact.id))
                .map(contactTarget)}
            />
          </Composer>
          {selectedSegment ? (
            <Button
              variant="secondary"
              type="button"
              disabled={!contacts.length}
              onClick={() => setCheckedIds(contacts.map((contact) => contact.id))}
            >
              Bu grubun tüm kişilerini seç ({contacts.length})
            </Button>
          ) : null}
          {contacts.length ? (
            <div className="social-list">
              {contacts.map((contact) => (
                <div className="social-selection-row" key={contact.id}>
                  <label>
                    <Checkbox
                      aria-label={`${contact.name} kişisini seç`}
                      checked={checkedIds.includes(contact.id)}
                      onChange={(event) =>
                        setCheckedIds((current) =>
                          event.target.checked
                            ? [...current, contact.id]
                            : current.filter((id) => id !== contact.id),
                        )
                      }
                    />
                  </label>
                  <Button
                    type="submit"
                    variant="tab"
                    className="social-row"
                    aria-label={contact.name}
                    aria-pressed={contact.id === selectedId}
                    onClick={() => setSelectedId(contact.id)}
                  >
                    <strong>{contact.name}</strong>
                    <span>
                      {snapshot.accounts.find((account) => account.id === contact.accountId)
                        ?.name ?? "Hesap bulunamadı"}{" "}
                      · {contact.platformId}
                    </span>
                    <span>
                      {contact.projectIds
                        .map(
                          (id) =>
                            projects.find((project) => project.id === id)?.name ??
                            "Erişilemeyen proje",
                        )
                        .join(", ")}
                      {contact.tags.length ? ` · ${contact.tags.join(", ")}` : ""}
                    </span>
                    <StatusBadge
                      status={
                        contact.optedOut
                          ? "cancelled"
                          : contact.consent?.allowed
                            ? "available"
                            : "review"
                      }
                      label={
                        contact.optedOut
                          ? "İletişim kapalı"
                          : contact.consent?.allowed
                            ? "Mesaj izni var"
                            : "Mesaj izni yok"
                      }
                    />
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <Empty title={query || segment ? "Kişi bulunamadı" : "Hedef kitlenizi oluşturun"}>
              {query || segment
                ? "Aramanıza uygun kişi bulunamadı. "
                : "Kişi ekleyin veya kişi listenizi içe aktarın. "}
            </Empty>
          )}
          <details className="social-settings">
            <summary>Kişileri içe aktar</summary>
            <label>
              JSON kişi listesi
              <TextField
                hideLabel
                label=""
                type="file"
                accept="application/json,.json"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file)
                    void run(async () => {
                      if (file.size > 1024 * 1024)
                        throw new Error("İçe aktarma en fazla 1 MiB olabilir.");
                      const contacts = JSON.parse(await file.text());
                      if (!Array.isArray(contacts))
                        throw new Error("Dosya bir JSON kişi listesi içermelidir.");
                      await client.request("contacts.import", { contacts });
                    });
                }}
              />
            </label>
            <p>
              accountId, platformId, name, projectIds, tags ve language alanları kullanılabilir. İçe
              aktarma gönderim izni oluşturmaz.
            </p>
          </details>
        </section>
        <section>
          {selected ? (
            <>
              <h3>{selected.name}</h3>
              <p>
                {snapshot.accounts.find((account) => account.id === selected.accountId)?.name ??
                  "Hesap bulunamadı"}{" "}
                · {selected.platformId}
              </p>
              {selected.profileUrl ? (
                <a href={selected.profileUrl} target="_blank" rel="noreferrer">
                  Profil
                </a>
              ) : null}
              <Notice
                kind={
                  selected.optedOut ? "warning" : selected.consent?.allowed ? "success" : "info"
                }
                title={
                  selected.optedOut
                    ? "İletişim durduruldu"
                    : selected.consent?.allowed
                      ? "Yeni mesaj izni kayıtlı"
                      : "Yeni mesaj izni kayıtlı değil"
                }
              >
                {selected.consent?.source ??
                  "İzin bilgisini kişi düzenleme bölümünden kaydedebilirsiniz."}
                {selected.consent?.at ? ` · ${time(selected.consent.at)}` : ""}
              </Notice>
              <Button
                type="submit"
                variant="secondary"
                disabled={selected.optedOut}
                onClick={() =>
                  void run(
                    () => client.request("contacts.optout", { id: selected.id }),
                    "Bu kişiyle iletişim durduruldu ve bekleyen işler iptal edildi.",
                  )
                }
              >
                {selected.optedOut
                  ? "Bu kişiyle iletişim durduruldu"
                  : "İletişimi durdur ve bekleyen işleri iptal et"}
              </Button>
              <details className="social-settings">
                <summary>Kişi bilgilerini ve izinlerini düzenle</summary>
                <ContactForm
                  key={selected.id}
                  client={client}
                  snapshot={snapshot}
                  projects={projects}
                  initialProject={initialProject}
                  run={run}
                  contact={selected}
                />
              </details>
              <SocialContactHistory contact={selected} client={client} />
              <Composer title="Mesaj veya yorum hazırla">
                <SocialBulkComposer
                  key={selected.id}
                  client={client}
                  snapshot={snapshot}
                  projects={projects}
                  initialProject={selected.projectIds[0]}
                  targets={[contactTarget(selected)]}
                  run={run}
                />
              </Composer>
              <DraftList
                drafts={snapshot.drafts.filter(
                  (draft) => draft.contactId === selected.id && !draft.threadId,
                )}
                client={client}
                run={run}
                snapshot={snapshot}
              />
            </>
          ) : (
            <Empty title="Kişi ayrıntıları">
              Proje ilişkilerini, iletişim geçmişini ve izinlerini görmek için bir kişi seçin.
            </Empty>
          )}
        </section>
      </div>
    </div>
  );
}
function ContactForm({
  client,
  snapshot,
  projects,
  initialProject,
  run,
  contact,
}: Props & { contact?: SocialContact }) {
  const [projectIds, setProjectIds] = useState<string[]>(
    contact?.projectIds ?? (initialProject ? [initialProject] : []),
  );
  const [addConsent, setAddConsent] = useState(false);
  const validProjects =
    projectIds.length > 0 &&
    projectIds.every((id) => projects.some((project) => project.id === id));
  return (
    <form
      className="social-form"
      onSubmit={(event) => {
        const form = event.currentTarget;
        const data = field(event);
        void (async () => {
          if (
            await run(
              async () => {
                if (!validProjects) throw new Error("Kişi için en az bir mevcut proje seçin.");
                const consentAt = new Date(String(data.get("date"))).getTime();
                if (
                  addConsent &&
                  (!Number.isFinite(consentAt) || consentAt <= 0 || consentAt > Date.now())
                )
                  throw new Error("İzin için geçmişteki geçerli bir tarih ve kaynak girin.");
                return client.request("contacts.upsert", {
                  ...(contact ? { id: contact.id } : {}),
                  accountId: data.get("account"),
                  platformId: data.get("identity"),
                  name: data.get("name"),
                  source: contact?.source ?? "manual",
                  projectIds,
                  tags: String(data.get("tags") ?? "")
                    .split(",")
                    .map((item) => item.trim())
                    .filter(Boolean),
                  ...(data.get("url") ? { profileUrl: data.get("url") } : {}),
                  ...(data.get("language") ? { language: data.get("language") } : {}),
                  replyEligible: !contact?.optedOut && data.get("reply") === "on",
                  commentEligible: !contact?.optedOut && data.get("comment") === "on",
                  ...(addConsent
                    ? {
                        consent: {
                          allowed: true,
                          source: data.get("source"),
                          at: consentAt,
                        },
                      }
                    : {}),
                });
              },
              contact
                ? "Kişi bilgileri güncellendi."
                : "Kişi eklendi. Listeden seçerek mesaj veya yorum hazırlayabilirsiniz.",
            )
          ) {
            if (!contact) {
              form.reset();
              closeComposer(form);
            }
            setAddConsent(false);
          }
        })();
      }}
    >
      <h3>{contact ? "Kişiyi güncelle" : "Yeni kişi"}</h3>
      <label>
        Hesap
        <NativeSearchableSelect
          label="Hesap"
          options={
            snapshot.accounts.length
              ? snapshot.accounts.map((account) => ({ value: account.id, label: account.name }))
              : [{ value: "", label: "Önce bir hesap ekleyin" }]
          }
          name="account"
          required
          defaultValue={contact?.accountId}
          disabled={!!contact || !snapshot.accounts.length}
        />
      </label>
      {contact ? <input type="hidden" name="account" value={contact.accountId} /> : null}
      <label>
        Platform kimliği
        <TextField
          hideLabel
          label=""
          name="identity"
          required
          maxLength={300}
          defaultValue={contact?.platformId}
          readOnly={!!contact}
          placeholder="Platformun verdiği alıcı kimliği"
        />
        <small>
          Gelen kutusundaki kişiler için bu kimlik otomatik alınır. Elle eklerken platformun verdiği
          alıcı kimliğini kullanın.
        </small>
      </label>
      <label>
        Ad
        <TextField
          hideLabel
          label=""
          name="name"
          required
          maxLength={300}
          defaultValue={contact?.name}
        />
      </label>
      <label>
        Profil URL
        <TextField
          hideLabel
          label=""
          name="url"
          type="url"
          defaultValue={contact?.profileUrl}
          placeholder="https://"
        />
      </label>
      <label>
        Etiketler
        <TextField
          hideLabel
          label=""
          name="tags"
          defaultValue={contact?.tags.join(", ")}
          placeholder="Virgülle ayırın"
        />
      </label>
      <label>
        Dil
        <TextField
          hideLabel
          label=""
          name="language"
          maxLength={30}
          defaultValue={contact?.language}
          placeholder="tr"
        />
      </label>
      <Projects projects={projects} selected={projectIds} onChange={setProjectIds} />
      <details className="social-settings">
        <summary>İletişim uygunluğu ve açık izin</summary>
        <p className="social-muted">
          Kişiyi eklemek gönderim izni vermez. Uygunlukları yalnızca doğruladığınızda seçin. Mevcut
          mesaj izni, yeni izin kaydetmedikçe korunur.
        </p>
        <fieldset className="social-checks" disabled={contact?.optedOut}>
          <legend>Uygunlukları ayrı doğrulayın</legend>
          <label>
            <Checkbox name="reply" defaultChecked={contact?.replyEligible} />
            Yanıt vermeye uygun
          </label>
          <label>
            <Checkbox name="comment" defaultChecked={contact?.commentEligible} />
            Gönderisine yorum yapmaya uygun
          </label>
          <label>
            <Checkbox
              name="consent"

              checked={addConsent}
              onChange={(event) => setAddConsent(event.target.checked)}
            />
            Yeni mesaj için açık iletişim izni kaydet
          </label>
        </fieldset>
        {addConsent ? (
          <>
            <label>
              İzin kaynağı
              <TextField
                hideLabel
                label=""
                name="source"
                maxLength={1000}
                required
                placeholder="İzin veren kişi ve doğrulama kaynağı"
              />
            </label>
            <label>
              İzin tarihi
              <TextField hideLabel label="" name="date" type="datetime-local" required />
            </label>
          </>
        ) : null}
      </details>
      {contact?.optedOut ? (
        <p className="social-muted">
          Bu kişi iletişimi durdurdu. Bilgileri güncellemek iletişim iznini yeniden açmaz.
        </p>
      ) : null}
      <Button
        type="submit"
        variant="secondary"
        disabled={!snapshot.accounts.length || !validProjects}
      >
        Kişiyi kaydet
      </Button>
      {!validProjects ? (
        <p className="social-muted">Kişiyi kaydetmek için bir proje seçin.</p>
      ) : null}
    </form>
  );
}
export function Rules({ client, snapshot, projects, initialProject, run }: Props) {
  const [chosenAccount, setAccountId] = useState(snapshot.accounts[0]?.id ?? "");
  const [chosenProject, setProjectId] = useState(initialProject ?? projects[0]?.id ?? "");
  const projectId = projects.some((project) => project.id === chosenProject)
    ? chosenProject
    : (projects[0]?.id ?? "");
  const accounts = snapshot.accounts.filter((account) =>
    account.grants[projectId]?.includes("draft"),
  );
  const accountId = accounts.some((account) => account.id === chosenAccount)
    ? chosenAccount
    : (accounts[0]?.id ?? "");
  const account = accounts.find((item) => item.id === accountId);
  const [mode, setMode] = useState("draft");
  const [trigger, setTrigger] = useState("comment");
  const [factId, setFactId] = useState("");
  const [agent, setAgent] = useState("");
  const [agentModel, setAgentModel] = useState("");
  const facts = snapshot.profiles.find((profile) => profile.projectId === projectId)?.facts ?? [];
  const canAutomate =
    account?.platform !== "linkedin" && !!account?.grants[projectId]?.includes("reply");
  const triggerCapability = snapshot.capabilities[accountId]?.find(
    (item) => item.operation === (trigger === "comment" ? "comments.read" : "inbox.read"),
  );
  const validFact = facts.some((fact) => fact.id === factId);
  return (
    <div className="social-page social-rules-page">
      <p className="social-page-intro">
        Doğrulanmış bilgilerle yanıt kuralları hazırlayın; etkin kuralları, taslakları ve gönderim
        kuyruğunu izleyin.
      </p>
      <Composer title="Otomasyon kuralı oluştur">
        <form
          className="social-form"
          onSubmit={(event) => {
            const form = event.currentTarget;
            const data = field(event);
            const fact = facts.find((item) => item.id === factId);
            void (async () => {
              if (
                await run(async () => {
                  if (
                    !accountId ||
                    !projectId ||
                    !fact ||
                    (mode === "automatic" && !canAutomate) ||
                    triggerCapability?.status === "unsupported"
                  )
                    throw new Error(
                      "Kural için uygun hesap, proje, tetikleyici ve doğrulanmış bilgi seçin.",
                    );
                  return client.request("automations.create", {
                    name: data.get("name"),
                    accountId,
                    projectId,
                    mode,
                    trigger,
                    topics: fact ? [fact.topic] : [],
                    dailyLimit: Number(data.get("limit")),
                    stopWords: String(data.get("stop") ?? "")
                      .split(",")
                      .map((item) => item.trim())
                      .filter(Boolean),
                    answers: [{ keyword: data.get("keyword"), factId }],
                    ...(agent
                      ? {
                          agent: {
                            provider: agent,
                            ...(agentModel.trim() ? { model: agentModel.trim() } : {}),
                          },
                        }
                      : {}),
                  });
                })
              ) {
                form.reset();
                setFactId("");
                setMode("draft");
                setAgent("");
                setAgentModel("");
                closeComposer(form);
              }
            })();
          }}
        >
          <h3>Kural oluştur</h3>
          <details className="social-settings">
            <summary>Bu kural için farklı AI ajanı kullan</summary>
            <label>
              Bu kuralın AI ajanı
              <NativeSelect
                value={agent}
                onChange={(event) => {
                  setAgent(event.target.value);
                  setAgentModel("");
                }}
              >
                <option value="">Global / platform ajanını devral</option>
                {REMOTE_PROVIDERS.map((id) => (
                  <option key={id} value={id}>
                    {HARNESS_TITLE[id]}
                  </option>
                ))}
              </NativeSelect>
            </label>
            {agent ? (
              <label>
                Bu kuralın AI modeli
                <TextField
                  hideLabel
                  label=""
                  value={agentModel}
                  maxLength={200}
                  placeholder="Boş: ajanın varsayılan modeli"
                  onChange={(event) => setAgentModel(event.target.value)}
                />
              </label>
            ) : null}
          </details>
          <label>
            Ad
            <TextField hideLabel label="" name="name" required maxLength={200} />
          </label>
          <label>
            Hesap
            <SearchableSelect
              value={accountId}
              label={"Hesap"}
              options={[
                ...(!accounts.length
                  ? [
                      {
                        value: "",
                        label: "Seçili proje için taslak erişimi olan hesap yok",
                      },
                    ]
                  : []),
                ...accounts.map((account) => ({
                  value: account.id,
                  label: [account.name, "·", names[account.platform]].join(" "),
                })),
              ]}
              onChange={(nextValue) => setAccountId(nextValue)}
              searchLocale="tr"
            />
          </label>
          <label>
            Proje
            <SearchableSelect
              value={projectId}
              label={"Proje"}
              options={projects.map((project) => ({
                value: project.id,
                label: project.name || project.cwd,
              }))}
              onChange={(nextValue) => {
                setProjectId(nextValue);
                setFactId("");
              }}
              searchLocale="tr"
            />
          </label>
          <label>
            Mod
            <NativeSelect value={mode} onChange={(event) => setMode(event.target.value)}>
              <option value="draft">Yalnızca taslak</option>
              <option value="approval">Kullanıcı onayıyla gönderim</option>
              <option value="automatic" disabled={!canAutomate}>
                Açık kural kapsamında otomatik gönderim
              </option>
            </NativeSelect>
          </label>
          <label>
            Tetikleyici
            <NativeSelect
              name="trigger"
              value={trigger}
              onChange={(event) => setTrigger(event.target.value)}
            >
              <option
                value="comment"
                disabled={snapshot.capabilities[accountId]?.some(
                  (item) => item.operation === "comments.read" && item.status === "unsupported",
                )}
              >
                Gelen yorum
              </option>
              <option
                value="message"
                disabled={snapshot.capabilities[accountId]?.some(
                  (item) => item.operation === "inbox.read" && item.status === "unsupported",
                )}
              >
                Gelen mesaj
              </option>
            </NativeSelect>
          </label>
          <label>
            Tam eşleşecek gelen ifade
            <TextField
              hideLabel
              label=""
              name="keyword"
              required
              maxLength={100}
              placeholder="Örn. fiyatı nedir"
            />
          </label>
          {!facts.length ? (
            <p className="social-muted">
              Bu projede doğrulanmış bilgi yok. Kampanyalar bölümünden bir bilgi ekleyin.
            </p>
          ) : null}
          <label>
            İzin verilen yanıt bilgisi
            <NativeSearchableSelect
              label="İzin verilen yanıt bilgisi"
              options={[
                { value: "", label: "Doğrulanmış bilgi seç", disabled: true },
                ...facts.map((fact) => ({ value: fact.id, label: `${fact.topic}: ${fact.text}` })),
              ]}
              required
              value={factId}
              onChange={(event) => setFactId(event.target.value)}
            />
          </label>
          <details className="social-settings">
            <summary>İleri seçenekler: günlük sınır ve durdurma ifadeleri</summary>
            <label>
              Günlük sınır
              <TextField
                hideLabel
                label=""
                name="limit"
                type="number"
                min={1}
                max={100}
                defaultValue={10}
                required
              />
            </label>
            <label>
              Durdurma ifadeleri
              <TextField hideLabel label="" name="stop" placeholder="Virgülle ayırın" />
            </label>
          </details>
          {triggerCapability?.status === "unsupported" ? (
            <Alert tone="danger">
              {account?.connection === "browser"
                ? "Tarayıcı bağlantısı gelen kutusunu otomatik okuyamaz. Bu tetikleyici için resmi API bağlantısı gerekir."
                : triggerCapability.reason}
            </Alert>
          ) : null}
          {mode === "automatic" && !canAutomate ? (
            <Alert tone="danger">
              Otomatik gönderim için desteklenen bir hesap ve bu projeye yanıt izni gerekli.
            </Alert>
          ) : null}
          <p className="social-muted">
            Kural durdurulmuş olarak kaydedilir. İçeriği ve izinleri kontrol edip ayrıca
            etkinleştirin. AI ajanı ve içerik sınırları Ayarlar bölümünden devralınır.
          </p>
          <Button
            type="submit"
            variant="secondary"
            disabled={
              !accountId ||
              !projectId ||
              !validFact ||
              (mode === "automatic" && !canAutomate) ||
              triggerCapability?.status === "unsupported"
            }
          >
            Durdurulmuş kuralı kaydet
          </Button>
        </form>
      </Composer>
      <div className="social-columns">
        <section>
          <h2>
            Yanıt kuralları <small>{snapshot.rules.length}</small>
          </h2>
          {snapshot.rules.length ? (
            snapshot.rules.map((rule) => (
              <article className="social-preview" key={rule.id}>
                <h3>{rule.name}</h3>
                <p>
                  {snapshot.accounts.find((item) => item.id === rule.accountId)?.name ??
                    "Hesap bulunamadı"}{" "}
                  ·{" "}
                  {projects.find((item) => item.id === rule.projectId)?.name ?? "Proje bulunamadı"}{" "}
                  · {rule.trigger === "comment" ? "Gelen yorum" : "Gelen mesaj"}
                </p>
                <p>
                  {
                    (
                      {
                        draft: "Yalnızca taslak",
                        approval: "Kullanıcı onayıyla gönderim",
                        automatic: "Kurallar kapsamında otomatik",
                      } as Record<string, string>
                    )[rule.mode]
                  }{" "}
                  · Günlük {rule.dailyLimit}
                </p>
                <StatusBadge status={rule.enabled ? "active" : "paused"} />
                <p>{rule.topics.join(", ")}</p>
                {rule.pausedReason ? (
                  <Notice kind="warning" title="Kural durduruldu">
                    {rule.pausedReason}
                  </Notice>
                ) : null}
                <p>
                  Ajan:{" "}
                  {(() => {
                    const account = snapshot.accounts.find((item) => item.id === rule.accountId);
                    const agent = account
                      ? effectiveSocialPolicy(
                          snapshot.policies ?? DEFAULT_SOCIAL_POLICIES,
                          account.platform,
                          rule.agent,
                        ).agent
                      : rule.agent;
                    return agent
                      ? `${HARNESS_TITLE[agent.provider]} · ${agent.model || "varsayılan model"}${rule.agent ? " · kurala özel" : " · global / platform ayarı"}`
                      : "Seçilmedi · doğrulanmış sabit yanıt";
                  })()}
                </p>
                <div className="social-actions">
                  <Button
                    type="submit"
                    variant="secondary"
                    disabled={!rule.enabled}
                    onClick={() =>
                      void run(() => client.request("automations.pause", { id: rule.id }))
                    }
                  >
                    Durdur
                  </Button>
                  {!rule.enabled ? (
                    <Button
                      type="submit"
                      variant="secondary"
                      onClick={() =>
                        void run(() =>
                          client.request("automations.activate", {
                            id: rule.id,
                            ...(rule.mode === "automatic"
                              ? { confirm: "ENABLE_AUTOMATIC_REPLIES" }
                              : {}),
                          }),
                        )
                      }
                    >
                      {rule.mode === "automatic"
                        ? "Bu kuralın otomatik gönderimini etkinleştir"
                        : "Etkinleştir"}
                    </Button>
                  ) : null}
                </div>
              </article>
            ))
          ) : (
            <Empty title="İlk yanıt kuralınızı oluşturun">
              Doğrulanmış bilgiyle başlayın. Yeni kurallar durdurulmuş olarak kaydedilir; otomatik
              gönderim ayrıca etkinleştirilir.
            </Empty>
          )}
        </section>
        <section>
          <h2>Yanıt taslakları ve onay durumu</h2>

          <DraftList drafts={snapshot.drafts} client={client} run={run} snapshot={snapshot} />
          {!snapshot.drafts.length ? (
            <p className="social-muted">İncelenecek yanıt taslağı yok.</p>
          ) : null}
        </section>
      </div>
    </div>
  );
}
export function JobList({
  snapshot,
  campaignId,
  thread,
  client,
  run,
}: {
  snapshot: SocialSnapshot;
  campaignId?: string;
  thread?: SocialThread;
  client: SocialClient;
  run: Run;
}) {
  const jobs = snapshot.jobs.filter(
    (job) =>
      (!campaignId || job.campaignId === campaignId) &&
      (!thread ||
        snapshot.drafts.some((draft) => draft.id === job.draftId && draft.threadId === thread.id)),
  );
  return <JobHistory snapshot={snapshot} jobs={jobs} client={client} run={run} />;
}
