# Voice companion

Settings show permission, verified readiness and current activity separately.
Enabling a preference does not verify the microphone or engine. Opening settings
never starts voice. Readiness comes from a successful check; a failed refresh
clears the previous runtime observation. Activity is unknown when the current
window cannot observe it, and running only when a live voice operation is known.

Voice is **off by default**. Enable **Settings → Voice assistant → Enable voice companion** on
this device. When disabled, no voice launcher or companion is shown in chat.
**Enable dictation** is a separate device preference in the same section. Turning
voice companion off does not turn dictation off, and enabling dictation does not
enable the companion or its tools.
Disabling it unmounts the companion, cancels pending speech and side replies,
and releases the microphone and local engines without stopping coding work.

Use the assistant button at the bottom of the sidebar, beside Settings, to set up
voice and later open the companion. After setup it shows the assistant's avatar
and name (the narrow rail shows the avatar alone). The avatar has no dot while
voice is off; the dot pulses green while the assistant listens or speaks, turns
yellow while connecting, red on an error and grey while the microphone is paused. When
no sidebar is visible the button floats at the bottom right of the window. Before the first conversation,
complete the assistant setup: choose its name, spoken language, provider and
voice, verify playback and a microphone sentence, and review the autonomy budget.
Existing device settings prefill setup; the assistant has no default name.
The microphone opens only after you choose **Test microphone**, **Start voice**
or **Talk**. Closing voice never stops coding work.

## Connection recovery and idle sleep

Cloud voice retries temporary connection failures with fresh credentials, at most
five consecutive times (1, 2, 5, 10 and 30 seconds). A stable minute restores
the retry budget. Sign-in, billing and microphone permission failures require
your action. **Disconnect voice** cancels any scheduled reconnect. Escape closes
menus without disconnecting voice.

Voice sleeps after ten minutes without input by default. Change **Sleep voice
when I'm idle** in Voice settings; **Never** disables idle sleep. On Windows,
screen lock also puts voice to sleep. Returning shows **Ready. Microphone is
off.** Press **Talk** to reopen it. Sleep and disconnect do not stop coding work.
Native idle and lock detection currently supports Windows. Browser sessions can
observe activity within their page only; unsupported native platforms cannot
establish computer-wide presence for automatic reconnection.

Accepted speech also keeps an already open conversation active while the mouse
and keyboard are idle. This does not override screen lock, Away, Do not disturb
or unknown computer presence. Pausing the microphone clears this activity receipt.

Recovery restores up to six recent text turns. It does not replay tool calls or
generate a new response automatically. A temporary drop can resume a microphone
you already opened; returning after idle sleep always requires **Talk**.

In **Global** mode, a project missing from the connected Host's directory does
not prevent listening. Unverified history and summaries remain excluded. Hiding
or locking a project captured by the conversation still closes the microphone.

## Waiting and recovery

Host discovery, native presence checks, voice tool responses and speech streams have bounded waits. A failed presence check means unknown presence. A tool timeout can mean its operation is still running: inspect the original request or work item before retrying. Reopening voice does not replay operations.

The session work indicator describes the selected coding conversation, separately from listening and playback. No recent session updates means no new transcript update was observed for 90 seconds; background work can still be running. Use the existing Stop work control to request cancellation. Disconnecting voice only closes the voice connection.

## Identity, language and memory

Identity and communication rules belong to the Host assistant profile. **Customize**
opens its Room settings; **Memory → Manage** opens the shared Memory tab. **Voice
style** keeps the device's tone and task-style choices. Names and rules grant no
operation authority and cannot approve external sends or bypass permission gates.

Spoken language defaults to **Auto**, independently of the interface language.
A chosen language overrides detection; OpenAI transcription receives its language
code and local playback keeps that language. Voice previews let you hear the
configured provider without opening the microphone. Auto remembers the last supported
language from accepted owner speech, using actual recognition metadata or a confident
text match. Ambiguous words preserve the previous language. Room briefings use that
saved language; if none is known, speak once or choose a language before listening.
Voice quality and accent
still require listening on the intended provider and device.

Application-tool search recognizes localized feature labels in the eight UI
languages. Turkish forms such as “ekiplerim” and “ekipteki”, and mixed terms such
as “crew”, share the same feature vocabulary. A name such as “Kree” is not silently
rewritten. This improves feature discovery; it does not bypass confirmations or
guarantee microphone recognition of every pronunciation.

Say “remember that I prefer short answers” or ask to forget a saved note. Explicit
corrections such as “never mention bananas to me” save an owner rule with the exact
accepted quote. Session, worker and tool text cannot create owner rules. Saves
and removals are acknowledged only after the Host confirms them; forgetting requires
the exact saved entry and your confirmation. Disabled memory
rejects new saves. Existing local notes and persona rules migrate once, retaining
the original keys as backup. Rules can apply everywhere, only to voice or only
to coding sessions. A pending rule save keeps its original request and offers Retry;
an uncertain save does not change speech settings before acknowledgement.

