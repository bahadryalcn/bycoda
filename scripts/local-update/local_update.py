"""One frozen source, two parallel machines, persistent caches, independent installs."""
import argparse
import concurrent.futures
import gzip
import hashlib
import io
import inspect
import json
import os
import pathlib
import platform
import re
import shlex
import shutil
import sqlite3
import subprocess
import sys
import tarfile
import time
import tomllib
import uuid

from local_update_lib import (digest, lock, read_json, run, safe_child,
                              tree_hashes, verify_tree, write_json, alive, windows_binary_digest, PRODUCT_IDENTITY, package_identity,
                              spawn_windows_updater, UpdaterLaunchRefused, assert_windows_installer_idle, package_components, count)
from local_install import verify_host, desktop_db, verify_desktop_backup

ROOT = pathlib.Path(__file__).resolve().parents[2]
TOOLS = ('local_update.py', 'local_update_lib.py', 'local_install.py')
UPDATER_FEED = 'https://github.com/bahadryalcn/bycoda/releases/latest/download/latest.json'

def git_output(root, *args):
    # NUL-delimited paths and status columns must not be stripped or decoded
    # with Windows' legacy console code page.
    options = {'creationflags': subprocess.CREATE_NO_WINDOW} if os.name == 'nt' else {}
    return subprocess.run(['git', *args], cwd=root, check=True,
                          capture_output=True, **options).stdout.decode('utf-8')

def inputs(root):
    names = git_output(root, 'ls-files', '-z', '--cached', '--others', '--exclude-standard').split('\0')
    # Locally excluded sources that local builds still need, one pattern per line
    # Git resolves linked-worktree .git files and common-dir info correctly.
    extra = pathlib.Path(git_output(root, 'rev-parse', '--path-format=absolute',
                                   '--git-path', 'info/local-build-sources').rstrip('\r\n'))
    if extra.is_file():
        names += git_output(root, 'ls-files', '-z', '--others', '--ignored', f'--exclude-from={extra}').split('\0')
    return {name: (root / name).read_bytes() for name in sorted(set(names))
            if name and not name.startswith(('.scratch/', 'build/', '.git/'))
            # The app bundles user guides (such as its policies); other docs are not inputs.
            and (not name.startswith('docs/') or name.startswith('docs/guides/'))
            and '__pycache__' not in pathlib.PurePosixPath(name).parts and not name.endswith('.pyc')
            and (root / name).is_file()}

BUILD_ENV_KEY = re.compile(r'BYCODA_(?:ACCOUNT|CLERK|STAGING)_[A-Z0-9_]{1,40}')


def build_env(values):
    """Public account build settings (`BYCODA_ACCOUNT_*`, `BYCODA_CLERK_*`, `BYCODA_STAGING_*`)
    from the config's `buildEnv`. Anything else, or a value with whitespace, is refused so
    no secret or shell text can ride along to a worker."""
    if values in (None, {}):
        return {}
    if not isinstance(values, dict):
        raise ValueError('buildEnv must be an object')
    result = {}
    for key, value in values.items():
        if not isinstance(key, str) or not BUILD_ENV_KEY.fullmatch(key):
            raise ValueError(f'buildEnv key not allowed: {key!r}')
        if not isinstance(value, str) or not re.fullmatch(r'[A-Za-z0-9:/._-]{1,300}', value):
            raise ValueError(f'buildEnv value not allowed for {key}')
        result[key] = value
    return dict(sorted(result.items()))


def fingerprint(files):
    value = hashlib.sha256()
    for name, content in sorted(files.items()):
        value.update(name.encode() + b'\0' + hashlib.sha256(content).digest())
    return value.hexdigest()

def git_identity(root):
    """Only source metadata; never read authentication or runtime files."""
    common = pathlib.Path(git_output(root, 'rev-parse', '--path-format=absolute',
                                    '--git-common-dir').rstrip('\r\n')).resolve()
    canonical = common.as_posix().lower() if os.name == 'nt' else common.as_posix()
    repository = hashlib.sha256(canonical.encode()).hexdigest()
    branch = git_output(root, 'rev-parse', '--abbrev-ref', 'HEAD').rstrip('\r\n')
    head = git_output(root, 'rev-parse', 'HEAD').rstrip('\r\n')
    raw = git_output(root, 'status', '--porcelain=v1', '-z', '--untracked-files=all')
    entries = iter(raw.split('\0'))
    dirty = []
    for entry in entries:
        if not entry:
            continue
        status, name = entry[:2], entry[3:]
        dirty.append({'path': name, 'status': status})
        if 'R' in status or 'C' in status:
            original = next(entries)
            dirty.append({'path': original, 'status': status})
    return {'repositoryId': repository, 'branch': branch, 'head': head,
            'dirtyPaths': sorted(dirty, key=lambda item: (item['path'], item['status']))}

def freeze_identity(files, metadata, state, mode, base_request=None):
    source = fingerprint(files)
    version = json.loads(files['package.json'])['version']
    key = fingerprint({'identity': json.dumps(dict(metadata, source=source, mode=mode,
                                                   overlay=base_request is not None),
                                              sort_keys=True).encode()})[:20]
    build_id = key + '-' + mode
    path = state / 'incoming' / (build_id + '.build-info.json')
    manifest = dict(schemaVersion=1, buildId=build_id, version=version,
                    channel='local', mode=mode, sourceFingerprint=source, **metadata,
                    capturedAt=int(time.time() * 1000),
                    components={name: build_id + ':' + name for name in ('web', 'native', 'host')},
                    includedSources=[])
    if not base_request:
        manifest['includedSources'] = [{'repositoryId': metadata['repositoryId'],
                                        'sourceHead': metadata['head']}]
    # An overlay is a synthetic tree, so neither root HEAD nor the previous HEAD
    # proves complete source inclusion. Its exact fingerprint remains authoritative.
    if path.exists():
        previous = read_json(path)
        if dict(previous, capturedAt=manifest['capturedAt']) != manifest:
            raise RuntimeError('Immutable build identity collision')
        return previous
    write_json(path, manifest)
    return manifest

