"""Small shared primitives for the local updater (Python 3.11+, no dependencies)."""
import contextlib
import ctypes
import hashlib
import json
import os
import pathlib
import sqlite3
import subprocess
import time

# Presentation/artifact identity is separate from the internal Rust binary name.
PRODUCT_IDENTITY = {
    'productName': 'bycoda', 'binaryName': 'bycoda',
    'bundleIdentifier': 'com.bycoda.desktop', 'hostDirectory': '.bycoda-host',
    'hostService': 'com.bycoda.host', 'hostTaskName': 'Bycoda Host',
    'hostLauncher': 'bycoda-host', 'hostPort': 3776,
}

def package_identity(manifest):
    identity = manifest.get('identity')
    if identity != PRODUCT_IDENTITY:
        raise RuntimeError('Package identity is missing or incompatible; rebuild the bycoda package')
    return identity

def digest(path):
    with pathlib.Path(path).open('rb') as f:
        return hashlib.file_digest(f, 'sha256').hexdigest()

def windows_binary_digest(path):
    """Tauri embeds NSS during NSIS packaging, then restores UNK in the build EXE.
    Normalize only that single marker; every other executable byte is verified.
    """
    data = pathlib.Path(path).read_bytes()
    marker = b'__TAURI_BUNDLE_TYPE_VAR_'
    if data.count(marker) != 1:
        raise RuntimeError('Expected one Tauri bundle type marker')
    offset = data.index(marker) + len(marker)
    if data[offset:offset + 3] not in (b'UNK', b'NSS'):
        raise RuntimeError('Unexpected Windows bundle type')
    return hashlib.sha256(data[:offset] + b'UNK' + data[offset + 3:]).hexdigest()

def read_json(path):
    return json.loads(pathlib.Path(path).read_text(encoding='utf-8-sig'))

def write_json(path, value):
    path = pathlib.Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + f'.{os.getpid()}.tmp')
    tmp.write_text(json.dumps(value, indent=2), encoding='utf-8')
    os.replace(tmp, path)

def safe_child(root, name):
    root = pathlib.Path(root).resolve()
    path = (root / name).resolve()
    if path == root or root not in path.parents:
        raise ValueError(f'Path escapes managed directory: {name}')
    return path

def alive(pid):
    if not isinstance(pid, int) or pid <= 0:
        return False
    if os.name == 'nt':
        kernel = ctypes.WinDLL('kernel32', use_last_error=True)
        kernel.OpenProcess.restype = ctypes.c_void_p
        kernel.CloseHandle.argtypes = [ctypes.c_void_p]
        handle = kernel.OpenProcess(0x1000, False, pid)
        if not handle:
            return ctypes.get_last_error() == 5
        code = ctypes.c_ulong()
        kernel.GetExitCodeProcess.argtypes = [ctypes.c_void_p, ctypes.POINTER(ctypes.c_ulong)]
        ok = kernel.GetExitCodeProcess(handle, ctypes.byref(code))
        kernel.CloseHandle(handle)
        return bool(ok and code.value == 259)
    try:
        os.kill(pid, 0)
        return True
    except ProcessLookupError:
        return False
    except PermissionError:
        return True

@contextlib.contextmanager
def lock(path):
    path = pathlib.Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        path.mkdir()
    except FileExistsError:
        owner = read_json(path / 'owner.json')
        if alive(owner['pid']):
            raise RuntimeError(f'Update already running (PID {owner["pid"]})')
        (path / 'owner.json').unlink()
        path.rmdir()
        path.mkdir()
    write_json(path / 'owner.json', {'pid': os.getpid()})
    try:
        yield
    finally:
        (path / 'owner.json').unlink(missing_ok=True)
        path.rmdir()

def run(args, *, cwd=None, env=None, log=None, timeout=None):
    options = dict(cwd=cwd, env=env, check=True, timeout=timeout)
    if os.name == 'nt':
        options['creationflags'] = subprocess.CREATE_NO_WINDOW
        if args[0] in ('npm', 'npx', 'pnpm'):
            # Arguments here are fixed updater commands, never arbitrary shell text.
            args = ['cmd.exe', '/d', '/c', subprocess.list2cmdline(args)]
    if log:
        with pathlib.Path(log).open('ab') as f:
            return subprocess.run(args, stdout=f, stderr=f, **options)
    return subprocess.run(args, capture_output=True, text=True, **options).stdout.strip()

def ps(script):
    import base64
    encoded = base64.b64encode(('$ErrorActionPreference="Stop"; '+script).encode('utf-16le')).decode()
    env = {k: v for k, v in os.environ.items() if k.upper() != 'PSMODULEPATH'}
    return run(['powershell.exe', '-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], env=env, timeout=60)

def ps_quote(value):
    return "'" + str(value).replace("'", "''") + "'"

def count(db, sql):
    # Failure must never look like zero active sessions.
    with contextlib.closing(sqlite3.connect(pathlib.Path(db).resolve().as_uri() + '?mode=ro', uri=True, timeout=3)) as con:
        return con.execute(sql).fetchone()[0]

def backup(db, destination, seconds=15):
    deadline = time.monotonic() + seconds
    def progress(status, remaining, total):
        if time.monotonic() > deadline:
            raise TimeoutError(f'Database backup exceeded {seconds}s')
    with contextlib.closing(sqlite3.connect(pathlib.Path(db).resolve().as_uri() + '?mode=ro', uri=True, timeout=1)) as source:
        with contextlib.closing(sqlite3.connect(destination, timeout=1)) as target:
            source.backup(target, pages=128, progress=progress, sleep=0.05)
            if target.execute('pragma quick_check').fetchone()[0] != 'ok':
                raise RuntimeError('Backup integrity check failed')

def tree_hashes(root):
    root = pathlib.Path(root)
    return {str(p.relative_to(root)).replace('\\', '/'): digest(p)
            for p in sorted(root.rglob('*')) if p.is_file()}

def verify_tree(root, hashes):
    for name, expected in hashes.items():
        if digest(safe_child(root, name)) != expected:
            raise RuntimeError(f'Artifact checksum mismatch: {name}')
