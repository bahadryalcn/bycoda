/** Offline worker: cached public Whisper models only, no credentials or downloads. */
export const localVoicePython = String.raw`
import os, sys, json, base64, time
os.environ['HF_HUB_OFFLINE'] = '1'
os.environ['HF_HUB_DISABLE_TELEMETRY'] = '1'
os.environ['HF_HUB_DISABLE_IMPLICIT_TOKEN'] = '1'
try:
    import numpy as np
    from faster_whisper import WhisperModel
    from huggingface_hub import snapshot_download
    config = json.loads(os.environ.get('BYCODA_VOICE_CONFIG', '{}'))
    model_path = config.get('whisperPath')
    model_name = 'custom' if model_path else None
    for name in ['small', 'base', 'tiny']:
        if model_path: break
        try:
            model_path = snapshot_download('Systran/faster-whisper-' + name, local_files_only=True)
            if not os.path.isfile(os.path.join(model_path, 'model.bin')):
                model_path = None
                continue
            model_name = name
            break
        except Exception:
            pass
    if not model_path:
        raise RuntimeError('no-cached-model')
    try:
        import ctranslate2
        device = 'cuda' if ctranslate2.get_cuda_device_count() else 'cpu'
        model = WhisperModel(model_path, device=device, compute_type='float16' if device == 'cuda' else 'int8', cpu_threads=4, local_files_only=True)
        # Test runtime DLL availability now, before the microphone opens.
        list(model.transcribe(np.zeros(1600, dtype=np.float32), language='tr', beam_size=1)[0])
    except Exception:
        device = 'cpu'
        model = WhisperModel(model_path, device='cpu', compute_type='int8', cpu_threads=4, local_files_only=True)
    print(json.dumps({'ready': True, 'model': model_name, 'device': device}), flush=True)
except Exception:
    print(json.dumps({'error': 'Local voice needs Python, faster-whisper and a cached multilingual Whisper model (small, base or tiny). No model is downloaded automatically.'}), flush=True)
    sys.exit(1)
for line in sys.stdin:
    req = {}
    try:
        req = json.loads(line)
        raw = base64.b64decode(req['audio'], validate=True)
        if len(raw) < 3200 or len(raw) > 960000 or len(raw) % 2:
            raise ValueError('invalid audio')
        audio = np.frombuffer(raw, dtype='<i2').astype(np.float32) / 32768.0
        language = req.get('language') or None
        started = time.monotonic()
        segments, info = model.transcribe(audio, language=language, beam_size=1, condition_on_previous_text=False, vad_filter=True, without_timestamps=True)
        text = ' '.join(s.text.strip() for s in segments if s.no_speech_prob < 0.7).strip()
        print(json.dumps({'id': req['id'], 'text': text, 'language': info.language, 'inferenceMs': round((time.monotonic()-started)*1000)}), flush=True)
    except Exception:
        print(json.dumps({'id': req.get('id') if isinstance(req, dict) else None, 'error': 'Local speech recognition failed.'}), flush=True)
`;
