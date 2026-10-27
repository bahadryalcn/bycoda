import importlib.util
import pathlib
import stat
import tempfile
import unittest
import zipfile
import warnings

spec = importlib.util.spec_from_file_location('preview_archive', pathlib.Path(__file__).with_name('preview-archive.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class PreviewArchiveTests(unittest.TestCase):
    def archive(self, entries):
        context = tempfile.TemporaryDirectory(prefix='bycoda-preview-zip-')
        self.addCleanup(context.cleanup)
        target = pathlib.Path(context.name) / 'preview.zip'
        with zipfile.ZipFile(target, 'w') as package, warnings.catch_warnings():
            warnings.simplefilter('ignore', UserWarning)
            for entry, content in entries:
                package.writestr(entry, content)
        # Windows ZipInfo normalizes backslashes when creating a ZIP. Inject the
        # raw central/local name bytes so this fixture exercises a hostile ZIP,
        # rather than the platform's already-normalized safe output.
        if any(isinstance(entry, str) and '\\' in entry for entry, _ in entries):
            data = target.read_bytes()
            for entry, _ in entries:
                if isinstance(entry, str) and '\\' in entry:
                    data = data.replace(entry.replace('\\', '/').encode(), entry.encode())
            target.write_bytes(data)
        return target

    def validate(self, entries):
        return module.validate_archive(self.archive(entries), repository='owner/project', pull_number=7, sha='a' * 40)

    def test_valid_preview_is_data_bound_to_exact_source(self):
        value = self.validate([('index.html', '<main>fixture</main>'), ('assets/app.js', 'fixture')])
        self.assertEqual(value['evidence'], 'unsigned-pr-web-preview')
        self.assertEqual(value['sourceSha'], 'a' * 40)
        self.assertEqual(len(value['archiveSha256']), 64)

    def test_unsafe_and_ambiguous_paths_types_and_duplicate_entries_fail(self):
        for name in ('../escape.js', '/absolute.js', 'C:/drive.js', 'a\\b.js', 'a/../x.js', 'a//x.js', 'CON.txt', 'trail./file.js', 'run.exe', 'control\x01.js', 'tab\t.js'):
            with self.subTest(name=name), self.assertRaises(ValueError):
                self.validate([('index.html', 'fixture'), (name, 'fixture')])
        for names in [('index.html', 'index.html'), ('index.html', 'INDEX.HTML')]:
            with self.assertRaises(ValueError):
                self.validate([(name, 'fixture') for name in names])

    def test_symlinks_special_files_missing_entrypoint_and_oversize_fail(self):
        for kind in (stat.S_IFLNK, stat.S_IFIFO):
            entry = zipfile.ZipInfo('link.js')
            entry.create_system = 3
            entry.external_attr = (kind | 0o777) << 16
            with self.assertRaises(ValueError):
                self.validate([('index.html', 'fixture'), (entry, 'elsewhere')])
        with self.assertRaises(ValueError):
            self.validate([('assets/app.js', 'fixture')])
        previous = module.MAX_TOTAL
        module.MAX_TOTAL = 3
        try:
            with self.assertRaises(ValueError):
                self.validate([('index.html', 'fixture')])
        finally:
            module.MAX_TOTAL = previous

    def test_artifact_envelope_cannot_extract_arbitrary_paths_or_extra_files(self):
        inner = self.archive([('index.html', 'fixture')]).read_bytes()
        context = tempfile.TemporaryDirectory(prefix='bycoda-preview-envelope-')
        self.addCleanup(context.cleanup)
        output = pathlib.Path(context.name) / 'preview.zip'
        module.read_artifact_envelope(self.archive([('preview.zip', inner)]), output)
        self.assertEqual(output.read_bytes(), inner)
        for entries in [[('../preview.zip', inner)], [('preview.zip', inner), ('other.js', 'fixture')], [('preview.zip', b'')]]:
            with self.assertRaises(ValueError):
                module.read_artifact_envelope(self.archive(entries), pathlib.Path(context.name) / 'rejected.zip')

if __name__ == '__main__':
    unittest.main()
