"""No live build/install/SSH or app/provider stop. Windows job fixture owns its test children."""
import io
import os
from contextlib import closing
import json
import pathlib
import plistlib
import shutil
import sqlite3
import subprocess
import sys
import tarfile
import tempfile
import time
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from local_update import UPDATER_FEED, archive_package, dependency_action, dependency_key, fingerprint, sync_source, queue_install, validate_versions, validate_product_identity, finish_build, host_key, install_job_active, snapshot, bundled_host_key, worker
from local_update_lib import backup, count, safe_child, write_json, read_json, alive, digest, windows_binary_digest, PRODUCT_IDENTITY, package_identity
from local_install import wait_idle, stop_windows_host, host_install, verify_windows_host_process
from local_install import app_install, windows_app_process_filter, desktop_db, mac_app_update_paths
from local_install import windows_app_snapshot
from local_install import verify_desktop_backup, wait_broker_launch
from local_update import install_job_status, git_identity, stamp_build_identity, inputs
from local_install import installed_identity
from local_update_lib import spawn_windows_updater, tree_hashes, UpdaterLaunchRefused, windows_installer_idle

class LocalUpdateTests(unittest.TestCase):
    def git_fixture(self, root):
        options = {'creationflags': subprocess.CREATE_NO_WINDOW} if os.name == 'nt' else {}
        def git(*args):
            return subprocess.run(['git', *args], cwd=root, check=True, capture_output=True,
                                  text=True, **options).stdout.strip()
        git('init', '-b', 'main')
        git('config', 'user.email', 'fixture@example.invalid')
        git('config', 'user.name', 'Fixture')
        (root / '.gitignore').write_text('state/\nsecret.txt\n')
        (root / 'package.json').write_text('{"version":"0.1.0"}')
        (root / 'source.ts').write_text('original')
        git('add', '.')
        git('commit', '-m', 'Fixture')
        return git

    def test_worktree_git_metadata_and_local_sources_use_common_git_directory(self):
        with tempfile.TemporaryDirectory() as folder:
            root = pathlib.Path(folder) / 'repo'
            root.mkdir()
            git = self.git_fixture(root)
            worktree = pathlib.Path(folder) / 'worktree'
            git('worktree', 'add', '-b', 'work', str(worktree))
            self.assertTrue((worktree / '.git').is_file())
            (root / '.git/info/local-build-sources').write_text('secret.txt\n')
            (worktree / 'secret.txt').write_text('fixture explicitly opted in')
            self.assertIn('secret.txt', inputs(worktree))
            self.assertEqual(git_identity(root)['repositoryId'], git_identity(worktree)['repositoryId'])
            self.assertEqual(git_identity(worktree)['branch'], 'work')

    def test_frozen_identity_matches_real_dirty_bytes_and_reuses_immutable_stamp(self):
        with tempfile.TemporaryDirectory() as folder:
            root = pathlib.Path(folder)
            git = self.git_fixture(root)
            git('mv', 'source.ts', 'renamed.ts')
            (root / 'renamed.ts').write_text('dirty frozen bytes')
            (root / ' Türkçe.ts').write_text('unicode source')
            identity = {}
            archive, source = snapshot(root, root / 'state', capture=identity)
            self.assertEqual(identity['sourceFingerprint'], source)
            self.assertEqual(identity['head'], git('rev-parse', 'HEAD'))
            self.assertEqual(identity['schemaVersion'], 1)
            self.assertEqual({row['path'] for row in identity['dirtyPaths']}, {'source.ts', 'renamed.ts', ' Türkçe.ts'})
            again = {}
            snapshot(root, root / 'state', capture=again)
            self.assertEqual(identity, again)
            workspace = root / 'state/source'
            frozen = sync_source(archive, source, workspace)
            path = stamp_build_identity(workspace, {'source': source, 'mode': 'local',
                                        'buildIdentity': identity}, '0.1.0')
            self.assertEqual(read_json(path), identity)
            self.assertEqual(fingerprint(frozen), identity['sourceFingerprint'])
            self.assertEqual(frozen['renamed.ts'], b'dirty frozen bytes')
            self.assertNotIn('build/build-info.json', frozen)
            with self.assertRaisesRegex(RuntimeError, 'does not match'):
                stamp_build_identity(workspace, {'source': 'different', 'mode': 'local',
                                     'buildIdentity': identity}, '0.1.0')
            (root / 'renamed.ts').write_text('different same-version source')
            changed = {}
            snapshot(root, root / 'state', capture=changed)
            self.assertNotEqual(identity['buildId'], changed['buildId'])

    def test_source_edit_during_capture_is_rejected_without_identity(self):
        with tempfile.TemporaryDirectory() as folder:
            root = pathlib.Path(folder)
            self.git_fixture(root)
            real_inputs = inputs
            calls = 0
            def editing_inputs(path):
                nonlocal calls
                result = real_inputs(path)
                calls += 1
                if calls == 1:
                    (root / 'source.ts').write_text('concurrent writer')
                return result
            identity = {}
            with patch('local_update.inputs', side_effect=editing_inputs):
                with self.assertRaisesRegex(RuntimeError, 'Source changed during freeze'):
                    snapshot(root, root / 'state', capture=identity)
            self.assertEqual(identity, {})

    def test_installed_receipt_binds_manifest_to_observed_binary_without_auth(self):
        with tempfile.TemporaryDirectory() as folder:
            binary = pathlib.Path(folder) / 'bycoda-host.mjs'
            binary.write_bytes(b'fixture package')
            identity = {'buildId': 'fixture'}
            receipt = installed_identity({'buildIdentity': identity}, binary, host=True)
            self.assertEqual(receipt, {'buildIdentity': identity, 'binaryPath': str(binary.resolve()),
                                      'binaryHash': digest(binary), 'binaryHashKind': 'sha256'})
            self.assertNotIn('buildIdentity', installed_identity({}, binary, host=True))

    def test_archived_package_name_carries_build_identity(self):
        with tempfile.TemporaryDirectory() as folder:
            root = pathlib.Path(folder)
            setup = root / 'setup.exe'
            setup.write_bytes(b'fixture')
            target = archive_package(root, setup, '0.1.0', True, today='2026-10-26',
                                     build_id='01234567890123456789-local')
            self.assertIn('_01234567890123456789-local_', target.name)
            with self.assertRaisesRegex(ValueError, 'Invalid build identity'):
                archive_package(root, setup, '0.1.0', True, build_id='../unsafe')

    def test_dead_helper_does_not_allow_a_still_running_installer_or_unknown_nsis_child(self):
        release = pathlib.Path('C:/build/run')
        app = pathlib.Path('C:/local/bycoda/bycoda.exe')
        normal = {'ProcessId': 1, 'ParentProcessId': 0, 'Name': 'other.exe', 'ExecutablePath': 'C:/other.exe', 'CommandLine': 'other.exe'}
        windows_installer_idle([normal], release, app, 900)
        for candidate in (
            {**normal, 'ExecutablePath': 'C:/build/run/setup.exe'},
            {**normal, 'ExecutablePath': 'C:/local/bycoda/uninstall.exe'},
            {**normal, 'ParentProcessId': 900},
            {**normal, 'Name': 'Au_.exe', 'ExecutablePath': 'C:/Temp/nsF3B.tmp/Au_.exe'},
            {**normal, 'Name': 'setup.exe', 'ExecutablePath': None, 'CommandLine': None},
            {**normal, 'Name': 'bycoda_0.6.75_x64-setup.exe'},
        ):
            with self.subTest(candidate=candidate), self.assertRaisesRegex(RuntimeError, 'still running or ambiguous'):
                windows_installer_idle([candidate], release, app, 900)
        with self.assertRaisesRegex(RuntimeError, 'Cannot verify'):
            windows_installer_idle([{}], release, app)

    @unittest.skipUnless(os.name == 'nt', 'Windows unknown launch recovery')
    def test_windows_launch_failure_preserves_child_state_and_blocks_unknown_retry(self):
        for outcome in ('child', 'unknown', 'refused'):
            with self.subTest(outcome=outcome), tempfile.TemporaryDirectory() as folder:
                root = pathlib.Path(folder)
                release = root / 'release'
                release.mkdir()
                write_json(release / 'manifest.json', {'id': 'same', 'identity': dict(PRODUCT_IDENTITY)})
                record = root / '.bycoda-host/update-jobs/app.json'
                def launch(args, cwd, receipt, launch_key):
                    if outcome == 'child':
                        write_json(record, {'id': 'same', 'pid': 123, 'state': 'waiting', 'launchKey': launch_key})
                    if outcome == 'refused':
                        raise UpdaterLaunchRefused('known refusal')
                    raise RuntimeError('unknown verification outcome')
                with patch('local_update.pathlib.Path.home', return_value=root), \
                     patch('local_update.alive', return_value=True), \
                     patch('local_update.spawn_windows_updater', side_effect=launch) as broker:
                    with self.assertRaises(RuntimeError):
                        queue_install(release, ('app',))
                    current = install_job_status(read_json(record))
                    self.assertEqual(current['state'], {'child': 'waiting', 'unknown': 'launch-unknown', 'refused': 'failed'}[outcome])
                    if outcome == 'child':
                        self.assertEqual(current['pid'], 123)
                    if outcome == 'unknown':
                        with self.assertRaisesRegex(RuntimeError, 'outcome is unknown'):
                            queue_install(release, ('app',))
                        self.assertEqual(broker.call_count, 1)

    @unittest.skipUnless(os.name == 'nt', 'Windows late publication reconciliation')
    def test_launch_exception_sidecar_cannot_overwrite_a_late_completed_helper_report(self):
        with tempfile.TemporaryDirectory() as folder:
            root = pathlib.Path(folder)
            release = root / 'release'
            release.mkdir()
            record = root / '.bycoda-host/update-jobs/app.json'
            write_json(release / 'manifest.json', {'id': 'same', 'identity': dict(PRODUCT_IDENTITY)})
            def publish(path, value):
                if path.name.endswith('.error.json'):
                    write_json(record, {'id': 'same', 'pid': 123, 'state': 'installed'})
                write_json(path, value)
            with patch('local_update.pathlib.Path.home', return_value=root), \
                 patch('local_update.write_json', side_effect=publish), \
                 patch('local_update.spawn_windows_updater', side_effect=RuntimeError('verification timed out')):
                with self.assertRaisesRegex(RuntimeError, 'timed out'):
                    queue_install(release, ('app',))
            self.assertEqual(read_json(record), {'id': 'same', 'pid': 123, 'state': 'installed'})

    def test_status_uses_only_the_current_attempt_receipt_before_first_helper_report(self):
        with tempfile.TemporaryDirectory() as folder:
            root = pathlib.Path(folder)
            receipt = root / 'launch-app.json'
            launch_key = 'a' * 32
            record = {'state': 'launching', 'pid': None, 'launchKey': launch_key,
                      'launchReceipt': str(receipt), 'component': 'app', 'releaseDirectory': str(root)}
            write_json(receipt, {'pid': 123, 'verified': True, 'launchKey': 'b' * 32})
            self.assertIsNone(install_job_status(record)['pid'])
            self.assertTrue(install_job_active(record))
            write_json(receipt, {'pid': 123, 'verified': True, 'launchKey': launch_key})
            with patch('local_update.alive', return_value=False):
                projected = install_job_status(record)
                self.assertEqual(projected['pid'], 123)
                self.assertEqual(projected['state'], 'interrupted')
                self.assertFalse(install_job_active(record))
            with patch('local_update.alive', return_value=True):
                self.assertTrue(install_job_active(record))
            self.assertIsNone(record['pid'])

    def test_helper_launch_handshake_requires_matching_pid_key_and_verification(self):
        with tempfile.TemporaryDirectory() as folder:
            receipt = pathlib.Path(folder) / 'launch-app.json'
            write_json(receipt, {'pid': os.getpid(), 'launchKey': 'a' * 32, 'verified': True})
            wait_broker_launch(receipt, 'a' * 32)
            for state in ({'pid': os.getpid(), 'launchKey': 'b' * 32, 'verified': True},
                          {'pid': os.getpid(), 'launchKey': 'a' * 32, 'verified': False}):
                write_json(receipt, state)
                with self.assertRaisesRegex(RuntimeError, 'installation did not start'):
                    wait_broker_launch(receipt, 'a' * 32, seconds=0)

    def test_headless_helper_owns_its_log_for_startup_validation_failure(self):
        with tempfile.TemporaryDirectory() as folder:
            root = pathlib.Path(folder)
            manifest = root / 'manifest.json'
            write_json(manifest, {'id': 'invalid', 'version': '0.6.75', 'identity': dict(PRODUCT_IDENTITY)})
            log = root / 'install-app.log'
            options = {'creationflags': subprocess.CREATE_NO_WINDOW} if os.name == 'nt' else {}
            result = subprocess.run([sys.executable, '-B', str(pathlib.Path(__file__).with_name('local_install.py')),
                                     str(manifest), 'app', '--log', str(log)], capture_output=True, **options)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('Invalid package id/version', log.read_text())

    @unittest.skipUnless(os.name == 'nt', 'Real isolated Windows job lifetime')
    def test_windows_broker_survives_kill_on_close_job(self):
        import ctypes
        import _winapi
        from ctypes import wintypes
        class Limits(ctypes.Structure):
            _fields_ = [('processTime', ctypes.c_int64), ('jobTime', ctypes.c_int64),
                        ('flags', wintypes.DWORD), ('minimum', ctypes.c_size_t),
                        ('maximum', ctypes.c_size_t), ('count', wintypes.DWORD),
                        ('affinity', ctypes.c_size_t), ('priority', wintypes.DWORD),
                        ('scheduling', wintypes.DWORD)]
        class ExtendedLimits(ctypes.Structure):
            _fields_ = [('basic', Limits), ('io', ctypes.c_uint64 * 6),
                        ('processMemory', ctypes.c_size_t), ('jobMemory', ctypes.c_size_t),
                        ('peakProcess', ctypes.c_size_t), ('peakJob', ctypes.c_size_t)]
        kernel = ctypes.WinDLL('kernel32', use_last_error=True)
        kernel.CreateJobObjectW.argtypes = [ctypes.c_void_p, wintypes.LPCWSTR]
        kernel.CreateJobObjectW.restype = wintypes.HANDLE
        kernel.SetInformationJobObject.argtypes = [wintypes.HANDLE, ctypes.c_int, ctypes.c_void_p, wintypes.DWORD]
        kernel.AssignProcessToJobObject.argtypes = [wintypes.HANDLE, wintypes.HANDLE]
        kernel.ResumeThread.argtypes = [wintypes.HANDLE]
        kernel.OpenProcess.argtypes = [wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
        kernel.OpenProcess.restype = wintypes.HANDLE
        kernel.IsProcessInJob.argtypes = [wintypes.HANDLE, wintypes.HANDLE, ctypes.POINTER(wintypes.BOOL)]
        kernel.CloseHandle.argtypes = [wintypes.HANDLE]
        with tempfile.TemporaryDirectory() as folder:
            root = pathlib.Path(folder)
            library = str(pathlib.Path(__file__).resolve().parent)
            leaf_start = (
                'import ctypes,os,pathlib,time,json,subprocess,sys;from ctypes import wintypes;'
                'k=ctypes.WinDLL("kernel32");k.GetConsoleWindow.restype=ctypes.c_void_p;'
                'k.GetCurrentProcess.restype=wintypes.HANDLE;'
                'a=ctypes.WinDLL("advapi32");a.OpenProcessToken.argtypes=[wintypes.HANDLE,wintypes.DWORD,ctypes.POINTER(wintypes.HANDLE)];'
                'token=wintypes.HANDLE();assert a.OpenProcessToken(k.GetCurrentProcess(),8,ctypes.byref(token));'
                'e=wintypes.DWORD();n=wintypes.DWORD();assert a.GetTokenInformation(token,20,ctypes.byref(e),4,ctypes.byref(n));'
                'p=pathlib.Path(' + repr(str(root)) + ');'
                'p.joinpath(str(os.getpid())+".ready").write_text(json.dumps({"console":k.GetConsoleWindow() or 0,"elevated":bool(e.value)}));'
                'deadline=time.monotonic()+30;'
            )
            descendant = leaf_start + (
                '\nwhile not p.joinpath("finish").exists() and time.monotonic()<deadline: time.sleep(.02)'
            )
            leaf = leaf_start + 'spawned=False;childCode=' + repr(descendant) + (
                '\nwhile not p.joinpath("finish").exists() and time.monotonic()<deadline:'
                '\n if p.joinpath("restart").exists() and not spawned:'
                '\n  child=subprocess.Popen([sys.executable,"-B","-c",childCode],creationflags=subprocess.CREATE_NO_WINDOW);spawned=True;'
                'p.joinpath("descendant.pid").write_text(str(child.pid))'
                '\n time.sleep(.02)'
            )
            root_code = (
                'import json,pathlib,subprocess,sys,time;'
                'sys.stdout=open(' + repr(str(root / 'parent.log')) + ',"w",buffering=1);sys.stderr=sys.stdout;'
                'sys.path.insert(0,' + repr(library) + ');'
                'from local_update_lib import spawn_windows_updater;'
                'p=pathlib.Path(' + repr(str(root)) + ');'
                'args=[sys.executable,"-B","-c",' + repr(leaf) + '];'
                'direct=subprocess.Popen(args,creationflags=subprocess.CREATE_NO_WINDOW);'
                '\ntry:\n broker=spawn_windows_updater(args,p)\n'
                'except subprocess.CalledProcessError as error:\n print(error.stderr,flush=True)\n raise\n'
                'p.joinpath("pids.json").write_text(json.dumps({"direct":direct.pid,"broker":broker}));'
                'time.sleep(30)'
            )
            job = kernel.CreateJobObjectW(None, None)
            self.assertTrue(job)
            limits = ExtendedLimits()
            limits.basic.flags = 0x2000  # JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE, no breakaway.
            self.assertTrue(kernel.SetInformationJobObject(job, 9, ctypes.byref(limits), ctypes.sizeof(limits)))
            process = thread = None
            handles = []
            try:
                process, thread, pid, _ = _winapi.CreateProcess(
                    sys.executable, subprocess.list2cmdline([sys.executable, '-B', '-c', root_code]),
                    None, None, False, subprocess.CREATE_NO_WINDOW | 4, None, str(root), subprocess.STARTUPINFO())
                self.assertTrue(kernel.AssignProcessToJobObject(job, process))
                self.assertNotEqual(kernel.ResumeThread(thread), -1)
                _winapi.CloseHandle(thread)
                thread = None
                deadline = time.monotonic() + 20
                while not (root / 'pids.json').exists():
                    self.assertEqual(_winapi.WaitForSingleObject(process, 0), 258,
                                     (root / 'parent.log').read_text() if (root / 'parent.log').exists() else 'Isolated job parent exited before broker launch')
                    self.assertLess(time.monotonic(), deadline, 'Broker launch timed out')
                    time.sleep(.02)
                pids = read_json(root / 'pids.json')
                elevations = []
                for name in ('direct', 'broker'):
                    while not (root / (str(pids[name]) + '.ready')).exists():
                        self.assertLess(time.monotonic(), deadline, 'Marker child did not start')
                        time.sleep(.02)
                    handle = kernel.OpenProcess(0x100000 | 0x1000, False, pids[name])
                    self.assertTrue(handle)
                    handles.append(handle)
                    member = wintypes.BOOL()
                    self.assertTrue(kernel.IsProcessInJob(handle, job, ctypes.byref(member)))
                    self.assertEqual(bool(member.value), name == 'direct')
                    info = read_json(root / (str(pids[name]) + '.ready'))
                    self.assertEqual(info['console'], 0, 'Fixture console must remain hidden')
                    elevations.append(info['elevated'])
                    if name == 'broker':
                        self.assertTrue(kernel.IsProcessInJob(handle, None, ctypes.byref(member)))
                        self.assertFalse(member.value, 'Broker must also escape the WMI provider quota job')
                self.assertEqual(elevations[0], elevations[1], 'Broker must not elevate the caller')
                kernel.CloseHandle(job)
                job = None
                self.assertEqual(_winapi.WaitForSingleObject(process, 5000), 0)
                self.assertEqual(_winapi.WaitForSingleObject(handles[0], 5000), 0)
                self.assertEqual(_winapi.WaitForSingleObject(handles[1], 0), 258, 'Brokered helper died with the managed parent')
                (root / 'restart').touch()
                while not (root / 'descendant.pid').exists():
                    self.assertLess(time.monotonic(), deadline, 'Brokered descendant did not launch')
                    time.sleep(.02)
                descendant_pid = int((root / 'descendant.pid').read_text())
                handle = kernel.OpenProcess(0x100000 | 0x1000, False, descendant_pid)
                self.assertTrue(handle)
                handles.append(handle)
                self.assertTrue(kernel.IsProcessInJob(handle, None, ctypes.byref(member)))
                self.assertFalse(member.value, 'Restarted descendant inherited a job quota')
                (root / 'finish').touch()
                self.assertEqual(_winapi.WaitForSingleObject(handles[1], 5000), 0)
                print(json.dumps({'proof': 'isolated Windows updater lifetime', 'managedParentAndChildStopped': True,
                                  'brokerSurvived': True, 'brokerAndDescendantOutsideAllJobs': True,
                                  'sameElevation': True, 'sameUserAndSessionVerified': True, 'hiddenConsole': True}))
            finally:
                (root / 'finish').touch()
                if job:
                    kernel.CloseHandle(job)
                if process:
                    _winapi.WaitForSingleObject(process, 5000)
                    _winapi.CloseHandle(process)
                if thread:
                    _winapi.CloseHandle(thread)
                for handle in handles:
                    _winapi.WaitForSingleObject(handle, 5000)
                    kernel.CloseHandle(handle)
                for marker in root.glob('*.ready'):
                    handle = kernel.OpenProcess(0x100000, False, int(marker.stem))
                    if handle:
                        _winapi.WaitForSingleObject(handle, 5000)
                        kernel.CloseHandle(handle)

    def test_existing_database_backup_is_verified_without_replacing_corruption(self):
        with tempfile.TemporaryDirectory() as folder:
            path = pathlib.Path(folder) / 'desktop.db'
            for content in (b'', b'partial SQLite backup'):
                path.write_bytes(content)
                with self.assertRaisesRegex(RuntimeError, 'requires recovery'):
                    verify_desktop_backup(path)
                self.assertEqual(path.read_bytes(), content)
            path.unlink()
            with closing(sqlite3.connect(path)) as connection:
                connection.execute('CREATE TABLE in_flight_sessions(id TEXT)')
            with self.assertRaisesRegex(RuntimeError, 'requires recovery'):
                verify_desktop_backup(path)
            with closing(sqlite3.connect(path)) as connection:
                connection.execute('CREATE TABLE sessions(id TEXT)')
            verify_desktop_backup(path)
            with self.assertRaisesRegex(RuntimeError, 'requires recovery'):
                verify_desktop_backup(path, seconds=0)

    def test_job_status_reports_dead_helpers_without_mutating_records(self):
        original = {'state': 'installing', 'pid': 123, 'id': 'same'}
        with patch('local_update.alive', return_value=False):
            self.assertEqual(install_job_status(original), {**original, 'state': 'interrupted',
                             'recordedState': 'installing', 'helperAlive': False})
            self.assertEqual(original['state'], 'installing')
            self.assertEqual(install_job_status({'state': 'launching', 'pid': None}),
                             {'state': 'launching', 'pid': None, 'helperAlive': None})
        with patch('local_update.alive', return_value=True) as alive:
            self.assertTrue(install_job_status(original)['helperAlive'])
            for state in ('installed', 'failed'):
                self.assertEqual(install_job_status({'state': state, 'pid': 123}),
                                 {'state': state, 'pid': 123, 'helperAlive': None})
            self.assertEqual(alive.call_count, 1)

    @unittest.skipUnless(os.name == 'nt', 'Windows broker contract')
    def test_windows_queue_retries_dead_same_package_via_hidden_broker(self):
        with tempfile.TemporaryDirectory() as folder:
            root = pathlib.Path(folder)
            release = root / 'release'
            release.mkdir()
            write_json(release / 'manifest.json', {'id': 'same', 'identity': dict(PRODUCT_IDENTITY)})
            record = root / '.bycoda-host/update-jobs/app.json'
            write_json(record, {'id': 'same', 'pid': 456, 'state': 'installing'})
            def launch(args, cwd, receipt, launch_key):
                self.assertEqual(cwd, release)
                self.assertEqual(args[-6:-4], ['--log', str(release / 'install-app.log')])
                self.assertEqual(args[:3], [sys.executable, '-B', str(release / 'local_install.py')])
                write_json(record, {'id': 'same', 'pid': 123, 'state': 'starting'})
                return 123
            with patch('local_update.pathlib.Path.home', return_value=root), \
                 patch('local_update.alive', return_value=False), \
                 patch('local_update.spawn_windows_updater', side_effect=launch) as broker, \
                 patch('local_update.assert_windows_installer_idle') as installer_guard, \
                 patch('local_update.subprocess.Popen') as direct:
                queue_install(release, ('app',))
            broker.assert_called_once()
            installer_guard.assert_called_once()
            direct.assert_not_called()
            self.assertEqual(read_json(record)['state'], 'starting')
            self.assertEqual(read_json(release / 'launch-app.json')['pid'], 123)

    def test_windows_broker_checks_result_pid_and_current_user_without_elevation(self):
        with patch('local_update_lib.ps', return_value='123') as powershell, \
             patch('local_update_lib.alive', return_value=True):
            self.assertEqual(spawn_windows_updater(['python.exe', "a path's/entry.py", 'app'], "C:/a path's"), 123)
        script = powershell.call_args.args[0]
        self.assertIn('Win32_ProcessStartup', script)
        self.assertIn('ShowWindow=[uint16]0;CreateFlags=[uint32]150994944', script)
        self.assertIn('GetOwnerSid', script)
        self.assertIn('WindowsIdentity]::GetCurrent().User.Value', script)
        self.assertNotIn('RunAs', script)
        for value, running in [('bad', True), ('0', True), ('123', False)]:
            with patch('local_update_lib.ps', return_value=value), patch('local_update_lib.alive', return_value=running):
                with self.assertRaisesRegex(RuntimeError, 'process id|exited'):
                    spawn_windows_updater(['python.exe'], 'C:/fixture')

    def test_interrupted_windows_snapshot_is_reused_only_for_known_installation(self):
        with tempfile.TemporaryDirectory() as folder:
            root = pathlib.Path(folder)
            app = root / 'app/bycoda.exe'
            app.parent.mkdir()
            app.write_bytes(b'old exe-__TAURI_BUNDLE_TYPE_VAR_UNK')
            (app.parent / 'sidecar.dll').write_bytes(b'old sidecar')
            rollback = root / 'rollback'
            rollback.mkdir()
            manifest = {'binaryHash': 'new hash', 'version': '0.6.75'}
            hashes, complete = windows_app_snapshot(app, rollback, manifest)
            before = tree_hashes(rollback)
            self.assertFalse(complete)
            self.assertEqual(windows_app_snapshot(app, rollback, manifest), (hashes, False))
            self.assertEqual(tree_hashes(rollback), before)
            (app.parent / 'sidecar.dll').write_bytes(b'unknown partial installation')
            with self.assertRaisesRegex(RuntimeError, 'unknown installation'):
                windows_app_snapshot(app, rollback, manifest)
            self.assertEqual(tree_hashes(rollback), before)
            with patch('local_install.windows_binary_digest', return_value='new hash'), \
                 patch('local_install.ps', return_value='0.6.75'):
                with self.assertRaisesRegex(RuntimeError, 'unknown installation'):
                    windows_app_snapshot(app, rollback, manifest)
                (app.parent / 'sidecar.dll').unlink()
                with self.assertRaisesRegex(RuntimeError, 'unknown installation'):
                    windows_app_snapshot(app, rollback, manifest)
            (rollback / 'installation/sidecar.dll').write_bytes(b'corrupt backup')
            with self.assertRaisesRegex(RuntimeError, 'integrity'):
                windows_app_snapshot(app, rollback, manifest)

    @unittest.skipUnless(os.name == 'nt', 'Windows worker package layout')
    def test_worker_repackages_changed_host_without_rebuilding_unchanged_web(self):
        with tempfile.TemporaryDirectory() as folder:
            root = pathlib.Path(folder)
            workspace = root / 'source'
            workspace.mkdir()
            files = {'package.json': b'{"packageManager":"pnpm@12.0.0"}',
                     'host/cli.ts': b'old host', 'src-tauri/src/lib.rs': b'unchanged Rust'}
            (workspace / 'package.json').write_bytes(files['package.json'])
            (workspace / 'node_modules').mkdir()
            helpers = workspace / 'scripts/local-update'
            helpers.mkdir(parents=True)
            for name in ('local_update.py', 'local_update_lib.py', 'local_install.py'):
                (helpers / name).write_text('# fixture only')
            source_archive = root / 'source.tar.gz'
            source_archive.write_bytes(b'fixture source archive')
            artifacts = root / 'cargo/release'
            native = artifacts / 'bycoda.exe'
            setup = artifacts / 'bundle/nsis/bycoda_0.0.1_x64-setup.exe'
            host = workspace / 'build/host-packages/win32-x64'
            archive = host.parent / 'bycoda-host-win32-x64.zip'
            stages = []

            def build_stage(name, command, cwd, env, release, timings):
                stages.append(name)
                if request.get('buildIdentity'):
                    self.assertEqual(read_json(env['BYCODA_BUILD_MANIFEST']), request['buildIdentity'])
                if name == 'host':
                    host.mkdir(parents=True, exist_ok=True)
                    (host / 'host.mjs').write_bytes(files['host/cli.ts'])
                    archive.write_bytes(files['host/cli.ts'])
                    pathlib.Path(f'{archive}.sha256').write_text(digest(archive))
                elif name == 'web':
                    (workspace / 'dist').mkdir(exist_ok=True)
                    (workspace / 'dist/index.html').write_text('unchanged web')
                elif name == 'native':
                    setup.parent.mkdir(parents=True, exist_ok=True)
                    native.write_bytes(b'MZ-__TAURI_BUNDLE_TYPE_VAR_UNK-unchanged-native')
                    # Model the installer bundling the generated host resource.
                    setup.write_bytes(b'installer:' + archive.read_bytes())
                else:
                    self.fail('Unexpected build stage: ' + name)

            request = {'stateRoot': str(root), 'cargoTarget': str(root / 'cargo'),
                       'archive': str(source_archive), 'archiveHash': digest(source_archive),
                       'source': 'fixture', 'mode': 'local', 'buildOnly': True}
            with patch('local_update.sync_source', return_value=files), \
                 patch('local_update.validate_versions', return_value='0.0.1'), \
                 patch('local_update.validate_product_identity'), \
                 patch('local_update.legacy_updaters', return_value=[]), \
                 patch('local_update.status', return_value={}), \
                 patch('local_update.run', side_effect=lambda args, **kwargs: '12.0.0' if args[0] == 'pnpm' else 'rustc fixture'), \
                 patch('local_update.stage', side_effect=build_stage), \
                 patch('local_update.archive_package', return_value=setup), \
                 patch('local_update.finish_build'):
                worker(dict(request, id='baseline'))
                self.assertEqual(stages, ['host', 'web', 'native'])
                stages.clear()
                worker(dict(request, id='unchanged'))
                self.assertEqual(stages, [])
                files['host/cli.ts'] = b'new host'
                worker(dict(request, id='host-changed'))
                self.assertEqual(stages, ['host', 'native'])
                self.assertEqual((root / 'runs/host-changed/setup.exe').read_bytes(), b'installer:new host')
                stages.clear()
                worker(dict(request, id='host-unchanged'))
                self.assertEqual(stages, [])
                identity = {'schemaVersion': 1, 'buildId': '01234567890123456789-local',
                            'sourceFingerprint': 'fixture', 'version': '0.0.1', 'mode': 'local'}
                request['buildIdentity'] = identity
                worker(dict(request, id='stamped'))
                self.assertEqual(stages, ['host', 'web', 'native'])
                self.assertEqual(read_json(root / 'runs/stamped/build-info.json'), identity)
                self.assertEqual(read_json(root / 'runs/stamped/manifest.json')['buildIdentity'], identity)
                stages.clear()
                worker(dict(request, id='stamped-reuse'))
                self.assertEqual(stages, [])
                # Equal versions and code cache hits do not permit stale component stamps.
                request['buildIdentity'] = dict(identity, buildId='11234567890123456789-local')
                worker(dict(request, id='different-stamp'))
                self.assertEqual(stages, ['host', 'web', 'native'])

    def test_installer_cache_tracks_bundled_host_bytes_and_checksum(self):
        with tempfile.TemporaryDirectory() as folder:
            archive = pathlib.Path(folder) / 'bycoda-host-win32-x64.zip'
            checksum = pathlib.Path(f'{archive}.sha256')
            archive.write_bytes(b'old host package')
            checksum.write_text('old checksum')
            previous = bundled_host_key(archive)
            self.assertEqual(previous, bundled_host_key(archive))
            archive.write_bytes(b'new host package')
            changed = bundled_host_key(archive)
            self.assertNotEqual(previous, changed)
            checksum.write_text('new checksum')
            self.assertNotEqual(changed, bundled_host_key(archive))

    def test_completed_host_job_requires_running_runtime_health_before_reuse(self):
        for healthy in (True, False):
            with self.subTest(healthy=healthy), tempfile.TemporaryDirectory() as folder:
                root = pathlib.Path(folder)
                release = root / 'release'
                release.mkdir()
                runtime = root / '.bycoda-host/runtime/selected'
                runtime.mkdir(parents=True)
                (runtime / 'host.mjs').write_text('selected host')
                (root / '.bycoda-host/runtime-path').write_text(str(runtime))
                write_json(release / 'manifest.json', {
                    'id': 'same', 'identity': dict(PRODUCT_IDENTITY),
                    'hostHashes': {'host.mjs': digest(runtime / 'host.mjs')}})
                record = root / '.bycoda-host/update-jobs/host.json'
                write_json(record, {'id': 'same', 'state': 'installed'})
                with patch('local_update.pathlib.Path.home', return_value=root), \
                     patch('local_update.verify_host', side_effect=None if healthy else RuntimeError('Wrong running runtime')) as verify, \
                     patch('local_update.subprocess.Popen', return_value=SimpleNamespace(pid=123)) as direct_spawn, \
                     patch('local_update.spawn_windows_updater', return_value=123) as broker_spawn:
                    queue_install(release, ('host',))
                self.assertEqual((broker_spawn if os.name == 'nt' else direct_spawn).call_count, 0 if healthy else 1)
                verify.assert_called_once_with(runtime)

    def test_mac_update_migrates_legacy_and_stable_services_and_restores_engine_on_failure(self):
        for stable_service in (False, True):
            for fail in (False, True):
                with self.subTest(stable=stable_service, fail=fail), tempfile.TemporaryDirectory() as folder:
                    home = pathlib.Path(folder)
                    base = home / '.bycoda-host'
                    previous = base / 'runtime/previous'
                    (previous / 'bin').mkdir(parents=True)
                    (previous / 'bin/node').write_bytes(b'old node')
                    (base / 'host.db').touch()
                    (base / 'runtime-path').write_text(str(previous))
                    (base / 'engine').mkdir()
                    engine = base / 'engine/node'
                    engine.write_bytes(b'old node')
                    plist = home / 'Library/LaunchAgents/com.bycoda.host.plist'
                    plist.parent.mkdir(parents=True)
                    original = {
                        'ProgramArguments': [str(engine if stable_service else previous / 'bin/node'),
                                             str(previous / 'host.mjs'), 'serve', '--port', '3776'],
                        'EnvironmentVariables': {'PATH': str(previous / 'bin') + ':/usr/bin'},
                    }
                    with plist.open('wb') as f:
                        plistlib.dump(original, f)
                    release = home / 'release'
                    (release / 'host/bin').mkdir(parents=True)
                    (release / 'host/bin/node').write_bytes(b'new node')
                    (release / 'host/host.mjs').write_text('new host')
                    (release / 'host/bycoda-host.mjs').write_text('new host bundle')
                    system = SimpleNamespace(name='posix', getuid=lambda: 501,
                                             close=os.close, replace=os.replace)
                    health = RuntimeError('simulated health failure') if fail else None
                    with patch('local_install.BASE', base), patch('local_install.os', system), \
                         patch('local_install.pathlib.Path.home', return_value=home), \
                         patch('local_install.verify_tree'), patch('local_install.wait_idle'), \
                         patch('local_install.backup'), patch('local_install.run'), \
                         patch('local_install.verify_host', side_effect=health):
                        install = lambda: host_install(release, {'version': '0.6.60', 'platform': 'darwin-arm64',
                                                                'id': 'fixture', 'hostHashes': {}}, lambda *a, **kw: None)
                        if fail:
                            with self.assertRaisesRegex(RuntimeError, 'simulated health failure'):
                                install()
                        else:
                            install()
                    with plist.open('rb') as f:
                        installed = plistlib.load(f)
                    if fail:
                        self.assertEqual(installed, original)
                        self.assertEqual((base / 'runtime-path').read_text(), str(previous))
                        if stable_service:
                            self.assertEqual(engine.read_bytes(), b'old node')
                    else:
                        selected = base / 'runtime/0.6.60-darwin-arm64-fixture'
                        self.assertEqual(installed['ProgramArguments'][0], str(engine))
                        self.assertEqual(installed['ProgramArguments'][1], str(selected / 'host.mjs'))
                        self.assertEqual(engine.read_bytes(), b'new node')
                        self.assertEqual((base / 'runtime-path').read_text().strip(), str(selected))

    def test_windows_host_verifies_stable_engine_and_selected_entry(self):
        with tempfile.TemporaryDirectory() as folder:
            base = pathlib.Path(folder)
            runtime = base / 'runtime/new-package'
            runtime.mkdir(parents=True)
            (runtime / 'node.exe').write_bytes(b'expected node')
            stable = base / 'engine/node.exe'
            stable.parent.mkdir()
            stable.write_bytes(b'expected node')
            entry = runtime / 'host.mjs'
            for executable in (stable, runtime / 'node.exe'):
                with self.subTest(executable=executable), \
                     patch('local_install.BASE', base), \
                     patch('local_install.ps', side_effect=[str(executable), f'"{executable}" "{entry}" serve']):
                    verify_windows_host_process(runtime, 123)
            with patch('local_install.BASE', base):
                with patch('local_install.ps', side_effect=[str(stable), f'node {entry} serve']):
                    verify_windows_host_process(runtime, 123)
                with patch('local_install.ps', side_effect=[str(stable), f'node "{base / "runtime/old-package/host.mjs"}" serve']):
                    with self.assertRaisesRegex(RuntimeError, 'entry point'):
                        verify_windows_host_process(runtime, 123)
                stable.write_bytes(b'wrong node')
                with patch('local_install.ps', return_value=str(stable)):
                    with self.assertRaisesRegex(RuntimeError, 'checksum'):
                        verify_windows_host_process(runtime, 123)
                with patch('local_install.ps', return_value=str(base / 'unrelated/node.exe')):
                    with self.assertRaisesRegex(RuntimeError, 'runtime process'):
                        verify_windows_host_process(runtime, 123)

    @unittest.skipUnless(os.name == 'nt', 'Windows installation recovery')
    def test_windows_failed_update_restores_complete_installation(self):
        for failure in ('installer', 'version', 'hash'):
            for running in (False, True):
                with self.subTest(failure=failure, running=running), tempfile.TemporaryDirectory() as folder:
                    root = pathlib.Path(folder)
                    app = root / 'local/bycoda/bycoda.exe'
                    app.parent.mkdir(parents=True)
                    app.write_bytes(b'working old exe')
                    (app.parent / 'resources').mkdir()
                    (app.parent / 'resources/sidecar.dll').write_bytes(b'old sidecar')
                    (app.parent / 'uninstall.exe').write_bytes(b'old uninstaller')
                    release = root / 'release'
                    release.mkdir()
                    built = release / 'built.exe'
                    built.write_bytes(b'new exe-__TAURI_BUNDLE_TYPE_VAR_UNK')
                    db = root / 'desktop.db'
                    with closing(sqlite3.connect(db)) as conn:
                        conn.execute('CREATE TABLE in_flight_sessions (id TEXT)')
                    manifest = {'version': '0.6.25', 'appHashes': {}, 'binaryHash': digest(built)}
                    events = []
                    commands = []
                    def powershell(command):
                        commands.append(command)
                        if command.endswith('.Count'):
                            return '1' if running else '0'
                        if 'ProductVersion' in command:
                            return 'wrong' if failure == 'version' else manifest['version']
                        return ''
                    def installer(args, **kwargs):
                        app.write_bytes(b'bad exe-__TAURI_BUNDLE_TYPE_VAR_UNK' if failure == 'hash' else built.read_bytes())
                        (app.parent / 'resources/sidecar.dll').write_bytes(b'new incompatible sidecar')
                        (app.parent / 'new-only.dll').write_bytes(b'new resource')
                        (app.parent / 'uninstall.exe').unlink()
                        if failure == 'installer':
                            raise RuntimeError('setup failed after replacing files')
                    with patch.dict(os.environ, {'LOCALAPPDATA': str(root / 'local')}), \
                         patch('local_install.desktop_db', return_value=db), \
                         patch('local_install.time.sleep'), \
                         patch('local_install.ps', side_effect=powershell), \
                         patch('local_install.run', side_effect=installer):
                        with self.assertRaisesRegex(RuntimeError, 'setup failed|version/hash mismatch'):
                            app_install(release, manifest, lambda state, **data: events.append(state))
                    self.assertEqual(app.read_bytes(), b'working old exe')
                    self.assertEqual((app.parent / 'resources/sidecar.dll').read_bytes(), b'old sidecar')
                    self.assertEqual((app.parent / 'uninstall.exe').read_bytes(), b'old uninstaller')
                    self.assertFalse((app.parent / 'new-only.dll').exists())
                    recovery = read_json(release / 'rollback-app/windows-recovery.json')
                    self.assertTrue((pathlib.Path(recovery['failedInstallation']) / 'new-only.dll').exists())
                    self.assertTrue((release / 'rollback-app/installation/bycoda.exe').exists())
                    self.assertEqual(count(db, 'pragma quick_check'), 'ok')
                    self.assertNotIn('installed', events)
                    self.assertEqual(sum('Start-Process' in command for command in commands), int(running))

    @unittest.skipUnless(os.name == 'nt', 'Windows installation recovery')
    def test_windows_update_keeps_successful_replacement_and_backup(self):
        with tempfile.TemporaryDirectory() as folder:
            root = pathlib.Path(folder)
            app = root / 'local/bycoda/bycoda.exe'
            app.parent.mkdir(parents=True)
            app.write_bytes(b'old executable')
            release = root / 'release'
            release.mkdir()
            expected = release / 'built.exe'
            expected.write_bytes(b'new executable-__TAURI_BUNDLE_TYPE_VAR_UNK')
            db = root / 'desktop.db'
            db.touch()
            events = []
            def powershell(command):
                return '0' if command.endswith('.Count') else '0.6.25' if 'ProductVersion' in command else ''
            with patch.dict(os.environ, {'LOCALAPPDATA': str(root / 'local')}), \
                 patch('local_install.desktop_db', return_value=db), \
                 patch('local_install.time.sleep'), patch('local_install.wait_idle'), \
                 patch('local_install.count', return_value=0), patch('local_install.backup'), \
                 patch('local_install.ps', side_effect=powershell), \
                 patch('local_install.run', side_effect=lambda *args, **kwargs: shutil.copy2(expected, app)):
                app_install(release, {'version': '0.6.25', 'appHashes': {}, 'binaryHash': digest(expected)},
                            lambda state, **data: events.append(state))
            self.assertEqual(app.read_bytes(), expected.read_bytes())
            self.assertEqual((release / 'rollback-app/installation/bycoda.exe').read_bytes(), b'old executable')
            self.assertEqual(events[-1], 'installed')

    def test_mac_update_keeps_one_visible_app_and_restores_failed_install(self):
        for fail_verification in (False, True):
            with self.subTest(fail_verification=fail_verification), tempfile.TemporaryDirectory() as folder:
                root = pathlib.Path(folder)
                applications = root / 'Applications'
                app = applications / 'bycoda.app'
                app.mkdir(parents=True)
                (app / 'previous.txt').write_text('recoverable old app')
                release = root / 'release'
                payload = release / 'bycoda.app'
                binary = payload / 'Contents/MacOS/bycoda'
                binary.parent.mkdir(parents=True)
                binary.write_text('new binary')
                with (payload / 'Contents/Info.plist').open('wb') as handle:
                    plistlib.dump({'CFBundleShortVersionString': '0.6.13'}, handle)
                db = root / 'desktop.db'
                db.touch()
                manifest = {'id': '0123456789abcdef-local', 'version': '0.6.13',
                            'appHashes': {}, 'binaryHash': digest(binary)}
                def command(args, **kwargs):
                    if args[0] == 'ditto':
                        shutil.copytree(args[1], args[2])
                    elif args[0] == 'pgrep':
                        raise subprocess.CalledProcessError(1, args)
                    elif args[0] == 'codesign' and args[-1] == str(app) and fail_verification:
                        raise RuntimeError('simulated signature failure')
                    return ''
                with patch('local_install.os', SimpleNamespace(name='posix')), \
                     patch('local_install.MAC_APPLICATIONS', applications), \
                     patch('local_install.desktop_db', return_value=db), \
                     patch('local_install.verify_tree'), patch('local_install.time.sleep'), \
                     patch('local_install.wait_idle'), patch('local_install.backup'), \
                     patch('local_install.count', return_value=0), \
                     patch('local_install.run', side_effect=command):
                    if fail_verification:
                        with self.assertRaisesRegex(RuntimeError, 'signature failure'):
                            app_install(release, manifest, lambda *a, **k: None)
                    else:
                        app_install(release, manifest, lambda *a, **k: None)
                saved, staged = mac_app_update_paths(app, manifest['id'])
                self.assertEqual(list(applications.glob('*.app')), [app])
                self.assertFalse(list(saved.parent.rglob('*.app')))
                self.assertTrue((saved.parent.parent / '.metadata_never_index').exists())
                if fail_verification:
                    self.assertEqual((app / 'previous.txt').read_text(), 'recoverable old app')
                    self.assertTrue((staged / 'Contents/MacOS/bycoda').exists())
                else:
                    self.assertEqual((saved / 'previous.txt').read_text(), 'recoverable old app')
                    self.assertTrue((app / 'Contents/MacOS/bycoda').exists())

    @unittest.skipUnless(os.name == 'nt', 'Windows service recovery')
    def test_split_host_payload_survives_install_and_rollback(self):
        # Exercise real recursive copies and pointer restoration, never services.
        for fail_health in (False, True):
            with self.subTest(rollback=fail_health), tempfile.TemporaryDirectory() as folder:
                root = pathlib.Path(folder)
                base = root / 'base'
                (base / 'bin').mkdir(parents=True)
                previous = base / 'runtime' / 'previous'
                previous.mkdir(parents=True)
                release = root / 'release'
                payload = release / 'host'
                payload.mkdir(parents=True)
                names = ('host.mjs', 'bycoda-host.mjs', 'provider-guard.mjs')
                for name in names:
                    (previous / name).write_text('previous ' + name)
                    (payload / name).write_text('new ' + name)
                (base / 'host.db').touch()
                (base / 'runtime-path').write_text(str(previous))
                service = "& 'node.exe' 'host.mjs' serve --port '3777'"
                (base / 'service.ps1').write_text(service)
                (base / 'bin/bycoda-host.cmd').write_text('previous-launcher')
                manifest = {'version': 'test', 'platform': 'win32-x64', 'id': 'split',
                            'hostHashes': {name: digest(payload / name) for name in names}}
                runtime = base / 'runtime/test-win32-x64-split'
                def health(candidate):
                    self.assertEqual(candidate, runtime)
                    for name in names:
                        self.assertEqual((candidate / name).read_text(), 'new ' + name)
                    if fail_health:
                        raise RuntimeError('simulated health failure')
                with patch('local_install.BASE', base), patch('local_install.wait_idle'), \
                     patch('local_install.backup'), patch('local_install.run') as command, \
                     patch('local_install.verify_host', side_effect=health):
                    if fail_health:
                        with self.assertRaisesRegex(RuntimeError, 'simulated health failure'):
                            host_install(release, manifest, lambda *a, **kw: None)
                        self.assertEqual((base / 'runtime-path').read_text(), str(previous))
                        self.assertEqual((base / 'service.ps1').read_text(), service)
                        self.assertEqual((base / 'bin/bycoda-host.cmd').read_text(), 'previous-launcher')
                        self.assertEqual(command.call_args.args[0][:4],
                                         [str(previous / 'node.exe'), str(previous / 'host.mjs'),
                                          'service', 'install'])
                    else:
                        host_install(release, manifest, lambda *a, **kw: None)
                        self.assertEqual((base / 'runtime-path').read_text().strip(), str(runtime))
                    for name in names:
                        self.assertEqual((previous / name).read_text(), 'previous ' + name)
                        self.assertEqual((runtime / name).read_text(), 'new ' + name)

    def test_desktop_database_keeps_existing_installation_filename(self):
        self.assertEqual(desktop_db().name, 'bycoda.db')
        self.assertEqual(desktop_db().parent.name, 'com.bycoda.desktop')

    def test_windows_install_closes_only_this_products_app(self):
        with tempfile.TemporaryDirectory() as folder:
            root = pathlib.Path(folder)
            app = root / 'bycoda/bycoda.exe'
            previous = root / 'other/other.exe'
            previous.parent.mkdir()
            previous.touch()
            command = windows_app_process_filter(app)
            self.assertIn(str(app), command)
            self.assertNotIn(str(previous), command)
            self.assertIn('-eq "bycoda"', command)

    @unittest.skipUnless(__import__('os').name == 'nt', 'Windows installer regression')
    def test_windows_install_still_cancels_force_close_when_a_new_turn_starts(self):
        with tempfile.TemporaryDirectory() as folder:
            root = pathlib.Path(folder)
            release = root / 'release'
            release.mkdir()
            db = root / 'desktop.db'
            db.touch()
            previous = root / 'bycoda/bycoda.exe'
            previous.parent.mkdir()
            previous.touch()
            with patch.dict('os.environ', {'LOCALAPPDATA': str(root)}), \
                 patch('local_install.desktop_db', return_value=db), \
                 patch('local_install.verify_tree'), patch('local_install.time.sleep'), \
                 patch('local_install.wait_idle'), patch('local_install.backup'), \
                 patch('local_install.ps', return_value='bycoda') as shell, \
                 patch('local_install.count', return_value=1), patch('local_install.run') as installer:
                with self.assertRaisesRegex(RuntimeError, 'new turn started'):
                    app_install(release, {'appHashes': {}}, lambda *a, **k: None)
            self.assertTrue(any('CloseMainWindow' in call.args[0]
                                for call in shell.call_args_list))
            self.assertFalse(any('Stop-Process' in call.args[0] for call in shell.call_args_list))
            installer.assert_not_called()

    def test_selected_overlay_preserves_unselected_verified_source(self):
        with tempfile.TemporaryDirectory() as folder:
            root = pathlib.Path(folder)
            original = {'owned.ts': b'old', 'other.ts': b'verified'}
            with patch('local_update.inputs', return_value=original):
                archive, source = snapshot(root, root/'state')
            request = {'archive': str(archive), 'archiveHash': digest(archive), 'source': source}
            with patch('local_update.inputs', return_value={'owned.ts': b'fixed', 'other.ts': b'incomplete'}):
                updated, _ = snapshot(root, root/'state', request, ['owned.ts'])
                with self.assertRaises(ValueError):
                    snapshot(root, root/'state', request, ['../escape.ts'])
            with tarfile.open(updated) as tar:
                self.assertEqual(tar.extractfile('owned.ts').read(), b'fixed')
                self.assertEqual(tar.extractfile('other.ts').read(), b'verified')

    @unittest.skipUnless(__import__('os').name == 'nt', 'Windows installer regression')
    def test_first_install_with_imported_database_waits_and_backs_up(self):
        with tempfile.TemporaryDirectory() as folder:
            root = pathlib.Path(folder)
            release = root / 'release'
            release.mkdir()
            db = root / 'imported.db'
            db.touch()
            with patch.dict('os.environ', {'LOCALAPPDATA': str(root)}), \
                 patch('local_install.desktop_db', return_value=db), \
                 patch('local_install.verify_tree'), patch('local_install.time.sleep'), \
                 patch('local_install.wait_idle') as idle, \
                 patch('local_install.backup') as snapshot, \
                 patch('local_install.ps'), patch('local_install.count', return_value=0), \
                 patch('local_install.run', side_effect=RuntimeError('installer reached')):
                with self.assertRaisesRegex(RuntimeError, 'installer reached'):
                    app_install(release, {'appHashes': {}}, lambda *a, **k: None)
            idle.assert_called_once()
            snapshot.assert_called_once_with(db, release / 'rollback-app/desktop.db')

    def test_product_identity_is_independent_from_upstream(self):
        self.assertEqual(PRODUCT_IDENTITY['productName'], 'bycoda')
        self.assertEqual(PRODUCT_IDENTITY['binaryName'], 'bycoda')
        self.assertEqual(PRODUCT_IDENTITY['bundleIdentifier'], 'com.bycoda.desktop')
        self.assertEqual(PRODUCT_IDENTITY['hostDirectory'], '.bycoda-host')
        self.assertEqual(PRODUCT_IDENTITY['hostPort'], 3776)
        self.assertEqual(package_identity({'identity': dict(PRODUCT_IDENTITY)}), PRODUCT_IDENTITY)

    def test_legacy_or_changed_package_identity_cannot_install(self):
        for manifest in ({}, {'identity': dict(PRODUCT_IDENTITY, productName='Bycoda')}):
            with self.assertRaises(RuntimeError):
                package_identity(manifest)

    def test_frozen_native_identity_and_updater_match_coordinator(self):
        config = {'productName': 'bycoda', 'mainBinaryName': 'bycoda', 'identifier': 'com.bycoda.desktop',
                  'plugins': {'updater': {'endpoints': []}}, 'bundle': {'createUpdaterArtifacts': False}}
        files = {name: json.dumps(config).encode() for name in
                 ('src-tauri/tauri.conf.json', 'src-tauri/tauri.fork.conf.json', 'src-tauri/tauri.fork.macos.conf.json')}
        for windows in (True, False):
            self.assertEqual(validate_product_identity(files, windows), PRODUCT_IDENTITY)
        unsafe = dict(config, mainBinaryName='other')
        files['src-tauri/tauri.fork.conf.json'] = json.dumps(unsafe).encode()
        with self.assertRaises(RuntimeError):
            validate_product_identity(files, True)
        config['plugins']['updater']['endpoints'] = ['https://upstream.invalid/feed']
        files['src-tauri/tauri.fork.conf.json'] = json.dumps(config).encode()
        with self.assertRaises(RuntimeError):
            validate_product_identity(files, True)
        config['plugins']['updater']['endpoints'] = [UPDATER_FEED]
        files['src-tauri/tauri.fork.conf.json'] = json.dumps(config).encode()
        with self.assertRaises(RuntimeError):
            validate_product_identity(files, True)
        config['plugins']['updater']['pubkey'] = 'key'
        files['src-tauri/tauri.fork.conf.json'] = json.dumps(config).encode()
        self.assertEqual(validate_product_identity(files, True), PRODUCT_IDENTITY)
        config['bundle']['createUpdaterArtifacts'] = True
        files['src-tauri/tauri.fork.conf.json'] = json.dumps(config).encode()
        with self.assertRaises(RuntimeError):
            validate_product_identity(files, True)

    def test_missing_existing_host_database_is_not_a_fresh_install(self):
        with tempfile.TemporaryDirectory() as folder:
            root = pathlib.Path(folder)
            release = root/'release'
            (release/'host').mkdir(parents=True)
            base = root/'.bycoda-host'
            base.mkdir()
            (base/'runtime-path').write_text('existing-runtime')
            manifest = {'version': '1.0.0', 'platform': 'test', 'id': 'test', 'hostHashes': {}}
            with patch('local_install.BASE', base), patch('local_install.run') as command:
                with self.assertRaisesRegex(RuntimeError, 'database is missing'):
                    host_install(release, manifest, lambda *args, **kwargs: None)
            command.assert_not_called()

    def test_terminal_install_job_does_not_block_on_reused_pid(self):
        with patch('local_update.alive', return_value=True) as liveness:
            for state in ('installed', 'failed'):
                self.assertFalse(install_job_active({'state': state, 'pid': 123}))
            liveness.assert_not_called()

    def test_unfinished_install_job_preserves_process_guard(self):
        with patch('local_update.alive', return_value=True):
            for state in ('launching', 'starting', 'waiting', 'installing', None):
                self.assertTrue(install_job_active({'state': state, 'pid': 123}))
        with patch('local_update.alive', return_value=False):
            self.assertFalse(install_job_active({'state': 'installing', 'pid': 123}))

    def test_shared_provider_edit_invalidates_host_cache(self):
        files = {'host/cli.ts': b'entry',
                 'src/integrations/harness/providers/codex/codex.ts': b'old'}
        before = host_key(files)
        files['src/integrations/harness/providers/codex/codex.ts'] = b'excludeTurns: true'
        self.assertNotEqual(before, host_key(files))
        after = host_key(files)
        files['src/integrations/harness/providers/codex/codexLive.test.ts'] = b'test'
        self.assertEqual(after, host_key(files))

    def test_exited_windows_host_does_not_require_a_live_lifecycle_endpoint(self):
        with patch('local_install.read_json', return_value={'pid': 123, 'port': 3774}), \
             patch('local_install.alive', return_value=False), patch('local_install.lifecycle') as lifecycle:
            self.assertEqual(stop_windows_host(), 3774)
        lifecycle.assert_not_called()

    def test_live_windows_host_requires_shutdown_before_installation(self):
        with patch('local_install.read_json', return_value={'pid': 123, 'port': 3774}), \
             patch('local_install.alive', side_effect=[True, False, False]), \
             patch('local_install.lifecycle', return_value=123) as lifecycle:
            self.assertEqual(stop_windows_host(), 3774)
        lifecycle.assert_called_once_with('stop')

    def test_windows_lifecycle_failure_with_live_pid_does_not_allow_a_service_swap(self):
        with patch('local_install.read_json', return_value={'pid': 123, 'port': 3774}), \
             patch('local_install.alive', return_value=True), \
             patch('local_install.lifecycle', side_effect=ConnectionError('unavailable')):
            with self.assertRaises(ConnectionError):
                stop_windows_host()

    @unittest.skipUnless(__import__('os').name == 'nt', 'Windows service recovery')
    def test_windows_install_recovers_a_missing_running_file_and_commits_pointer_after_health(self):
        with tempfile.TemporaryDirectory() as folder:
            root = pathlib.Path(folder)
            base = root / '.bycoda-host'
            (base / 'bin').mkdir(parents=True)
            (base / 'host.db').touch()
            (base / 'runtime-path').write_text('previous-runtime')
            (base / 'service.ps1').write_text("& 'node.exe' 'host.mjs' serve --port '3777'")
            (base / 'bin/bycoda-host.cmd').write_text('previous-launcher')
            release = root / 'release'
            (release / 'host').mkdir(parents=True)
            (release / 'host/host.mjs').write_text('// isolated fixture host')
            (release / 'host/bycoda-host.mjs').write_text('// isolated executing fixture bundle')
            calls = []
            reports = []
            def checked_runtime(runtime):
                self.assertEqual((base / 'runtime-path').read_text(), 'previous-runtime')
                calls.append('health')
            def recorded_run(args):
                calls.append(args[2:4])
            with patch('local_install.BASE', base), patch('local_install.verify_tree'), \
                 patch('local_install.wait_idle'), patch('local_install.backup'), \
                 patch('local_install.run', side_effect=recorded_run), \
                 patch('local_install.verify_host', side_effect=checked_runtime):
                host_install(release, {'version':'0.5.70','platform':'win32-x64','id':'fixed','hostHashes':{}},
                             lambda state, **values: reports.append((state, values)))
            self.assertEqual(calls, [['service', 'uninstall'], ['service', 'install'], 'health'])
            self.assertIn('fixed', (base / 'runtime-path').read_text())
            self.assertEqual(pathlib.Path(reports[-1][1]['binaryPath']).name, 'bycoda-host.mjs')
            self.assertEqual(reports[-1][1]['binaryHash'], digest(release / 'host/bycoda-host.mjs'))

    def test_build_only_does_not_schedule_installation(self):
        with patch('local_update.queue_install') as install:
            finish_build(pathlib.Path('verified-package'), build_only=True)
        install.assert_not_called()

    def test_default_build_preserves_installation_behavior(self):
        release = pathlib.Path('verified-package')
        with patch('local_update.queue_install') as install:
            finish_build(release)
        install.assert_called_once_with(release, ('host', 'app'))

    def test_host_only_leaves_other_pending_app_package_untouched(self):
        with tempfile.TemporaryDirectory() as folder:
            root = pathlib.Path(folder)
            release = root/'release'
            release.mkdir()
            write_json(release/'manifest.json', {'id': 'new', 'identity': dict(PRODUCT_IDENTITY)})
            base = root/'.bycoda-host/update-jobs'
            write_json(base/'host.json', {'id': 'new', 'pid': 123, 'state': 'waiting'})
            app = {'id': 'old', 'pid': 456, 'state': 'waiting'}
            write_json(base/'app.json', app)
            with patch('local_update.pathlib.Path.home', return_value=root), patch('local_update.alive', return_value=True), patch('local_update.subprocess.Popen') as spawn:
                queue_install(release, ('host',))
            spawn.assert_not_called()
            self.assertEqual(read_json(base/'app.json'), app)
            self.assertEqual(set(read_json(release/'install-jobs.json')), {'host'})

    def test_nsis_bundle_marker_is_the_only_normalized_executable_difference(self):
        with tempfile.TemporaryDirectory() as folder:
            built = pathlib.Path(folder) / 'built.exe'
            installed = pathlib.Path(folder) / 'installed.exe'
            built.write_bytes(b'MZ-prefix-__TAURI_BUNDLE_TYPE_VAR_UNK-suffix')
            installed.write_bytes(b'MZ-prefix-__TAURI_BUNDLE_TYPE_VAR_NSS-suffix')
            self.assertEqual(windows_binary_digest(installed), digest(built))
            self.assertEqual(windows_binary_digest(built), digest(built))
            installed.write_bytes(b'MZ-changed-__TAURI_BUNDLE_TYPE_VAR_NSS-suffix')
            self.assertNotEqual(windows_binary_digest(installed), digest(built))
            for data in (b'missing', b'__TAURI_BUNDLE_TYPE_VAR_MSI',
                         b'__TAURI_BUNDLE_TYPE_VAR_NSS__TAURI_BUNDLE_TYPE_VAR_UNK'):
                installed.write_bytes(data)
                with self.assertRaises(RuntimeError):
                    windows_binary_digest(installed)

    def test_packages_are_archived_by_version_and_date_without_overwrite(self):
        with tempfile.TemporaryDirectory() as temp:
            state = pathlib.Path(temp)
            setup = state / 'setup.exe'
            setup.write_bytes(b'one')
            first = archive_package(state, setup, '0.9.2', True, today='2026-10-10')
            self.assertEqual(first, state / 'packages' / f"{PRODUCT_IDENTITY['productName']}_0.9.2_2026-10-10_x64-setup.exe")
            self.assertEqual(archive_package(state, setup, '0.9.2', True, today='2026-10-10'), first)
            setup.write_bytes(b'two')
            second = archive_package(state, setup, '0.9.2', True, today='2026-10-10')
            self.assertEqual(second.name, f"{PRODUCT_IDENTITY['productName']}_0.9.2_2026-10-10_2_x64-setup.exe")
            self.assertEqual(first.read_bytes(), b'one')

    def test_process_liveness_is_read_only(self):
        import os
        self.assertTrue(alive(os.getpid()))
        self.assertFalse(alive(None))

    def test_mixed_version_source_is_rejected_before_build(self):
        files = {'package.json': b'{"version":"0.8.70"}',
                 'package-lock.json': b'{"version":"0.8.70","packages":{"":{"version":"0.8.70"}}}',
                 'src-tauri/tauri.conf.json': b'{"version":"0.8.71"}',
                 'Cargo.toml': b'[workspace.package]\nversion="0.8.70"'}
        with self.assertRaises(RuntimeError):
            validate_versions(files)

    def test_matching_version_and_rust_lock_are_accepted(self):
        files = {'package.json': b'{"version":"0.8.70"}',
                 'package-lock.json': b'{"version":"0.8.70","packages":{"":{"version":"0.8.70"}}}',
                 'src-tauri/tauri.conf.json': b'{"version":"0.8.70"}',
                 'Cargo.toml': b'[workspace.package]\nversion="0.8.70"',
                 'src-tauri/Cargo.toml': b'[package]\nname="bycoda"',
                 'Cargo.lock': b'[[package]]\nname="bycoda"\nversion="0.8.70"'}
        self.assertEqual(validate_versions(files), '0.8.70')

    def test_only_package_json_controls_dependency_key(self):
        def files(version, dependency='1.0.0'):
            return {'package.json': json.dumps({'version': version, 'dependencies': {'a': dependency}}).encode(),
                    'package-lock.json': json.dumps({'version': version, 'packages': {'': {'version': version},
                                                   'node_modules/a': {'version': dependency}}}).encode()}
        self.assertNotEqual(dependency_key(files('0.8.70')), dependency_key(files('0.8.71')))
        self.assertNotEqual(dependency_key(files('0.8.70')), dependency_key(files('0.8.70', '2.0.0')))
        first = files('0.8.70')
        changed_lock = dict(first, **{'package-lock.json': b'changed', 'pnpm-lock.yaml': b'changed'})
        self.assertEqual(dependency_key(first), dependency_key(changed_lock))

    def test_dependency_install_policy_preserves_existing_modules(self):
        files = {'package.json': b'{"version":"0.8.70"}'}
        with tempfile.TemporaryDirectory() as folder:
            workspace = pathlib.Path(folder)
            self.assertEqual(dependency_action(workspace, files), 'install')
            (workspace/'node_modules').mkdir()
            self.assertEqual(dependency_action(workspace, files), 'reuse')
            self.assertEqual(dependency_action(workspace, files, dependency_key(files)), 'reuse')
            self.assertEqual(dependency_action(workspace, files, previous_package=files['package.json']), 'reuse')
            self.assertEqual(dependency_action(workspace, files, previous_package=b'{}'), 'clean-install')
            self.assertEqual(dependency_action(workspace, files, 'old'), 'clean-install')

    def test_bad_database_read_never_means_idle(self):
        reports = []
        with patch('local_install.count', side_effect=[sqlite3.OperationalError('busy'), 2, 0]), patch('local_install.time.sleep') as sleep:
            wait_idle('unused', 'unused', lambda state, **values: reports.append(values['activeSessions']))
        self.assertEqual(reports, [None, 2, 0])
        self.assertEqual(sleep.call_count, 2)

    def test_missing_database_count_fails_closed(self):
        with tempfile.TemporaryDirectory() as folder:
            with self.assertRaises(sqlite3.OperationalError):
                count(pathlib.Path(folder)/'missing.db', 'select 0')

    def test_paths_cannot_escape_managed_workspace(self):
        with tempfile.TemporaryDirectory() as folder:
            for name in ('../outside', '/outside', '.'):
                with self.assertRaises(ValueError):
                    safe_child(folder, name)

    def test_archive_root_and_stale_files_without_removing_cache(self):
        with tempfile.TemporaryDirectory() as folder:
            root = pathlib.Path(folder)
            workspace = root/'source'
            workspace.mkdir()
            (workspace/'removed.ts').write_text('old')
            (workspace/'node_modules').mkdir()
            (workspace/'node_modules/cache').write_text('keep')
            write_json(root/'source-files.json', ['removed.ts'])
            files = {'src/örnek.ts': b'new', 'package.json': b'{}'}
            archive = root/'source.tar'
            with tarfile.open(archive, 'w') as tar:
                for name, value in files.items():
                    entry = tarfile.TarInfo(name)
                    entry.size = len(value)
                    tar.addfile(entry, io.BytesIO(value))
            self.assertEqual(sync_source(archive, fingerprint(files), workspace), files)
            self.assertFalse((workspace/'removed.ts').exists())
            self.assertEqual((workspace/'node_modules/cache').read_text(), 'keep')

    def test_epoch_archive_invalidates_changed_sources_but_preserves_unchanged_cache(self):
        with tempfile.TemporaryDirectory() as folder:
            root = pathlib.Path(folder)
            workspace = root/'source'
            workspace.mkdir()
            for name in ('changed.rs', 'unchanged.rs'):
                (workspace/name).write_bytes(b'old')
                os.utime(workspace/name, ns=(1_000_000_000, 1_000_000_000))
            files = {'changed.rs': b'new', 'unchanged.rs': b'old'}
            archive = root/'source.tar'
            with tarfile.open(archive, 'w') as tar:
                for name, value in files.items():
                    entry = tarfile.TarInfo(name)
                    entry.size = len(value)
                    tar.addfile(entry, io.BytesIO(value))
            sync_source(archive, fingerprint(files), workspace)
            self.assertGreater((workspace/'changed.rs').stat().st_mtime_ns, 1_000_000_000)
            self.assertEqual((workspace/'unchanged.rs').stat().st_mtime_ns, 1_000_000_000)

    def test_backup_is_complete_and_bounded_when_locked(self):
        with tempfile.TemporaryDirectory() as folder:
            root = pathlib.Path(folder)
            db = root/'db'
            with closing(sqlite3.connect(db)) as con, con:
                con.execute('create table rows (value)')
                con.execute('insert into rows values (42)')
            backup(db, root/'copy')
            self.assertEqual(count(root/'copy', 'select value from rows'), 42)
            with closing(sqlite3.connect(db)) as writer, writer:
                writer.execute('begin exclusive')
                started = time.monotonic()
                with self.assertRaises(TimeoutError):
                    backup(db, root/'locked-copy', seconds=0.05)
                self.assertLess(time.monotonic()-started, 3)

    def test_same_pending_package_does_not_spawn_second_helper(self):
        with tempfile.TemporaryDirectory() as folder:
            root = pathlib.Path(folder)
            release = root/'release'
            release.mkdir()
            write_json(release/'manifest.json', {'id': 'same', 'identity': dict(PRODUCT_IDENTITY)})
            base = root/'.bycoda-host/update-jobs'
            for component in ('host', 'app'):
                write_json(base/(component+'.json'), {'id': 'same', 'pid': 123})
            with patch('local_update.pathlib.Path.home', return_value=root), patch('local_update.alive', return_value=True), patch('local_update.subprocess.Popen') as spawn:
                queue_install(release)
            spawn.assert_not_called()

    def test_pending_different_package_refuses_double_installer(self):
        with tempfile.TemporaryDirectory() as folder:
            root = pathlib.Path(folder)
            release = root/'release'
            release.mkdir()
            write_json(release/'manifest.json', {'id': 'new', 'identity': dict(PRODUCT_IDENTITY)})
            write_json(root/'.bycoda-host/update-jobs/host.json', {'id': 'old', 'pid': 123})
            with patch('local_update.pathlib.Path.home', return_value=root), patch('local_update.alive', return_value=True), patch('local_update.subprocess.Popen') as spawn:
                with self.assertRaises(RuntimeError):
                    queue_install(release)
            spawn.assert_not_called()

if __name__ == '__main__':
    unittest.main()
