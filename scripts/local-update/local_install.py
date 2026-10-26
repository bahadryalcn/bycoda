"""Idle-only host/app installation. Spawned headlessly by local_update.py."""
import json
import contextlib
import os
import pathlib
import plistlib
import re
import shutil
import sqlite3
import sys
import tempfile
import time
import traceback
import urllib.request

from local_update_lib import (alive, backup, count, digest, lock, ps, ps_quote,
                              read_json, run, safe_child, tree_hashes, verify_tree, write_json, windows_binary_digest, PRODUCT_IDENTITY, package_identity)

BASE = pathlib.Path.home() / PRODUCT_IDENTITY['hostDirectory']
MAC_APPLICATIONS = pathlib.Path('/Applications')

def mac_app_update_paths(app, package_id):
    # Keep atomic renames on the Applications volume without exposing rollback
    # or staging bundles as additional apps to LaunchServices/Spotlight.
    archive = app.parent / '.bycoda-update.noindex'
    job = safe_child(archive, package_id)
    job.mkdir(parents=True, exist_ok=True)
    (archive / '.metadata_never_index').touch(exist_ok=True)
    return job / 'previous.bundle', job / 'staged.bundle'

def desktop_db():
    return (pathlib.Path(os.environ['APPDATA']) / 'com.bycoda.desktop/bycoda.db'
            if os.name == 'nt' else pathlib.Path.home() / 'Library/Application Support/com.bycoda.desktop/bycoda.db')

def windows_app_process_filter(app):
    # Earlier products use other identifiers and data; they are never closed here.
    paths = [app]
    allowed = '@(' + ','.join(ps_quote(path) for path in paths) + ')'
    return (f'Get-Process | Where-Object {{ $_.ProcessName -eq "{PRODUCT_IDENTITY["binaryName"]}" '
            f'-and {allowed} -contains $_.Path }}')

def windows_app_snapshot(app, rollback, manifest):
    """Reuse only an intact previous installation, never overwrite recovery data."""
    saved = rollback / 'installation'
    hashes_path = rollback / 'windows-installation-hashes.json'
    if saved.exists() or hashes_path.exists():
        if not saved.is_dir() or not hashes_path.is_file():
            raise RuntimeError('Incomplete Windows rollback snapshot; recovery required')
        hashes = read_json(hashes_path)
        if not isinstance(hashes, dict) or app.name not in hashes or tree_hashes(saved) != hashes:
            raise RuntimeError('Windows rollback snapshot failed integrity verification')
        if not app.exists() or tree_hashes(app.parent) != hashes:
            raise RuntimeError('Interrupted Windows update has unknown installation state; recovery required')
        return hashes, False
    if not app.exists():
        return None, False
    hashes = tree_hashes(app.parent)
    shutil.copytree(app.parent, saved)
    if tree_hashes(saved) != hashes:
        raise RuntimeError('Windows rollback snapshot failed integrity verification')
    write_json(hashes_path, hashes)
    return hashes, False

