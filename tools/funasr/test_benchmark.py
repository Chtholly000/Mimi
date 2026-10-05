import hashlib
import json
from pathlib import Path
import sys
import subprocess
import time
import tempfile
import unittest
import wave

from benchmark import Worker, chunks, read_cases, score, wav_info
from summarize import aggregate, check_complete_run


class BenchmarkTests(unittest.TestCase):
    def test_literal_numbers_are_not_silently_normalized(self):
        self.assertEqual(score('Two shields.', '2 shields!')['errors'], 1)
        self.assertEqual(score('DO not stop.', 'do NOT stop')['wer'], 0)
        self.assertEqual(score('', 'noise')['wer'], None)

    def test_deletions_and_insertions_count(self):
        self.assertEqual(score('one two three', 'one three')['errors'], 1)
        self.assertEqual(score('one two', 'one big two')['errors'], 1)

    def test_chunk_boundaries_cover_once(self):
        for frames in (1, 480000, 480001, 1540214):
            ranges = chunks(frames)
            self.assertEqual(ranges[0][0], 0)
            self.assertEqual(ranges[-1][1], frames)
            self.assertTrue(all(end - start <= 480000 for start, end in ranges))
            self.assertTrue(all(left[1] == right[0] for left, right in zip(ranges, ranges[1:])))
            self.assertEqual(sum(end - start for start, end in ranges), frames)

    def fixture(self, directory):
        audio = directory / 'sample.wav'
        with wave.open(str(audio), 'wb') as stream:
            stream.setparams((1, 2, 16000, 0, 'NONE', 'not compressed'))
            stream.writeframes(b'\0\0' * 1600)
        (directory / 'sample.txt').write_text('Test text.\n')
        return {'id': 's1', 'wav': 'sample.wav', 'reference': 'sample.txt',
                'sha256': hashlib.sha256(audio.read_bytes()).hexdigest()}

    def test_json_and_jsonl_manifests(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            item = self.fixture(directory)
            manifest = directory / 'manifest.json'
            manifest.write_text(json.dumps({'cases': [item]}))
            self.assertEqual(read_cases(manifest)[0]['reference_text'], 'Test text.')
            manifest = directory / 'manifest.jsonl'
            manifest.write_text(json.dumps({'id': 's1', 'audio_path': str(directory / 'sample.wav'),
                                            'reference': 'Test text.', 'sha256': item['sha256'], 'split': 'clean'})+'\n')
            self.assertEqual(read_cases(manifest)[0]['frames'], 1600)

    def test_bad_hash_and_duplicate_fail_before_loading(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            item = self.fixture(directory)
            manifest = directory / 'manifest.json'
            manifest.write_text(json.dumps({'cases': [item, item]}))
            with self.assertRaisesRegex(ValueError, 'duplicate'):
                read_cases(manifest)
            item['sha256'] = 'bad'
            manifest.write_text(json.dumps({'cases': [item]}))
            with self.assertRaisesRegex(ValueError, 'hash_mismatch'):
                read_cases(manifest)

    def test_sample_escape_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            item = self.fixture(directory)
            item['wav'] = '../outside.wav'
            manifest = directory / 'manifest.json'
            manifest.write_text(json.dumps(item))
            with self.assertRaisesRegex(ValueError, 'outside'):
                read_cases(manifest)

    def test_empty_audio_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            audio = Path(temporary) / 'empty.wav'
            with wave.open(str(audio), 'wb') as stream:
                stream.setparams((1, 2, 16000, 0, 'NONE', 'none'))
            with self.assertRaisesRegex(ValueError, 'duration'):
                wav_info(audio)

    def test_partial_protocol_lines_and_eof(self):
        process = Worker([sys.executable, '-c', "import os,time;os.write(1,b'{\"event\":');time.sleep(.03);os.write(1,b'\"ready\"}\\n')"])
        try:
            self.assertEqual(process.receive(1)['event'], 'ready')
            with self.assertRaisesRegex(RuntimeError, 'exited'):
                process.receive(1)
        finally:
            process.close()
        self.assertIsNotNone(process.process.poll())

    def test_timeout_cleanup_reaps_owned_worker(self):
        process = Worker([sys.executable, '-c', 'import time;time.sleep(30)'])
        try:
            with self.assertRaises(TimeoutError):
                process.receive(.03)
        finally:
            process.close()
        self.assertIsNotNone(process.process.poll())

    def test_worker_output_limit(self):
        process = Worker([sys.executable, '-c', "import sys;sys.stdout.write('a' * 1100000);sys.stdout.flush()"])
        try:
            with self.assertRaisesRegex(RuntimeError, 'response_limit'):
                process.receive(3)
        finally:
            process.close()

    def test_silence_is_separate_from_speech_wer(self):
        shared = {'audio_seconds': 1, 'wall_seconds': .1, 'peak_rss_bytes': 1,
                  'complete': True, 'cold': False, 'rtf': .1}
        cases = [{**shared, 'id': 'speech', 'reference_text': 'test', 'hypothesis': 'test'},
                 {**shared, 'id': 'silence', 'reference_text': '', 'hypothesis': 'noise'}]
        result = aggregate(cases, lambda text: text)
        self.assertEqual(result['literal']['wer'], 0)
        self.assertEqual(result['unexpected_nonempty_cases'], 1)
        self.assertEqual(result['per_case'][1]['literal']['errors'], 1)

    def test_summary_rejects_partial_aborted_duplicate_runs(self):
        metadata = {'event': 'metadata', 'expected_case_ids': ['a', 'b']}
        first = {'event': 'case', 'id': 'a', 'complete': True}
        second = {'event': 'case', 'id': 'b', 'complete': True}
        self.assertEqual(len(check_complete_run([metadata, first, second])[1]), 2)
        for rows in ([metadata, first], [metadata, first, first],
                     [metadata, first, second, {'event': 'abort'}],
                     [metadata, first, {**second, 'complete': False}],
                     [{**metadata, 'expected_case_count': 3}, first, second]):
            with self.assertRaises(ValueError):
                check_complete_run(rows)

    def assert_stopped(self, pid):
        import psutil
        deadline = time.monotonic() + 2
        while time.monotonic() < deadline:
            try:
                if psutil.Process(pid).status() == psutil.STATUS_ZOMBIE:
                    return
            except psutil.NoSuchProcess:
                return
            time.sleep(.02)
        self.fail('owned descendant still running')

    def nested_command(self, exit_leader=False):
        grandchild = 'import signal,time;signal.signal(signal.SIGTERM,signal.SIG_IGN);time.sleep(60)'
        leader = ("import subprocess,sys,time,json;"
                  f"p=subprocess.Popen([sys.executable,'-c',{grandchild!r}]);"
                  "time.sleep(.1);print(json.dumps({'event':'ready','child':p.pid}),flush=True);"
                  + ("sys.exit(0)" if exit_leader else "sys.stdin.read()"))
        return [sys.executable, '-c', leader]

    def test_close_cleans_descendant_after_leader_exit(self):
        process = Worker(self.nested_command(exit_leader=True))
        child = process.receive(2)['child']
        process.process.wait(timeout=2)
        process.close()
        self.assert_stopped(child)

    def test_runner_sigterm_cleans_owned_group(self):
        script = ("import sys,time,json;sys.path.insert(0," + repr(str(Path(__file__).parent)) + ");"
                  "from benchmark import Worker,install_cancellation_handler,RunCancelled;"
                  "install_cancellation_handler();p=Worker(" + repr(self.nested_command()) + ");"
                  "print(json.dumps(p.receive(2)),flush=True)\n"
                  "try: time.sleep(60)\n"
                  "except RunCancelled: pass\n"
                  "finally: p.close()\n")
        parent = subprocess.Popen([sys.executable, '-c', script], stdout=subprocess.PIPE,
                                  stderr=subprocess.PIPE, text=True)
        try:
            child = json.loads(parent.stdout.readline())['child']
            parent.terminate()
            parent.wait(timeout=5)
            self.assertEqual(parent.returncode, 0)
            self.assert_stopped(child)
        finally:
            if parent.poll() is None:
                parent.kill()
                parent.wait(timeout=2)
            parent.stdout.close()
            parent.stderr.close()

    def test_normal_eof_stops_worker(self):
        process = Worker([sys.executable, '-c', 'import sys;sys.stdin.read()'])
        process.close()
        self.assertEqual(process.process.returncode, 0)


if __name__ == '__main__':
    unittest.main()
