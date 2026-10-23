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
try:
    with contextlib.redirect_stdout(sys.stderr):
        import torch, numpy as np
        from voxcpm import VoxCPM
        torch.set_num_threads(4)
        config = json.loads(os.environ['BYCODA_VOICE_CONFIG'])
        model = VoxCPM.from_pretrained(config['ttsPath'], load_denoiser=False,
            local_files_only=True, optimize=False, device='cuda' if torch.cuda.is_available() else 'cpu')
    emit({'ready': True})
except Exception:
    emit({'error': 'VoxCPM2 could not start. Check the Python environment, model folder and available memory in Chat settings.'})
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
threading.Thread(target=read_commands, daemon=True).start()
while True:
    req = pending.get()
    id = req['id']
    if current != id: continue
    try:
        with contextlib.redirect_stdout(sys.stderr):
            stream = model.generate_streaming(text=req['text'], cfg_value=2.0,
                inference_timesteps=6, seed=42, normalize=False, retry_badcase=False, max_len=400)
            try:
                for wav in stream:
                    if current != id: break
                    samples = np.asarray(wav).reshape(-1)
                    pcm = (np.clip(samples, -1, 1) * 32767).astype('<i2').tobytes()
                    emit({'id': id, 'audio': base64.b64encode(pcm).decode(), 'sampleRate': model.tts_model.sample_rate})
            finally: stream.close()
        emit({'id': id, 'done': True})
    except Exception:
        emit({'id': id, 'error': 'Local voice playback failed. Check the VoxCPM2 installation.'})
`;