def snapshot(root, state, base_request=None, source_paths=None, *, capture=None, mode='local'):
    metadata = git_identity(root) if capture is not None else None
    if base_request:
        archive = pathlib.Path(base_request['archive']).expanduser()
        if digest(archive) != base_request['archiveHash']:
            raise RuntimeError('Base snapshot checksum mismatch')
        with tarfile.open(archive) as tar:
            files = {}
            for entry in tar.getmembers():
                safe_child(root, entry.name)
                if not entry.isfile():
                    raise ValueError('Base snapshot must contain regular files only')
                files[entry.name] = tar.extractfile(entry).read()
        if fingerprint(files) != base_request['source']:
            raise RuntimeError('Base source fingerprint mismatch')
        current = inputs(root)
        for name in source_paths or []:
            safe_child(root, name)
            if name not in current:
                raise ValueError('Overlay must name an included source file: ' + name)
            files[name] = current[name]
    else:
        files = inputs(root)
    if capture is not None:
        current = inputs(root)
        if base_request:
            stable = all(current.get(name) == files[name] for name in source_paths or [])
        else:
            stable = fingerprint(current) == fingerprint(files)
        if not stable or git_identity(root) != metadata:
            raise RuntimeError('Source changed during freeze; retry from a stable working copy')
    source = fingerprint(files)
    out = state / 'incoming' / (source + '.tar.gz')
    out.parent.mkdir(parents=True, exist_ok=True)
    with out.open('wb') as raw, gzip.GzipFile(fileobj=raw, mode='wb', mtime=0) as gz:
        with tarfile.open(fileobj=gz, mode='w') as tar:
            for name, content in files.items():
                entry = tarfile.TarInfo(name)
                entry.size = len(content)
                entry.mode = 0o755 if name.endswith('.sh') else 0o644
                tar.addfile(entry, io.BytesIO(content))
    if capture is not None:
        # Check again after archiving so metadata cannot silently drift while copying.
        current = inputs(root)
        stable = (all(current.get(name) == files[name] for name in source_paths or [])
                  if base_request else fingerprint(current) == source)
        if not stable or git_identity(root) != metadata:
            raise RuntimeError('Source changed during freeze; retry from a stable working copy')
        capture.update(freeze_identity(files, metadata, state, mode, base_request))
    return out, source

def stamp_build_identity(workspace, request, version):
    """Bind every cached stage to the same immutable frozen-source manifest."""
    identity = request.get('buildIdentity')
    if identity is None:
        # Old saved snapshot requests may still be rebuilt, without inventing provenance.
        (workspace / 'build/build-info.json').unlink(missing_ok=True)
        return None
    if (identity.get('schemaVersion') != 1 or identity.get('sourceFingerprint') != request['source']
            or identity.get('version') != version or identity.get('mode') != request['mode']):
        raise RuntimeError('Build identity does not match frozen request')
    target = workspace / 'build/build-info.json'
    write_json(target, identity)
    return target

def sync_source(archive, source, workspace):
    workspace.mkdir(parents=True, exist_ok=True)
    marker = workspace.parent / 'source-files.json'
    previous = {}
    with tarfile.open(archive) as tar:
        names = [entry.name for entry in tar.getmembers()]
        for name in names:
            target = safe_child(workspace, name)
            if target.is_file():
                previous[name] = (target.read_bytes(), target.stat().st_mtime_ns)
        for old in read_json(marker) if marker.exists() else []:
            if old not in names:
                safe_child(workspace, old).unlink(missing_ok=True)
        tar.extractall(workspace, filter='data')
    files = {name: safe_child(workspace, name).read_bytes() for name in names}
    if fingerprint(files) != source:
        raise RuntimeError('Extracted source fingerprint mismatch')
    # Archives have deterministic epoch timestamps. Cargo needs changed sources
    # newer than its cache, while unchanged files should retain their timestamps.
    for name, content in files.items():
        target = safe_child(workspace, name)
        old = previous.get(name)
        if old and old[0] == content and old[1] > 0:
            os.utime(target, ns=(old[1], old[1]))
        else:
            os.utime(target, None)
    write_json(marker, names)
    return files

def dependency_key(files):
    # A product version is not an install input. Preserve every other package
    # field conservatively, including lifecycle scripts and package-manager config.
    package = json.loads(files['package.json'])
    package.pop('version', None)
    install_inputs = {'package.json': json.dumps(package, sort_keys=True,
                                                separators=(',', ':')).encode('utf-8')}
    for name, content in files.items():
        if (name in ('pnpm-lock.yaml', 'pnpm-workspace.yaml', '.npmrc', '.pnpmfile.cjs') or name.startswith('patches/') or
                (name.startswith(('apps/', 'packages/')) and name.endswith('/package.json'))):
            install_inputs[name] = content
    # Old markers intentionally refresh once; they did not track pnpm's lockfile.
    return 'install-inputs-v3:' + fingerprint(install_inputs)

def host_key(files, graph):
    """A compile cache hit proves equality of all resolved and dynamic Host inputs."""
    if (graph.get('schemaVersion') != 1 or not isinstance(graph.get('inputs'), list) or
            not graph['inputs'] or not isinstance(graph.get('outputs'), list) or not graph['outputs']):
        raise RuntimeError('Host input graph is unavailable or invalid')
    selected = {}
    for name in graph['inputs']:
        if not isinstance(name, str) or name not in files:
            raise RuntimeError('Host input graph references a missing frozen input')
        selected[name] = files[name]
    selected[':dependencies'] = dependency_key(files).encode()
    return 'host-graph-v1:' + fingerprint(selected)

def host_graph(workspace, env):
    # This trusted source helper parses build options and asks esbuild for in-memory
    # metadata. It neither executes host/build.mjs nor writes/runs Host bundles.
    return json.loads(run(['node', 'scripts/build/host-inputs.mjs'], cwd=workspace, env=env))

def cached_pnpm_environment(env, version):
    """Select an already provisioned exact native pnpm; never upgrade the global shim."""
    if not re.fullmatch(r'\d+\.\d+\.\d+', version):
        raise ValueError('Invalid pinned pnpm version')
    if os.name != 'nt' or not env.get('LOCALAPPDATA'):
        return None
    arch = 'arm64' if platform.machine().lower() in ('arm64', 'aarch64') else 'x64'
    package = '@pnpm/exe.win32-' + arch
    cache = pathlib.Path(env['LOCALAPPDATA']) / 'pnpm/package-manager-store/v11/links' / package / version
    if not cache.is_dir():
        return None
    for metadata in sorted(cache.glob('*/node_modules/@pnpm/exe.win32-' + arch + '/package.json')):
        try:
            value = read_json(metadata)
        except (OSError, ValueError):
            continue
        executable = metadata.parent / 'pnpm.exe'
        if isinstance(value, dict) and value.get('name') == package and value.get('version') == version and executable.is_file():
            return dict(env, PATH=str(executable.parent) + os.pathsep + env.get('PATH', ''))
    return None

def host_outputs(workspace, graph):
    outputs = {}
    for name in graph['outputs']:
        if not isinstance(name, str) or not name.startswith('build/host/'):
            raise RuntimeError('Host output graph is invalid')
        target = safe_child(workspace, name)
        if not target.is_file():
            return None
        outputs[name] = digest(target)
    return outputs

