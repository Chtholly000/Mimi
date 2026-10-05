"""Rescore private ASR evidence without emitting reference or hypothesis text."""
import argparse
from collections import Counter, defaultdict
import hashlib
import json
from pathlib import Path
import re
import statistics
import sys


def errors(ref, hyp):
    previous = list(range(len(hyp) + 1))
    for i, token in enumerate(ref, 1):
        current = [i]
        for j, guess in enumerate(hyp, 1):
            current.append(min(current[-1] + 1, previous[j] + 1,
                               previous[j - 1] + (token != guess)))
        previous = current
    return previous[-1]


def read(path):
    if path.suffix == ".jsonl":
        return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]
    value = json.loads(path.read_text())
    return value["cases"]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", action="append", required=True, help="LABEL=private-evidence-path")
    parser.add_argument("--normalizer-dir", type=Path, required=True)
    parser.add_argument("--human-manifest", type=Path, help="Require exact 40-case corpus coverage for every model")
    args = parser.parse_args()
    expected = {}
    if args.human_manifest:
        expected_rows = read(args.human_manifest)
        expected = {r["id"]: r for r in expected_rows}
        if len(expected_rows) != 40 or len(expected) != 40 or Counter(r["split"] for r in expected_rows) != {"test-clean": 20, "test-other": 20}:
            raise ValueError("expected_40_human_cases")
    manifest = json.loads((args.normalizer_dir / "manifest.json").read_text())
    for name, expected_hash in manifest["files"].items():
        source = args.normalizer_dir / "whisper_normalizers" / name
        if hashlib.sha256(source.read_bytes()).hexdigest() != expected_hash:
            raise ValueError("normalizer_hash_mismatch")
    sys.path.insert(0, str(args.normalizer_dir))
    from whisper_normalizers import EnglishTextNormalizer
    normalize = EnglishTextNormalizer()
    grouped = defaultdict(list)
    seen = set()
    labels = set()
    for spec in args.input:
        label, name = spec.split("=", 1)
        labels.add(label)
        for row in read(Path(name)):
            if row.get("event") in ("failed", "error", "abort", "aborted") or row.get("complete") is False:
                raise ValueError("failed_or_incomplete_evidence")
            if "hypothesis" not in row:
                if row.get("event") in ("case", "result", "failed", "error"):
                    raise ValueError("failed_or_incomplete_evidence")
                continue
            case_id = row["id"]
            if (label, case_id) in seen:
                raise ValueError("duplicate_case_for_model")
            seen.add((label, case_id))
            ref = row.get("reference", row.get("reference_text"))
            if not isinstance(ref, str):
                raise ValueError("missing_reference")
            declared_split = row.get("split", row.get("tag", "unspecified"))
            if expected and declared_split in ("test-clean", "test-other") and case_id not in expected:
                raise ValueError("unexpected_human_case")
            if case_id in expected:
                original = expected[case_id]
                if declared_split != original["split"]:
                    raise ValueError("human_split_changed")
                if ref.strip() != original["reference"].strip():
                    raise ValueError("reference_changed")
                if row.get("sha256", row.get("audio_sha256")) != original["sha256"]:
                    raise ValueError("input_hash_changed")
            hyp = row["hypothesis"]
            split = declared_split
            if re.fullmatch(r"en-\d+", case_id):
                split = "synthetic"
            elif "combined" in case_id or "continuous" in case_id:
                split = "continuous-file"
            elif "silence" in case_id:
                split = "silence"
            elif "jfk" in case_id:
                split = "jfk"
            literal_ref = re.findall(r"[a-z0-9]+", ref.casefold())
            literal_hyp = re.findall(r"[a-z0-9]+", hyp.casefold())
            normal_ref, normal_hyp = normalize(ref).split(), normalize(hyp).split()
            duration = row.get("duration_s", row.get("audio_seconds"))
            elapsed = row.get("decode_s", row.get("decode_seconds", row.get("elapsed_s")))
            item = {"id": case_id, "audio_s": duration, "decode_s": elapsed,
                    "literal_errors": errors(literal_ref, literal_hyp), "literal_words": len(literal_ref),
                    "normalized_errors": errors(normal_ref, normal_hyp), "normalized_words": len(normal_ref),
                    "nonempty": bool(hyp.strip())}
            grouped[(label, split)].append(item)
    if expected:
        for label in labels:
            if {case_id for model, case_id in seen if model == label and case_id in expected} != set(expected):
                raise ValueError("human_corpus_incomplete")
    results = []
    for (label, split), rows in sorted(grouped.items()):
        result = {"model": label, "split": split, "cases": len(rows),
                  "audio_s": sum(r["audio_s"] for r in rows),
                  "decode_s": sum(r["decode_s"] for r in rows),
                  "decode_median_s": statistics.median(r["decode_s"] for r in rows),
                  "nonempty_cases": sum(r["nonempty"] for r in rows)}
        for metric in ("literal", "normalized"):
            n = sum(r[f"{metric}_words"] for r in rows)
            e = sum(r[f"{metric}_errors"] for r in rows)
            result[metric] = {"errors": e, "words": n, "wer": e / n if n else None}
        result["rtf"] = result["decode_s"] / result["audio_s"]
        results.append(result)
    print(json.dumps({"normalizer_revision": manifest["revision"], "human_coverage_verified": bool(expected), "results": results}, indent=2))


if __name__ == "__main__":
    main()
