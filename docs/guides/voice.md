# Voice companion

Voice is **off by default**. Enable **Settings → Chat → Voice companion** on
this device. When disabled, no voice launcher or companion is shown in chat.
Disabling it unmounts the companion, cancels pending speech and side replies,
and releases the microphone and local engines without stopping coding work.

Open the speech bubble at the bottom right, select a session, then choose
**Start voice**. The default path requires no voice API key. Microphone access is
requested only after start. Closing the companion releases the microphone and
its local recognizer without stopping coding work.

## Audio stays on this computer

The local bycoda Host runs Faster Whisper in an on-demand hidden Python process.
It uses an already cached multilingual `Systran/faster-whisper-small`, `base` or
`tiny` model, in that preference order. It tries CUDA and falls back to CPU int8.
Detection and voice playback never download models or use Hugging Face credentials.
Choose **Install** in voice settings to prepare missing Python, packages and public
models before starting voice.
`BYCODA_VOICE_PYTHON` can select an existing Python executable. The installed host
must include the `voice.local.v1` capability.

Speech is segmented locally and transcribed after roughly 600 ms of silence.
Recognition detects the spoken language independently of the interface language.
Natural replies use local **VoxCPM2** with incremental PCM playback. Its model
loads on start and stays warm during the connection. Speaking again or choosing
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
`faster-whisper` and `huggingface-hub`, and adds `voxcpm` for natural replies. If
no compatible Python is found, setup downloads a checksum-pinned uv tool and uses
it to prepare private Python 3.12, without changing system Python, PATH or registry
entries. An explicitly selected Python path is preserved rather than replaced.
Setup reuses complete model folders and downloads missing public
`Systran/faster-whisper-small` and, for natural replies, `openbmb/VoxCPM2` files.
Model downloads can be several GB. Setup continues when leaving settings; return
to see its stage or retry a failure. GPU acceleration is recommended for natural
replies; CPU performance depends on the machine. Detection confirms discoverable
files/packages; starting voice checks
that the runtime can actually load them.

Initial model loading and the selected conversation provider add latency. A warm
VoxCPM2 worker streams chunks without waiting for the entire reply, but this is
not a guarantee of instant speech on every machine.

The recognizer stays warm during a voice connection. Closing its last connection
unloads it; abandoned connections expire after 90 seconds. Audio is held in memory
for transcription and is not written to recordings or logs.

## Conversation and work

The floating window follows the active session. Pin it to retain a session while
navigating. Each spoken turn binds at local speech detection, before transcription;
later navigation does not retarget it. A newer utterance cancels an older pending
side reply and prevents a stale decision from submitting work.

General conversation uses the existing isolated, read-only text runner for the
session's signed-in provider and account. Its selected model and provider limits
apply. Providers without side-conversation support report this visibly. This is
independent of the main coding turn. Simple status, silence and explicit stop
phrases are handled locally without waiting for another model response.

Only an explicit work decision submits the exact transcribed user words through
the ordinary session pipeline. Generated replacement commands are never submitted.
Routing, queues, budgets and approval gates remain in force. Acceptance is not
provider delivery or completion. Coding work can continue while the user asks
questions. A tracked turn ending can announce its last response, without certifying
that the work succeeded. Voice has no direct approval or publishing action.

**Pause mic** disables actual input tracks. **Silence** stops speech playback.
Ask explicitly to stop coding work. Drag the grip or focus it and use arrow keys
to move the window. Its saved position is clamped to the current viewport.

## Verification boundary

Synthetic offline Turkish audio and subscription-login smoke checks can verify
the individual runtime paths. They do not prove physical microphone acoustics,
native WebView permissions, speaker echo cancellation or installed-app acceptance.
Build and installation use the normal local update coordinator. EmbeddingGemma
recognition and hosted Grok speech are not required by the default path.