def package_run(state, request, components):
    # The same frozen source may produce a Host-only and a complete desktop package.
    # Keep both immutable; a later full build must not rewrite a waiting Host package.
    suffix = '-host' if set(components) == {'host'} else ''
    if not isinstance(request.get('id'), str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,100}', request['id']):
        raise ValueError('Invalid immutable package identifier')
    return safe_child(state / 'runs', request['id'] + suffix)

def immutable_copy(source, destination):
    if destination.exists():
        if digest(source) != digest(destination):
            raise RuntimeError('Immutable package payload changed; use a new frozen build request')
    else:
        shutil.copy2(source, destination)

def write_package_manifest(path, manifest):
    if path.exists():
        old = read_json(path)
        # Timings describe the first creation, not subsequent verified cache reuse.
        if {k: v for k, v in old.items() if k != 'timings'} != {k: v for k, v in manifest.items() if k != 'timings'}:
            raise RuntimeError('Immutable package manifest changed; use a new frozen build request')
    else:
        write_json(path, manifest)

def bundled_host_key(archive):
    # The installer ships these generated resources even when no Rust/web source
    # changed. Fingerprint bytes rather than source so Node/package changes count.
    return fingerprint({archive.name: digest(archive).encode('ascii'),
                        archive.name + '.sha256': pathlib.Path(f'{archive}.sha256').read_bytes()})

def dependency_action(workspace, files, installed_key=None, previous_package=None):
    """Never reinstall just because a build cache is missing or force-build is set."""
    if not (workspace / 'node_modules').is_dir():
        return 'install'
    previous_key = installed_key
    if previous_key is None and previous_package is not None:
        previous_key = dependency_key({'package.json': previous_package})
    if previous_key is not None and previous_key != dependency_key(files):
        return 'clean-install'
    return 'reuse'

def validate_versions(files):
    version = json.loads(files['package.json'])['version']
    values = [json.loads(files['src-tauri/tauri.conf.json'])['version'],
              tomllib.loads(files['Cargo.toml'].decode())['workspace']['package']['version']]
    if not re.fullmatch(r'\d+\.\d+\.\d+', version) or any(value != version for value in values):
        raise RuntimeError('Version files disagree; run the existing bump-version script before building')
    rust_name = tomllib.loads(files['src-tauri/Cargo.toml'].decode())['package']['name']
    rust_versions = [p['version'] for p in tomllib.loads(files['Cargo.lock'].decode())['package'] if p['name'] == rust_name]
    if rust_versions != [version]:
        raise RuntimeError('Cargo.lock version disagrees; run the bump-version script before building')
    return version

def validate_product_identity(files, windows):
    """Validate the frozen configs before deriving artifact/install paths."""
    config = json.loads(files['src-tauri/tauri.conf.json'])
    override = 'src-tauri/tauri.fork.conf.json' if windows else 'src-tauri/tauri.fork.macos.conf.json'
    config.update(json.loads(files[override]))
    if (config.get('productName') != PRODUCT_IDENTITY['productName']
            or config.get('identifier') != PRODUCT_IDENTITY['bundleIdentifier']
            or config.get('mainBinaryName') != PRODUCT_IDENTITY['binaryName']):
        raise RuntimeError('Native package identity disagrees with the bycoda coordinator')
    updater = config.get('plugins', {}).get('updater', {})
    if updater.get('endpoints') not in ([], [UPDATER_FEED]) or (updater.get('endpoints') and not updater.get('pubkey')):
        raise RuntimeError('Updater may only use the signed bycoda GitHub release feed')
    if config.get('bundle', {}).get('createUpdaterArtifacts'):
        raise RuntimeError('Local builds do not sign updater artifacts; the release workflow enables them')
    return dict(PRODUCT_IDENTITY)

def legacy_updaters():
    if os.name == 'nt':
        from local_update_lib import ps
        value = ps('Get-CimInstance Win32_Process | Where-Object { $_.Name -eq "powershell.exe" -and $_.CommandLine -like "*BycodaUpdate*install-*.ps1*" } | ForEach-Object { $_.ProcessId }')
        return value.splitlines() if value else []
    processes = run(['ps', 'ax', '-o', 'pid=,command='])
    return [line.split()[0] for line in processes.splitlines()
            if re.search(r'/projects/bycoda-build[^ ]*/(?:install-host|finish-mac-host[^ ]*|update-mac)\.py(?:\s|$)', line)]

def status():
    base = pathlib.Path.home() / PRODUCT_IDENTITY['hostDirectory'] / 'update-jobs'
    result = {}
    for component in ('host', 'app'):
        record = base / (component + '.json')
        current = install_job_status(read_json(record)) if record.exists() else {'state': 'not scheduled by this pipeline'}
        # A saved waiting count belongs to its report, not to the current machine.
        if 'activeSessions' in current:
            current['reportedActiveSessions'] = current.pop('activeSessions')
        database = base.parent / 'host.db' if component == 'host' else desktop_db()
        sql = ("select count(*) from sessions where status='running' or shell_running=1" if component == 'host'
               else 'select count(*) from in_flight_sessions')
        try:
            active = count(database, sql)
            gate = {'state': 'idle' if active == 0 else 'busy', 'activeSessions': active}
        except (OSError, RuntimeError, sqlite3.Error):
            gate = {'state': 'unknown', 'activeSessions': None}
        current['idleGate'] = dict(gate, observedAt=time.time())
        result[component] = current
    return result

def status_script():
    """Run the same read-only projection remotely without installing updater tools."""
    imports = 'import contextlib,ctypes,json,os,pathlib,re,sqlite3,time'
    functions = (read_json, alive, count, desktop_db, install_job_status, status)
    return '\n\n'.join([imports, 'PRODUCT_IDENTITY = ' + repr(PRODUCT_IDENTITY),
                          *(inspect.getsource(function) for function in functions),
                          'print(json.dumps(status(), indent=2))'])

