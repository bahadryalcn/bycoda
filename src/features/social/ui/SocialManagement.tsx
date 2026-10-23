import { SocialFilters } from "./SocialFilters";
import { Alert } from "../../../shared/ui/Alert";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { TextField } from "../../../shared/ui/TextField";
import { Button } from "../../../shared/ui/Button";
import { NativeSelect } from "../../../shared/ui/Select";
import { NativeSearchableSelect } from "../../../shared/ui/NativeSearchableSelect";
import { Checkbox } from "../../../shared/ui/Checkbox";
import { SearchInput } from "../../../shared/ui/SearchInput";
import { useState } from "react";
import { getLocale, t, useLocale } from "../../../shared/i18n";
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
const selectedContacts = (count: number) =>
  count === 1 ? t("1 contact selected") : t("{p0} contacts selected", { p0: count });
export function Audience({
  client,
  snapshot,
  projects,
  initialProject,
  run,
  onFilterChange,
}: Props) {
  useLocale();
  const [selectedProjects, setSelectedProjects] = useState<string[]>(
    initialProject ? [initialProject] : [],
  );
  const [selectedId, setSelectedId] = useState(snapshot.contacts[0]?.id ?? "");
  const [checkedIds, setCheckedIds] = useState<string[]>([]);
  const selected =
    snapshot.contacts.find((contact) => contact.id === selectedId) ?? snapshot.contacts[0];
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
          .toLocaleLowerCase(getLocale())
          .includes(query.toLocaleLowerCase(getLocale()))),
  );
  const checkedVisible = checkedIds.filter((id) => contacts.some((contact) => contact.id === id));
  return (
    <div className="social-page social-collection-page">
      <div className="social-collection-actions">
        <Composer title={t("Add contact")}>
          <ContactForm
            client={client}
            snapshot={snapshot}
            projects={projects}
            initialProject={initialProject}
            run={run}
          />
        </Composer>
        <Composer title={t("Create segment")}>
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
                    t("Contact group created. You can pick it from the segment filter."),
                  )
                ) {
                  form.reset();
                  closeComposer(form);
                }
              })();
            }}
          >
            <h3>{t("Create segment")}</h3>
            <TextField label={t("Name")} name="name" maxLength={200} required />
            <TextField
              label={t("User-provided tags")}
              name="tags"
              placeholder={t("Separate with commas")}
            />
            <TextField label={t("Language")} name="language" maxLength={30} placeholder="tr" />
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
              {t("Save segment")}
            </Button>
          </form>
        </Composer>
      </div>
      <div
        className="social-columns social-collection-workspace"
        data-empty={!snapshot.contacts.length}
      >
        <section className="social-collection-list">
          <h2>
            {t("Contacts")} <small>{contacts.length}</small>
          </h2>
          <div className="social-list-tools">
            <label>
              {t("Search contacts or tags")}
              <SearchInput
                appearance="field"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <SocialFilters
              activeCount={Number(!!segment) + Number(!!accountFilter)}
              onReset={() => {
                setSegment("");
                setAccountFilter("");
              }}
            >
              <label>
                {t("Segment")}
                <SearchableSelect
                  value={segment}
                  label={t("Segment")}
                  options={[
                    { value: "", label: t("All contacts") },
                    ...snapshot.segments.map((item) => ({
                      value: item.id,
                      label: item.name,
                    })),
                  ]}
                  onChange={(nextValue) => setSegment(nextValue)}
                  searchLocale={getLocale()}
                />
              </label>
              <label>
                {t("Account")}
                <SearchableSelect
                  value={accountFilter}
                  label={t("Account")}
                  options={[
                    { value: "", label: t("All accounts") },
                    ...snapshot.accounts.map((account) => ({
                      value: account.id,
                      label: account.name,
                    })),
                  ]}
                  onChange={(nextValue) => setAccountFilter(nextValue)}
                  searchLocale={getLocale()}
                />
              </label>
            </SocialFilters>
          </div>
          <label className="social-select-all" hidden={!contacts.length}>
            <Checkbox
              aria-label={t("Select all visible contacts")}
              checked={
                contacts.length > 0 && contacts.every((contact) => checkedIds.includes(contact.id))
              }
              disabled={!contacts.length}
              onChange={(event) =>
                setCheckedIds(event.target.checked ? contacts.map((contact) => contact.id) : [])
              }
            />
            {t("Select all visible contacts")} ({contacts.length})
          </label>
          <div hidden={!contacts.some((contact) => checkedIds.includes(contact.id))}>
            <div className="social-bulk-toolbar">
              <span>{selectedContacts(checkedVisible.length)}</span>
              <Button
                variant="secondary"
                type="button"
                disabled={!checkedIds.length}
                onClick={() => setCheckedIds([])}
              >
                {t("Clear selection")}
              </Button>
            </div>
            <Composer title={t("Prepare a message or comment for the selected contacts")}>
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
          </div>
          {selectedSegment ? (
            <Button
              variant="secondary"
              type="button"
              disabled={!contacts.length}
              onClick={() => setCheckedIds(contacts.map((contact) => contact.id))}
            >
              {t("Select all contacts in this group ({p0})", { p0: contacts.length })}
            </Button>
          ) : null}
          {contacts.length ? (
            <div className="social-list">
              {contacts.map((contact) => (
                <div className="social-selection-row" key={contact.id}>
                  <label>
                    <Checkbox
                      aria-label={t("Select contact {p0}", { p0: contact.name })}
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
                    type="button"
                    variant="tab"
                    layout="stacked"
                    className="social-row"
                    aria-label={contact.name}
                    aria-pressed={contact.id === selectedId}
                    onClick={() => setSelectedId(contact.id)}
                  >
                    <strong>{contact.name}</strong>
                    <span>
                      {snapshot.accounts.find((account) => account.id === contact.accountId)
                        ?.name ?? t("Account not found")}{" "}
                      · {contact.platformId}
                    </span>
                    <span>
                      {contact.projectIds
                        .map(
                          (id) =>
                            projects.find((project) => project.id === id)?.name ??
                            t("Inaccessible project"),
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
                          ? t("Contact closed")
                          : contact.consent?.allowed
                            ? t("Messaging allowed")
                            : t("No messaging consent")
                      }
                    />
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <Empty
              title={
                query || segment || accountFilter
                  ? t("No contacts found")
                  : t("Build your audience")
              }
            >
              {query || segment || accountFilter
                ? t("No contact matches your search.")
                : t("Add a contact or import your contact list.")}
            </Empty>
          )}
          <details className="social-settings">
            <summary>{t("Import contacts")}</summary>
            <TextField
              label={t("JSON contact list")}
              type="file"
              accept="application/json,.json"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file)
                  void run(async () => {
                    if (file.size > 1024 * 1024)
                      throw new Error(t("The import can be at most 1 MiB."));
                    const contacts = JSON.parse(await file.text());
                    if (!Array.isArray(contacts))
                      throw new Error(t("The file must contain a JSON contact list."));
                    await client.request("contacts.import", { contacts });
                  });
              }}
            />
            <p>
              {t(
                "The accountId, platformId, name, projectIds, tags and language fields can be used. Importing does not create sending permission.",
              )}
            </p>
          </details>
        </section>
        <section className="social-collection-detail" hidden={!snapshot.contacts.length}>
          {selected ? (
            <>
              <div className="social-detail-header">
                <h3>{selected.name}</h3>
                <Composer title={t("Prepare a message or comment")}>
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
              </div>
              <p>
                {snapshot.accounts.find((account) => account.id === selected.accountId)?.name ??
                  t("Account not found")}{" "}
                · {selected.platformId}
              </p>
              {selected.profileUrl ? (
                <a href={selected.profileUrl} target="_blank" rel="noreferrer">
                  {t("Profile")}
                </a>
              ) : null}
              <Notice
                kind={
                  selected.optedOut ? "warning" : selected.consent?.allowed ? "success" : "info"
                }
                title={
                  selected.optedOut
                    ? t("Contact stopped")
                    : selected.consent?.allowed
                      ? t("Consent for new messages is on record")
                      : t("No consent for new messages on record")
                }
              >
                {selected.consent?.source ??
                  t("You can record consent in the contact edit section.")}
                {selected.consent?.at ? ` · ${time(selected.consent.at)}` : ""}
              </Notice>
              <details className="social-settings">
                <summary>{t("Edit contact details and consent")}</summary>
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

              <DraftList
                drafts={snapshot.drafts.filter(
                  (draft) => draft.contactId === selected.id && !draft.threadId,
                )}
                client={client}
                run={run}
                snapshot={snapshot}
              />
              <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-(--ui-tone-neutral-border) pt-3">
                <Button
                  type="button"
                  variant="danger"
                  disabled={selected.optedOut}
                  onClick={() =>
                    void run(
                      () => client.request("contacts.optout", { id: selected.id }),
                      t("Contact with this person was stopped and pending jobs were cancelled."),
                    )
                  }
                >
                  {selected.optedOut
                    ? t("Contact with this person is stopped")
                    : t("Stop contact and cancel pending jobs")}
                </Button>
                {!selected.optedOut ? (
                  <small className="social-muted">
                    {t("Affects {p0} only. Pending jobs for this contact are cancelled.", {
                      p0: selected.name,
                    })}
                  </small>
                ) : null}
              </div>
            </>
          ) : (
            <Empty
              title={
                snapshot.contacts.length
                  ? t("Select a contact")
                  : t("Contacts and conversation history")
              }
            >
              {snapshot.contacts.length
                ? t("Manage the contact's history, consent and drafts here.")
                : t(
                    "Add a contact or import your list. You can review messages and comments before sending them.",
                  )}
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
  useLocale();
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
                if (!validProjects)
                  throw new Error(t("Select at least one existing project for the contact."));
                const consentAt = new Date(String(data.get("date"))).getTime();
                if (
                  addConsent &&
                  (!Number.isFinite(consentAt) || consentAt <= 0 || consentAt > Date.now())
                )
                  throw new Error(t("Enter a valid past date and a source for the consent."));
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
                ? t("Contact details updated.")
                : t("Contact added. Select it from the list to prepare a message or comment."),
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
      <h3>{contact ? t("Update contact") : t("New contact")}</h3>
      <label>
        {t("Account")}
        <NativeSearchableSelect
          label={t("Account")}
          options={
            snapshot.accounts.length
              ? snapshot.accounts.map((account) => ({ value: account.id, label: account.name }))
              : [{ value: "", label: t("Add an account first") }]
          }
          name="account"
          required
          defaultValue={contact?.accountId}
          disabled={!!contact || !snapshot.accounts.length}
        />
      </label>
      {contact ? <input type="hidden" name="account" value={contact.accountId} /> : null}
      <TextField
        label={t("Platform ID")}
        description={t(
          "For contacts from the inbox this ID is taken automatically. When adding manually, use the recipient ID the platform gave you.",
        )}
        name="identity"
        required
        maxLength={300}
        defaultValue={contact?.platformId}
        readOnly={!!contact}
        placeholder={t("Recipient ID issued by the platform")}
      />
      <TextField
        label={t("Name")}
        name="name"
        required
        maxLength={300}
        defaultValue={contact?.name}
      />
      <TextField
        label={t("Profile URL")}
        name="url"
        type="url"
        defaultValue={contact?.profileUrl}
        placeholder="https://"
      />
      <TextField
        label={t("Tags")}
        name="tags"
        defaultValue={contact?.tags.join(", ")}
        placeholder={t("Separate with commas")}
      />
      <TextField
        label={t("Language")}
        name="language"
        maxLength={30}
        defaultValue={contact?.language}
        placeholder="tr"
      />
      <Projects projects={projects} selected={projectIds} onChange={setProjectIds} />
      <details className="social-settings">
        <summary>{t("Contact eligibility and explicit consent")}</summary>
        <p className="social-muted">
          {t(
            "Adding a contact does not grant sending permission. Select eligibilities only after you verify them. Existing messaging consent is kept unless you record new consent.",
          )}
        </p>
        <fieldset className="social-checks" disabled={contact?.optedOut}>
          <legend>{t("Verify eligibilities separately")}</legend>
          <label>
            <Checkbox name="reply" defaultChecked={contact?.replyEligible} />
            {t("Eligible for replies")}
          </label>
          <label>
            <Checkbox name="comment" defaultChecked={contact?.commentEligible} />
            {t("Eligible for comments on their posts")}
          </label>
          <label>
            <Checkbox
              name="consent"
              checked={addConsent}
              onChange={(event) => setAddConsent(event.target.checked)}
            />
            {t("Record explicit contact consent for new messages")}
          </label>
        </fieldset>
        {addConsent ? (
          <>
            <TextField
              label={t("Consent source")}
              name="source"
              maxLength={1000}
              required
              placeholder={t("Person who gave consent and verification source")}
            />
            <TextField label={t("Consent date")} name="date" type="datetime-local" required />
          </>
        ) : null}
      </details>
      {contact?.optedOut ? (
        <p className="social-muted">
          {t(
            "This person stopped contact. Updating details does not turn contact consent back on.",
          )}
        </p>
      ) : null}
      {!validProjects ? (
        <p className="social-muted">{t("Select a project to save the contact.")}</p>
      ) : null}
      <Button
        type="submit"
        variant="secondary"
        disabled={!snapshot.accounts.length || !validProjects}
      >
        {t("Save contact")}
      </Button>
    </form>
  );
}
export function Rules({ client, snapshot, projects, initialProject, run }: Props) {
  useLocale();
  const [selectedRuleId, setSelectedRuleId] = useState(snapshot.rules[0]?.id ?? "");
  const [ruleQuery, setRuleQuery] = useState("");
  const selectedRule =
    snapshot.rules.find((rule) => rule.id === selectedRuleId) ?? snapshot.rules[0];
  const visibleRules = snapshot.rules.filter((rule) =>
    rule.name.toLocaleLowerCase(getLocale()).includes(ruleQuery.toLocaleLowerCase(getLocale())),
  );
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
  const modeLabels: Record<string, string> = {
    draft: t("Draft only"),
    approval: t("Send with user approval"),
    automatic: t("Automatic within the rules"),
  };
  return (
    <div className="social-page social-rules-page social-collection-page">
      <div className="social-collection-actions">
        <Composer title={t("Create automation rule")}>
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
                        t(
                          "Select a suitable account, project, trigger and verified fact for the rule.",
                        ),
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
            <h3>{t("Create rule")}</h3>
            <details className="social-settings">
              <summary>{t("Use a different AI agent for this rule")}</summary>
              <label>
                {t("AI agent for this rule")}
                <NativeSelect
                  value={agent}
                  onChange={(event) => {
                    setAgent(event.target.value);
                    setAgentModel("");
                  }}
                >
                  <option value="">{t("Inherit the global / platform agent")}</option>
                  {REMOTE_PROVIDERS.map((id) => (
                    <option key={id} value={id}>
                      {HARNESS_TITLE[id]}
                    </option>
                  ))}
                </NativeSelect>
              </label>
              {agent ? (
                <TextField
                  label={t("AI model for this rule")}
                  value={agentModel}
                  maxLength={200}
                  placeholder={t("Empty: the agent's default model")}
                  onChange={(event) => setAgentModel(event.target.value)}
                />
              ) : null}
            </details>
            <TextField label={t("Name")} name="name" required maxLength={200} />
            <label>
              {t("Account")}
              <SearchableSelect
                value={accountId}
                label={t("Account")}
                options={[
                  ...(!accounts.length
                    ? [
                        {
                          value: "",
                          label: t("No account with draft access for the selected project"),
                        },
                      ]
                    : []),
                  ...accounts.map((account) => ({
                    value: account.id,
                    label: [account.name, "·", names[account.platform]].join(" "),
                  })),
                ]}
                onChange={(nextValue) => setAccountId(nextValue)}
                searchLocale={getLocale()}
              />
            </label>
            <label>
              {t("Project")}
              <SearchableSelect
                value={projectId}
                label={t("Project")}
                options={projects.map((project) => ({
                  value: project.id,
                  label: project.name || project.cwd,
                }))}
                onChange={(nextValue) => {
                  setProjectId(nextValue);
                  setFactId("");
                }}
                searchLocale={getLocale()}
              />
            </label>
            <label>
              {t("Mode")}
              <NativeSelect value={mode} onChange={(event) => setMode(event.target.value)}>
                <option value="draft">{t("Draft only")}</option>
                <option value="approval">{t("Send with user approval")}</option>
                <option value="automatic" disabled={!canAutomate}>
                  {t("Automatic sending within an explicit rule")}
                </option>
              </NativeSelect>
            </label>
            <label>
              {t("Trigger")}
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
                  {t("Incoming comment")}
                </option>
                <option
                  value="message"
                  disabled={snapshot.capabilities[accountId]?.some(
                    (item) => item.operation === "inbox.read" && item.status === "unsupported",
                  )}
                >
                  {t("Incoming message")}
                </option>
              </NativeSelect>
            </label>
            <TextField
              label={t("Incoming phrase to match exactly")}
              name="keyword"
              required
              maxLength={100}
              placeholder={t("E.g. what is the price")}
            />
            {!facts.length ? (
              <p className="social-muted">
                {t("This project has no verified facts. Add one in the Campaigns section.")}
              </p>
            ) : null}
            <label>
              {t("Allowed reply fact")}
              <NativeSearchableSelect
                label={t("Allowed reply fact")}
                options={[
                  { value: "", label: t("Select a verified fact"), disabled: true },
                  ...facts.map((fact) => ({
                    value: fact.id,
                    label: `${fact.topic}: ${fact.text}`,
                  })),
                ]}
                required
                value={factId}
                onChange={(event) => setFactId(event.target.value)}
              />
            </label>
            <details className="social-settings">
              <summary>{t("Advanced options: daily limit and stop phrases")}</summary>
              <TextField
                label={t("Daily limit")}
                name="limit"
                type="number"
                min={1}
                max={100}
                defaultValue={10}
                required
              />
              <TextField
                label={t("Stop phrases")}
                name="stop"
                placeholder={t("Separate with commas")}
              />
            </details>
            {triggerCapability?.status === "unsupported" ? (
              <Alert tone="danger">
                {account?.connection === "browser"
                  ? t(
                      "The browser connection cannot read the inbox automatically. This trigger needs an official API connection.",
                    )
                  : triggerCapability.reason}
              </Alert>
            ) : null}
            {mode === "automatic" && !canAutomate ? (
              <Alert tone="danger">
                {t(
                  "Automatic sending needs a supported account and reply permission for this project.",
                )}
              </Alert>
            ) : null}
            <p className="social-muted">
              {t(
                "The rule is saved paused. Review the content and permissions, then enable it separately. The AI agent and content limits are inherited from Settings.",
              )}
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
              {t("Save paused rule")}
            </Button>
          </form>
        </Composer>
      </div>
      <div
        className="social-columns social-collection-workspace"
        data-empty={!snapshot.rules.length && !snapshot.drafts.length}
      >
        <section className="social-collection-list">
          <h2>
            {t("Reply rules")} <small>{snapshot.rules.length}</small>
          </h2>
          <label className="social-collection-search">
            <span className="sr-only">{t("Search rules")}</span>
            <SearchInput
              appearance="field"
              value={ruleQuery}
              onChange={(event) => setRuleQuery(event.target.value)}
              placeholder={t("Search rules")}
            />
          </label>
          <div className="social-list">
            {visibleRules.map((rule) => (
              <Button
                key={rule.id}
                type="button"
                variant="tab"
                layout="stacked"
                className="social-row"
                aria-pressed={selectedRule?.id === rule.id}
                onClick={() => setSelectedRuleId(rule.id)}
              >
                <strong>{rule.name}</strong>
                <span>
                  {snapshot.accounts.find((item) => item.id === rule.accountId)?.name ??
                    t("Account not found")}{" "}
                  · {rule.trigger === "comment" ? t("Comment") : t("Message")}
                </span>
                <StatusBadge status={rule.enabled ? "active" : "paused"} />
              </Button>
            ))}
            {!visibleRules.length ? (
              <Empty
                title={snapshot.rules.length ? t("No rules found") : t("Prepare replies with AI")}
              >
                {snapshot.rules.length
                  ? t("Change your search.")
                  : t(
                      "Create a reply rule. Define which account, which topic and how replies are prepared.",
                    )}
              </Empty>
            ) : null}
          </div>
        </section>
        <section
          className="social-collection-detail"
          hidden={!snapshot.rules.length && !snapshot.drafts.length}
        >
          {selectedRule
            ? [selectedRule].map((rule) => {
                const ruleAccount = snapshot.accounts.find((item) => item.id === rule.accountId);
                const ruleProject = projects.find((item) => item.id === rule.projectId);
                return (
                  <article className="social-preview" key={rule.id}>
                    <h3>{rule.name}</h3>
                    <p>
                      {ruleAccount?.name ?? t("Account not found")} ·{" "}
                      {ruleProject?.name ?? t("Project not found")} ·{" "}
                      {rule.trigger === "comment" ? t("Incoming comment") : t("Incoming message")}
                    </p>
                    <p>
                      {modeLabels[rule.mode]} · {t("Daily {p0}", { p0: rule.dailyLimit })}
                    </p>
                    <StatusBadge status={rule.enabled ? "active" : "paused"} />
                    <p>{rule.topics.join(", ")}</p>
                    {rule.pausedReason ? (
                      <Notice kind="warning" title={t("Rule paused")}>
                        {rule.pausedReason}
                      </Notice>
                    ) : null}
                    <p>
                      {t("Agent:")}{" "}
                      {(() => {
                        const agent = ruleAccount
                          ? effectiveSocialPolicy(
                              snapshot.policies ?? DEFAULT_SOCIAL_POLICIES,
                              ruleAccount.platform,
                              rule.agent,
                            ).agent
                          : rule.agent;
                        return agent
                          ? `${HARNESS_TITLE[agent.provider]} · ${agent.model || t("default model")} · ${rule.agent ? t("rule-specific") : t("global / platform setting")}`
                          : t("Not selected · verified fixed reply");
                      })()}
                    </p>
                    {!rule.enabled && rule.mode === "automatic" ? (
                      <small className="social-muted" role="status">
                        {t("Automatic replies will be sent from {p0} for {p1}.", {
                          p0: ruleAccount?.name ?? t("Account not found"),
                          p1: ruleProject?.name ?? t("Project not found"),
                        })}
                      </small>
                    ) : null}
                    <div className="social-actions">
                      <Button
                        type="button"
                        variant="secondary"
                        disabled={!rule.enabled}
                        onClick={() =>
                          void run(() => client.request("automations.pause", { id: rule.id }))
                        }
                      >
                        {t("Pause rule")}
                      </Button>
                      {!rule.enabled ? (
                        <Button
                          type="button"
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
                            ? t("Enable automatic sending for this rule")
                            : t("Activate")}
                        </Button>
                      ) : null}
                    </div>
                  </article>
                );
              })
            : null}
          <h2>{t("Replies to review")}</h2>

          <DraftList drafts={snapshot.drafts} client={client} run={run} snapshot={snapshot} />
          {!snapshot.drafts.length ? (
            <p className="social-muted">{t("No reply drafts to review.")}</p>
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
