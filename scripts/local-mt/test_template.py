"""Golden prompt from the pinned GGUF; no weights or inference required in CI."""
import json
from pathlib import Path
import unittest


class PromptTests(unittest.TestCase):
    def test_candidate_template_keeps_original_prompt_bytes(self):
        directory = Path(__file__).with_name('models')
        for manifest_path in directory.glob('*.json'):
            manifest = json.loads(manifest_path.read_text())
            if not manifest.get('chat_template_file'):
                continue
            import jinja2
            def reject(message):
                raise ValueError(message)
            environment = jinja2.Environment(undefined=jinja2.StrictUndefined)
            environment.globals['raise_exception'] = reject
            template = environment.from_string((directory / manifest['chat_template_file']).read_text())
            actual = template.render(messages=[{'role': 'user', 'content': 'Synthetic input.'}],
                                     source_lang_code='en', target_lang_code='zh-Hans',
                                     bos_token='<bos>', add_generation_prompt=True)
            expected = (directory / 'translategemma-text.expected.txt').read_text()
            self.assertEqual(actual, expected)


if __name__ == '__main__':
    unittest.main()
