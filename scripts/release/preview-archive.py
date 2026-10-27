"""Validate an unsigned web preview ZIP as data. Never execute/extract PR code."""
import argparse
import hashlib
import json
import pathlib
import re
import stat
import unicodedata
import zipfile

MAX_ARCHIVE = 128 * 1024 * 1024
MAX_TOTAL = 256 * 1024 * 1024
MAX_FILE = 64 * 1024 * 1024
MAX_ENTRIES = 5000
ALLOWED = {'.html', '.js', '.mjs', '.css', '.json', '.map', '.svg', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.ico', '.avif', '.woff', '.woff2', '.ttf', '.wasm', '.txt', '.mp3', '.wav', '.ogg', '.mp4', '.webm', '.pdf'}

def validate_archive(archive, *, repository, pull_number, sha):
    if not re.fullmatch(r'[\w.-]+/[\w.-]+', repository) or not isinstance(pull_number, int) or pull_number < 1 or not re.fullmatch(r'[a-f0-9]{40}', sha):
        raise ValueError('Invalid preview identity')
    archive = pathlib.Path(archive)
    if archive.is_symlink() or not archive.is_file() or archive.stat().st_size > MAX_ARCHIVE:
        raise ValueError('ZIP is not a bounded regular file')
    files, seen, total = [], set(), 0
    with zipfile.ZipFile(archive) as package:
        entries = package.infolist()
        if not 0 < len(entries) <= MAX_ENTRIES:
            raise ValueError('Invalid archive entry count')
        for entry in entries:
            name = entry.orig_filename
            pure = pathlib.PurePosixPath(name)
            parts = name.rstrip('/').split('/')
            if not name or len(name) > 1024 or name.startswith('/') or any(c in name for c in '\\\x00\r\n:') or any(ord(c) < 32 or ord(c) == 127 for c in name) or any(part in ('', '.', '..') for part in parts):
                raise ValueError('Unsafe archive path')
            if any(re.fullmatch(r'(?i)(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?', part) or part.endswith(('.', ' ')) for part in parts):
                raise ValueError('Platform-ambiguous archive path')
            folded = unicodedata.normalize('NFC', name.rstrip('/')).casefold()
            if folded in seen:
                raise ValueError('Duplicate or case-colliding archive entry')
            seen.add(folded)
            kind = stat.S_IFMT(entry.external_attr >> 16)
            if kind not in (0, stat.S_IFREG, stat.S_IFDIR) or entry.flag_bits & 1:
                raise ValueError('Symlink, special or encrypted entry')
            if entry.is_dir():
                continue
            if kind == stat.S_IFDIR or pure.suffix.lower() not in ALLOWED:
                raise ValueError('Unexpected preview file type')
            if entry.compress_type not in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED) or not 0 <= entry.file_size <= MAX_FILE:
                raise ValueError('Unsupported or oversized preview entry')
            total += entry.file_size
            if total > MAX_TOTAL or entry.file_size > max(1, entry.compress_size) * 200:
                raise ValueError('Archive expansion exceeds bound')
            count, digest = 0, hashlib.sha256()
            with package.open(entry) as stream:
                for chunk in iter(lambda: stream.read(65536), b''):
                    count += len(chunk)
                    if count > MAX_FILE or count > entry.file_size:
                        raise ValueError('Archive payload exceeds declared size')
                    digest.update(chunk)
            if count != entry.file_size:
                raise ValueError('Truncated archive payload')
            files.append({'path': name, 'bytes': count, 'sha256': digest.hexdigest()})
    if not any(item['path'] == 'index.html' and item['bytes'] > 0 for item in files):
        raise ValueError('Preview root index.html is required')
    return {'schemaVersion': 1, 'evidence': 'unsigned-pr-web-preview', 'repository': repository, 'pullNumber': pull_number, 'sourceSha': sha, 'archiveSha256': hashlib.sha256(archive.read_bytes()).hexdigest(), 'totalBytes': total, 'files': sorted(files, key=lambda item: item['path']), 'scope': 'Validated web artifact only; no trusted native shell, signing, provider or installation acceptance.'}

def read_artifact_envelope(archive, output):
    archive, output = pathlib.Path(archive), pathlib.Path(output)
    if archive.is_symlink() or not archive.is_file() or archive.stat().st_size > MAX_ARCHIVE + 1024 * 1024:
        raise ValueError('Invalid artifact envelope')
    with zipfile.ZipFile(archive) as envelope:
        entries = envelope.infolist()
        if len(entries) != 1:
            raise ValueError('Artifact envelope must contain only preview.zip')
        entry = entries[0]
        if entry.orig_filename != 'preview.zip' or stat.S_IFMT(entry.external_attr >> 16) not in (0, stat.S_IFREG) or entry.flag_bits & 1 or not 0 < entry.file_size <= MAX_ARCHIVE or entry.compress_type not in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED) or entry.file_size > max(1, entry.compress_size) * 200:
            raise ValueError('Unsafe artifact envelope member')
        output.parent.mkdir(parents=True, exist_ok=True)
        count = 0
        with envelope.open(entry) as source, output.open('xb') as destination:
            for chunk in iter(lambda: source.read(65536), b''):
                count += len(chunk)
                if count > MAX_ARCHIVE or count > entry.file_size:
                    raise ValueError('Artifact envelope expansion exceeds bound')
                destination.write(chunk)
        if count != entry.file_size:
            raise ValueError('Truncated artifact envelope')
    return output


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('archive')
    parser.add_argument('--repository', required=True)
    parser.add_argument('--pull', type=int, required=True)
    parser.add_argument('--sha', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--artifact-envelope', action='store_true')
    parser.add_argument('--preview-output')
    args = parser.parse_args()
    if args.artifact_envelope and not args.preview_output:
        raise ValueError('Artifact envelope requires a fixed preview output path')
    archive = read_artifact_envelope(args.archive, args.preview_output) if args.artifact_envelope else args.archive
    result = validate_archive(archive, repository=args.repository, pull_number=args.pull, sha=args.sha)
    output = pathlib.Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, indent=2) + '\n', encoding='utf8')