A “don't interrupt me” rule acknowledged through voice enables **I decide when my
turn ends** and holds spoken progress updates. Long pauses then keep listening;
choose **Finish turn** to transcribe and send the captured turn. Silence and Smart
Turn cannot finish it automatically. Long silent intervals are omitted from the
capture buffer. At its two-minute audio limit, capture waits for Finish turn and
shows a notice rather than answering automatically. While voice is connected,
the companion and floating window offer **Reply when I pause** and
**I'll finish when ready** with short explanations. In manual mode, **Finish turn**
submits the captured speech only when clicked. Compact mode uses an icon with a
tooltip; choose the turn mode from its options menu.
The menu checks the current mode. Floating
windows use a native menu so both choices remain reachable in the compact pill.
The same choice remains available as **I decide when my turn ends**
in Voice settings, independently of the saved rule.
Pause length, barge-in and progress announcements remain separate settings.

In **Conversation style**, choose **Apply professional preset** to
wait 2.5 seconds at a turn boundary, allow genuine interruptions, hold spoken
progress announcements and use automatic turn ending. This is an optional preset;
it changes no provider, microphone, language or voice selection, and each setting
can still be adjusted afterwards. Existing preferences are not migrated.

A short acknowledgement such as “tamam” after a delivered answer does not request
another reply. Pending questions and choices still accept your answer normally,
and “tamam, ekipleri aç” remains a new request. “Bir saniye, düşünüyorum” pauses
the assistant without stopping background work or dismissing a pending choice;
answering that choice resumes the conversation. An explicit question such as
“tamam?” still reaches the assistant. Short listening signals such as
“hı hı” during speech do not take the floor.

Automatic return briefings require a Host-confirmed return, a meaningful recent
update, your proactive-speech preference and an available conversation. Routine
zero-work summaries, old daily artifacts and interrupted or uncertain deliveries
are not automatically read again. **Important** accepts only classified important
return updates. Reading a briefing explicitly remains available in the Room.
For an interrupted or uncertain briefing, **Retry briefing** starts a new attempt
after the prior playback has stopped. Held announcements, mute and availability
still apply; Voice does not replay the earlier attempt automatically.

If the provider cannot confirm cleanup of an unrecognized audio fragment, Voice
stops capture and asks you to start it again with **Talk**. It does not resend that
fragment automatically. A brief background sound can produce a recognition candidate
even before you have spoken; rejected candidates must never start a reply.

## Conversation history and choices

Project scope is the default; **Global** switches to the cross-project thread.
A selected session remains the captured focus for each accepted spoken turn.
Transcript text is stored in Host threads; microphone recordings are not stored.
When you start talking again ten minutes or more after the last message, the
assistant treats it as a new conversation: it knows when the previous one ended
and the current time, answers a greeting with a short greeting and asks what you
want, offering the unfinished topic as a question instead of continuing it. After
six hours or on a new day it greets for the time of day and offers, without
reading it, a summary of the day. Shorter pauses and automatic reconnects simply
continue.
Assistant speech enters voice history after playback completes. When a reply is
cut off and word-level playback alignment is unavailable, its unconfirmed text
is omitted from voice history; verified operation results remain intact. Generated
text may still be visible in the panel. An incomplete global project directory
limits reusable context proof without being reported as a failed transcript save;
actual save failures retain their retry path.
Recovery uses the thread summary and six recent text turns without replaying tools.
A failed save retains its request identity and offers **Save conversation**.
Canonical project identity is checked before a project thread opens. A remote project
uses its selected Host's assistant history when that Host supports it. Machine,
environment, project and thread identity remain fixed through delayed writes and
retries; remote history never passes through the local Room cache. An unavailable
or older Host leaves the original transcript pending with **Save conversation**;
voice and tools remain available. Global history stays on the local Host and never
attaches a remote session ID. Session links require an actual Host session binding;
a legacy native-only conversation can still save text without a guessed link.
Later navigation cannot retarget a pending save or tool call.

Global recovery includes only history with verified project contributors that
remain visible from the captured turn. Older entries without that information and
unscoped Global summaries are omitted from model context. Fresh speech still works
when history is unavailable. Locking or hiding a captured project closes the
microphone and clears the active voice context; use **Talk** to start again after
changing scope. Pending transcript saves and job-review drafts remain retained.

Ask for assistant job status or to pause, resume or stop a specific job. Voice
controls keep the captured project scope and current visible-project restrictions.
Deleting a job or assistant notebook entry requires an exact target/version and a
confirmation card; a changed target must be reviewed again. Owner conversation
history is not deletable through these tools. An explicit “stop all assistant work”
pauses assistant work immediately without closing voice or stopping unrelated manual
conversations. Unknown operation outcomes remain visible instead of being replayed.

