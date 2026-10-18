"""Idle-only host/app installation. Spawned headlessly by local_update.py."""
import json
import os
import pathlib
import plistlib
import re
import shutil
import sys
import time
import urllib.request

from local_update_lib import (alive, backup, count, digest, lock, ps, ps_quote,
                              read_json, run, safe_child, verify_tree, write_json, windows_binary_digest, PRODUCT_IDENTITY, package_identity)

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
        report('installed', runtime=str(runtime), firstInstall=True)
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
        actual_previous = str(pathlib.Path(config['ProgramArguments'][0]).parent.parent)
        config['ProgramArguments'] = [arg.replace(actual_previous, str(runtime)) for arg in config['ProgramArguments']]
        config['EnvironmentVariables']['PATH'] = config['EnvironmentVariables']['PATH'].replace(actual_previous, str(runtime))
        domain = f'gui/{os.getuid()}'
        run(['launchctl', 'bootout', domain, str(plist)])
        try:
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
            run(['launchctl', 'bootstrap', domain, str(plist)])
            raise
    report('installed', runtime=str(runtime))

def verify_host(runtime):
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        try:
            pid = lifecycle('status')
            if not alive(pid):
                raise RuntimeError('Host PID exited')
            if os.name == 'nt':
                path = ps(f'(Get-Process -Id {pid}).Path')
                if pathlib.Path(path).resolve() != (runtime / 'node.exe').resolve():
                    raise RuntimeError('Unexpected host runtime process')
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
        backup(desktop_db(), rollback / 'desktop.db')
    report('installing')
    if windows:
        app = pathlib.Path(os.environ['LOCALAPPDATA']) / PRODUCT_IDENTITY['productName']/(PRODUCT_IDENTITY['binaryName']+'.exe')
        if not first_install:
            shutil.copy2(app, rollback / 'bycoda.exe')
        app_q = ps_quote(app)
        process_filter = windows_app_process_filter(app)
        ps(process_filter + ' | ForEach-Object { [void]$_.CloseMainWindow() }')
        time.sleep(5)
        if has_database and count(desktop_db(), 'select count(*) from in_flight_sessions') != 0:
            raise RuntimeError('A new turn started; app installation canceled')
        # Close-to-tray retains an idle process; only terminate the known app path.
        ps(process_filter + ' | Stop-Process -Force')
        run([str(release / 'setup.exe'), '/S'], timeout=180)
        version = ps(f'(Get-Item -LiteralPath {app_q}).VersionInfo.ProductVersion')
        if version != manifest['version'] or windows_binary_digest(app) != manifest['binaryHash']:
            raise RuntimeError('Installed Windows executable version/hash mismatch; rollback EXE retained')
        ps(f'Start-Process -FilePath {app_q}')
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
    report('installed', version=manifest['version'])

def main():
    manifest_path = pathlib.Path(sys.argv[1]).resolve()
    release = manifest_path.parent
    manifest = read_json(manifest_path)
    package_identity(manifest)
    if not re.fullmatch(r'[a-f0-9]{16}-(local|release)(-\d+)?', manifest['id']) or not re.fullmatch(r'\d+\.\d+\.\d+', manifest['version']):
        raise ValueError('Invalid package id/version')
    component = sys.argv[2]
    if component not in ('host', 'app'):
        raise ValueError('Unknown install component')
    record = BASE / 'update-jobs' / (component + '.json')
    def report(state, **values):
        message = {'pid': os.getpid(), 'id': manifest['id'], 'state': state, 'time': time.time(), **values}
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

if __name__ == '__main__':
    main()