def verify_desktop_backup(path, seconds=15):
    deadline = time.monotonic() + seconds
    try:
        if seconds <= 0:
            raise RuntimeError('Database backup validation timed out')
        if path.stat().st_size == 0:
            raise RuntimeError('Empty database backup')
        with contextlib.closing(sqlite3.connect(path.resolve().as_uri() + '?mode=ro', uri=True,
                                               timeout=min(1, seconds))) as connection:
            connection.set_progress_handler(lambda: int(time.monotonic() > deadline), 1000)
            if connection.execute('PRAGMA quick_check').fetchall() != [('ok',)]:
                raise RuntimeError('Database integrity check failed')
            tables = {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")}
            if not {'sessions', 'in_flight_sessions'} <= tables or time.monotonic() > deadline:
                raise RuntimeError('Database backup is incomplete or validation timed out')
    except (OSError, sqlite3.Error, RuntimeError) as error:
        raise RuntimeError('Existing desktop database backup requires recovery') from error

def restore_windows_app(app, saved, hashes, rollback, process_filter):
    """Restore the complete installation, keeping the failed tree for diagnosis."""
    # Validate the recovery copy before touching the failed replacement. Keep the
    # database in APPDATA intact: an app rollback is never a database rollback.
    verify_tree(saved, hashes)
    ps(process_filter + ' | Stop-Process -Force -PassThru | Wait-Process -Timeout 30')
    recovery = pathlib.Path(tempfile.mkdtemp(
        prefix='.' + PRODUCT_IDENTITY['productName'] + '-failed-', dir=app.parent.parent))
    write_json(rollback / 'windows-recovery.json', {'failedInstallation': str(recovery / 'installation')})
    if app.parent.exists():
        app.parent.rename(recovery / 'installation')
    try:
        shutil.copytree(saved, app.parent)
        if tree_hashes(app.parent) != hashes:
            raise RuntimeError('Restored Windows installation failed integrity verification')
    except Exception:
        # Both the known-good snapshot and failed replacement remain available.
        raise RuntimeError('Windows rollback failed; recovery artifacts retained at ' + str(rollback))

def wait_idle(db, sql, report):
    last = object()
    while True:
        try:
            active = count(db, sql)
        except Exception:
            active = None  # A read error is never proof that the app/host is idle.
        if active != last:
            report('waiting', activeSessions=active)
            last = active
        if active == 0:
            return
        time.sleep(5)

def lifecycle(action):
    state = read_json(BASE / 'running.json')
    request = urllib.request.Request(f'http://127.0.0.1:{state["port"]}/lifecycle',
                                    data=json.dumps({'action': action}).encode(),
                                    headers={'Authorization': 'Bearer ' + state['secret']})
    with urllib.request.urlopen(request, timeout=15) as response:
        response.read()
    return state['pid']


def stop_windows_host():
    """An already-exited host has no lifecycle endpoint to stop. A live PID
    still requires successful shutdown; a network error never means idle."""
    state = read_json(BASE / 'running.json')
    old_pid = state['pid']
    if alive(old_pid):
        old_pid = lifecycle('stop')
        deadline = time.monotonic() + 30
        while alive(old_pid) and time.monotonic() < deadline:
            time.sleep(0.5)
        if alive(old_pid):
            raise RuntimeError('Old host did not stop; service paths left unchanged')
    return state['port']


def prepare_posix_node(runtime):
    source = runtime / 'bin/node'
    engine = BASE / 'engine'
    node = engine / 'node'
    expected = digest(source)
    if node.exists() and digest(node) == expected:
        return node
    engine.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd, staged_path = tempfile.mkstemp(prefix='node-', suffix='.tmp', dir=engine)
    os.close(fd)
    staged = pathlib.Path(staged_path)
    try:
        shutil.copyfile(source, staged)
        if digest(staged) != expected:
            raise RuntimeError('The staged host engine checksum changed')
        staged.chmod(0o700)
        os.replace(staged, node)
    finally:
        staged.unlink(missing_ok=True)
    return node

def host_install(release, manifest, report):
    source = release / 'host'
    verify_tree(source, manifest['hostHashes'])
    runtime = safe_child(BASE / 'runtime', manifest['version'] + '-' + manifest['platform'] + '-' + manifest['id'])
    if runtime.exists():
        verify_tree(runtime, manifest['hostHashes'])
    else:
        shutil.copytree(source, runtime)
    if not (BASE / 'host.db').exists():
        # A fresh, independent product has no previous database to read. Never
        # reinterpret a missing DB for an existing installation as idle.
        if any((BASE / name).exists() for name in ('runtime-path', 'running.json', 'service.ps1')):
            raise RuntimeError('Existing bycoda host database is missing; installation requires recovery')
        launcher = PRODUCT_IDENTITY['hostLauncher'] + ('.cmd' if os.name == 'nt' else '')
        (BASE / 'bin').mkdir(parents=True, exist_ok=True)
        if os.name == 'nt':
            content = '@echo off\r\nsetlocal DisableDelayedExpansion\r\n"'+str(runtime/'node.exe')+'" "'+str(runtime/'host.mjs')+'" %*\r\nexit /b %errorlevel%\r\n'
        else:
            import shlex
            content = '#!/bin/sh\nexec ' + shlex.quote(str(runtime/'bin/node')) + ' ' + shlex.quote(str(runtime/'host.mjs')) + ' "$@"\n'
        (BASE / 'bin' / launcher).write_text(content, encoding='utf-8')
        if os.name != 'nt':
            (BASE / 'bin' / launcher).chmod(0o755)
        (BASE / 'runtime-path').write_text(str(runtime)+'\n', encoding='utf-8')
        node = runtime / ('node.exe' if os.name == 'nt' else 'bin/node')
        run([str(node), str(runtime/'host.mjs'), 'service', 'install', '--data-dir', str(BASE),
             '--port', str(PRODUCT_IDENTITY['hostPort'])])
        verify_host(runtime)
        report('installed', runtime=str(runtime), firstInstall=True,
               **installed_identity(manifest, runtime / 'bycoda-host.mjs', host=True))
        return
    wait_idle(BASE / 'host.db', "select count(*) from sessions where status='running' or shell_running=1", report)
    rollback = release / 'rollback-host'
    rollback.mkdir(exist_ok=True)
    backup(BASE / 'host.db', rollback / 'host.db')
    configs = [BASE / 'runtime-path']
    if os.name == 'nt':
        configs += [BASE / 'service.ps1', BASE / 'bin/bycoda-host.cmd']
    else:
        configs += [pathlib.Path.home() / 'Library/LaunchAgents/com.bycoda.host.plist']
    for path in configs:
        shutil.copy2(path, rollback / path.name)
    previous = (BASE / 'runtime-path').read_text(encoding='utf-8-sig').strip()
    report('installing', runtime=str(runtime))
    if os.name == 'nt':
        # Use the new CLI's graceful shutdown + owned launcher-tree cleanup.
        # A legacy host can have removed running.json but still hold host.log.
        try:
            port = read_json(BASE / 'running.json')['port']
        except FileNotFoundError:
            service = (BASE / 'service.ps1').read_text(encoding='utf-8-sig')
            match = re.search(r"--port'?\s+'?(\d+)", service)
            if not match:
                raise RuntimeError('Cannot recover the installed host port')
            port = int(match.group(1))
        node = runtime / 'node.exe'
        entry = runtime / 'host.mjs'
        run([str(node), str(entry), 'service', 'uninstall', '--data-dir', str(BASE)])
        try:
            run([str(node), str(entry), 'service', 'install', '--data-dir', str(BASE), '--port', str(port)])
            verify_host(runtime)
            for path in configs:
                if path.name == 'runtime-path':
                    path.write_text(str(runtime)+'\n', encoding='utf-8')
                elif path.name == 'bycoda-host.cmd':
                    content = '@echo off\r\nsetlocal DisableDelayedExpansion\r\n"'+str(runtime/'node.exe')+'" "'+str(runtime/'host.mjs')+'" %*\r\nexit /b %errorlevel%\r\n'
                    path.write_text(content, encoding='utf-8')
        except Exception:
            run([str(node), str(entry), 'service', 'uninstall', '--data-dir', str(BASE)])
            for path in configs:
                shutil.copy2(rollback / path.name, path)
            run([str(pathlib.Path(previous)/'node.exe'), str(pathlib.Path(previous)/'host.mjs'),
                 'service', 'install', '--data-dir', str(BASE), '--port', str(port)])
            raise
    else:
        plist = configs[-1]
        with plist.open('rb') as f:
            config = plistlib.load(f)
        # The executable now lives outside the versioned package. Derive the
        # previous package from host.mjs, never from engine/node.
        actual_previous = str(pathlib.Path(config['ProgramArguments'][1]).parent)
        config['ProgramArguments'] = [arg.replace(actual_previous, str(runtime)) for arg in config['ProgramArguments']]
        config['EnvironmentVariables']['PATH'] = config['EnvironmentVariables']['PATH'].replace(actual_previous, str(runtime))
        domain = f'gui/{os.getuid()}'
        run(['launchctl', 'bootout', domain, str(plist)])
        try:
            config['ProgramArguments'][0] = str(prepare_posix_node(runtime))
            with plist.open('wb') as f:
                plistlib.dump(config, f)
            (BASE / 'runtime-path').write_text(str(runtime)+'\n')
            run(['launchctl', 'bootstrap', domain, str(plist)])
            verify_host(runtime)
        except Exception:
            try:
                run(['launchctl', 'bootout', domain, str(plist)])
            except Exception:
                pass
            for path in configs:
                shutil.copy2(rollback / path.name, path)
            # A legacy plist may still point at its packaged Node. Restoring the
            # engine is required when the previous plist used the stable path.
            with plist.open('rb') as f:
                restored = plistlib.load(f)
            if restored['ProgramArguments'][0] == str(BASE / 'engine/node'):
                prepare_posix_node(pathlib.Path(previous))
            run(['launchctl', 'bootstrap', domain, str(plist)])
            raise
    report('installed', runtime=str(runtime), **installed_identity(manifest, runtime / 'bycoda-host.mjs', host=True))

def installed_identity(manifest, binary, host=False):
    """An observed executable receipt; no credentials or runtime authentication."""
    result = {'binaryPath': str(binary.resolve()),
              'binaryHash': digest(binary) if host or os.name != 'nt' else windows_binary_digest(binary),
              'binaryHashKind': 'sha256' if host or os.name != 'nt' else 'tauri-normalized-sha256'}
    if manifest.get('buildIdentity'):
        result['buildIdentity'] = manifest['buildIdentity']
    return result

def verify_windows_host_process(runtime, pid):
    path = ps(f'(Get-Process -Id {pid}).Path')
    executable = pathlib.Path(path).resolve()
    # Archived packages still launch their own Node. New hosts retain a stable
    # firewall identity, but must run the selected package with matching bytes.
    if executable not in ((runtime / 'node.exe').resolve(),
                          (BASE / 'engine/node.exe').resolve()):
        raise RuntimeError('Unexpected host runtime process')
    if digest(executable) != digest(runtime / 'node.exe'):
        raise RuntimeError('Unexpected host Node engine checksum')
    command = ps(f'(Get-CimInstance Win32_Process -Filter "ProcessId = {pid}").CommandLine')
    entry = re.escape(str(runtime / 'host.mjs'))
    if not re.search(r'(?:^|\s)(?:"' + entry + r'"|' + entry + r')(?=\s|$)',
                     command, re.IGNORECASE):
        raise RuntimeError('Unexpected host entry point')


def verify_host(runtime):
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        try:
            pid = lifecycle('status')
            if not alive(pid):
                raise RuntimeError('Host PID exited')
            if os.name == 'nt':
                verify_windows_host_process(runtime, pid)
            else:
                command = run(['ps', '-p', str(pid), '-o', 'command='])
                if str(runtime / 'host.mjs') not in command:
                    raise RuntimeError('Unexpected host runtime process')
            if count(BASE / 'host.db', 'pragma quick_check') != 'ok':
                raise RuntimeError('Host database integrity check failed')
            return
        except Exception:
            time.sleep(1)
    raise RuntimeError('New host did not pass runtime/health/database checks')

def app_install(release, manifest, report):
    windows = os.name == 'nt'
    app = (pathlib.Path(os.environ['LOCALAPPDATA']) / PRODUCT_IDENTITY['productName'] /
           (PRODUCT_IDENTITY['binaryName']+'.exe') if windows else
           MAC_APPLICATIONS/(PRODUCT_IDENTITY['productName']+'.app'))
    first_install = not app.exists()
    has_database = desktop_db().exists()
    if app.exists() and not desktop_db().exists():
        raise RuntimeError('Existing bycoda desktop database is missing; installation requires recovery')
    verify_tree(release if windows else release / (PRODUCT_IDENTITY['productName']+'.app'), manifest['appHashes'])
    # Give the turn scheduling this update time to persist its final reply.
    time.sleep(30)
    if has_database:
        wait_idle(desktop_db(), 'select count(*) from in_flight_sessions', report)
    rollback = release / 'rollback-app'
    rollback.mkdir(exist_ok=True)
    if has_database:
        if (rollback / 'desktop.db').exists():
            verify_desktop_backup(rollback / 'desktop.db')
        else:
            backup(desktop_db(), rollback / 'desktop.db')
    report('installing')
    if windows:
        app = pathlib.Path(os.environ['LOCALAPPDATA']) / PRODUCT_IDENTITY['productName']/(PRODUCT_IDENTITY['binaryName']+'.exe')
        saved = rollback / 'installation'
        previous_hashes, already_installed = windows_app_snapshot(app, rollback, manifest)
        if already_installed:
            report('installed', version=manifest['version'], **installed_identity(manifest, app))
            return
        app_q = ps_quote(app)
        process_filter = windows_app_process_filter(app)
        was_running = ps('@(' + process_filter + ').Count') != '0'
        ps(process_filter + ' | ForEach-Object { [void]$_.CloseMainWindow() }')
        time.sleep(5)
        if has_database and count(desktop_db(), 'select count(*) from in_flight_sessions') != 0:
            raise RuntimeError('A new turn started; app installation canceled')
        # Close-to-tray retains an idle process; only terminate the known app path.
        ps(process_filter + ' | Stop-Process -Force -PassThru | Wait-Process -Timeout 30')
        try:
            run([str(release / 'setup.exe'), '/S'], timeout=180)
            version = ps(f'(Get-Item -LiteralPath {app_q}).VersionInfo.ProductVersion')
            if version != manifest['version'] or windows_binary_digest(app) != manifest['binaryHash']:
                raise RuntimeError('Installed Windows executable version/hash mismatch')
            ps(f'Start-Process -FilePath {app_q}')
        except Exception as install_error:
            if not first_install:
                try:
                    restore_windows_app(app, saved, previous_hashes, rollback, process_filter)
                    if was_running:
                        ps(f'Start-Process -FilePath {app_q}')
                except Exception as recovery_error:
                    raise RuntimeError('Windows update failed and rollback requires recovery: ' + str(recovery_error)) from install_error
            raise
    else:
        saved, staged = mac_app_update_paths(app, manifest['id'])
        if saved.exists() or staged.exists():
            raise RuntimeError('Rollback/staging app already exists; refusing overwrite')
        run(['codesign', '--verify', '--deep', '--strict', str(release / (PRODUCT_IDENTITY['productName']+'.app'))])
        run(['ditto', str(release / (PRODUCT_IDENTITY['productName']+'.app')), str(staged)])
        if not first_install:
            run(['osascript', '-e', f'tell application "{PRODUCT_IDENTITY["productName"]}" to quit'])
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline:
            try:
                run(['pgrep', '-f', re.escape(str(app/'Contents/MacOS'/PRODUCT_IDENTITY['binaryName']))])
            except Exception:
                break
            time.sleep(1)
        else:
            raise RuntimeError('App did not quit; installation canceled')
        if has_database and count(desktop_db(), 'select count(*) from in_flight_sessions') != 0:
            raise RuntimeError('A new turn started; app installation canceled')
        if not first_install:
            app.rename(saved)
        try:
            staged.rename(app)
            run(['codesign', '--verify', '--deep', '--strict', str(app)])
            with (app / 'Contents/Info.plist').open('rb') as f:
                if plistlib.load(f)['CFBundleShortVersionString'] != manifest['version']:
                    raise RuntimeError('Installed bundle version mismatch')
            if digest(app / 'Contents/MacOS' / PRODUCT_IDENTITY['binaryName']) != manifest['binaryHash']:
                raise RuntimeError('Installed Mac executable hash mismatch')
        except Exception:
            if app.exists():
                app.rename(staged)
            if not first_install:
                saved.rename(app)
                run(['open', '-a', str(app)])
            raise
        run(['open', '-a', str(app)])
    binary = app if windows else app / 'Contents/MacOS' / PRODUCT_IDENTITY['binaryName']
    report('installed', version=manifest['version'], **installed_identity(manifest, binary))

def main(launch_key=None):
    manifest_path = pathlib.Path(sys.argv[1]).resolve()
    release = manifest_path.parent
    manifest = read_json(manifest_path)
    package_identity(manifest)
    if not re.fullmatch(r'[a-f0-9]{16,20}-(local|release)(-\d+)?', manifest['id']) or not re.fullmatch(r'\d+\.\d+\.\d+', manifest['version']):
        raise ValueError('Invalid package id/version')
    component = sys.argv[2]
    if component not in ('host', 'app'):
        raise ValueError('Unknown install component')
    record = BASE / 'update-jobs' / (component + '.json')
    def report(state, **values):
        message = {'pid': os.getpid(), 'id': manifest['id'], 'state': state, 'time': time.time(), **values}
        if launch_key is not None:
            message['launchKey'] = launch_key
        write_json(record, message)
        print(json.dumps(message), flush=True)
    with lock(BASE / 'update-jobs' / (component + '.lock')):
        try:
            report('starting')
            (host_install if component == 'host' else app_install)(release, manifest, report)
        except Exception as error:
            # Never print auth state or arbitrary subprocess output.
            report('failed', errorType=type(error).__name__, error=str(error) if not hasattr(error, 'cmd') else 'Command failed; see local stage logs')
            raise SystemExit(1)

def wait_broker_launch(receipt, launch_key, seconds=15):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        try:
            state = read_json(receipt)
            if state.get('pid') == os.getpid() and state.get('launchKey') == launch_key and state.get('verified') is True:
                return
        except (OSError, ValueError):
            pass
        time.sleep(.05)
    raise RuntimeError('Updater broker launch was not verified; installation did not start')

if __name__ == '__main__':
    if len(sys.argv) in (5, 9) and sys.argv[3] == '--log':
        expected = pathlib.Path(sys.argv[1]).resolve().parent / ('install-' + sys.argv[2] + '.log')
        if sys.argv[2] not in ('host', 'app') or pathlib.Path(sys.argv[4]).resolve() != expected:
            raise ValueError('Invalid updater log target')
        # A broker cannot inherit the coordinator's redirected standard handles.
        # Own the log for the entire helper lifetime, including startup failures.
        with open(os.devnull, 'r') as source, expected.open('a', encoding='utf-8', buffering=1) as output:
            sys.stdin = source
            with contextlib.redirect_stdout(output), contextlib.redirect_stderr(output):
                try:
                    if len(sys.argv) == 9:
                        receipt = expected.parent / ('launch-' + sys.argv[2] + '.json')
                        if sys.argv[5] != '--broker-receipt' or pathlib.Path(sys.argv[6]).resolve() != receipt or sys.argv[7] != '--broker-key' or not re.fullmatch('[a-f0-9]{32}', sys.argv[8]):
                            raise ValueError('Invalid updater launch receipt')
                        wait_broker_launch(receipt, sys.argv[8])
                    main(sys.argv[8] if len(sys.argv) == 9 else None)
                except Exception:
                    traceback.print_exc()
                    raise SystemExit(1)
    elif len(sys.argv) == 3:
        main()
    else:
        raise ValueError('Invalid updater arguments')