def install_job_status(record):
    result = dict(record)
    pid = record.get('pid')
    if not pid and record.get('state') in ('launching', 'launch-unknown'):
        try:
            component = record['component']
            if component not in ('host', 'app') or pathlib.Path(record['launchReceipt']) != pathlib.Path(record['releaseDirectory']) / ('launch-' + component + '.json'):
                raise ValueError('Unexpected updater receipt path')
            receipt = read_json(record['launchReceipt'])
            if not isinstance(receipt, dict):
                raise ValueError('Unexpected updater receipt')
            if receipt.get('launchKey') == record.get('launchKey') and isinstance(record.get('launchKey'), str) and re.fullmatch('[a-f0-9]{32}', record['launchKey']) and type(receipt.get('pid')) is int and receipt['pid'] > 0:
                pid = receipt['pid']
                result['pid'] = pid
                result['launchVerified'] = receipt.get('verified') is True
        except (OSError, ValueError, KeyError, TypeError):
            pass  # A broker may still be atomically publishing its receipt.
        try:
            if record.get('component') not in ('host', 'app') or not re.fullmatch('[a-f0-9]{32}', str(record.get('launchKey', ''))):
                raise ValueError('Unexpected updater launch classification')
            failure_path = pathlib.Path(record['releaseDirectory']) / ('launch-' + record['component'] + '-' + record['launchKey'] + '.error.json')
            failure = read_json(failure_path)
            if not isinstance(failure, dict):
                raise ValueError('Unexpected updater launch classification')
            if failure.get('launchKey') == record['launchKey']:
                result['state'] = 'failed' if failure.get('kind') == 'refused' and not pid else 'launch-unknown'
                result['recordedState'] = record.get('state')
        except (OSError, ValueError, KeyError, TypeError):
            pass
    if record.get('state') in ('installed', 'failed') or type(pid) is not int or pid <= 0:
        result['helperAlive'] = None
        if (record.get('state') in ('starting', 'waiting', 'installing') or
                (record.get('id') is not None and record.get('state') not in ('installed', 'failed', 'launching', 'launch-unknown'))):
            result['recordedState'] = record.get('state')
            result['state'] = 'launch-unknown'
    else:
        result['helperAlive'] = alive(pid)
        if not result['helperAlive']:
            result['recordedState'] = record.get('recordedState', record.get('state'))
            result['state'] = 'interrupted'
            result['recovery'] = ('retry-same-package-with-install-only' if result['recordedState'] in ('starting', 'waiting')
                                  else 'verify-recovery-before-install-only')
    return result

def install_job_active(record):
    # Completed helpers can leave a PID later reused by an unrelated process.
    record = install_job_status(record)
    if record.get('state') in ('launching', 'launch-unknown') and not record.get('pid'):
        return True
    pid = record.get('pid')
    return record.get('state') not in ('installed', 'failed') and type(pid) is int and pid > 0 and alive(pid)

def stage(name, command, workspace, env, release, timings):
    print(f'[{sys.platform}] {name}', flush=True)
    started = time.monotonic()
    try:
        run(command, cwd=workspace, env=env, log=release / (name + '.log'), timeout=3600)
    finally:
        timings[name] = round(time.monotonic() - started, 2)
        write_json(release / 'timings.json', timings)

def verify_interrupted_resume(release, manifest, component, old):
    if old.get('id') != manifest['id']:
        raise RuntimeError(f'{component} interrupted another package; recover that exact package first')
    phase = old.get('recordedState')
    if phase in ('starting', 'waiting'):
        return  # A new helper still performs its independent, fresh idle check.
    if phase != 'installing' or component != 'app' or os.name != 'nt':
        raise RuntimeError('Interrupted updater has an uncertain effect; inspect preserved recovery artifacts')
    app = pathlib.Path(os.environ['LOCALAPPDATA']) / PRODUCT_IDENTITY['productName'] / (PRODUCT_IDENTITY['binaryName'] + '.exe')
    assert_windows_installer_idle(release, app, old.get('pid'))
    rollback = release / 'rollback-app'
    hashes_file = rollback / 'windows-installation-hashes.json'
    if not hashes_file.is_file() or not (rollback / 'installation').is_dir():
        raise RuntimeError('Interrupted app has no verified rollback snapshot; recovery required')
    hashes = read_json(hashes_file)
    if not isinstance(hashes, dict) or app.name not in hashes:
        raise RuntimeError('Interrupted app rollback manifest is invalid')
    verify_tree(rollback / 'installation', hashes)
    if not app.is_file() or tree_hashes(app.parent) != hashes:
        raise RuntimeError('Interrupted app installation outcome is unknown; recovery required')
    if desktop_db().exists():
        verify_desktop_backup(rollback / 'desktop.db')

def queue_install(release, components=('host', 'app'), *, resume=False):
    if not components or not set(components) <= {'host', 'app'}:
        raise ValueError('Components must be host and/or app')
    manifest = read_json(release / 'manifest.json')
    package_identity(manifest)
    package_components(manifest, components)
    base = pathlib.Path.home() / PRODUCT_IDENTITY['hostDirectory'] / 'update-jobs'
    base.mkdir(parents=True, exist_ok=True)
    results = {}
    for component in components:
        record = base / (component + '.json')
        old = install_job_status(read_json(record)) if record.exists() else {}
        if old.get('state') == 'launch-unknown' and not old.get('pid'):
            raise RuntimeError('Updater launch outcome is unknown; inspect the launch receipt before retrying')
        if old.get('id') == manifest['id'] and old.get('state') == 'installed':
            try:
                if component == 'host':
                    runtime = pathlib.Path((pathlib.Path.home()/PRODUCT_IDENTITY['hostDirectory']/'runtime-path').read_text().strip())
                    verify_tree(runtime, manifest['hostHashes'])
                    verify_host(runtime)
                else:
                    binary = (pathlib.Path(os.environ['LOCALAPPDATA'])/PRODUCT_IDENTITY['productName']/(PRODUCT_IDENTITY['binaryName']+'.exe') if os.name == 'nt'
                              else pathlib.Path('/Applications')/(PRODUCT_IDENTITY['productName']+'.app')/'Contents/MacOS'/PRODUCT_IDENTITY['binaryName'])
                    if (windows_binary_digest(binary) if os.name == 'nt' else digest(binary)) != manifest['binaryHash']:
                        raise RuntimeError('Installed binary changed')
                results[component] = str(record)
                continue
            except (OSError, RuntimeError):
                pass
        if install_job_active(old):
            if old.get('id') != manifest['id']:
                raise RuntimeError(f'{component} updater already running for another package; see {record}')
            results[component] = str(record)
            continue
        if old.get('state') == 'interrupted':
            if not resume:
                raise RuntimeError(f'{component} updater was interrupted; inspect --status and resume the same package with --install-only')
            verify_interrupted_resume(release, manifest, component, old)
        if os.name == 'nt' and component == 'app' and (old.get('recordedState', old.get('state')) == 'installing' or (release / 'rollback-app/installation').exists()):
            app = pathlib.Path(os.environ['LOCALAPPDATA']) / PRODUCT_IDENTITY['productName'] / (PRODUCT_IDENTITY['binaryName'] + '.exe')
            assert_windows_installer_idle(release, app, old.get('pid'))
        log = release / ('install-' + component + '.log')
        command = [sys.executable, '-B', str(release / 'local_install.py'),
                   str(release / 'manifest.json'), component]
        receipt = release / ('launch-'+component+'.json')
        launch_key = uuid.uuid4().hex
        write_json(record, {'pid': None, 'id': manifest['id'], 'state': 'launching', 'log': str(log),
                            'launchKey': launch_key, 'launchReceipt': str(receipt),
                            'component': component, 'releaseDirectory': str(release)})
        try:
            if os.name == 'nt':
                pid = spawn_windows_updater(command + ['--log', str(log), '--broker-receipt', str(receipt),
                                                        '--broker-key', launch_key], release, receipt, launch_key)
            else:
                with log.open('ab') as output:
                    child = subprocess.Popen(command, stdin=subprocess.DEVNULL, cwd=release,
                                             start_new_session=True, stdout=output, stderr=output)
                pid = child.pid
        except Exception as error:
            # Never race the helper's first/advanced report. Classification lives
            # in an attempt-specific sidecar and is projected only for this launch.
            write_json(release / ('launch-' + component + '-' + launch_key + '.error.json'),
                       {'launchKey': launch_key, 'kind': 'refused' if isinstance(error, UpdaterLaunchRefused) else 'unknown'})
            raise
        write_json(receipt, {'pid': pid, 'log': str(log), 'launchKey': launch_key, 'verified': True})
        results[component] = str(record)
    write_json(release / 'install-jobs.json', results)
    print(f'[{sys.platform}] install jobs scheduled; state: {base}', flush=True)

