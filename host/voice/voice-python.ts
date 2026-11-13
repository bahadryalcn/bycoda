/** Offline worker: cached public Whisper models only, no credentials or downloads. */
export const localVoicePython = String.raw`
import os, re, sys, json, base64, time, math
os.environ['HF_HUB_OFFLINE'] = '1'
os.environ['HF_HUB_DISABLE_TELEMETRY'] = '1'
os.environ['HF_HUB_DISABLE_IMPLICIT_TOKEN'] = '1'
try:
    import numpy as np
    from faster_whisper import WhisperModel
    from huggingface_hub import try_to_load_from_cache
    config = json.loads(os.environ.get('BYCODA_VOICE_CONFIG', '{}'))
    def cached(repo, folder=None):
        # Newer huggingface_hub rejects offline snapshots that lack optional
        # files, so look up the model files themselves.
        required = ['model.bin', 'config.json', 'tokenizer.json']
        if not folder:
            found = try_to_load_from_cache(repo, 'model.bin')
            folder = os.path.dirname(found) if isinstance(found, str) else None
        return folder if folder and all(os.path.isfile(os.path.join(folder, f)) for f in required) else None
    model_path = config.get('whisperPath')
    model_name = 'custom' if model_path else None
    for name in ['small', 'base', 'tiny']:
        if model_path: break
        model_path = cached('Systran/faster-whisper-' + name)
        model_name = name if model_path else None
    if not model_path:
        raise RuntimeError('no-cached-model')
    # Large-v3-turbo recognizes far better (notably Turkish) and runs in about
    # 0.2 s on a GPU, but is too slow on a CPU. Setup downloads it next to the
    # GPU runtime; it replaces only a stock small/base/tiny model.
    stock = not config.get('whisperExact') and (model_name != 'custom' or re.search(r'whisper-(small|base|tiny)', model_path.replace(os.sep, '/')))
    owned_turbo = os.path.join(os.path.expanduser('~'), '.bycoda', 'voice', 'models', 'whisper-large-v3-turbo')
    turbo = (cached(None, owned_turbo) or cached('mobiuslabsgmbh/faster-whisper-large-v3-turbo')) if stock else None
    try:
        # The owner's CPU choice keeps recognition off the GPU entirely.
        if config.get('device') == 'cpu':
            raise RuntimeError('cpu-requested')
        import ctranslate2
        if not ctranslate2.get_cuda_device_count():
            raise RuntimeError('no-cuda')
        model = WhisperModel(turbo or model_path, device='cuda', compute_type='float16', local_files_only=True)
        # Test runtime DLL availability now, before the microphone opens.
        list(model.transcribe(np.zeros(1600, dtype=np.float32), language='tr', beam_size=1)[0])
        device = 'cuda'
        if turbo: model_name = 'large-v3-turbo'
    except Exception:
        device = 'cpu'
        model = WhisperModel(model_path, device='cpu', compute_type='int8', cpu_threads=4, local_files_only=True)
    # Smart Turn v3.2 (BSD-2, 23 languages): judges from the audio whether a
    # pause ends the sentence. Optional; without it the app uses a fixed pause.
    turn = None
    try:
        import onnxruntime as ort
        turn_path = os.path.join(os.path.expanduser('~'), '.bycoda', 'voice', 'models', 'smart-turn', 'smart-turn-v3.2-gpu.onnx')
        if not os.path.isfile(turn_path):
            found = try_to_load_from_cache('pipecat-ai/smart-turn-v3', 'smart-turn-v3.2-gpu.onnx', revision='f766f81d3cfdf7737ac64aad813d91bbfd56bf93')
            turn_path = found if isinstance(found, str) else None
        if turn_path:
            options = ort.SessionOptions()
            options.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
            options.inter_op_num_threads = 1
            options.intra_op_num_threads = 1
            turn = ort.InferenceSession(turn_path, sess_options=options, providers=['CPUExecutionProvider'])
    except Exception:
        turn = None
    print(json.dumps({'ready': True, 'model': model_name, 'device': device, 'turn': turn is not None}), flush=True)
except Exception:
    print(json.dumps({'error': 'Local voice needs Python, faster-whisper and a cached multilingual Whisper model (small, base or tiny). No model is downloaded automatically.'}), flush=True)
    sys.exit(1)
def turn_mel():
    # Whisper log-mel filters as in WhisperFeatureExtractor(chunk_length=8).
    def to_mel(f):
        return np.where(f >= 1000.0, 15.0 + np.log(np.maximum(f, 1e-12) / 1000.0) * (27.0 / np.log(6.4)), 3.0 * f / 200.0)
    def to_hz(m):
        return np.where(m >= 15.0, 1000.0 * np.exp(np.log(6.4) / 27.0 * (m - 15.0)), 200.0 * m / 3.0)
    fft = np.linspace(0, 8000, 201)
    edges = to_hz(np.linspace(to_mel(np.array(0.0)), to_mel(np.array(8000.0)), 82))
    slopes = edges[None, :] - fft[:, None]
    diff = np.diff(edges)
    bank = np.maximum(0.0, np.minimum(-slopes[:, :-2] / diff[:-1], slopes[:, 2:] / diff[1:]))
    return bank * (2.0 / (edges[2:82] - edges[:80]))
TURN_MEL = turn_mel()
TURN_WINDOW = 0.5 - 0.5 * np.cos(2.0 * np.pi * np.arange(400) / 400)
def turn_complete(audio):
    """Probability that the speaker finished: last 8 s, left-padded, Whisper log-mel."""
    x = audio.astype(np.float64)[-128000:]
    x = np.concatenate([np.zeros(128000 - x.size), x])
    x = np.pad((x - x.mean()) / np.sqrt(x.var() + 1e-7), 200, mode='reflect')
    frames = np.lib.stride_tricks.sliding_window_view(x, 400)[::160]
    mel = (np.abs(np.fft.rfft(frames * TURN_WINDOW, axis=1)) ** 2)[:-1] @ TURN_MEL
    log = np.log10(np.maximum(mel, 1e-10)).T
    log = (np.maximum(log, log.max() - 8.0) + 4.0) / 4.0
    return float(turn.run(None, {'input_features': log[None].astype(np.float32)})[0][0, 0])
# Coding vocabulary: helps these words inside Turkish or English speech; neutral
# on general speech (FLEURS en/tr WER within noise).
HOTWORDS = 'commit, branch, rebase, merge, pull request, README, TypeScript, JavaScript, WebSocket, pnpm, npm, API, useState, dev server, main, build, deploy, test, bug'

def accepted_transcript(segments):
    """Reject failed decoding even when Whisper returns text after its retries.

    These are Whisper's normal decoding-quality thresholds, applied to the final
    result as well. No word-count/duration floor: a confident "no" or "dur" is
    as valid as a sentence. VAD remains necessary; confident hallucinations cannot
    be identified from decoder confidence alone.
    """
    accepted = []
    for segment in segments:
        scores = (segment.no_speech_prob, segment.avg_logprob, segment.compression_ratio)
        if not all(math.isfinite(value) for value in scores):
            return ''
        if not (0 <= segment.no_speech_prob < 0.6 and segment.avg_logprob >= -1.0 and 0 <= segment.compression_ratio <= 2.4):
            # Do not splice around an uncertain clause: dropping a negation
            # could turn "do not stop" into an actionable "stop".
            return ''
        text = segment.text.strip()
        if text:
            accepted.append(text)
    return ' '.join(accepted)

for line in sys.stdin:
    req = {}
    try:
        req = json.loads(line)
        raw = base64.b64decode(req['audio'], validate=True)
        if len(raw) < 3200 or len(raw) > 960000 or len(raw) % 2:
            raise ValueError('invalid audio')
        audio = np.frombuffer(raw, dtype='<i2').astype(np.float32) / 32768.0
        hint = req.get('language') or None
        started = time.monotonic()
        probability = None
        if req.get('endpoint') and turn is not None:
            # A pause: transcribe only when the sentence sounds finished.
            probability = turn_complete(audio)
            if probability < 0.7:
                print(json.dumps({'id': req['id'], 'complete': False, 'probability': round(probability, 3)}), flush=True)
                continue
        options = dict(beam_size=1, condition_on_previous_text=False, vad_filter=True, without_timestamps=True, hotwords=HOTWORDS)
        segments, info = model.transcribe(audio, **options)
        # Short clips often get an uncertain language guess; the app language is
        # the better choice then. A confident other language is kept.
        if hint and info.language != hint and info.language_probability < 0.75:
            segments, info = model.transcribe(audio, language=hint, **options)
        text = accepted_transcript(segments)
        print(json.dumps({'id': req['id'], 'text': text, 'language': info.language, 'inferenceMs': round((time.monotonic()-started)*1000), **({} if probability is None else {'complete': True, 'probability': round(probability, 3)})}), flush=True)
    except Exception:
        print(json.dumps({'id': req.get('id') if isinstance(req, dict) else None, 'error': 'Local speech recognition failed.'}), flush=True)
`;
