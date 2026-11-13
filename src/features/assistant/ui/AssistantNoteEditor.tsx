import { useRef, useState } from "react";
import type { AssistantNote } from "../../../shared/model/host-contracts/assistant";
import { formatNumber, t } from "../../../shared/i18n";
import { Save, X } from "../../../shared/ui/icons";
import { Button } from "../../../shared/ui/Button";
import { TextField } from "../../../shared/ui/TextField";
import { Tabs, TabList, Tab, TabPanel } from "../../../shared/ui/Tabs";
import { surfaceAttributes } from "../../../shared/ui/Surface";
import { InlineError } from "../../../shared/ui/InlineError";
import { LiveText } from "../../../shared/ui/LiveText";
import {
  NoteMarkdownEditor,
  NoteMarkdownToolbar,
  NoteEditablePreview,
  NoteEditorPane,
  useNoteEditorMode,
  type NoteEditorViewRef,
} from "../../notes/public/NoteMarkdownEditor";
import { operationId } from "../model/assistantClient";
import { AssistantNoteDraft } from "../model/assistantNoteDraft";
import styles from "./AssistantNoteCard.module.css";
import { assistantRequest as ownerRequest } from "../model/assistantClient";

type OwnerRequest = typeof ownerRequest;
const MAX_BODY_LENGTH = 100000;

/** Main Notes document editor, with Assistant's durable explicit-save owner. */
export function NoteEditor({
  request,
  environmentId,
  note,
  onSaved,
  onClose,
}: {
  request: OwnerRequest;
  environmentId?: string;
  note: AssistantNote | "new";
  onSaved: () => Promise<void>;
  onClose: () => void;
}) {
  const original = note === "new" ? null : note;
  const [controller] = useState(
    () => new AssistantNoteDraft(original, localStorage, operationId, environmentId),
  );
  const [draft, setDraft] = useState(() => controller.value);
  const { title, body } = draft;
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [previewEditing, setPreviewEditing] = useState(false);
  const editorViewRef = useRef<NoteEditorViewRef["current"]>(null);
  const previewViewRef = useRef<NoteEditorViewRef["current"]>(null);
  const previewRangeRef = useRef<{ from: number; to: number } | null>(null);
  const { detailRef, narrow, visibleMode, setMode, toolbarTarget, setToolbarTarget } =
    useNoteEditorMode(`assistant:${environmentId}:${draft.id}`, previewEditing);
  const locked = pending || Boolean(draft.intent);
  const tooLong = body.length > MAX_BODY_LENGTH;
  const updateBody = (next: string) => {
    if (locked) return;
    controller.update({ body: next });
    setDraft(controller.value);
  };
  async function save() {
    if (pending || !title.trim() || tooLong) return;
    setPending(true);
    setError("");
    try {
      const save = controller.save(request);
      setDraft(controller.value);
      await save;
      controller.clear();
      await onSaved();
      onClose();
    } catch (cause) {
      setError(t(cause instanceof Error ? cause.message : String(cause)));
    } finally {
      setPending(false);
    }
  }
  return (
    <section
      ref={detailRef}
      className={`note-detail ${styles.documentEditor}`}
      aria-label={t(original ? "Edit note" : "New note")}
    >
      <div className="note-detail-content">
        <header className="note-detail-header">
          <div className="note-detail-titlerow">
            <TextField
              label={t("Note title")}
              appearance="quiet"
              fieldVariant="compact"
              hideLabel
              fieldClassName="note-detail-title"
              textSize="title"
              weight="medium"
              leading="snug"
              value={title}
              placeholder={t("Note title")}
              required
              maxLength={300}
              disabled={locked}
              onKeyDown={(event) => {
                if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
                  event.preventDefault();
                  void save();
                }
              }}
              onChange={(event) => {
                controller.update({ title: event.currentTarget.value });
                setDraft(controller.value);
              }}
            />
            <div className="note-detail-actions">
              <Button
                startIcon={<X className="icon-sm" />}
                variant="ghost"
                disabled={pending}
                onClick={onClose}
              >
                {t("Close")}
              </Button>
              <Button
                startIcon={<Save className="icon-sm" />}
                variant="primary"
                loading={pending}
                disabled={!title.trim() || tooLong}
                onClick={() => void save()}
              >
                {t("Save")}
              </Button>
            </div>
          </div>
          {error && <InlineError>{error}</InlineError>}
          {tooLong && (
            <InlineError>
              {t("Notes can contain up to {p0} characters.", { p0: formatNumber(MAX_BODY_LENGTH) })}
            </InlineError>
          )}
          <LiveText
            size="caption"
            tone="secondary"
            leading="inherit"
            text={
              draft.intent && !pending
                ? t("Note save is pending. Retry to verify the original note.")
                : ""
            }
          />
        </header>
        <Tabs value={visibleMode} onValueChange={setMode} panels="shared">
          <div className="note-editor-toolbar">
            <TabList label={t("Note sections")}>
              <Tab value="preview">{t("Document")}</Tab>
              <Tab value="source">{t("Source")}</Tab>
              {!narrow && <Tab value="split">{t("Split")}</Tab>}
            </TabList>
            <div inert={locked}>
              <NoteMarkdownToolbar
                viewRef={
                  visibleMode === "preview" ||
                  (visibleMode === "split" && previewEditing && toolbarTarget === "preview")
                    ? previewViewRef
                    : editorViewRef
                }
                editing={visibleMode !== "preview" || previewEditing}
              />
            </div>
          </div>
          <TabPanel
            tabIndex={undefined}
            {...surfaceAttributes({ frame: "pane", edge: "block-start" }, "note-editor-body")}
          >
            <div className={visibleMode === "split" ? "note-layout note-split" : "note-layout"}>
              <NoteEditorPane
                label={t("Source")}
                scrollKey={`assistant:${draft.id}:source`}
                hidden={visibleMode === "preview"}
                split={visibleMode === "split"}
              >
                <NoteMarkdownEditor
                  viewRef={editorViewRef}
                  minHeight={0}
                  value={body}
                  readOnly={locked}
                  onChange={updateBody}
                  onSave={() => void save()}
                  onFocus={() => setToolbarTarget("source")}
                />
              </NoteEditorPane>
              <NoteEditorPane
                label={t("Document")}
                document
                scrollKey={`assistant:${draft.id}:document`}
                hidden={visibleMode === "source"}
                split={visibleMode === "split"}
              >
                <NoteEditablePreview
                  value={body}
                  readOnly={locked}
                  viewRef={previewViewRef}
                  rangeRef={previewRangeRef}
                  onEditingChange={setPreviewEditing}
                  onFocus={() => setToolbarTarget("preview")}
                  onChange={updateBody}
                  onSave={() => void save()}
                />
              </NoteEditorPane>
            </div>
          </TabPanel>
        </Tabs>
      </div>
    </section>
  );
}