Clickable choice cards accept option labels, spoken numbers/ordinals and keyboard
selection. Escape dismisses the card without disconnecting voice. Choices never
replace application approval dialogs. Jobs start directly unless **Confirm jobs before
starting** is on in assistant settings. Then multi-job requests show an editable
review with a project per job; nothing is created until **Start jobs**. Accepted
jobs keep running independently. After an uncertain result, retry checks existing
Host jobs and retains the original request keys.

When returning after sleep, the assistant may read the Host's welcome-back
briefing through speakers only, according to its conversation-start preference.
Quiet hours, Away/Do not disturb and held announcements prevent this. **Talk**
still opens the microphone; otherwise the output-only session sleeps after a
minute. Explicit Disconnect stays off.

## Visual style and compact mode

The expanded companion has one header with a **More voice options** button for its
secondary actions, such as finishing the turn and muting the speaker. The status
row shows the connection state and the **Global** scope toggle. Your speech and
replies appear as chat bubbles.

Choose **Settings → Voice assistant → Companion → Visual style** to select
**bycoda mark** (default), **Wave**, **Dots** or **Orb**. Each option has a live
preview. Changing the style updates an open companion immediately and keeps the
voice connection running. The choice is saved on this device.

The visual distinguishes disconnected, connecting, listening, your speech,
preparing a reply, assistant playback, microphone paused and error states through
shape as well as motion. Listening reacts to the actual microphone level on both
local and cloud voice. **Sound detected** confirms incoming audio, not recognized
words or delivery to a model. Reduced motion, or decorative motion turned off in
Settings → Appearance → Motion, retains an input-sensitive still indicator. Assistant
speech appears when reply audio actually starts playing, rather than while it is
being prepared. A separate corner indicator means the target session's agent is
working; it can appear alongside any voice state. The status text remains the
accessible description. Reduced motion keeps recognizable still poses.

Choose **Compact voice companion** in the panel header to keep a small pill with
the visual, session title, the latest spoken line (reply, your words or an error),
microphone pause/resume, speaker mute, disconnect and expand actions. Manual turn
ending has an icon instead of a text button. Speaker mute leaves the conversation
connected; disconnect ends voice without stopping the coding session. The voice
session keeps running, and the compact preference is saved with voice settings.
Choose **Expand voice companion**, or double-click the pill's visual, to restore
the full panel and its controls. Drag the pill's visual, or focus that move
control and use arrow keys, to reposition it. Both sizes stay within the viewport
when moved, resized or expanded; position is saved independently of visual style.

To make the expanded panel larger, drag the resize grip in its header up and
away from the nearer window edge, or focus it and use the arrow keys. The size is
saved; double-click the grip to return to the automatic size.

An open question or job review slides out in its own panel beside the
companion, on the side with room (above it when neither side fits), so the
whole conversation stays visible while you answer. The panel follows the
companion when you move or resize it and scrolls to its answer actions when it
opens. In a window too small for that, it appears above the controls instead.

### Floating outside the app

In the desktop app on Windows, macOS and Linux, choose **Float outside the app**
from the **Voice options** menu in the companion header, or drag the visual/grip past the edge of the bycoda
window and release it there. The companion continues as a small always-on-top
window that you can drag anywhere on any screen, so you can keep talking and
control voice while bycoda is in the background, minimized or hidden. A
question opens beside the floating window too, toward the side of the screen
with room; when it is answered the window returns to its size and place. While it
floats, the app shows a **Return voice companion to this window** button in the
same place.

