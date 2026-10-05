"""Coverage regressions; a local identity normalizer isolates corpus validation."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


class CoverageTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.normalizer = self.root / "normalizer"
        package = self.normalizer / "whisper_normalizers"
        package.mkdir(parents=True)
        source = b"class EnglishTextNormalizer:\n def __call__(self, text):\n  return text.lower()\n"
        (package / "__init__.py").write_bytes(source)
        (self.normalizer / "manifest.json").write_text(json.dumps({
            "revision": "coverage-test-only", "files": {"__init__.py": hashlib.sha256(source).hexdigest()}}))
        self.cases = [{"id": str(i), "reference": "public test", "sha256": "a" * 64,
                       "split": "test-clean" if i < 20 else "test-other", "duration_s": 1,
                       "hypothesis": "public test", "decode_s": 0.1} for i in range(40)]
        self.manifest = self.root / "manifest.jsonl"
        self.manifest.write_text("\n".join(json.dumps(row) for row in self.cases))

    def run_score(self, cases):
        evidence = self.root / "evidence.jsonl"
        evidence.write_text("\n".join(json.dumps(row) for row in cases))
        return subprocess.run([sys.executable, str(Path(__file__).with_name("score_asr.py")),
                               "--normalizer-dir", str(self.normalizer), "--human-manifest", str(self.manifest),
                               "--input", f"candidate={evidence}"], capture_output=True, text=True, timeout=10)

    def test_full_coverage_is_verified(self):
        result = self.run_score(self.cases)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(json.loads(result.stdout)["human_coverage_verified"])

    def test_one_missing_utterance_rejects_ranking(self):
        result = self.run_score(self.cases[:-1])
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("human_corpus_incomplete", result.stderr)

    def test_failed_case_rejects_ranking(self):
        result = self.run_score(self.cases[:-1] + [{"id": "39", "event": "failed"}])
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("failed_or_incomplete_evidence", result.stderr)

    def test_changed_pcm_rejects_comparison(self):
        result = self.run_score([{**self.cases[0], "sha256": "b" * 64}, *self.cases[1:]])
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("input_hash_changed", result.stderr)

    def test_extra_human_utterance_rejects_ranking(self):
        result = self.run_score(self.cases + [{**self.cases[0], "id": "extra"}])
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("unexpected_human_case", result.stderr)

    def test_changed_split_rejects_comparison(self):
        result = self.run_score([{**self.cases[0], "split": "test-other"}, *self.cases[1:]])
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("human_split_changed", result.stderr)

    def test_abort_after_complete_corpus_rejects_ranking(self):
        result = self.run_score(self.cases + [{"event": "abort"}])
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("failed_or_incomplete_evidence", result.stderr)


if __name__ == "__main__":
    unittest.main()