def archive_package(state, source, version, windows, today=None, build_id=None):
    """Keep every built installer in one place, named by version and build date."""
    packages = state / 'packages'
    packages.mkdir(parents=True, exist_ok=True)
    stamp = (today or time.strftime('%Y-%m-%d'))
    suffix = '_x64-setup.exe' if windows else '_aarch64.app'
    if build_id is not None and not re.fullmatch(r'[A-Za-z0-9_-]{1,100}', build_id):
        raise ValueError('Invalid build identity for package name')
    base = f"{PRODUCT_IDENTITY['productName']}_{version}_{stamp}" + (('_' + build_id) if build_id else '')
    expected = digest(source) if windows else tree_hashes(source)
    for attempt in range(100):
        target = packages / (base + (f'_{attempt + 1}' if attempt else '') + suffix)
        if not target.exists():
            if windows:
                shutil.copy2(source, target)
            else:
                run(['ditto', str(source), str(target)])
            return target
        # Never overwrite: reuse an identical same-day package, otherwise pick a new name.
        if (digest(target) if windows else tree_hashes(target)) == expected:
            return target
    raise RuntimeError('Too many differing packages for ' + base)

def archive_host_package(state, source, version, target, build_id):
    packages = state / 'packages'
    packages.mkdir(parents=True, exist_ok=True)
    if not re.fullmatch(r'[A-Za-z0-9_-]{1,100}', build_id):
        raise ValueError('Invalid Host package identity')
    extension = '.zip' if target.startswith('win32-') else '.tar.gz'
    destination = packages / f'bycoda-host_{version}_{time.strftime("%Y-%m-%d")}_{build_id}_{target}{extension}'
    immutable_copy(source, destination)
    checksum = pathlib.Path(str(destination) + '.sha256')
    expected = digest(destination) + '  ' + destination.name + '\n'
    if checksum.exists() and checksum.read_text() != expected:
        raise RuntimeError('Immutable Host package checksum changed')
    if not checksum.exists():
        checksum.write_text(expected, encoding='utf-8')
    return destination

def finish_build(release, build_only=False, components=('host', 'app')):
    if build_only:
        print(f'[{sys.platform}] build-only package verified: {release}', flush=True)
    else:
        queue_install(release, components)


