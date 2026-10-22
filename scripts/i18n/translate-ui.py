"""Development-only machine translation of public UI copy.

No account data, prompts, source files, credentials or runtime data are sent.
The shipped app uses bundled JSON only. Run explicitly to refresh catalogs;
review generated translations before release. Requires no Python packages.
"""
import concurrent.futures
import json
import pathlib
import re
import time
import urllib.parse
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[2] / 'src/shared/i18n/locales'
SOURCE = json.loads((ROOT / 'en.json').read_text(encoding='utf-8'))
LANGUAGES = {'tr': 'tr', 'de': 'de', 'fr': 'fr', 'es': 'es', 'pt': 'pt', 'zh-CN': 'zh-CN', 'ja': 'ja'}

def translate_batch(keys, target):
    query = '\n\n'.join(f'[[{i:04d}]]\n' + re.sub(r'\s+', ' ', key).strip() for i, key in enumerate(keys)) if len(keys) > 1 else re.sub(r'\s+', ' ', keys[0]).strip()
    url = 'https://translate.googleapis.com/translate_a/single?' + urllib.parse.urlencode({'client': 'gtx', 'sl': 'en', 'tl': target, 'dt': 't', 'q': query})
    error = None
    for attempt in range(5):
        try:
            request = urllib.request.Request(url, headers={'User-Agent': 'Bycoda-UI-Catalog/1.0'})
            with urllib.request.urlopen(request, timeout=45) as response:
                data = json.load(response)
            text = ''.join(part[0] or '' for part in data[0])
            if len(keys) == 1:
                if sorted(re.findall(r'\{p\d+\}', text)) != sorted(re.findall(r'\{p\d+\}', keys[0])):
                    raise ValueError(f'placeholder changed: {keys[0]!r} -> {text!r}')
                return {keys[0]: re.match(r'^\s*', keys[0]).group() + text.strip() + re.search(r'\s*$', keys[0]).group()}
            matches = list(re.finditer(r'[\[［【]{1,2}\s*(\d+)\s*[\]］】]{1,2}', text))
            if len(matches) != len(keys):
                raise ValueError(f'marker count {len(matches)} != {len(keys)}')
            result = {}
            for index, match in enumerate(matches):
                if int(match.group(1)) != index:
                    raise ValueError('message order changed')
                end = matches[index + 1].start() if index + 1 < len(matches) else len(text)
                translated = text[match.end():end].strip()
                translated = re.sub(r'\{\s*p\s*(\d+)\s*\}', r'{p\1}', translated)
                if sorted(re.findall(r'\{p\d+\}', translated)) != sorted(re.findall(r'\{p\d+\}', keys[index])):
                    raise ValueError(f'placeholder changed: {keys[index]!r} -> {translated!r}')
                if not translated:
                    raise ValueError('empty translation')
                leading = re.match(r'^\s*', keys[index]).group()
                trailing = re.search(r'\s*$', keys[index]).group()
                result[keys[index]] = leading + translated + trailing
            return result
        except Exception as exc:
            error = exc
            if attempt == 0:
                print(f'Retrying {target} ({len(keys)} messages): {exc}', flush=True)
            if isinstance(exc, ValueError):
                break
            time.sleep(min(2 ** attempt, 10))
    # Smaller requests isolate malformed machine translations without accepting
    # incomplete catalogs or silently discarding placeholders.
    if len(keys) > 1:
        middle = len(keys) // 2
        return translate_batch(keys[:middle], target) | translate_batch(keys[middle:], target)
    raise RuntimeError(f'{target}: {keys[0]!r}: {error}')

def language(locale, target):
    destination = ROOT / f'{locale}.json'
    existing = json.loads(destination.read_text(encoding='utf-8')) if destination.exists() else {}
    missing = [key for key in SOURCE if key not in existing]
    batches, batch, size = [], [], 0
    for key in missing:
        if size + len(key) > 2300 and batch:
            batches.append(batch)
            batch, size = [], 0
        batch.append(key)
        size += len(key) + 15
    if batch:
        batches.append(batch)
    for index, batch in enumerate(batches):
        existing.update(translate_batch(batch, target))
        destination.write_text(json.dumps({key: existing[key] for key in SOURCE if key in existing}, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        print(f'{locale}: {index + 1}/{len(batches)} ({len(existing)}/{len(SOURCE)})', flush=True)
    if locale == 'tr':
        overrides = json.loads((ROOT.parent / 'tr-overrides.json').read_text(encoding='utf-8'))
        existing.update({key: value for key, value in overrides.items() if key in SOURCE})
        destination.write_text(json.dumps({key: existing[key] for key in SOURCE if key in existing}, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    return locale

if __name__ == '__main__':
    with concurrent.futures.ThreadPoolExecutor(max_workers=7) as pool:
        for result in pool.map(lambda item: language(*item), LANGUAGES.items()):
            print(f'Complete: {result}', flush=True)
