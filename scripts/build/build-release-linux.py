"""Build Linux distribution artifacts from a coordinator's frozen source."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tarfile
import time


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def child(root, name):
    path = (root / name).resolve()
    if path == root or root not in path.parents:
        raise ValueError(f'Path escapes the Linux build workspace: {name}')
    return path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('archive')
    parser.add_argument('archive_hash')
    parser.add_argument('source_hash')
    args = parser.parse_args()
    archive = Path(args.archive)
    if digest(archive) != args.archive_hash:
        raise RuntimeError('Frozen archive checksum mismatch')
    root = Path('/work/source')
    root.mkdir(parents=True, exist_ok=True)
    root = root.resolve()
    with tarfile.open(archive) as tar:
        files = {}
        for entry in tar.getmembers():
            child(root, entry.name)
            if not entry.isfile():
                raise ValueError('The frozen archive must contain regular files only')
            files[entry.name] = tar.extractfile(entry).read()
    fingerprint = hashlib.sha256()
    for name, content in sorted(files.items()):
        fingerprint.update(name.encode() + b'\0' + hashlib.sha256(content).digest())
    if fingerprint.hexdigest() != args.source_hash:
        raise RuntimeError('Frozen source fingerprint mismatch')
    marker = Path('/work/source-files.json')
    for old in json.loads(marker.read_text()) if marker.exists() else []:
        if old not in files:
            child(root, old).unlink(missing_ok=True)
    for name, content in files.items():
        path = child(root, name)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)
        path.chmod(0o755 if name.endswith('.sh') else 0o644)
    marker.write_text(json.dumps(sorted(files)))
    version = json.loads(files['package.json'])['version']
    output = Path('/out') / (args.source_hash[:16] + '-release')
    output.mkdir(parents=True, exist_ok=True)
    timings = {}

    def run(stage, command):
        print(f'[linux] {stage}', flush=True)
        started = time.monotonic()
        with (output / (stage + '.log')).open('w') as log:
            result = subprocess.run(command, cwd=root, stdout=log, stderr=subprocess.STDOUT)
        timings[stage] = round(time.monotonic() - started, 2)
        (output / 'timings.json').write_text(json.dumps(timings, indent=2))
        if result.returncode:
            raise RuntimeError(f'{stage} failed ({result.returncode}); see {stage}.log')

    package_hash = hashlib.sha256(files['package.json']).hexdigest()
    deps_marker = Path('/work/installed-package.sha256')
    if not (root / 'node_modules').exists() or not deps_marker.exists() or deps_marker.read_text() != package_hash:
        run('dependencies', ['pnpm', 'install', '--frozen-lockfile', '--prefer-offline'])
        deps_marker.write_text(package_hash)
    run('web', ['pnpm', 'run', 'build'])
    run('host', ['pnpm', 'run', 'host:package', '--target', 'linux-x64'])
    override = root / 'linux-release-build.json'
    # The fork config bundles the Windows host archive; Linux apps don't ship a bundled host.
    fork = json.loads(files['src-tauri/tauri.fork.conf.json'])
    resources = {name: None for name in fork.get('bundle', {}).get('resources', {})}
    override.write_text(json.dumps({'build': {'beforeBuildCommand': ''},
                                    'bundle': {'resources': resources}}))
    run('native', ['pnpm', 'exec', 'tauri', 'build', '--ci', '--bundles', 'deb,appimage,rpm',
                   '--config', 'src-tauri/tauri.fork.conf.json', '--config', override.name])
    artifacts = []
    bundle = Path(os.environ['CARGO_TARGET_DIR']) / 'release/bundle'
    for directory, extension in [('deb', '.deb'), ('appimage', '.AppImage'), ('rpm', '.rpm')]:
        matches = [p for p in (bundle / directory).glob('*' + extension) if version in p.name]
        if len(matches) != 1:
            raise RuntimeError(f'Expected exactly one {extension} artifact for {version}')
        target = output / f'bycoda-{version}-linux-x64{extension}'
        shutil.copy2(matches[0], target)
        artifacts.append(target)
    host = root / 'build/host-packages/bycoda-host-linux-x64.tar.gz'
    target = output / f'bycoda-host-{version}-linux-x64.tar.gz'
    shutil.copy2(host, target)
    artifacts.append(target)
    binary = Path(os.environ['CARGO_TARGET_DIR']) / 'release/bycoda'
    run('loader-check', ['sh', '-c', 'file "$1"; ldd "$1"', 'sh', str(binary)])
    if 'not found' in (output / 'loader-check.log').read_text():
        raise RuntimeError('Linux binary has unresolved shared libraries')
    manifest = {'productName': 'bycoda', 'version': version, 'platform': 'linux-x64',
                'mode': 'release', 'source': args.source_hash, 'archiveHash': args.archive_hash,
                'timings': timings, 'artifacts': {p.name: digest(p) for p in artifacts}}
    (output / 'manifest.json').write_text(json.dumps(manifest, indent=2))
    (output / 'SHA256SUMS').write_text(''.join(f'{digest(p)}  {p.name}\n' for p in artifacts))
    print(f'[linux] verified release artifacts: {output}', flush=True)


if __name__ == '__main__':
    main()