def worker(request):
    if (os.name == 'nt' and platform.machine().lower() not in ('amd64', 'x86_64')) or (os.name != 'nt' and (sys.platform != 'darwin' or platform.machine() != 'arm64')):
        raise RuntimeError('Local updater supports Windows x64 and Apple Silicon Mac only')
    state = pathlib.Path(request['stateRoot']).expanduser().resolve()
    components = request.get('components', ['host', 'app'])
    if not components or not set(components) <= {'host', 'app'}:
        raise ValueError('Components must be host and/or app')
    release = package_run(state, request, request.get('packageComponents', components) if request.get('installOnly') else components)
    release.mkdir(parents=True, exist_ok=True)
    legacy = legacy_updaters()
    if legacy:
        raise RuntimeError('Previous ad-hoc updater still running (PID '+','.join(legacy)+'); finish it before starting this pipeline')
    for component, old in status().items():
        if component in components and install_job_active(old) and old.get('id') != request['id']:
            raise RuntimeError(f'{component} has a pending package; see --status before starting another update')
    if request.get('installOnly'):
        if not (release / 'manifest.json').is_file():
            raise RuntimeError('Selected immutable package is unavailable; build the selected component first')
        package_components(read_json(release / 'manifest.json'), components)
        # Reuse the immutable package with current installation bug fixes.
        # An already-running helper has imported its own code and keeps its job.
        for name in TOOLS:
            shutil.copy2(pathlib.Path(__file__).parent / name, release / name)
        queue_install(release, components, resume=True)
        return
    with lock(state / 'build.lock'):
        archive = pathlib.Path(request['archive']).expanduser()
        if digest(archive) != request['archiveHash']:
            raise RuntimeError('Transferred archive checksum mismatch')
        workspace = state / 'source'
        package_file = workspace / 'package.json'
        previous_package = package_file.read_bytes() if package_file.exists() else None
        files = sync_source(archive, request['source'], workspace)
        version = validate_versions(files)
        validate_product_identity(files, os.name == 'nt')
        build_manifest = stamp_build_identity(workspace, request, version)
        workspace = state / 'source'
        env = os.environ.copy()
        env['PATH'] = str(pathlib.Path.home() / '.cargo/bin') + os.pathsep + env['PATH']
        if sys.platform == 'darwin':
            env['PATH'] = str(pathlib.Path.home() / 'Library/pnpm/bin') + ':/opt/homebrew/bin:' + env['PATH']
        env['PNPM_CONFIG_VERIFY_DEPS_BEFORE_RUN'] = 'false'
        # Account endpoints compiled in with `option_env!`; without them the app is guest-only.
        env.update(build_env(request.get('buildEnv')))
        # Exact version is checked below. The pnpm self-management shim must not
        # rewrite lockfile metadata after the source and identity were frozen.
        env['pnpm_config_pm_on_fail'] = 'ignore'
        env['CARGO_TARGET_DIR'] = str(pathlib.Path(request['cargoTarget']).expanduser().resolve())
        env['BYCODA_HOST_RUNTIME_CACHE'] = str(state / 'runtime-cache')
        if build_manifest:
            env['BYCODA_BUILD_MANIFEST'] = str(build_manifest.resolve())
        else:
            env.pop('BYCODA_BUILD_MANIFEST', None)
        if os.name == 'nt':
            env['RUSTUP_TOOLCHAIN'] = 'stable-x86_64-pc-windows-msvc'
        # Local packages are unsigned; only the GitHub release workflow holds the updater key.
        env.pop('TAURI_SIGNING_PRIVATE_KEY', None)
        env.pop('TAURI_SIGNING_PRIVATE_KEY_PASSWORD', None)
        if request['mode'] == 'local':
            env.update(CARGO_PROFILE_RELEASE_LTO='false', CARGO_PROFILE_RELEASE_CODEGEN_UNITS='16',
                       CARGO_PROFILE_RELEASE_INCREMENTAL='true')
        else:
            for name in ('LTO', 'CODEGEN_UNITS', 'INCREMENTAL'):
                env.pop('CARGO_PROFILE_RELEASE_'+name, None)
        cache_file = state / 'build-cache.json'
        cache = read_json(cache_file) if cache_file.exists() else {}
        pnpm_version = run(['pnpm', '--version'], cwd=workspace, env=env)
        expected_pnpm = json.loads(files['package.json'])['packageManager'].removeprefix('pnpm@')
        if pnpm_version != expected_pnpm:
            provisioned = cached_pnpm_environment(env, expected_pnpm)
            if provisioned:
                env = provisioned
                pnpm_version = run(['pnpm', '--version'], cwd=workspace, env=env)
            if pnpm_version != expected_pnpm:
                raise RuntimeError(f'pnpm {expected_pnpm} required; found {pnpm_version}; provision the pinned manager without changing the frozen source')
        timings = {}
        # Tests/docs do not affect shipped JS/Rust. Package/config/version files do.
        shipped = {n: b for n, b in files.items() if '.test.' not in n and not n.startswith('tests/')}
        keys = {
            'deps': dependency_key(files),
            'web': fingerprint({n: b for n, b in shipped.items()
                                if not n.startswith(('host/', 'src-tauri/', 'Cargo.', 'scripts/', '.github/',
                                                     'packages/host-service-launcher/'))
                                and n not in ('AGENTS.md', 'README.md', 'LICENSE')}),
        }
        # Even reusable code/assets must carry this exact manifest, rather than
        # an earlier equal-semver source stamp. Dependency caches stay independent.
        if build_manifest:
            identity_key = ':identity-v1:' + digest(build_manifest)
            keys['web'] += identity_key
        def needed(key, exists):
            return request.get('forceBuild') or cache.get(key) != keys[key] or not exists
        # Separate marker: older build-cache deps keys included npm lock/version normalization.
        deps_marker = state / 'installed-package.json'
        installed_key = read_json(deps_marker).get('hash') if deps_marker.exists() else None
        action = dependency_action(workspace, files, installed_key, previous_package)
        if action == 'clean-install':
            modules = safe_child(workspace, 'node_modules')
            if modules.is_symlink() or modules.is_junction():
                raise RuntimeError('Refusing to clean linked node_modules; use a real managed directory')
            shutil.rmtree(modules)
        if action != 'reuse':
            stage('dependencies', ['pnpm', 'install', '--frozen-lockfile', '--prefer-offline'], workspace, env, release, timings)
        else:
            print('Dependencies reused: install inputs unchanged; no install', flush=True)
        write_json(deps_marker, {'hash': keys['deps']})
        windows = os.name == 'nt'
        target = 'win32-x64' if windows else 'darwin-arm64'
        graph = host_graph(workspace, env)
        keys['hostCompile'] = host_key(files, graph)
        outputs = host_outputs(workspace, graph)
        if needed('hostCompile', outputs is not None and outputs == cache.get('hostCompileHashes')):
            stage('host-compile', ['pnpm', 'run', 'host:build'], workspace, env, release, timings)
            outputs = host_outputs(workspace, graph)
            if outputs is None:
                raise RuntimeError('Host compilation did not produce every declared output')
            cache.update(hostCompile=keys['hostCompile'], hostCompileHashes=outputs)
            write_json(cache_file, cache)
        # Host executable bytes have no embedded frozen-source stamp. Package-adjacent
        # version/build-info is finalized separately, only after graph equivalence and
        # output hashes prove that the reused code belongs to these compile inputs.
        package_inputs = {n: b for n, b in files.items()
                          if n in ('LICENSE', 'host/package.mjs', 'host/package-archive.mjs',
                                   'scripts/build/build-info.mjs', 'Cargo.toml', 'Cargo.lock',
                                   'scripts/build/host-service-launcher.mjs',
                                   'scripts/release/sign-desktop-helper.ps1')
                          or n.startswith('packages/host-service-launcher/')}
        keys['host'] = keys['hostCompile'] + ':package-v2:' + fingerprint(package_inputs) + target
        if windows:
            keys['host'] += ':authenticode:' + (env.get('BYCODA_WINDOWS_SIGNING_CERT_SHA1') or '') + ':' + (env.get('BYCODA_WINDOWS_SIGNING_STORE') or 'CurrentUser')
        if build_manifest:
            keys['host'] += ':identity-v1:' + digest(build_manifest)
        host = workspace / 'build/host-packages' / target
        # The installer bundles this archive so the app can install its own host.
        archive = workspace / 'build/host-packages' / f"bycoda-host-{target}.{'zip' if windows else 'tar.gz'}"
        host_matches = ((host / 'host.mjs').exists() and archive.exists() and pathlib.Path(f'{archive}.sha256').exists())
        if windows:
            host_matches = host_matches and (host / 'bycoda-host-launcher.exe').is_file()
        if host_matches:
            host_matches = (cache.get('hostPayloadHashes') == tree_hashes(host) and
                            cache.get('hostArchiveHash') == digest(archive) and
                            cache.get('hostChecksumHash') == digest(pathlib.Path(f'{archive}.sha256')))
        if needed('host', host_matches):
            stage('host-package', ['node', 'host/package.mjs'], workspace, env, release, timings)
            cache.update(host=keys['host'], hostPayloadHashes=tree_hashes(host),
                         hostArchiveHash=digest(archive), hostChecksumHash=digest(pathlib.Path(f'{archive}.sha256')))
            write_json(cache_file, cache)
        build_app = 'app' in components
        if build_app and needed('web', (workspace / 'dist/index.html').exists()):
            stage('web', ['pnpm', 'run', 'build'], workspace, env, release, timings)
            cache['web'] = keys['web']
            write_json(cache_file, cache)
        # Host-only requests skip desktop compilation and installers. Windows Host
        # packaging includes its precompiled native service launcher.
        if build_app:
            toolchain = run(['rustc', '--version'], cwd=workspace, env=env)
            native = {n: b for n, b in shipped.items() if n.startswith(('src-tauri/', 'Cargo.'))}
            profile = {k: v for k, v in env.items() if k.startswith('CARGO_PROFILE_RELEASE_')}
            keys['native'] = ('source-mtime-v2:' + fingerprint(native) + keys['web'] + request['mode'] + toolchain +
                              json.dumps(profile, sort_keys=True) + ':bundled-host-v1:' + bundled_host_key(archive) +
                              ':sign:' + (env.get('BYCODA_MACOS_SIGNING_IDENTITY') or '-') +
                              ':buildenv:' + json.dumps(build_env(request.get('buildEnv'))))
            if windows:
                signing_script = files.get('scripts/release/windows-authenticode.mjs', b'')
                keys['native'] += ':authenticode:' + hashlib.sha256(signing_script).hexdigest() + ':' + (env.get('BYCODA_WINDOWS_SIGNING_CERT_SHA1') or '') + ':' + (env.get('BYCODA_WINDOWS_SIGNING_STORE') or 'CurrentUser')
        # Web was built explicitly once; Tauri must not run it for a second time.
        override = workspace / 'local-update-tauri.json'
        if build_app:
            # A stable signing identity keeps macOS privacy grants (microphone, screen
            # recording, folders) across rebuilds; ad-hoc signing changes identity each time.
            overlay = {'build': {'beforeBuildCommand': ''}}
            identity = (env.get('BYCODA_MACOS_SIGNING_IDENTITY') or '').strip()
            if identity and not windows:
                overlay['bundle'] = {'macOS': {'signingIdentity': identity}}
            override.write_text(json.dumps(overlay), encoding='utf-8')
            if windows and env.get('BYCODA_WINDOWS_SIGNING_CERT_SHA1'):
                run(['node', 'scripts/release/windows-authenticode.mjs', '--config', str(override)], cwd=workspace, env=env)
        cargo = pathlib.Path(env['CARGO_TARGET_DIR'])
        artifacts = cargo / ('release' if windows else 'aarch64-apple-darwin/release')
        app = artifacts / 'bundle/nsis' / f"{PRODUCT_IDENTITY['productName']}_{version}_x64-setup.exe" if windows else artifacts / 'bundle/macos' / (PRODUCT_IDENTITY['productName']+'.app')
        native_binary = artifacts / (PRODUCT_IDENTITY['binaryName']+'.exe') if windows else app/'Contents/MacOS'/PRODUCT_IDENTITY['binaryName']
        matches = build_app and app.exists() and native_binary.exists() and cache.get('binaryHash') == digest(native_binary)
        if matches and windows:
            matches = cache.get('installerHash') == digest(app)
        if matches and not windows:
            try:
                run(['codesign', '--verify', '--deep', '--strict', str(app)])
            except Exception:
                matches = False
        if build_app and needed('native', matches):
            command = ['pnpm', 'exec', 'tauri', 'build', '--ci', '--bundles', 'nsis' if windows else 'app',
                       '--config', 'src-tauri/tauri.fork.conf.json' if windows else 'src-tauri/tauri.fork.macos.conf.json',
                       '--config', override.name]
            if not windows:
                command += ['--target', 'aarch64-apple-darwin']
            stage('native', command, workspace, env, release, timings)
            cache['native'] = keys['native']
        if build_app:
            cache['binaryHash'] = digest(native_binary)
            if windows:
                cache['installerHash'] = digest(app)
        write_json(cache_file, cache)
        # Copy immutable payloads before releasing the build workspace lock.
        payload = release / 'host'
        if payload.exists():
            verify_tree(payload, tree_hashes(host))
        else:
            shutil.copytree(host, payload)
        app_hashes = binary_hash = None
        if build_app and windows:
            immutable_copy(app, release / 'setup.exe')
            native_exe = artifacts / (PRODUCT_IDENTITY['binaryName']+'.exe')
            binary_hash = windows_binary_digest(native_exe)
            app_hashes = {'setup.exe': digest(release / 'setup.exe')}
        elif build_app:
            destination = release / (PRODUCT_IDENTITY['productName']+'.app')
            if not destination.exists():
                # ditto preserves bundle links and permissions.
                run(['ditto', str(app), str(destination)])
            else:
                verify_tree(destination, tree_hashes(app))
            run(['codesign', '--verify', '--deep', '--strict', str(destination)])
            binary_hash = digest(destination / 'Contents/MacOS' / PRODUCT_IDENTITY['binaryName'])
            app_hashes = tree_hashes(destination)
        for name in TOOLS:
            shutil.copy2(workspace / 'scripts/local-update' / name, release / name)
        manifest = {'identity': dict(PRODUCT_IDENTITY), 'id': request['id'], 'version': version, 'source': request['source'], 'mode': request['mode'],
                    'platform': target, 'components': ['host', 'app'] if build_app else ['host'],
                    'hostHashes': tree_hashes(payload), 'timings': timings,
                    'hostCompileInputs': keys['hostCompile'], 'hostCompileHashes': outputs}
        if build_app:
            manifest.update(appHashes=app_hashes, binaryHash=binary_hash)
        if build_manifest:
            manifest['buildIdentity'] = request['buildIdentity']
            shutil.copy2(build_manifest, release / 'build-info.json')
        host_archive = release / archive.name
        immutable_copy(archive, host_archive)
        immutable_copy(pathlib.Path(str(archive) + '.sha256'), pathlib.Path(str(host_archive) + '.sha256'))
        manifest['hostArchive'] = {'name': host_archive.name, 'sha256': digest(host_archive)}
        write_package_manifest(release / 'manifest.json', manifest)
        archive_id = request['id']
        archived = (archive_package(state, release / 'setup.exe' if windows else destination, version, windows,
                                    build_id=archive_id) if build_app else
                    archive_host_package(state, host_archive, version, target, archive_id))
        immutable_copy(release / 'manifest.json', pathlib.Path(str(archived) + '.manifest.json'))
        if build_manifest:
            write_json(pathlib.Path(str(archived) + '.build-info.json'), request['buildIdentity'])
        print(f'[{sys.platform}] package archived: {archived}', flush=True)
        write_json(cache_file, cache)
        write_json(state / 'latest.json', request)
    finish_build(release, request.get('buildOnly', False), components)

