#!/usr/bin/env python3
"""Print content-free literal/official-normalized WER and measured resource summaries."""
import argparse
import json
from pathlib import Path
import statistics
import sys

from benchmark import ROOT, digest, score, token_score


def normalizer(directory):
    expected = json.loads(Path(__file__).with_name('normalizer.json').read_text())
    for name, checksum in expected['files'].items():
        if digest(directory / 'whisper_normalizers' / name) != checksum:
            raise ValueError('normalizer_hash_mismatch')
    if digest(directory / 'LICENSE') != expected['license_sha256']:
        raise ValueError('normalizer_license_mismatch')
    sys.path.insert(0, str(directory))
    from whisper_normalizers import EnglishTextNormalizer
    return EnglishTextNormalizer()


def aggregate(cases, normalize):
    pairs = [(score(case['reference_text'], case['hypothesis']),
              token_score(normalize(case['reference_text']).split(), normalize(case['hypothesis']).split()))
             for case in cases]
    result = {'cases': len(cases), 'audio_seconds': sum(case['audio_seconds'] for case in cases),
              'wall_seconds': sum(case['wall_seconds'] for case in cases),
              'max_clip_wall_seconds': max(case['wall_seconds'] for case in cases),
              'peak_rss_bytes': max(case['peak_rss_bytes'] for case in cases),
              'complete_cases': sum(case['complete'] for case in cases),
              'unexpected_nonempty_cases': sum(not case['reference_text'] and bool(case['hypothesis']) for case in cases)}
    for name, index in (('literal', 0), ('normalized', 1)):
        words = sum(pair[index]['reference_words'] for pair in pairs)
        errors = sum(pair[index]['errors'] for pair in pairs if pair[index]['reference_words'])
        result[name] = {'errors': errors, 'words': words, 'wer': errors / words if words else None}
    result['wer_scope'] = 'nonempty references only; silence insertions reported separately'
    result['rtf'] = result['wall_seconds'] / result['audio_seconds']
    warm = [case['wall_seconds'] for case in cases if not case['cold']]
    result['warm_median_seconds'] = statistics.median(warm) if warm else None
    result['per_case'] = [{'id': case['id'], 'literal': pair[0], 'normalized': pair[1],
                          'wall_seconds': case['wall_seconds'], 'rtf': case['rtf']}
                         for case, pair in zip(cases, pairs)]
    return result


def check_complete_run(rows):
    if any(row.get("event") in ("abort", "failed", "error", "cancelled") for row in rows):
        raise ValueError("aborted_or_failed_run")
    metadata = next(row for row in rows if row.get("event") == "metadata")
    expected = metadata.get("expected_case_ids")
    if expected is None:
        # Legacy completed measurements can carry an explicit, independently
        # checked input-manifest coverage record; no implicit subset inference.
        coverage = next((row for row in rows if row.get("event") == "coverage_verification"), None)
        if not coverage or coverage.get("manifest_sha256") != metadata["manifest_sha256"]:
            raise ValueError("missing_expected_case_coverage")
        expected = coverage["expected_case_ids"]
    if metadata.get("expected_case_count", len(expected)) != len(expected):
        raise ValueError("expected_case_count_mismatch")
    cases = [row for row in rows if row.get("event") == "case"]
    actual = [case["id"] for case in cases]
    if not expected or len(set(expected)) != len(expected) or actual != expected:
        raise ValueError("incomplete_or_duplicate_case_coverage")
    if any(not case["complete"] for case in cases):
        raise ValueError("incomplete_generation")
    return metadata, cases


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('results', type=Path, nargs='+')
    parser.add_argument('--normalizer', type=Path, default=ROOT / 'normalizer')
    args = parser.parse_args()
    normalize = normalizer(args.normalizer)
    for path in args.results:
        rows = [json.loads(line) for line in path.read_text().splitlines()]
        metadata, cases = check_complete_run(rows)
        ready = next(row for row in rows if row.get('event') == 'ready')
        groups = {tag: aggregate([case for case in cases if case['tag'] == tag], normalize)
                  for tag in sorted({case['tag'] for case in cases})}
        print(json.dumps({'file': path.name, 'model': metadata['model'], 'device': metadata['device'],
                          'complete_run': True, 'expected_case_count': len(cases), 'load': ready, 'summary': aggregate(cases, normalize), 'groups': groups}, ensure_ascii=False))


if __name__ == '__main__':
    main()
