/** Protocol stdout is reserved for PCM chunks; library diagnostics stay on stderr. */
export const voiceSpeechPython = String.raw`
import os, sys, json, threading, queue, base64, contextlib
os.environ['HF_HUB_OFFLINE'] = '1'
os.environ['HF_HUB_DISABLE_IMPLICIT_TOKEN'] = '1'
os.environ['HF_HUB_DISABLE_TELEMETRY'] = '1'
protocol = sys.stdout
def emit(value):
    protocol.write(json.dumps(value) + '\n')
    protocol.flush()
config = json.loads(os.environ.get('BYCODA_VOICE_CONFIG', '{}'))
engine = 'voxcpm2' if config.get('engine') == 'voxcpm2' else 'supertonic'
def pcm_chunk(samples):
    import numpy as np
    return base64.b64encode((np.clip(samples, -1, 1) * 32767).astype('<i2').tobytes()).decode()
try:
    with contextlib.redirect_stdout(sys.stderr):
        import numpy as np
        if engine == 'supertonic':
            # Supertonic 3: ONNX on the CPU, 31 languages, about 0.4 s per sentence.
            from supertonic import TTS
            from supertonic.config import AVAILABLE_LANGUAGES
            folder = os.path.join(os.path.expanduser('~'), '.bycoda', 'voice', 'models', 'supertonic3')
            if not os.path.isfile(os.path.join(folder, 'onnx', 'tts.json')):
                folder = os.path.join(os.path.expanduser('~'), '.cache', 'supertonic3')
            model = TTS(model='supertonic-3', model_dir=folder, auto_download=False)
            style = model.get_voice_style(voice_name='M1')
            sample_rate = model.sample_rate
            def synthesize(text, language, is_current):
                lang = language if language in AVAILABLE_LANGUAGES else 'na'
                wav, _ = model.synthesize(text=text, voice_style=style, lang=lang)
                samples = np.asarray(wav, dtype=np.float32).reshape(-1)
                step = sample_rate // 2  # Half-second chunks keep protocol lines small.
                for start in range(0, samples.size, step):
                    if not is_current(): return
                    yield samples[start:start + step]
            model.synthesize(text='Merhaba.', voice_style=style, lang='tr')  # First-call setup.
            device = 'cpu'
        else:
            import torch
            from voxcpm import VoxCPM
            torch.set_num_threads(4)
            requested = config.get('device') or 'auto'
            if requested == 'gpu' and not torch.cuda.is_available():
                raise RuntimeError('gpu-unavailable')
            device = 'cuda' if requested != 'cpu' and torch.cuda.is_available() else 'cpu'
            model = VoxCPM.from_pretrained(config['ttsPath'], load_denoiser=False,
                local_files_only=True, optimize=False, device=device)
            sample_rate = model.tts_model.sample_rate
            def synthesize(text, language, is_current):
                torch.manual_seed(42)
                stream = model.generate_streaming(text=text, cfg_value=2.0,
                    inference_timesteps=10, normalize=False, retry_badcase=False, max_len=400)
                try:
                    for wav in stream:
                        if not is_current(): return
                        yield np.asarray(wav).reshape(-1)
                finally: stream.close()
            # The first generation is about 1.5 s slower (kernel and cache setup).
            # Pay it during start so the first spoken reply begins immediately.
            try:
                for _ in synthesize('Merhaba.', 'tr', lambda: True): pass
            except Exception:
                pass
    emit({'ready': True, 'device': device, 'engine': engine})
except Exception as error:
    emit({'error': 'GPU voice is unavailable. Install GPU support or choose CPU in Chat settings.' if str(error) == 'gpu-unavailable' else 'The natural voice could not start. Check the voice installation and available memory in Chat settings.'})
    sys.exit(1)
pending = queue.Queue(maxsize=1)
current = None
def read_commands():
    global current
    for line in sys.stdin:
        try:
            req = json.loads(line)
            if req.get('cancel'):
                if current == req['cancel']: current = None
                continue
            current = req['id']
            try: pending.get_nowait()
            except queue.Empty: pass
            pending.put_nowait(req)
        except Exception: pass
    # The Host closed the pipe: never linger holding model memory.
    os._exit(0)
threading.Thread(target=read_commands, daemon=True).start()
while True:
    req = pending.get()
    id = req['id']
    if current != id: continue
    try:
        with contextlib.redirect_stdout(sys.stderr):
            for samples in synthesize(req['text'], req.get('language'), lambda: current == id):
                emit({'id': id, 'audio': pcm_chunk(samples), 'sampleRate': sample_rate})
        emit({'id': id, 'done': True})
    except Exception:
        emit({'id': id, 'error': 'Local voice playback failed. Check the voice installation in Chat settings.'})
`;