def main():
    if sys.version_info < (3, 12):
        raise RuntimeError('Python 3.12+ is required (no third-party packages)')
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--platforms', default='windows,mac' if os.name == 'nt' else 'mac')
    parser.add_argument('--components', default='host,app')
    parser.add_argument('--version')
    parser.add_argument('--plan', action='store_true')
    parser.add_argument('--install-only', action='store_true')
    parser.add_argument('--build-only', action='store_true')
    parser.add_argument('--release', action='store_true')
    parser.add_argument('--force-build', action='store_true')
    parser.add_argument('--worker')
    parser.add_argument('--snapshot-request', help='Reuse one frozen source, or select its exact package manifest with --install-only')
    parser.add_argument('--base-snapshot', help='Overlay explicitly selected source files onto a verified previous snapshot')
    parser.add_argument('--source-path', action='append', default=[])
    parser.add_argument('--status', action='store_true')
    parser.add_argument('--status-worker', action='store_true', help=argparse.SUPPRESS)
    args = parser.parse_args()
    if bool(args.base_snapshot) != bool(args.source_path) or (args.base_snapshot and (args.snapshot_request or args.install_only or args.version)):
        raise ValueError('Use --base-snapshot with --source-path, without snapshot reuse, install-only or version changes')
    components = args.components.split(',')
    if not components or not set(components) <= {'host', 'app'}:
        raise ValueError('Components must be host and/or app')
    if args.install_only and (args.version or args.release or args.force_build or args.build_only):
        raise ValueError('--install-only reuses the previous version/mode; do not combine it with build options')
    if args.worker:
        worker(read_json(pathlib.Path(args.worker).expanduser()))
        return
    if args.status_worker:
        print(json.dumps(status(), indent=2))
        return
    config = read_json(ROOT / 'scripts/local-update/local-update.config.json')
    local = ROOT / 'scripts/local-update/local-update.local.json'
    if local.exists():
        for key, value in read_json(local).items():
            config[key] = {**config[key], **value} if isinstance(value, dict) and isinstance(config.get(key), dict) else value
    platforms = args.platforms.split(',')
    if not set(platforms) <= {'windows', 'mac'}:
        raise ValueError('Platforms must be windows and/or mac')
    if 'windows' in platforms and os.name != 'nt':
        raise ValueError('The Windows coordinator must run on Windows; use --platforms mac here')
    if args.version and not re.fullmatch(r'\d+\.\d+\.\d+', args.version):
        raise ValueError('Version must be x.y.z')
    mode = 'release' if args.release else 'local'
    if args.status:
        if 'windows' in platforms:
            print('Windows:', json.dumps(status(), indent=2))
        if 'mac' in platforms:
            if sys.platform == 'darwin':
                print('Mac:', json.dumps(status(), indent=2))
            else:
                host = config['mac']['ssh']
                code = status_script()
                command = f'{shlex.quote(config["mac"]["python"])} -c {shlex.quote(code)}'
                print('Mac:', run(['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', host, command], timeout=30))
        return
    if args.plan:
        print(json.dumps({'platforms': platforms, 'components': components, 'mode': mode, 'build': not args.install_only,
                          'version': args.version or read_json(ROOT / 'package.json')['version'],
                          'steps': (['reuse last manifest'] if args.install_only else ['freeze once', 'parallel cached builds']) +
                                   ['verify artifacts'] + ([] if args.build_only else ['independent idle host/app install jobs']),
                          'install': not args.build_only, 'config': config}, indent=2))
        return
    state = pathlib.Path(config['stateRoot']).expanduser().resolve()
    if args.snapshot_request and (len(platforms) != 1 or args.version or args.force_build):
        raise ValueError('snapshot-request requires one platform and no version/force-build options')
    coordinator_lock = ('coordinator-' + platforms[0] + '.lock') if args.snapshot_request else 'coordinator.lock'
    with lock(state / coordinator_lock):
        if args.version and not args.install_only:
            run(['node', 'scripts/release/bump-version.mjs', args.version], cwd=ROOT)
        if args.snapshot_request:
            previous = read_json(pathlib.Path(args.snapshot_request))
            if not args.install_only and previous['mode'] != mode:
                raise ValueError('Snapshot build mode does not match requested mode')
        elif args.install_only:
            previous = read_json(state / 'coordinator-latest.json')
        else:
            identity = {}
            archive, source = snapshot(ROOT, state, read_json(args.base_snapshot) if args.base_snapshot else None,
                                       args.source_path, capture=identity, mode=mode)
            previous = {'archive': str(archive), 'archiveHash': digest(archive), 'source': source,
                        'id': identity['buildId'], 'mode': mode, 'buildIdentity': identity}
            if args.force_build:
                previous['id'] += '-' + str(time.time_ns())
        if not args.install_only:
            previous = dict(previous, packageComponents=components)
        else:
            # A preserved component manifest can select an old interrupted job even
            # after a newer Host-only request became coordinator-latest.
            previous = dict(previous, packageComponents=previous.get('packageComponents', previous.get('components', ['host', 'app'])))
        def update(platform):
            request = dict(previous, installOnly=args.install_only, buildOnly=args.build_only,
                           forceBuild=args.force_build, stateRoot=config['stateRoot'], components=components,
                           buildEnv=build_env(config.get('buildEnv')))
            machine = config[platform]
            if platform == 'windows' or sys.platform == 'darwin':
                request['cargoTarget'] = str((ROOT / machine['cargoTarget']).resolve()) if not machine['cargoTarget'].startswith('~') else machine['cargoTarget']
                worker(request)
            else:
                host = machine['ssh']
                remote = '.bycoda-build/incoming/' + previous['id']
                remote_tools = '.bycoda-build/tools/' + previous['id']
                run(['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', host,
                     f'mkdir -p "$HOME/{remote}" "$HOME/{remote_tools}"'], timeout=30)
                if not args.install_only:
                    run(['scp', '-q', previous['archive'], f'{host}:{remote}/source.tar.gz'], timeout=120)
                for name in TOOLS:
                    run(['scp', '-q', str(ROOT / 'scripts/local-update' / name), f'{host}:{remote_tools}/{name}'], timeout=60)
                request.update(archive='~/'+remote+'/source.tar.gz', cargoTarget=machine['cargoTarget'])
                local_request = state / ('request-' + platform + '.json')
                write_json(local_request, request)
                run(['scp', '-q', str(local_request), f'{host}:{remote}/request.json'], timeout=60)
                command = f'{shlex.quote(machine["python"])} "$HOME/{remote_tools}/local_update.py" --worker "$HOME/{remote}/request.json"'
                # Keep per-machine output/logs, no shell interpolation of project paths.
                run(['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', host, command],
                    log=state / ('mac-' + previous['id'] + '.log'), timeout=7200)
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            futures = {pool.submit(update, platform): platform for platform in platforms}
            failures = []
            for future in concurrent.futures.as_completed(futures):
                platform = futures[future]
                try:
                    future.result()
                    result = 'build complete' if args.build_only else 'install jobs scheduled'
                    print(f'{platform}: package verified; {result}', flush=True)
                except Exception as error:
                    failures.append(platform)
                    print(f'{platform}: FAILED ({type(error).__name__}: {error}); inspect logs in {state}', flush=True)
            write_json(state / 'coordinator-latest.json', previous)
            if failures:
                raise RuntimeError('Update failed: ' + ', '.join(failures))

if __name__ == '__main__':
    main()
