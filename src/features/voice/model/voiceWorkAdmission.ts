import { normalizeVoiceSearch } from "./voiceFeatureLexicon";

const usageSubject = /\b(?:tokens?|kullanim\w*|usage|tuketim\w*)\b/;
const usageDimension =
  /\b(?:providers?|saglayici\w*|models?|model\w*|aylik|monthly|30 gun\w*|last month)\b/;
const readRequest =
  /\b(?:goster(?:ir|ebilir|in|iniz)?|listele(?:r|yebilir|yin)?|karsilastir(?:ir|abilir)?|oku(?:r|yabilir|yun)?|ozetle(?:r|yebilir)?|ne kadar|kac|hangi|what is|what are|show|list|read|summarize|plot|compare|breakdown|how many|how much)\b/;
const chartRequest = /\b(?:grafi(?:k|ge|gi)\w*|charts?|graphs?)\b/;
const implementation =
  /\b(?:uygula(?:r|yabilir|yin)?|gelistir(?:ir|ebilir|in)?|duzelt(?:ir|ebilir|in)?|implement(?:ing)?|fix|repair|patch|refactor)\b/;
const persistentArtifact =
  /\b(?:bilesen\w*|ozellik\w*|feature\w*|widget\w*|reusable|kalici|kalicilastir\w*|dosya\w*|kod|tests?|script\w*|file\w*)\b/;
const artifactChange = /\b(?:ekle\w*|yaz\w*|olustur\w*|add|create|build|code)\b/;
const editSurface =
  /\b(?:update|change|modify|edit)\s+(?:the |this |that )?(?:page|screen|component|file|button|dashboard)\b/;
const trackedHandoff =
  /\b(?:(?:is|gorev|hedef|not|oturum)(?:i|ini|u|unu)? (?:ac|olustur\w*|baslat\w*|ver|kaydet)|(?:create|start|schedule|run|submit|review) (?:an? |the )?(?:\w+ )?(?:job|task|goal|build|automation|session)|(?:save|take|write) (?:a |the )?note|(?:work(?:ing)? on|hand off|delegate|let the agent|finish)|arastirt(?:ir|abilir|in|iniz)?)\b/;
const asksHow =
  /\b(?:how (?:should|do|can|could) (?:i|we)|nasil (?:yaparim|duzeltirim|uygularim|yapilir))\b/;
const amendWork = /\b(?:koru(?:yun)?|ve ekle|keep|preserve|retain|also check)\b/;
const readOnlyCorrection =
  /\b(?:sadece goster\w*|yalnizca goster\w*|gostermen yeter|just show|only show|is acma|gorev acma|kod yazma|don.t create (?:a )?(?:job|task)|don.t write code)\b/;
const navigation =
  /\b(?:ayarlar\w*|kullanim\w*|dashboard\w*|logs?|loglar\w*|kayitlar\w*|sunucu\w*|cihaz\w*|panel\w*|ekran\w*|usage|settings|servers?|devices?|work tab|tools tab|sidebar)\b/;
const navigationVerb = /\b(?:ac|acar|acabilir\w*|git|gec|open|switch|navigate)\b/;
const panelPresentation =
  /\b(?:sagdaki|soldaki|right|left|side)\b.*\b(?:panel\w*|pane\w*)\b|\b(?:yan panel\w*|side panel)\b/;
const desktopTarget = /\b(?:chrome|localhost|youtube music|youtube muzik\w*|browser|tarayici\w*)\b/;
const desktopAction =
  /\b(?:ac|acabilir\w*|cal|caldir\w*|oynat\w*|gec|tikla\w*|open|switch|play|click|navigate)\b/;
const normalSession =
  /\b(?:normal|regular|standard|dogrudan) (?:bir |a )?(?:session|oturum|sohbet)\w*\b/;
const sessionAction =
  /\b(?:ac(?:ar|abilir\w*|in|iniz)?|open|create|yaz\w*|write|send|gonder\w*|arastirt\w*)\b/;
const sessionOpen =
  /\b(?:open|create) (?:a |an |the |new )?(?:new )?(?:session|coding conversation)\b|\b(?:session|oturum)\w* (?:ac(?:ar|abilir\w*|in|iniz)?|olustur\w*)\b/;
