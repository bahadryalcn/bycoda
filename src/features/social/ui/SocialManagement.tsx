import { Progress } from "../../../shared/ui/Progress";
import { useSocialPending } from "./useSocialPending";
import { useContext as useSocialContext } from "react";
import { SocialBusyContext as SocialLockContext } from "./socialContext";
import { SocialFilters } from "./SocialFilters";
import { Alert } from "../../../shared/ui/Alert";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { TextField } from "../../../shared/ui/TextField";
import { NumberField } from "../../../shared/ui/NumberField";
import { DateTimeField } from "../../../shared/ui/DateTimePicker";
import { Button } from "../../../shared/ui/Button";
import { BadgeList } from "../../../shared/ui/BadgeList";
import { NativeSelect } from "../../../shared/ui/Select";
import { NativeSearchableSelect } from "../../../shared/ui/NativeSearchableSelect";
import { Checkbox } from "../../../shared/ui/Checkbox";
import { SearchInput } from "../../../shared/ui/SearchInput";
import { mergeTags, type ContactTagSubject } from "../model/socialContactTags";
import { Stepper } from "../../../shared/ui/Stepper";
import { Sparkles } from "../../../shared/ui/icons";
import { useEffect, useId, useRef, useState } from "react";
import { getLocale, t, useLocale } from "../../../shared/i18n";
import { SocialContactHistory } from "./SocialHistoryPage";
import { useSocialWorkspaceFilter } from "./useSocialWorkspaceFilter";
import { JobHistory } from "./SocialHistory";
import type { SocialContact, SocialSnapshot, SocialThread } from "../model/social";
import type { SocialClient } from "../model/socialClient";
import { SocialModelField } from "./SocialModelField";
import { HARNESS_TITLE } from "../../sessions/model/session";
import { DEFAULT_SOCIAL_POLICIES, effectiveSocialPolicy } from "../model/socialPolicy";
import { DraftList } from "./SocialDrafts";
import {
  CONTACT_IMPORT_MAX_BYTES,
  previewContactImport,
  type ContactImportPreview,
} from "../model/socialContactImport";
import { SocialBulkComposer } from "./SocialBulkComposer";
import { ContactTagDialog } from "./ContactTagSuggestions";
import { RuleSimplifyReview, ruleModeLabel, useRuleSimplify } from "./RuleSimplifyReview";
import "./social-rules.css";
import "./social-tags.css";
import { contactTarget } from "./socialBulk";
import {
  Empty,
  Notice,
  StatusBadge,
  Composer,
  ComposerActions,
  SocialDialog,
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
  const pendingUi = useSocialPending();
  const socialLocked = useSocialContext(SocialLockContext);
  useLocale();
  const [selectedProjects, setSelectedProjects] = useState<string[]>(
    initialProject ? [initialProject] : [],
  );
  const [selectedId, setSelectedId] = useState(snapshot.contacts[0]?.id ?? "");
  const [checkedIds, setCheckedIds] = useState<string[]>([]);
  const [createRequest, setCreateRequest] = useState(0);
  const [importOpen, setImportOpen] = useState(false);
  const importSection = useRef<HTMLDetailsElement>(null);
  const [importPreview, setImportPreview] = useState<{
    name: string;
    preview: ContactImportPreview;
    /** Tags added to the draft rows from accepted AI suggestions (not saved until the import). */
    suggested?: number;
  }>();
  const [tagReview, setTagReview] = useState<{
    mode: "import" | "contacts";
    subjects: ContactTagSubject[];
  }>();
  useEffect(() => {
    if (importOpen) importSection.current?.scrollIntoView({ block: "nearest" });
  }, [importOpen]);
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
        <Composer title={t("Add contact")} openRequest={createRequest}>
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
                  await pendingUi.run("audience.save-segment", () =>
                    run(
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
                    ),
                  )
                ) {
                  form.reset();
                  closeComposer(form);
                }
              })();
            }}
          >
            <h3 className="sr-only">{t("Create segment")}</h3>
            <TextField
              disabled={socialLocked}
              label={t("Name")}
              name="name"
              maxLength={200}
              required
            />
            <div className="social-form-pair">
              <TextField
                disabled={socialLocked}
                label={t("User-provided tags")}
                name="tags"
                placeholder={t("Separate with commas")}
              />
              <TextField
                disabled={socialLocked}
                label={t("Language")}
                name="language"
                maxLength={30}
                placeholder="tr"
              />
            </div>
            <Projects
              projects={projects}
              selected={selectedProjects}
              onChange={setSelectedProjects}
            />
            <Button
              loading={pendingUi.is("audience.save-segment")}
              type="submit"
              variant="secondary"
              disabled={
                socialLocked ||
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
          <div className="social-list-heading">
            <h2>
              {t("Contacts")} <small>{contacts.length}</small>
            </h2>
          </div>
          <div className="social-list-tools">
            <SearchInput
              className="social-list-search"
              aria-label={t("Search contacts or tags")}
              placeholder={t("Name or tag")}
              disabled={socialLocked}
              appearance="field"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
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
                  disabled={socialLocked}
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
                  disabled={socialLocked}
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
              disabled={socialLocked || !contacts.length}
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
                startIcon={<Sparkles aria-hidden="true" />}
                disabled={socialLocked || !checkedVisible.length}
                onClick={() =>
                  setTagReview({
                    mode: "contacts",
                    subjects: contacts
                      .filter((contact) => checkedIds.includes(contact.id))
                      .map((contact) => ({
                        ref: contact.id,
                        accountId: contact.accountId,
                        platformId: contact.platformId,
                        projectIds: contact.projectIds,
                        name: contact.name,
                        profileUrl: contact.profileUrl,
                        language: contact.language,
                        tags: contact.tags,
                      })),
                  })
                }
              >
                {t("Suggest tags")}
              </Button>
              <Button
                variant="secondary"
                type="button"
                disabled={socialLocked || !checkedIds.length}
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
              disabled={socialLocked || !contacts.length}
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
                      disabled={socialLocked}
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
                    disabled={socialLocked}
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
              action={
                <div className="mt-2 flex flex-wrap gap-2">
                  {query || segment || accountFilter ? (
                    <Button
                      variant="ghost"
                      onClick={() => {
                        setQuery("");
                        setSegment("");
                        setAccountFilter("");
                      }}
                    >
                      {t("Clear filters")}
                    </Button>
                  ) : (
                    <>
                      <Button
                        onClick={() => setCreateRequest((value) => value + 1)}
                        disabled={socialLocked}
                      >
                        {t("Add contact")}
                      </Button>
                      <Button
                        variant="ghost"
                        onClick={() => setImportOpen(true)}
                        disabled={socialLocked}
                      >
                        {t("Import contacts")}
                      </Button>
                    </>
                  )}
                </div>
              }
            >
              {query || segment || accountFilter
                ? t("No contact matches your search.")
                : t("Add a contact or import your contact list.")}
            </Empty>
          )}
          <details
            ref={importSection}
            className="social-settings"
            open={importOpen}
            onToggle={(event) => setImportOpen(event.currentTarget.open)}
          >
            <summary>{t("Import contacts")}</summary>
            <p className="text-ui-caption text-(--ui-text-secondary)">
              {t(
                "Choose a JSON file. You review every row before anything is imported, and importing never grants permission to message anyone.",
              )}
            </p>
            <TextField
              key={importPreview?.name ?? "no-file"}
              disabled={socialLocked || pendingUi.is("contacts.import")}
              label={t("JSON contact list")}
              type="file"
              accept="application/json,.json"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                void (async () => {
                  const preview: ContactImportPreview =
                    file.size > CONTACT_IMPORT_MAX_BYTES
                      ? { rows: [], error: t("The import can be at most 1 MiB.") }
                      : previewContactImport(await file.text(), {
                          accounts: snapshot.accounts,
                          projectIds: projects.map((project) => project.id),
                        });
                  setImportPreview({ name: file.name, preview });
                })();
              }}
            />
            {importPreview
              ? (() => {
                  const { preview } = importPreview;
                  const valid = preview.rows.filter((row) => row.contact);
                  const invalid = preview.rows.filter((row) => !row.contact);
                  const ignored = [...new Set(preview.rows.flatMap((row) => row.ignored))];
                  return (
                    <div
                      className="social-import-preview"
                      role="group"
                      aria-label={t("Import preview")}
                    >
                      {preview.error ? (
                        <Notice kind="error" title={t("This file cannot be imported")}>
                          {preview.error}
                        </Notice>
                      ) : (
                        <>
                          <p>
                            <strong>{importPreview.name}</strong> ·{" "}
                            {t("{p0} contacts ready", { p0: valid.length })}
                            {invalid.length
                              ? " · " + t("{p0} rows need attention", { p0: invalid.length })
                              : ""}
                          </p>
                          {invalid.length ? (
                            <Notice kind="warning" title={t("These rows will be skipped")}>
                              <ul>
                                {invalid.slice(0, 8).map((row) => (
                                  <li key={row.row}>
                                    {t("Row {p0}", { p0: row.row })}: {row.issues.join(" ")}
                                  </li>
                                ))}
                              </ul>
                              {invalid.length > 8 ? (
                                <p>{t("And {p0} more rows.", { p0: invalid.length - 8 })}</p>
                              ) : null}
                            </Notice>
                          ) : null}
                          {ignored.length ? (
                            <p className="text-ui-caption text-(--ui-text-secondary)">
                              {t(
                                "Not imported: {p0}. Consent and eligibility are never taken from a file.",
                                { p0: ignored.join(", ") },
                              )}
                            </p>
                          ) : null}
                          {valid.length ? (
                            <details className="social-import-tags">
                              <summary>
                                {importPreview.suggested
                                  ? t("Tags in this import · {p0} added from AI suggestions", {
                                      p0: importPreview.suggested,
                                    })
                                  : t("Tags in this import")}
                              </summary>
                              <ul>
                                {valid.slice(0, 50).map((row) => (
                                  <li key={row.row}>
                                    <strong>{row.contact?.name}</strong>
                                    {" · "}
                                    {row.contact?.tags?.length
                                      ? row.contact.tags.join(", ")
                                      : t("No tags")}
                                  </li>
                                ))}
                              </ul>
                              {valid.length > 50 ? (
                                <p>{t("And {p0} more rows.", { p0: valid.length - 50 })}</p>
                              ) : null}
                            </details>
                          ) : null}
                        </>
                      )}
                      <div className="social-actions">
                        {!preview.error && valid.length ? (
                          <Button
                            loading={pendingUi.is("contacts.import")}
                            disabled={socialLocked}
                            onClick={() =>
                              void (async () => {
                                if (
                                  await pendingUi.run("contacts.import", () =>
                                    run(
                                      () =>
                                        client.request("contacts.import", {
                                          contacts: valid.map((row) => row.contact),
                                        }),
                                      t(
                                        "{p0} contacts imported. They have no messaging consent yet.",
                                        { p0: valid.length },
                                      ),
                                    ),
                                  )
                                )
                                  setImportPreview(undefined);
                              })()
                            }
                          >
                            {invalid.length
                              ? t("Import {p0} valid contacts", { p0: valid.length })
                              : t("Import {p0} contacts", { p0: valid.length })}
                          </Button>
                        ) : null}
                        {!preview.error && valid.length ? (
                          <Button
                            variant="secondary"
                            startIcon={<Sparkles aria-hidden="true" />}
                            disabled={socialLocked || pendingUi.is("contacts.import")}
                            onClick={() =>
                              setTagReview({
                                mode: "import",
                                subjects: valid.flatMap((row) =>
                                  row.contact
                                    ? [
                                        {
                                          ref: String(row.row),
                                          accountId: row.contact.accountId,
                                          platformId: row.contact.platformId,
                                          projectIds: row.contact.projectIds,
                                          name: row.contact.name,
                                          profileUrl: row.contact.profileUrl,
                                          language: row.contact.language,
                                          tags: row.contact.tags ?? [],
                                        },
                                      ]
                                    : [],
                                ),
                              })
                            }
                          >
                            {t("Suggest tags")}
                          </Button>
                        ) : null}
                        <Button
                          variant="ghost"
                          disabled={socialLocked || pendingUi.is("contacts.import")}
                          onClick={() => setImportPreview(undefined)}
                        >
                          {t("Choose another file")}
                        </Button>
                      </div>
                    </div>
                  );
                })()
              : null}
            {pendingUi.is("contacts.import") ? (
              <Progress label={t("Operation in progress…")} />
            ) : null}
            <details>
              <summary>{t("File format")}</summary>
              <p className="text-ui-caption text-(--ui-text-secondary)">
                {t(
                  "JSON array, up to 1 MiB and 500 contacts. Fields: accountId, platformId, name, projectIds, tags, language, profileUrl.",
                )}
              </p>
            </details>
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
                  loading={pendingUi.is("contact.optout")}
                  type="button"
                  variant="danger"
                  disabled={socialLocked || selected.optedOut}
                  onClick={() =>
                    void pendingUi.run("contact.optout", () =>
                      run(
                        () => client.request("contacts.optout", { id: selected.id }),
                        t("Contact with this person was stopped and pending jobs were cancelled."),
                      ),
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
      {tagReview ? (
        <ContactTagDialog
          mode={tagReview.mode}
          subjects={tagReview.subjects}
          client={client}
          accounts={snapshot.accounts}
          projects={projects}
          hostOnline={snapshot.hostOnline}
          run={run}
          onClose={() => setTagReview(undefined)}
          onApplyImport={(tags) =>
            // Draft only: the rows of this import gain the chosen tags; nothing is saved before the import.
            setImportPreview((current) => {
              if (!current) return current;
              let added = 0;
              const rows = current.preview.rows.map((row) => {
                const chosen = tags[String(row.row)];
                if (!row.contact || !chosen?.length) return row;
                const merged = mergeTags(row.contact.tags ?? [], chosen);
                added += merged.length - (row.contact.tags?.length ?? 0);
                return { ...row, contact: { ...row.contact, tags: merged } };
              });
              return {
                ...current,
                preview: { ...current.preview, rows },
                suggested: (current.suggested ?? 0) + added,
              };
            })
          }
        />
      ) : null}
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
  const pendingUi = useSocialPending();
  const socialLocked = useSocialContext(SocialLockContext);
  useLocale();
  const [projectIds, setProjectIds] = useState<string[]>(
    contact?.projectIds ?? (initialProject ? [initialProject] : []),
  );
  const [addConsent, setAddConsent] = useState(false);
  const [consentDate, setConsentDate] = useState("");
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
            await pendingUi.run("contact-form.save-contact", () =>
              run(
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
              ),
            )
          ) {
            if (!contact) {
              form.reset();
              closeComposer(form);
            }
            setAddConsent(false);
            setConsentDate("");
          }
        })();
      }}
    >
      <h3 className="sr-only">{contact ? t("Update contact") : t("New contact")}</h3>
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
          disabled={socialLocked || !!contact || !snapshot.accounts.length}
        />
      </label>
      {contact ? <input type="hidden" name="account" value={contact.accountId} /> : null}
      <TextField
        disabled={socialLocked}
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
        disabled={socialLocked}
        label={t("Name")}
        name="name"
        required
        maxLength={300}
        defaultValue={contact?.name}
      />
      <TextField
        disabled={socialLocked}
        label={t("Profile URL")}
        name="url"
        type="url"
        defaultValue={contact?.profileUrl}
        placeholder="https://"
      />
      <div className="social-form-pair">
        <TextField
          disabled={socialLocked}
          label={t("Tags")}
          name="tags"
          defaultValue={contact?.tags.join(", ")}
          placeholder={t("Separate with commas")}
        />
        <TextField
          disabled={socialLocked}
          label={t("Language")}
          name="language"
          maxLength={30}
          defaultValue={contact?.language}
          placeholder="tr"
        />
      </div>
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
            <Checkbox
              disabled={socialLocked}
              name="reply"
              defaultChecked={contact?.replyEligible}
            />
            {t("Eligible for replies")}
          </label>
          <label>
            <Checkbox
              disabled={socialLocked}
              name="comment"
              defaultChecked={contact?.commentEligible}
            />
            {t("Eligible for comments on their posts")}
          </label>
          <label>
            <Checkbox
              disabled={socialLocked}
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
              disabled={socialLocked}
              label={t("Consent source")}
              name="source"
              maxLength={1000}
              required
              placeholder={t("Person who gave consent and verification source")}
            />
            <DateTimeField
              disabled={socialLocked}
              label={t("Consent date")}
              name="date"
              required
              value={consentDate}
              onChange={setConsentDate}
            />
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
        loading={pendingUi.is("contact-form.save-contact")}
        type="submit"
        variant="secondary"
        disabled={socialLocked || !snapshot.accounts.length || !validProjects}
      >
        {t("Save contact")}
      </Button>
    </form>
  );
}
export function Rules({
  client,
  snapshot,
  projects,
  initialProject,
  run,
  onOpenContent,
  onOpenSettings,
}: Props) {
  const pendingUi = useSocialPending();
  const socialLocked = useSocialContext(SocialLockContext);
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
  const ruleFormId = useId();
  const [mode, setMode] = useState("draft");
  const [trigger, setTrigger] = useState("comment");
  const [factId, setFactId] = useState("");
  const [agent, setAgent] = useState("");
  const [agentModel, setAgentModel] = useState("");
  // One owner for the whole draft. The steps only render it, so Back/Next, closing the dialog
  // (the Composer parks the form) and the verified-facts detour never lose an entered value.
  const [ruleName, setRuleName] = useState("");
  const [keyword, setKeyword] = useState("");
  const [limit, setLimit] = useState("10");
  const [stop, setStop] = useState("");
  const [step, setStep] = useState(0);
  const [createRequest, setCreateRequest] = useState(0);
  const [simplifyOpen, setSimplifyOpen] = useState(false);
  const simplify = useRuleSimplify({
    client,
    rules: snapshot.rules,
    accounts: snapshot.accounts,
    profiles: snapshot.profiles,
    projects,
    hostOnline: snapshot.hostOnline,
    preferred: selectedRule,
    run,
  });
  const simplifyReason = simplify.phase === "review" ? "" : simplify.blocked;
  const facts = snapshot.profiles.find((profile) => profile.projectId === projectId)?.facts ?? [];
  const canAutomate =
    account?.platform !== "linkedin" && !!account?.grants[projectId]?.includes("reply");
  const triggerCapability = snapshot.capabilities[accountId]?.find(
    (item) => item.operation === (trigger === "comment" ? "comments.read" : "inbox.read"),
  );
  const validFact = facts.some((fact) => fact.id === factId);
  const projectName = projects.find((project) => project.id === projectId)?.name || projectId;
  const limitNumber = Number(limit);
  const limitValid =
    limit.trim() !== "" && Number.isInteger(limitNumber) && limitNumber >= 1 && limitNumber <= 100;
  const stopWords = stop
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  // Each blocker is shown in the step where it is resolved and disables Next with its reason.
  const contentBlockers = [
    ...(!projectId ? [t("Select a project.")] : []),
    ...(!accountId ? [t("No account with draft access for the selected project.")] : []),
    ...(triggerCapability?.status === "unsupported" ? [triggerCapability.reason] : []),
    ...(!ruleName.trim() ? [t("Enter a rule name.")] : []),
    ...(!facts.length
      ? [t("Add a verified fact for this project.")]
      : !validFact
        ? [t("Select the verified fact the rule may answer with.")]
        : []),
    ...(!keyword.trim() ? [t("Enter the phrase to match.")] : []),
  ];
  const behaviourBlockers = [
    ...(mode === "automatic" && !canAutomate
      ? [t("Automatic sending needs a supported account and reply permission for this project.")]
      : []),
    ...(!limitValid ? [t("Enter a whole daily limit from 1 to 100.")] : []),
  ];
  const stepBlockers = [contentBlockers, behaviourBlockers, [] as string[]];
  const stepsOpenTo = (index: number) => stepBlockers.slice(0, index).every((list) => !list.length);
  const ruleSteps = [
    { id: "content", label: t("Account and content") },
    { id: "behaviour", label: t("Behaviour") },
    { id: "review", label: t("Review") },
  ];
  const saveBlocked = socialLocked || !stepsOpenTo(2);
  const stepReason = stepBlockers[step].join(" ");
  const triggerLabel = trigger === "comment" ? t("Incoming comment") : t("Incoming message");
  const modeConsequence =
    mode === "automatic"
      ? t("Sends replies by itself within these limits once you enable the rule.")
      : mode === "approval"
        ? t("Prepares replies and sends one only after you approve it.")
        : t("Prepares reply drafts for you to review. Nothing is sent.");
  const chosenFact = facts.find((fact) => fact.id === factId);
  return (
    <div className="social-page social-rules-page social-collection-page">
      <div className="social-collection-actions">
        <Composer title={t("Create automation rule")} openRequest={createRequest}>
          <form
            id={ruleFormId}
            className="social-form"
            onSubmit={(event) => {
              event.preventDefault();
              const form = event.currentTarget;
              // Enter moves forward through the steps; only the Review step saves.
              if (step < 2) {
                if (!stepBlockers[step].length) setStep(step + 1);
                return;
              }
              const fact = facts.find((item) => item.id === factId);
              void (async () => {
                if (
                  await pendingUi.run("rules.save-paused-rule", () =>
                    run(async () => {
                      if (
                        !accountId ||
                        !projectId ||
                        !fact ||
                        (mode === "automatic" && !canAutomate) ||
                        triggerCapability?.status === "unsupported" ||
                        !ruleName.trim() ||
                        !keyword.trim() ||
                        !limitValid
                      )
                        throw new Error(
                          t(
                            "Select a suitable account, project, trigger and verified fact for the rule.",
                          ),
                        );
                      return client.request("automations.create", {
                        name: ruleName,
                        accountId,
                        projectId,
                        mode,
                        trigger,
                        topics: fact ? [fact.topic] : [],
                        dailyLimit: Number(limit),
                        stopWords,
                        answers: [{ keyword, factId }],
                        ...(agent
                          ? {
                              agent: {
                                provider: agent,
                                ...(agentModel.trim() ? { model: agentModel.trim() } : {}),
                              },
                            }
                          : {}),
                      });
                    }),
                  )
                ) {
                  setRuleName("");
                  setKeyword("");
                  setLimit("10");
                  setStop("");
                  setFactId("");
                  setMode("draft");
                  setAgent("");
                  setAgentModel("");
                  setStep(0);
                  closeComposer(form);
                }
              })();
            }}
          >
            <h3 className="sr-only">{t("Create rule")}</h3>
            <Stepper
              className="social-rule-steps"
              label={t("Create rule steps")}
              steps={ruleSteps}
              current={step}
              completed={ruleSteps
                .filter((_, index) => index < step && !stepBlockers[index].length)
                .map((item) => item.id)}
              selectable={ruleSteps.filter((_, index) => stepsOpenTo(index)).map((item) => item.id)}
              disabled={socialLocked}
              onStepSelect={setStep}
            />
            {step === 0 ? (
              <div className="social-rule-step" key="content">
                <TextField
                  disabled={socialLocked}
                  label={t("Name")}
                  value={ruleName}
                  onChange={(event) => setRuleName(event.target.value)}
                  maxLength={200}
                />
                <div className="social-form-pair">
                  <label>
                    {t("Account")}
                    <SearchableSelect
                      disabled={socialLocked}
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
                      disabled={socialLocked}
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
                </div>
                <label>
                  {t("Trigger")}
                  <NativeSelect
                    disabled={socialLocked}
                    name="trigger"
                    value={trigger}
                    onChange={(event) => setTrigger(event.target.value)}
                  >
                    <option
                      value="comment"
                      disabled={snapshot.capabilities[accountId]?.some(
                        (item) =>
                          item.operation === "comments.read" && item.status === "unsupported",
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
                {triggerCapability?.status === "unsupported" ? (
                  <Alert tone="danger">{triggerCapability.reason}</Alert>
                ) : null}
                {!facts.length ? (
                  <Notice kind="warning" title={t("Add a verified fact before creating a rule")}>
                    {t(
                      "Open Content to manage this project's verified facts. Your unfinished rule stays here.",
                    )}
                    <p>{projectName}</p>
                    {onOpenContent ? (
                      <Button
                        variant="link"
                        type="button"
                        disabled={socialLocked}
                        onClick={(event) => {
                          if (event.currentTarget.form) closeComposer(event.currentTarget.form);
                          onOpenContent(projectId);
                        }}
                      >
                        {t("Manage verified facts")}
                      </Button>
                    ) : null}
                  </Notice>
                ) : null}
                <div className="social-form-pair">
                  <TextField
                    disabled={socialLocked}
                    label={t("Incoming phrase to match exactly")}
                    value={keyword}
                    onChange={(event) => setKeyword(event.target.value)}
                    maxLength={100}
                    placeholder={t("E.g. what is the price")}
                  />
                  <label>
                    {t("Allowed reply fact")}
                    <NativeSearchableSelect
                      disabled={socialLocked}
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
                </div>
              </div>
            ) : null}
            {step === 1 ? (
              <div className="social-rule-step" key="behaviour">
                <label>
                  {t("Mode")}
                  <NativeSelect
                    disabled={socialLocked}
                    value={mode}
                    onChange={(event) => setMode(event.target.value)}
                  >
                    <option value="draft">{t("Draft only")}</option>
                    <option value="approval">{t("Send with user approval")}</option>
                    <option value="automatic" disabled={!canAutomate}>
                      {t("Automatic sending within an explicit rule")}
                    </option>
                  </NativeSelect>
                </label>
                {mode === "automatic" && !canAutomate ? (
                  <Alert tone="danger">
                    {t(
                      "Automatic sending needs a supported account and reply permission for this project.",
                    )}
                  </Alert>
                ) : null}
                <div className="social-form-pair">
                  <NumberField
                    disabled={socialLocked}
                    label={t("Daily limit")}
                    min={1}
                    max={100}
                    value={limit}
                    error={limitValid ? undefined : t("Enter a whole number from 1 to 100.")}
                    onChange={(event) => setLimit(event.target.value)}
                  />
                  <TextField
                    disabled={socialLocked}
                    label={t("Stop phrases")}
                    value={stop}
                    placeholder={t("Separate with commas")}
                    onChange={(event) => setStop(event.target.value)}
                  />
                </div>
                <details className="social-settings" open={agent ? true : undefined}>
                  <summary>{t("Use a different AI agent for this rule")}</summary>
                  <SocialModelField
                    label={t("AI agent and model for this rule")}
                    inheritLabel={t("Use the global agent")}
                    disabled={socialLocked}
                    value={{ provider: agent, model: agentModel }}
                    onChange={(next) => {
                      setAgent(next.provider);
                      setAgentModel(next.model);
                    }}
                  />
                </details>
              </div>
            ) : null}
            {step === 2 ? (
              <div className="social-rule-step" key="review">
                {contentBlockers.length || behaviourBlockers.length ? (
                  <Alert tone="danger">
                    {[...contentBlockers, ...behaviourBlockers].join(" ")}{" "}
                    {contentBlockers.length ? (
                      <Button variant="link" type="button" onClick={() => setStep(0)}>
                        {t("Fix in Account and content")}
                      </Button>
                    ) : null}
                    {behaviourBlockers.length ? (
                      <Button variant="link" type="button" onClick={() => setStep(1)}>
                        {t("Fix in Behaviour")}
                      </Button>
                    ) : null}
                  </Alert>
                ) : null}
                <dl className="social-rule-summary-list" aria-label={t("Rule summary")}>
                  <div>
                    <dt>{t("Name")}</dt>
                    <dd>{ruleName}</dd>
                  </div>
                  <div>
                    <dt>{t("Account")}</dt>
                    <dd>{account ? `${account.name} · ${names[account.platform]}` : "—"}</dd>
                  </div>
                  <div>
                    <dt>{t("Project")}</dt>
                    <dd>{projectName}</dd>
                  </div>
                  <div>
                    <dt>{t("Trigger")}</dt>
                    <dd>{triggerLabel}</dd>
                  </div>
                  <div>
                    <dt>{t("Mode")}</dt>
                    <dd>
                      {ruleModeLabel(mode)}. {modeConsequence}
                    </dd>
                  </div>
                  <div>
                    <dt>{t("Topics")}</dt>
                    <dd>{chosenFact?.topic ?? "—"}</dd>
                  </div>
                  <div>
                    <dt>{t("Answers")}</dt>
                    <dd>
                      {t("1 answer")}
                      {chosenFact ? `: “${keyword}” → ${chosenFact.topic}` : ""}
                    </dd>
                  </div>
                  <div>
                    <dt>{t("Daily limit")}</dt>
                    <dd>{limitValid ? t("up to {p0} a day", { p0: limitNumber }) : "—"}</dd>
                  </div>
                  <div>
                    <dt>{t("Stop phrases")}</dt>
                    <dd>
                      {stopWords.length ? (
                        <BadgeList
                          label={t("Stop phrases")}
                          max={6}
                          rows={2}
                          items={stopWords.map((word, index) => ({
                            id: `${index}:${word}`,
                            label: word,
                          }))}
                        />
                      ) : (
                        t("None")
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt>{t("AI agent")}</dt>
                    <dd>
                      {agent
                        ? [
                            HARNESS_TITLE[agent as keyof typeof HARNESS_TITLE] || agent,
                            agentModel.trim(),
                          ]
                            .filter(Boolean)
                            .join(" · ")
                        : t("Inherit the global / platform agent")}
                    </dd>
                  </div>
                </dl>
                {mode === "automatic" ? (
                  <Notice kind="warning" title={t("Automatic sending")}>
                    {t(
                      "Once enabled, this rule sends replies without asking you. Enabling it is a separate step that asks you to confirm.",
                    )}
                  </Notice>
                ) : null}
                <p className="social-muted">
                  {t(
                    "The rule is saved paused. Review the content and permissions, then enable it separately.",
                  )}
                </p>
              </div>
            ) : null}
            <ComposerActions className="social-rule-nav">
              {step > 0 ? (
                <Button
                  key="back"
                  type="button"
                  variant="ghost"
                  disabled={socialLocked}
                  onClick={() => setStep(step - 1)}
                >
                  {t("Back")}
                </Button>
              ) : null}
              {step < 2 ? (
                <>
                  {stepReason ? (
                    <p className="social-rule-reason" role="status">
                      {stepReason}
                    </p>
                  ) : null}
                  <Button
                    key="next"
                    type="button"
                    variant="primary"
                    disabled={socialLocked || !!stepBlockers[step].length}
                    onClick={() => setStep(step + 1)}
                  >
                    {t("Next")}
                  </Button>
                </>
              ) : (
                <Button
                  key="save"
                  loading={pendingUi.is("rules.save-paused-rule")}
                  form={ruleFormId}
                  type="submit"
                  variant="primary"
                  disabled={saveBlocked}
                >
                  {t("Save paused rule")}
                </Button>
              )}
            </ComposerActions>
          </form>
        </Composer>
      </div>
      <div
        className="social-columns social-collection-workspace"
        data-empty={!snapshot.rules.length && !snapshot.drafts.length}
      >
        <section className="social-collection-list">
          <div className="social-list-heading">
            <h2>
              {t("Reply rules")} <small>{snapshot.rules.length}</small>
            </h2>
            <Button
              variant="ghost"
              size="sm"
              type="button"
              startIcon={<Sparkles aria-hidden="true" />}
              disabled={socialLocked || !!simplifyReason}
              onClick={() => setSimplifyOpen(true)}
            >
              {t("Simplify with AI")}
            </Button>
          </div>
          {simplifyReason ? (
            <p className="social-rule-reason social-rule-list-reason" role="status">
              {simplifyReason}{" "}
              {simplify.noAgent && onOpenSettings ? (
                <Button variant="link" type="button" onClick={onOpenSettings}>
                  {t("Open settings")}
                </Button>
              ) : null}
            </p>
          ) : null}
          <div className="social-list-tools">
            <SearchInput
              className="social-list-search"
              aria-label={t("Search rules")}
              disabled={socialLocked}
              appearance="field"
              value={ruleQuery}
              onChange={(event) => setRuleQuery(event.target.value)}
              placeholder={t("Search rules")}
            />
          </div>
          <div className="social-list">
            {visibleRules.map((rule) => (
              <Button
                disabled={socialLocked}
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
                action={
                  snapshot.rules.length ? (
                    <Button variant="ghost" type="button" onClick={() => setRuleQuery("")}>
                      {t("Clear search")}
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      disabled={socialLocked}
                      onClick={() => setCreateRequest((value) => value + 1)}
                    >
                      {t("Create rule")}
                    </Button>
                  )
                }
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
                      {ruleModeLabel(rule.mode)} · {t("Daily {p0}", { p0: rule.dailyLimit })}
                    </p>
                    <StatusBadge status={rule.enabled ? "active" : "paused"} />
                    <BadgeList
                      label={t("Topics")}
                      items={rule.topics.map((topic, index) => ({
                        id: `${index}:${topic}`,
                        label: topic,
                      }))}
                    />
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
                        loading={pendingUi.is(`rules.pause-rule:${rule.id}`)}
                        type="button"
                        variant="secondary"
                        disabled={socialLocked || !rule.enabled}
                        onClick={() =>
                          void pendingUi.run(`rules.pause-rule:${rule.id}`, () =>
                            run(() => client.request("automations.pause", { id: rule.id })),
                          )
                        }
                      >
                        {t("Pause rule")}
                      </Button>
                      {!rule.enabled ? (
                        <Button
                          loading={pendingUi.is(
                            `rules.enable-automatic-sending-for-this-rule:${rule.id}`,
                          )}
                          disabled={socialLocked}
                          type="button"
                          variant="secondary"
                          onClick={() =>
                            void pendingUi.run(
                              `rules.enable-automatic-sending-for-this-rule:${rule.id}`,
                              () =>
                                run(() =>
                                  client.request("automations.activate", {
                                    id: rule.id,
                                    ...(rule.mode === "automatic"
                                      ? { confirm: "ENABLE_AUTOMATIC_REPLIES" }
                                      : {}),
                                  }),
                                ),
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
      {simplifyOpen ? (
        <SocialDialog
          title={t("Simplify rules with AI")}
          size="lg"
          onClose={() => setSimplifyOpen(false)}
        >
          <RuleSimplifyReview
            session={simplify}
            onClose={() => setSimplifyOpen(false)}
            onOpenSettings={onOpenSettings}
          />
        </SocialDialog>
      ) : null}
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