The floating window offers the same visual, session title, latest line,
**Start voice**, **Pause mic**/**Resume**, speaker mute, **Silence**, **Disconnect voice** and
compact/expand actions. Its close button (**Return voice companion to the app**)
puts the companion back in bycoda and brings the app forward; voice keeps running.
Use **Disconnect voice** to end the conversation. Drag its visual or empty surface to move it;
focus the visual and use arrow keys for keyboard movement. It stays inside the
screen's work area. Choosing a session, voice options and Global/Project scope
remain in the app panel.

The microphone, recognition, speech playback and session tools stay in the bycoda
window that started voice; the floating window only mirrors that state and sends
your commands back. Closing that bycoda window or reloading it closes the floating
window. Closing the floating window returns the controls to the app without
disconnecting voice. On Linux Wayland compositors, staying on top depends on the
compositor.

### Push to talk and tool activity

Assign **Voice: Push to Talk** in Keyboard shortcuts. It has no default binding.
While voice is connected and the microphone is paused, hold the shortcut to
capture one turn. Release it to submit the captured speech and pause the microphone
again. Escape or losing focus cancels capture. The shortcut never starts a closed
voice connection or opens the microphone while disconnected.

The expanded companion and floating window show recent tool activity with the
tool, target, elapsed wait and observed outcome. **Stop waiting** releases voice
from a pending result; it does not certify that the underlying action stopped.
An uncertain action keeps its request identity for a status check. A late result
updates the activity entry without replaying the action. Cards asking for your
choice or job review can wait for your answer; closing voice cancels that wait.

## Audio stays on this computer

The local bycoda Host runs Faster Whisper in an on-demand hidden Python process.
It uses an already cached multilingual `Systran/faster-whisper-small`, `base` or
`tiny` model, in that preference order. It tries CUDA and falls back to CPU int8,
unless **Processing** is set to **CPU**.
Detection and voice playback never download models or use Hugging Face credentials.
Choose **Install** in voice settings to prepare missing Python, packages and public
models before starting voice.
`BYCODA_VOICE_PYTHON` can select an existing Python executable. The installed host
must include the `voice.local.v1` capability.

Speech is segmented locally. When the installation includes Smart Turn (setup
downloads it, 32 MB), a pause of about 0.2 s asks a small local model whether the
sentence sounds finished: if so, the turn ends and is transcribed right away; if
you paused mid-sentence, voice keeps listening for up to 1.3 s. Without Smart Turn
the turn ends after roughly 600 ms of silence. Recognition detects the spoken
language independently of the interface language and knows common coding words
(commit, branch, pull request, TypeScript…).

The voice panel also has these choices, so you can change them without opening
settings:

- **Session**: a searchable list of sessions with their project. Choose one to keep
  voice on it, or **Active session** to follow the session you are viewing.
- **Conversation** and, for Local, **Reply voice**, shown with their icons.
  Changing either ends a live connection; select **Start voice** to continue.
- The microphone button pauses and resumes listening.

**Conversation** chooses who runs the conversation:

- **Local** (default): speech is recognized on this computer and the session's
  provider writes the reply, spoken by the **Reply voice** below.
- **Grok Voice** or **OpenAI Realtime**: a cloud speech-to-speech model listens,
  answers and speaks, usually starting within about a second. It can read the
  session's state, send your request to the session as work and stop work you
  explicitly ask it to stop. Audio is sent to the provider while voice is on. It uses
  your existing Grok Build or Codex sign-in on this computer (or `XAI_API_KEY` /
  `OPENAI_API_KEY` on bycoda Host); no separate key is entered in bycoda. Grok
  sign-ins expire after a few hours: open Grok Build once to refresh it.

**Reply voice** (Local only) offers four choices:

- **Natural (Supertonic)** (default): runs on the CPU, loads in about 2 s,
  speaks 31 languages including English and Turkish, and synthesizes a sentence in
  about 0.4–0.8 s. Setup installs `supertonic` and downloads its model (~385 MB).
- **High quality (VoxCPM2)**: sounds richer and streams audio, but needs an NVIDIA
  GPU to keep up, about 6 GB of its memory and up to a minute to load.
- **ElevenLabs**: a natural cloud voice (Flash v2.5, 32 languages). Only the reply
  text is sent to ElevenLabs. Paste your API key in settings; bycoda Host checks
  it and stores it encrypted on this computer (Windows DPAPI, macOS Keychain, Linux
  Secret Service). An optional voice ID selects another ElevenLabs voice.
- **System voice**: an installed local voice of the operating system.

**Speaker** chooses who speaks, in settings and in the voice panel: Supertonic has
five male and five female voices, Grok Voice has Eve, Ara, Leo, Rex and Sal, and
OpenAI Realtime has Marin, Cedar, Alloy, Ash, Ballad, Coral, Echo, Sage, Shimmer
and Verse. ElevenLabs uses the voice ID field. VoxCPM2 has one built-in voice.
Changing the speaker ends a live connection; select **Start voice** to continue.

Local listening ignores breaths, clicks and steady background noise: a turn
starts only after about 0.13 s of voiced speech, and while a reply is playing
about 0.26 s of clear speech is needed to interrupt it.

Replies are spoken sentence by sentence: the first sentence plays while the
provider is still writing the rest. Natural voices play at their own sample rate
(44.1–48 kHz). The voice model loads on start and stays warm during the connection. Speaking again or choosing
**Silence** cancels synthesis and scheduled audio. A late response cannot restart
cancelled playback. The synthesizer is shared between desktop windows; a busy
window reports that state instead of interrupting another window's voice.

Alternatively, choose **System voice** in settings to use an installed
local voice matching the recognized language. If none is available, the reply
stays visible with an explanation. The app never silently switches to a network
voice or downgrades natural voice to the system engine. Remote projects still
process microphone audio on this desktop.

## Installation detection

The settings page checks existing Python environments and the local Hugging Face
model cache when enabled. This check does not load models into GPU memory, request
the microphone, download files or use a Hugging Face token. It checks an explicitly
selected executable first; otherwise it tries `BYCODA_VOICE_PYTHON`, an active
virtual environment, `~/.bycoda/voice`, PATH and standard Windows Python folders
and launcher versions. The scan has a total time limit. A settings check that
cannot finish offers **Try again**; **Install** remains available while checking.

Use **Locate existing** to choose the Python executable and model directories or
enter their paths. Blank paths mean automatic detection. Missing components and
failure details are available behind **Technical details**. A custom model path
must point to the actual model files, such as a cache snapshot, rather than a
repository's parent cache directory. Changing the engine or paths disconnects an active voice
connection; reconnect explicitly after checking the installation.

**Install** creates a private environment under `~/.bycoda/voice`, installs
`faster-whisper` and `huggingface-hub`, and adds `supertonic` (Natural) or `voxcpm`
(High quality) for natural replies. If
no compatible Python is found, setup downloads a checksum-pinned uv tool and uses
it to prepare private Python 3.12, without changing system Python, PATH or registry
entries. An explicitly selected Python path is preserved rather than replaced.
Setup reuses complete model folders and downloads missing public
`Systran/faster-whisper-small`, Smart Turn (`pipecat-ai/smart-turn-v3`) and, for
natural replies, `Supertone/supertonic-3` or `openbmb/VoxCPM2` files.
Model downloads can be several GB. Setup continues when leaving settings; return
to see its stage or retry a failure. Detection confirms discoverable
files/packages; starting voice checks
that the runtime can actually load them.

## GPU or CPU processing

**Settings → Voice assistant → Voice engine → Processing** chooses where speech models run:

- **Automatic** (default) uses a supported NVIDIA GPU when one is available and
  otherwise runs on the CPU.
- **GPU** requires an NVIDIA GPU with CUDA support for High quality replies. Voice does
  not start until GPU support is installed; it never silently falls back to CPU.
- **CPU** keeps recognition and natural replies off the GPU.

High quality replies are much slower on the CPU and can sound choppy. On Windows,
the standard `voxcpm` install brings a CPU-only PyTorch. When Automatic or GPU
finds an NVIDIA GPU, **Install** replaces it with the newest PyTorch CUDA build
that the installed driver supports (CUDA 12.6 or newer drivers). This download
is about 3 GB. If an existing High quality installation is ready but still runs
on the CPU, settings name the detected GPU and offer **Install GPU support**.
In Automatic mode, a failed GPU install still finishes setup with the CPU voice;
in GPU mode it reports the failure. Disconnect voice before installing.
macOS uses the CPU path. Changing the processing choice disconnects an active
voice connection; start voice again afterwards.

If **Install** immediately reports **Couldn't check voice setup. Try again.**,
open **Technical details**. `Unsupported remote operation` means the desktop's
native bridge cannot forward the setup request. Update the desktop application;
updating only the Host does not repair this desktop routing error.

When an NVIDIA GPU is found, setup also downloads Whisper large-v3-turbo (about 1.6 GB).
It recognizes speech, notably Turkish, far more accurately than the small model
and takes about 0.3 seconds per sentence on the GPU. On the CPU, recognition keeps
the small model. When Whisper is unsure which language you spoke, it uses the
app language.

Spoken replies use the session's model with low reasoning effort and no extended
thinking. Voice starts the reply provider in advance, while the models load and
again after every reply, so a reply does not wait for the provider to start (about
ten seconds). Measured on an RTX 4070 with recorded Turkish speech, a reply starts
speaking about 3.5–4.5 s after you stop talking: about 0.6 s to end the turn and
transcribe it, 2.5–4 s until the provider's first sentence and about 0.5–0.8 s to
synthesize it. The provider's response time dominates and varies.

The recognizer stays warm during a voice connection. Closing its last connection
unloads it; after dictation it stays loaded for five more minutes so the next
dictation starts at once. Abandoned connections expire after 90 seconds. Audio is held in memory
for transcription and is not written to recordings or logs.

## Dictation in the message box

Enable **Settings → Voice assistant → Enable dictation** to show a microphone button next to
Send. It works even when voice companion is disabled. Both features default to off
on a new device. Existing voice users retain dictation after upgrading; after that,
each switch is independent. Disabling dictation cancels capture and pending
transcription without changing the message draft.
Select it and speak: the phrase you are saying appears where the caret is about
once a second, and each time you pause it is replaced by the final recognized
text, with a space between words. Editing a live phrase keeps your edit; the
update is then inserted at the caret instead. Select the button again to stop;
anything you were still saying is transcribed before the microphone closes.
Nothing is sent until you press Send, so you can edit the text first.

**Dictation recognition** chooses who recognizes speech:

- **This computer** (default) uses only speech recognition from your voice
  installation. It does not load the natural reply voice and does not ask a
  provider, so it can run while the voice companion is open. The first use after
  starting the app waits for the recognizer to load (a few seconds; longer on the
  first run). The microphone opens right away and the button shows that it is
  preparing; phrases spoken meanwhile are inserted, in order, as soon as the
  recognizer is ready. Dictating again within five minutes skips the wait.
- **OpenAI**, **Grok** or **OpenRouter** recognize speech in the cloud without
  installing a transcription model. Each phrase and its live previews are sent
  through bycoda Host on this computer to the chosen provider only. OpenAI and Grok
  use the same sign-in as cloud voice (Codex or `OPENAI_API_KEY`, Grok Build or
  `XAI_API_KEY`); OpenRouter needs an API key, stored encrypted on this computer
  (or `OPENROUTER_API_KEY`). Keys never reach the app window. Previews are billed
  like any other recognized audio. **Dictation model** chooses the provider's
  transcription model; the first entry is the default.

Select the button while it is preparing to cancel. Dictation keeps listening when
you switch to another tab or view; while its message box is off screen, the
footer shows **Dictating in** with the session name. Select it to return, or
select stop to finish what was said and close the microphone. **Settings → Voice
assistant** shows **Microphone in use** only while voice companion or dictation
is using the microphone. Select the button while it is preparing to cancel. Errors, such as a missing installation or a
blocked microphone, appear above the message box.

With only dictation enabled, **Dictation setup** installs recognition support
without reply-voice packages or models. Existing Python/model locations and voice
companion playback preferences are retained. Detection never installs anything;
choose **Install** explicitly to prepare missing files.

### Microphone permission

Feature switches do not grant OS or browser permission and never open the
microphone. **Microphone access** shows the browser's reported permission where
supported; otherwise permission stays unknown. **Check microphone access**
explicitly requests access, then immediately closes all captured tracks. It checks
access, not speech recognition or sound quality. Cancel or leaving the page
invalidates the result; a late grant is immediately closed. Dismiss a pending
system permission prompt before starting another check.

- macOS: allow bycoda in **System Settings → Privacy & Security → Microphone**.
- Windows: allow microphone access and desktop apps in **Settings → Privacy &
  security → Microphone** (Windows 10 uses **Privacy → Microphone**).
- Linux: check the sound input and microphone permissions for the app's sandbox
  or desktop environment. There is no universal privacy-pane shortcut.
- Browser: allow microphone access for the current site and check system input
  access. A secure context is required.

Native macOS and Windows denial messages offer **Open Privacy Settings** in
settings, the message box, companion and setup test. Opening that pane does not
grant permission; allow access there, return and retry explicitly. Missing input
devices, unavailable selected devices and capture failures have separate recovery
messages. Permission errors do not automatically retry or submit text.

The button shows a rotating ring while preparing, microphone-level bars while
listening, and animated dots while finishing transcription. Silence lowers the
bars. Finishing prevents duplicate presses; preparing remains cancellable.
With reduced motion enabled, each state keeps a distinct still shape.

## Conversation and work

The floating window follows the active session. Pin it to retain a session while
navigating. Each spoken turn binds at local speech detection, before transcription;
later navigation does not retarget it, including application tools. Local and
Grok/OpenAI turns retain the session and project selected when speech starts;
if no session was selected, a later tab does not become that turn's target.
A newer accepted transcript cancels an older
pending side reply and prevents a stale decision from submitting work. An acoustic
onset alone does not cancel the reply or stop playback.

**Experimental OpenAI turn detection** is off by default. In automatic mode it
sends microphone frames continuously to OpenAI while listening and uses semantic
turn detection. Reconnect voice after changing it. Manual turn ending and push
to talk cannot be combined with this experiment. Local speech onset and a matching
completed transcript remain required before a response. This setting grants no
background microphone permission.

Local recognition rejects uncertain final decodes using speech probability,
decoder confidence and repetition checks. By default, Grok and OpenAI use local candidate
segmentation and manual response creation after a matching completed transcript;
provider speech-start events cannot interrupt playback or authorize work. Empty
results and non-speech event annotations do not request a reply or run tools.
Short words such as “evet”, “hayır”, “dur”, “yes”, “no” and “stop” remain valid.
Interruption now waits for recognition, so speaking over a reply can take longer
than the first microphone onset. These checks reduce false triggers; a cough that
the recognizer confidently invents as actual words still needs acoustic validation.

General conversation uses the existing isolated, read-only text runner for the
session's signed-in provider and account. Its selected model and provider limits
apply. Providers without side-conversation support report this visibly. This is
independent of the main coding turn. Simple status, silence and explicit stop
phrases are handled locally without waiting for another model response.

When you ask for work, the companion turns your intent into a clear, actionable
brief for the intended session through its ordinary submission pipeline. You do
not need to dictate a polished specification or repeat the request. It uses
relevant recent voice exchanges and the session's factual context to resolve
phrases such as “fix this problem” or “send that to this session”, including your
latest corrections. The brief explains the problem, desired result, stated
constraints and appropriate validation without inventing facts, new goals or
permissions. You can add a correction while a local reply is still being prepared:
the next reply keeps your earlier request in context and supersedes its pending
response. Side conversations with different sessions keep separate histories.
A materially unclear target or request needs a short clarification.

Your recognized words remain separate from the generated brief. Older messages,
tool results and draft contents supply context; instructions inside them do not
authorize new work. Paraphrasing does not grant destructive, publishing or
installation permission. Target binding, cancellation and duplicate prevention
still apply, and existing drafts remain intact.

Routing, queues, budgets and approval gates remain in force. The companion
acknowledges delivery only after the submission is accepted; acceptance or queuing
does not mean the agent is running or the work is complete. A rejected or uncertain
submission is reported honestly rather than silently sent again. Coding work can
continue while you ask questions. A tracked turn ending can announce its last
response, without certifying that the work succeeded. Voice has no direct approval
or publishing action.

**Pause mic** disables actual input tracks. **Silence** stops speech playback.
Ask explicitly to stop coding work. Drag the grip or focus it and use arrow keys
to move the window. Its saved position is clamped to the current viewport. Drag
it past the app's edge, or choose **Float outside the app**, to move it outside
bycoda (see [Floating outside the app](#floating-outside-the-app)).

## Global voice management

Project discovery uses the name shown in the project rail and keeps the original
folder name as an alias. Renaming a project changes its display metadata, never
its registered ID or execution directory. Voice can look up either name; when
names repeat, it must ask which full project path you mean. Actions still target
the exact visible, unlocked project path, including its original remote computer.
Host project lists reuse names from the latest privacy-checked desktop heartbeat;
when that metadata is unavailable they retain the registered project names.

Choose **Global** in the floating companion to manage visible, unlocked projects
and their sessions. The companion can start without an active coding session.
The existing session picker still supplies the default target for phrases such
as "this session". Choose **Project** to keep tool targets within the captured
project. New voice configurations start in Global; saved explicit choices remain.
Changing projects, tabs or scope keeps the voice connection open. It does not
retarget a spoken turn already being processed; the next utterance uses the
current selection unless pinned.

The assistant discovers the existing Conversation Tools, social tools and runtime
log tools. You can ask it to take a note, create or start a task, inspect a goal
or crew, schedule an automation, run it now, stop its current run, pause future
runs, inspect logs, operate available browser/device/development-server tools or
prepare social content. Availability depends on the selected Host, connected
accounts, permissions and existing operation support. A newer Host with
`voice.tools.v1` is required. The assistant explains unavailable capabilities;
it does not claim an unconnected service is ready.

In Global mode the assistant can reach every project tool: it names the project
explicitly, so you do not need to switch to Project mode first. Ask it to create
a new project ("create a snake game") and it makes a new folder, adds it to the
project rail and shows it; it never reuses an existing folder. The folder goes in
**Settings → General → Folder for new projects**. When that is not set, it uses
the folder most of your projects already share, otherwise `Projects` in your home
folder. Creating the folder outside an approved location asks for file access
first. The assistant can then start a session, task or crew for the new project.

To run a project locally ("start localhost", "ayağa kaldır"), the assistant reads
the project's saved top-bar actions and the scripts in its `package.json` or
`Cargo.toml`. A saved action wins over a detected script. It picks the action
that starts a dev server even when **Manage as development server** is off: for
example, a saved `dev · pnpm run dev`. It checks whether that server already runs,
then starts it as a managed dev server whose status and logs it can read. It asks
only when several servers fit.

Supported project tools use the verified assistant thread without creating a coding
session. Working-copy operations still require an actual selected session.
Desktop operations can use the real assistant thread and existing native approvals.
Remote Host tools use an actual session on that Host until environment-bound
assistant threads are available. Opening, creating, renaming, closing, archiving or deleting a coding session
uses the normal workspace lifecycle. A background pane close preserves sibling
panes. Historical remote sessions may need opening before a lifecycle change.

Existing owner approvals still apply, including social sends and Inbox/PR writes.
An automation's **pause** stops future launches; **stop run** targets a specific
active run. Acceptance or queuing does not mean completion. When a tool result
is uncertain, the assistant must inspect its state rather than blindly retry.
Application tools also expose session configuration and unsent handoff/drafts,
workspace lifecycle and delivery review, sprints, project organization, Git
status/stage/unstage/commit/selected-file stash/fast-forward pull, provider status
and quota refresh, and theme/density/language/voice preferences. Every mutation
requires its exact native review and existing scope/revision checks. Global
application preferences and provider metadata use the registered Assistant Room
thread without a coding session; project-specific defaults still need an explicit
target. Visible project discovery excludes locked projects. Creating
global tasks, goals or automations requires explicit reviewed execution settings;
goal plan approval remains separate. New handoffs and drafts do not send a turn.

Crew management can use the same Room thread against an explicit project. Read
its current state first, then retain the returned revision and a stable operation
ID for a change. The operation ID is separate from a crew run or directive ID.
Starting work creates a real supervised coordinator through the existing Crew
owner. Native review does not replace task review, permission decisions or
delivery approval. If a result is uncertain, inspect the original operation and
run before requesting another start.

Lists are bounded and report pagination. Session lists include activity evidence;
absence of recent activity does not prove a stuck provider. The event subscription
is a bounded long poll of committed project changes, without durable replay or an
external PR event feed. Sign-in, credential changes, pairing, publication and
destructive recovery remain in their existing owner workflows.

Optional native computer use exposes `desktop.status`, `desktop.snapshot` and
`desktop.act`. The owner configures the verified helper and app allowlist in
**Computer use** settings. Observations and element refs belong to the captured
conversation and expire after five minutes. App content remains untrusted data.
When the owner is present, every input requires the native approval dialog for the
exact app, window, element, action and text.
The native approval identifies either the real coding session or the real
assistant thread; no artificial coding session is created for global voice.
Headless actions can run while the owner is away; locked or unknown desktop state
blocks input. Physical pointer/keyboard input additionally needs the owner's presence,
the physical-input setting and exact operation approval. **Stop computer use** stays
an owner control; the assistant cannot enable, resume or stop control itself.
Input attempts and outcomes go to History and the daily note using a stable operation
identity. These records contain app/action and delivery metadata, never snapshot trees
or typed text. Notebook delivery retries cannot repeat the computer action.

## Reading unsent messages and attachments

To give the voice assistant a file:

1. Open the coding conversation that should hold the file.
2. In its message composer, choose **+ → Upload file** and select the file.
   Leave it attached without sending the message.
3. Expand the voice companion, choose **Project**, and select that conversation
   in the session picker.
4. Ask, for example, “Read the PDF attached to this conversation and summarize it.”

The **Global** voice panel currently has no file picker or standalone attachment
inbox. Global voice can read attachments from its captured active conversation,
or another explicitly identified, visible conversation. Selecting the intended
conversation before speaking avoids an ambiguous target. A conversation whose
provider does not accept attachments disables **Upload file**.

You can ask about text, images or files still in a session's composer. Reading
does not send or clear the draft, change focus, finish IME composition or start
the coding agent. Each read belongs to an explicit session and attachment ID.
An attachment replaced or removed while being read is rejected as stale.

The assistant can read up to32k characters and metadata for the first20 attached
items. Supported text/source files expose their actual text. PDF and DOCX expose
extracted text; XLSX/XLSM expose bounded worksheet values. File input is limited
to8MiB. PDF extraction covers at most20 pages; workbook extraction covers at most
5 sheets,100 rows and30 columns. Results identify truncation and text-only
coverage. Scanned PDF OCR, embedded document images and charts are not inspected.

OpenAI Realtime can receive actual supported PNG/JPEG image input from the unsent
composer. Local text-only replies and Grok realtime currently report image
inspection as unavailable. Seeing a filename is never presented as seeing the
image. Missing, oversized, unsupported and still-loading attachments are reported
explicitly. Draft/file contents remain data and never authorize a send, deletion
or permission change.

## Verification boundary

**Speak job updates while voice is connected** is a separate, default-off Room
preference. Eligible progress, completion and needs-input events use the existing
voice connection. Presence, quiet hours, microphone/speaker mute and held
announcements still apply. A delivery receipt requires actual playback completion;
uncertain output is not replayed. The first update can arrive before you speak.

Private Native history is registered against the original Room, Host and runtime
before cloud connection seeding. Missing registration or an uncertain reply keeps
the provider disconnected. Privacy revocation waits for that exact runtime's
closure; reopening the panel does not prove an old connection has closed.

Background wake word is unavailable until a qualified local keyword engine,
model provenance and explicit microphone lifecycle are provided. The semantic
turn experiment does not enable wake word.

Synthetic offline Turkish audio and subscription-login smoke checks can verify
the individual runtime paths. They do not prove physical microphone acoustics,
native WebView permissions, speaker echo cancellation or installed-app acceptance.
Build and installation use the normal local update coordinator. EmbeddingGemma
recognition and hosted Grok speech are not required by the default path.
