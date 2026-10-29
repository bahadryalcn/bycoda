import { useContext as useSocialContext, useEffect, useRef, useState } from "react";
import { SocialBusyContext as SocialLockContext } from "./socialContext";
import { getLocale, t, useLocale } from "../../../shared/i18n";
import { Button } from "../../../shared/ui/Button";
import { Modal } from "../../../shared/ui/Modal";
import { SearchableSelect } from "../../../shared/ui/SearchableSelect";
import { TextField } from "../../../shared/ui/TextField";
import { TextareaField } from "../../../shared/ui/TextareaField";
import type { HostProject } from "../../connections/model/protocol";
import type { SocialClient } from "../model/socialClient";
import type { SocialProjectProfile } from "../model/social";
import { Notice, field, time, type Run } from "./socialShared";
import { useSocialPending } from "./useSocialPending";
import "./social-knowledge.css";

type ProfileDraft = {
  productName?: string;
  voice?: string;
  topic?: string;
  text?: string;
  source?: string;
  factId?: string;
};

/**
 * Product profile, brand voice and verified facts as one managed knowledge area. The daily
 * content screen shows only a summary row; the forms open on demand, keep their drafts while
 * closed, and a project intent (from an account or a rule blocker) opens them in context.
 */
export function ProductKnowledge({
  client,
  profiles,
  projects,
  initialProject,
  projectIntent,
  run,
}: {
  client: SocialClient;
  profiles: SocialProjectProfile[];
  projects: HostProject[];
  initialProject?: string;
  projectIntent?: { projectId: string; token: number };
  run: Run;
}) {
  const pendingUi = useSocialPending();
  const socialLocked = useSocialContext(SocialLockContext);
  useLocale();
  const [projectId, setProjectId] = useState(initialProject ?? projects[0]?.id ?? "");
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const [seenIntent, setSeenIntent] = useState<number>();
  // A project intent is a one-shot request identified by its token.
  if (projectIntent && projectIntent.token !== seenIntent) {
    setSeenIntent(projectIntent.token);
    if (projects.some((project) => project.id === projectIntent.projectId)) {
      setProjectId(projectIntent.projectId);
      setOpen(true);
    }
  }
  const [drafts, setDrafts] = useState<Record<string, ProfileDraft>>({});
  const [addFact, setAddFact] = useState(false);
  const closing = useRef(false);
  useEffect(() => {
    if (!open && closing.current) {
      closing.current = false;
      trigger.current?.focus();
    }
  }, [open]);
  const activeProject = projects.some((project) => project.id === projectId)
    ? projectId
    : (projects[0]?.id ?? "");
  const profile = profiles.find((item) => item.projectId === activeProject);
  const draft = drafts[activeProject] ?? {};
  const productName = draft.productName ?? profile?.productName ?? "";
  const voice = draft.voice ?? profile?.brandVoice ?? "";
  const updateDraft = (change: ProfileDraft) =>
    setDrafts((current) => ({
      ...current,
      [activeProject]: { ...current[activeProject], ...change },
    }));
  const save = (facts: SocialProjectProfile["facts"]) =>
    client.request("profiles.save", {
      projectId: activeProject,
      productName,
      brandVoice: voice,
      facts,
    });
  const projectName = projects.find((project) => project.id === activeProject)?.name;
  const factCount = profile?.facts.length ?? 0;
  const profileSet = !!profile?.productName.trim() && !!profile.brandVoice.trim();
  const editing = !!draft.factId;
  const unsavedProfile =
    (draft.productName !== undefined && draft.productName !== (profile?.productName ?? "")) ||
    (draft.voice !== undefined && draft.voice !== (profile?.brandVoice ?? ""));
  return (
    <>
      <div className="social-knowledge-row" aria-label={t("Product knowledge")}>
        <div>
          <strong>{t("Product knowledge")}</strong>
          <small>
            {!projects.length
              ? t("No project found")
              : profile
                ? `${projectName ?? ""} · ${profile.productName || t("No product name")} · ${t("Verified facts")}: ${factCount}${profileSet ? "" : ` · ${t("Brand voice or name missing")}`}`
                : `${projectName ?? ""} · ${t("No product profile yet. AI and automatic replies have no verified facts to use.")}`}
            {unsavedProfile || editing ? ` · ${t("Unsaved changes")}` : ""}
          </small>
        </div>
        <Button
          ref={trigger}
          variant="secondary"
          size="sm"
          type="button"
          disabled={socialLocked || !projects.length}
          aria-haspopup="dialog"
          onClick={() => setOpen(true)}
        >
          {t("Manage")}
        </Button>
      </div>
      {open ? (
        <Modal
          title={t("Product knowledge")}
          description={t("Verified product facts are the only facts AI drafts and automatic replies may rely on.")}
          size="lg"
          onClose={() => {
            closing.current = true;
            setOpen(false);
          }}
        >
          <div className="social-view social-knowledge">
            <label className="social-knowledge-field">
              {t("Project")}
              <SearchableSelect
                value={activeProject}
                disabled={socialLocked || !projects.length}
                label={t("Project")}
                options={projects.map((project) => ({
                  value: project.id,
                  label: project.name || project.cwd,
                }))}
                onChange={(nextValue) => setProjectId(nextValue)}
                searchLocale={getLocale()}
              />
            </label>
            <form
              className="social-form"
              onSubmit={(event) => {
                field(event);
                void pendingUi.run("project-profile.save-product-profile", () =>
                  run(() => save(profile?.facts ?? []), t("Product profile saved.")),
                );
              }}
            >
              <h3>{t("Product profile")}</h3>
              <TextField
                disabled={socialLocked}
                label={t("Product name")}
                required
                maxLength={200}
                value={productName}
                onChange={(event) => updateDraft({ productName: event.target.value })}
              />
              <TextField
                disabled={socialLocked}
                label={t("Brand voice")}
                required
                maxLength={1000}
                value={voice}
                placeholder={t("E.g. short, clear and friendly")}
                onChange={(event) => updateDraft({ voice: event.target.value })}
              />
              <div className="social-actions">
                <Button
                  loading={pendingUi.is("project-profile.save-product-profile")}
                  type="submit"
                  variant="secondary"
                  disabled={socialLocked || !activeProject}
                >
                  {t("Save product profile")}
                </Button>
              </div>
            </form>
            <section className="social-knowledge-facts" aria-label={t("Verified facts")}>
              <div className="social-knowledge-heading">
                <h3>
                  {t("Verified facts")} · {factCount}
                </h3>
                <Button
                  variant="secondary"
                  size="sm"
                  type="button"
                  disabled={socialLocked || (!editing && factCount >= 100)}
                  aria-expanded={addFact || editing}
                  onClick={() => setAddFact(!addFact)}
                >
                  {t("Add verified fact")}
                </Button>
              </div>
              {!profile?.facts.length ? (
                <p className="social-muted">
                  {t("No saved product facts. Add a verified fact to prepare automatic replies.")}
                </p>
              ) : (
                <ul className="social-knowledge-list">
                  {profile.facts.map((fact) => (
                    <li key={fact.id}>
                      <div>
                        <strong>{fact.topic}</strong>
                        <span>{fact.text}</span>
                        <small>
                          {fact.source} · {time(fact.verifiedAt)}
                        </small>
                      </div>
                      <Button
                        disabled={socialLocked}
                        variant="ghost"
                        size="sm"
                        type="button"
                        onClick={() => {
                          setAddFact(true);
                          updateDraft({
                            factId: fact.id,
                            topic: fact.topic,
                            text: fact.text,
                            source: fact.source,
                          });
                        }}
                      >
                        {t("Edit fact")}
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
              {addFact || editing ? (
                <form
                  className="social-form"
                  onSubmit={(event) => {
                    field(event);
                    const fact = {
                      id: draft.factId ?? crypto.randomUUID(),
                      topic: draft.topic ?? "",
                      text: draft.text ?? "",
                      source: draft.source ?? "",
                      verifiedAt: Date.now(),
                    };
                    const facts = draft.factId
                      ? (profile?.facts ?? []).map((item) => (item.id === draft.factId ? fact : item))
                      : [...(profile?.facts ?? []), fact];
                    void (async () => {
                      if (
                        await pendingUi.run("project-profile.save-public-fact", () =>
                          run(() => save(facts), t("Verified product fact saved.")),
                        )
                      ) {
                        updateDraft({ topic: "", text: "", source: "", factId: undefined });
                        setAddFact(false);
                      }
                    })();
                  }}
                >
                  <h3>{editing ? t("Edit verified fact") : t("Add verified fact")}</h3>
                  {!productName.trim() || !voice.trim() ? (
                    <Notice kind="info">
                      {t("Save the product name and brand voice above before adding facts.")}
                    </Notice>
                  ) : null}
                  <TextField
                    disabled={socialLocked}
                    label={t("Fact topic")}
                    required
                    maxLength={200}
                    value={draft.topic ?? ""}
                    onChange={(event) => updateDraft({ topic: event.target.value })}
                  />
                  <TextareaField
                    disabled={socialLocked}
                    label={t("Verified, announceable fact")}
                    required
                    maxLength={4000}
                    value={draft.text ?? ""}
                    onChange={(event) => updateDraft({ text: event.target.value })}
                  />
                  <TextField
                    disabled={socialLocked}
                    label={t("Verification source")}
                    required
                    maxLength={1000}
                    value={draft.source ?? ""}
                    onChange={(event) => updateDraft({ source: event.target.value })}
                  />
                  <div className="social-actions">
                    <Button
                      loading={pendingUi.is("project-profile.save-public-fact")}
                      type="submit"
                      variant="secondary"
                      disabled={
                        socialLocked ||
                        !activeProject ||
                        !productName.trim() ||
                        !voice.trim() ||
                        (!draft.factId && factCount >= 100)
                      }
                    >
                      {t("Save public fact")}
                    </Button>
                    <Button
                      disabled={socialLocked}
                      variant="ghost"
                      type="button"
                      onClick={() => {
                        updateDraft({ topic: "", text: "", source: "", factId: undefined });
                        setAddFact(false);
                      }}
                    >
                      {editing ? t("Stop editing") : t("Cancel")}
                    </Button>
                  </div>
                </form>
              ) : null}
            </section>
          </div>
        </Modal>
      ) : null}
    </>
  );
}