const sessionHandoff =
  /\b(?:session|oturum)\w*(?:['’]d[ae])?\b.{0,200}\b(?:arastirt\w*|(?:send|submit|run) (?:it|this|the prompt))\b/;
const sendSessionWork =
  /\b(?:send|submit|start|run|execute|investigate|research|arastir\w*|gonder\w*|calistir\w*|baslat\w*)\b/;
const keepDraft = /\b(?:draft|unsent|taslak\w*|gonderme|(?:do not|don.t|without) send\w*)\b/;
const doNotOpen = /\b(?:acma|acmayin|do not open|don.t open)\b/;
const voiceDrawerRequest =
  /\b(?:(?:voice|arif\w*|sesli asistan\w*)\b.{0,35}\b(?:drawer|panel\w*|right|side)|(?:drawer|right panel|sag panel\w*) beside (?:the )?(?:call|voice))\b/;
const usageViewRequest =
  /\b(?:(?:open|switch to|go to|navigate to) (?:the )?usage|kullanim\w*(?:['’][aei])? (?:ac|gec)|(?:usage|kullanim\w*|verbrauch|nutzung|utilizacion|utilisation|consumo|uso) (?:dashboard|page|screen|tab|panel|ekran\w*|sekme\w*|sayfa\w*|seite|fenster|pagina|ecran|aba))\b|使用量(?:画面|ページ|を開)|(?:用量|使用量)(?:页面|面板)|打开(?:用量|使用量)/u;

function sessionRequested(speech: string) {
  return (
    !readOnlyCorrection.test(speech) &&
    !asksHow.test(speech) &&
    !doNotOpen.test(speech) &&
    ((normalSession.test(speech) && sessionAction.test(speech)) ||
      sessionOpen.test(speech) ||
      sessionHandoff.test(speech))
  );
}

export function voiceSessionNeedsProject(utterance: string) {
  return sessionRequested(normalizeVoiceSearch(utterance).replace(/"[^"]*"|“[^”]*”/g, ""));
}

export function voiceSessionOpenSurface(utterance: string, requested: unknown) {
  const speech = normalizeVoiceSearch(utterance).replace(/"[^"]*"|“[^”]*”/g, "");
  return sessionRequested(speech) && !voiceDrawerRequest.test(speech) ? "project" : requested;
}

// Match requests and their objects. An app name or noun alone confers no work authority.
function acceptedIntent(speech: string) {
  if (readOnlyCorrection.test(speech) || asksHow.test(speech)) return "display";
  const read =
    readRequest.test(speech) ||
    (usageSubject.test(speech) && usageDimension.test(speech) && chartRequest.test(speech));
  const explicitWork =
    implementation.test(speech) ||
    editSurface.test(speech) ||
    sessionRequested(speech) ||
    trackedHandoff.test(speech) ||
    (persistentArtifact.test(speech) && artifactChange.test(speech));
  // An explicit implementation request can include instructions to show a result afterward.
  if (explicitWork) return "work";
  if (desktopTarget.test(speech) && desktopAction.test(speech)) return "computer_action";
  if (
    read ||
    (navigation.test(speech) && navigationVerb.test(speech)) ||
    (panelPresentation.test(speech) && chartRequest.test(speech))
  )
    return "display";
  return "ambiguous";
}

const workActions = new Set([
  "workspace.sessions.create",
  "workspace.sessions.submit",
  "sessions.message",
  "goals.create",
  "tasks.create",
  "tasks.start",
  "tasks.update",
  "automations.create",
  "automations.update",
  "automations.runNow",
  "automations.resume",
  "crews.start",
  "crews.save",
  "commands.run",
  "files.write",
  "files.create",
  "files.move",
  "files.rename",
  "files.delete",
  "files.mkdir",
  "git.stage",
  "git.unstage",
  "git.commit",
  "git.stash",
  "git.pull",
  "git.push",
  "git.merge",
]);

const startsTrackedWork = new Set([
  "goals.create",
  "tasks.create",
  "automations.create",
  "crews.start",
]);

const handoffTextFields = new Map([
  ["workspace.sessions.submit", "text"],
  ["workspace.sessions.create", "prompt"],
  ["sessions.message", "text"],
]);

function handoffText(tool: string, action: unknown, input: unknown) {
  if (tool === "submit_work") return input;
  if (typeof action !== "string") return undefined;
  const field = handoffTextFields.get(action);
  if (!field) return undefined;
  if (!input || typeof input !== "object") return null;
  const args = input as Record<string, unknown>;
  if (action === "workspace.sessions.create" && args.prompt === undefined && args.submit !== true)
    return undefined;
  return args[field] ?? null;
}

function sameSpokenContent(utterance: string, brief: unknown): boolean {
  if (typeof brief !== "string") return false;
  const words = (text: string) =>
    normalizeVoiceSearch(text)
      .match(/[\p{L}\p{N}]+/gu)
      ?.join(" ");
  const spoken = words(utterance);
  return Boolean(spoken && spoken === words(brief));
}

/** Prevent a display request from becoming a job through another dispatch path. */
export function voiceWorkRefusal(
  utterance: string,
  tool: string,
  action?: unknown,
  previous?: string,
  input?: unknown,
  family?: unknown,
  ownerPressedView = false,
) {
  const speech = normalizeVoiceSearch(utterance).replace(/"[^"]*"|“[^”]*”/g, "");
  const args = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const usageView = args.view === "usage" || (args.view === "settings" && args.section === "usage");
  const openingUsage =
    tool === "app_tool_call" &&
    ((family === "workspace" &&
      (action === "workspace.usage.open" || (action === "workspace.views.open" && usageView))) ||
      (family === "conversation" && action === "ui.workspace.open" && usageView));
  const workspaceSession = sessionRequested(speech);
  // A current panel press can create a draft from the owner's edited fields.
  // Submitted work still follows the ordinary handoff admission below.
  if (
    ownerPressedView &&
    tool === "app_tool_call" &&
    family === "workspace" &&
    action === "workspace.sessions.create" &&
    (args.submit === false || args.submit === undefined)
  )
    return undefined;
  if (
    !ownerPressedView &&
    openingUsage &&
    (!usageViewRequest.test(speech) || doNotOpen.test(speech))
  )
    return {
      accepted: false,
      status: "refused",
      intent: "display",
      error:
        "The current request does not ask to open the Usage screen. The workspace did not navigate.",
      next: "Follow the latest request. Use a Usage report only when the owner asks for usage data.",
    } as const;
  if (
    workspaceSession &&
    (tool === "give_jobs" ||
      tool === "submit_work" ||
      (tool === "app_tool_call" &&
        family === "conversation" &&
        typeof action === "string" &&
        (workActions.has(action) ||
          ["sessions.create", "sessions.submit", "workspace.sessions.open"].includes(action))))
  )
    return {
      accepted: false,
      status: "refused",
      intent: "normal_session",
      error:
        "The owner requested a normal conversation in the project workspace. No operation was dispatched.",
      next: "Resolve the visible project. Use the workspace family's create, open or submit tool for the exact normal session. For open, use surface project.",
    } as const;
  if (
    workspaceSession &&
    tool === "app_tool_call" &&
    family === "workspace" &&
    (action === "workspace.sessions.submit" ||
      (action === "workspace.sessions.create" && args.submit === true)) &&
    (keepDraft.test(speech) || (!sendSessionWork.test(speech) && !implementation.test(speech)))
  )
    return {
      accepted: false,
      status: "refused",
      intent: "normal_session",
      error: "The current request does not ask to send the prompt. No work was submitted.",
      next: "Keep text unsent. When opening a new session, pass prompt with submit false.",
    } as const;
  const work =
    tool === "submit_work" ||
    tool === "give_jobs" ||
    (tool === "app_tool_call" && typeof action === "string" && workActions.has(action));
  if (!work) return undefined;
  const intent = acceptedIntent(speech);
  if (intent === "work") return undefined;
  if (
    intent === "ambiguous" &&
    amendWork.test(speech) &&
    previous &&
    acceptedIntent(normalizeVoiceSearch(previous)) === "work"
  )
    return undefined;
  if (
    intent === "ambiguous" &&
    speech.trim() &&
    tool !== "give_jobs" &&
    !(typeof action === "string" && startsTrackedWork.has(action))
  ) {
    // Unrecognized phrasing can use existing typed operation admission. A free-text
    // handoff may carry the owner's words, but cannot expand them without review.
    const brief = handoffText(tool, action, input);
    if ((tool !== "submit_work" && brief === undefined) || sameSpokenContent(utterance, brief))
      return undefined;
  }
  return { accepted: false, status: "refused", intent, ...refusalDetails[intent] };
}

const refusalDetails = {
  display: {
    error: "The latest accepted request asks to see existing data. No work was submitted.",
    next: "Discover the requested read or presentation. For usage data, use the Usage report. Open the Usage screen only when the owner asks for that screen. Explain any missing scope or data.",
  },
  computer_action: {
    error:
      "The latest accepted request asks for an immediate computer action. No work was submitted.",
    next: "Discover the desktop tools and read the current computer state. Perform the requested action and verify its result, or report the precise capability or permission limitation.",
  },
  ambiguous: {
    error:
      "The latest accepted request does not identify a change or handoff. No work was submitted.",
    next: "Ask one short question to establish what the owner wants changed or whether they want to see information. Wait for the owner's answer before submitting any work.",
  },
};
