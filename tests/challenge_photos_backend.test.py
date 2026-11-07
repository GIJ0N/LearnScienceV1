"""challenge_photos_v1: fotos opcionales validadas, enviadas al modelo y nunca guardadas (solo su huella)."""
import base64
import contextlib
import importlib.util
import io
import json
import os
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
import app_legacy as app
from memory_store import DurableMemory

spec = importlib.util.spec_from_file_location('rwc', HERE / 'real_world_challenges_backend.test.py')
rwc = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rwc)

b64 = lambda raw: base64.b64encode(raw).decode()
JPEG = b'\xff\xd8\xff\xe0' + b'0' * 100
PNG = b'\x89PNG\r\n\x1a\n' + b'0' * 50
WEBP = b'RIFF\x00\x00\x00\x00WEBP' + b'0' * 50
photo = lambda raw=JPEG, mime='image/jpeg': {'mime': mime, 'data': b64(raw)}


class Photos(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = Path(self.tmp.name) / 'p.sqlite'
        self.memory = DurableMemory(self.path)
        self.profile = self.memory.create_profile('Sintético')['profile_id']
        self.patches = [patch.object(app, 'memory', return_value=self.memory), patch.object(app, 'CONTENT_VERIFY', False)]
        for p in self.patches:
            p.start()
        with patch.object(app, 'gemini', return_value=rwc.CHALLENGE):
            self.item = app.challenge_start({'profile_id': self.profile, 'goal_id': 'g1', 'goal': 'Física', 'node': rwc.NODE})
        app.challenge_commit({'profile_id': self.profile, 'goal_id': 'g1', 'item_id': self.item['item_id'], 'attempt_id': 'c1', 'prediction': rwc.PRED, 'confidence': 70})

    def tearDown(self):
        for p in self.patches:
            p.stop()
        self.tmp.cleanup()

    def report(self, photos=None, attempt='r1'):
        data = {'profile_id': self.profile, 'goal_id': 'g1', 'item_id': self.item['item_id'], 'attempt_id': attempt, 'prediction_attempt_id': 'c1',
                'evidence': rwc.EVID, 'reflection': rwc.REFL}
        if photos is not None:
            data['photos'] = photos
        with patch.object(app, 'gemini', return_value=rwc.REPORT) as g:
            try:
                return app.challenge_report(data), g
            except ValueError as exc:
                return exc, g

    def test_without_photos_nothing_changes(self):
        out, g = self.report()
        self.assertEqual(g.call_args.kwargs.get('images'), None)
        self.assertEqual(out['photo_count'], 0)
        self.assertNotIn('foto(s)', g.call_args[0][0])

    def test_valid_photo_goes_to_the_model_and_is_not_stored(self):
        out, g = self.report([photo(JPEG), photo(PNG, 'image/png')])
        self.assertEqual(g.call_args.kwargs['images'], [('image/jpeg', b64(JPEG)), ('image/png', b64(PNG))])
        self.assertIn('2 foto(s)', g.call_args[0][0])
        self.assertEqual(out['photo_count'], 2)
        self.assertEqual(len(out['photo_sha256'][0]), 64)
        self.assertNotIn(b64(JPEG), json.dumps(out))
        db = sqlite3.connect(self.path)
        dump = '\n'.join(db.iterdump())
        db.close()
        self.assertNotIn(b64(JPEG), dump)
        self.assertNotIn(b64(PNG), dump)

    def test_webp_is_accepted(self):
        out, _ = self.report([photo(WEBP, 'image/webp')])
        self.assertEqual(out['photo_count'], 1)

    def test_invalid_photos_are_rejected_before_the_model(self):
        cases = {'tres': [photo()] * 3, 'gif': [photo(JPEG, 'image/gif')], 'base64': [{'mime': 'image/jpeg', 'data': '@@no-es-base64@@'}],
                 'firma': [photo(b'no soy jpeg', 'image/jpeg')], 'grande': [photo(b'\xff\xd8' + b'0' * 1_000_001)], 'vacía': [photo(b'')],
                 'no lista': 'x', 'sin data': [{'mime': 'image/jpeg'}], 'png como jpeg': [photo(PNG, 'image/jpeg')]}
        for name, photos in cases.items():
            out, g = self.report(photos, attempt='r-' + name)
            self.assertIsInstance(out, ValueError, name)
            g.assert_not_called()

    def test_same_attempt_with_another_photo_conflicts(self):
        self.report([photo(JPEG)], attempt='same')
        out, _ = self.report([photo(JPEG + b'1')], attempt='same')
        self.assertIsInstance(out, ValueError)
        self.assertIn('PLACEMENT_ATTEMPT_CONFLICT', str(out))
        again, g = self.report([photo(JPEG)], attempt='same')
        self.assertEqual(again['photo_count'], 1)
        g.assert_not_called()

    def capture(self, fn, *args, **kw):
        seen = {}

        def fake(req, timeout=0):
            seen['body'] = json.loads(req.data.decode())
            raise OSError('sin red')
        with patch.dict(os.environ, {'GEMINI_API_KEY': 'x', 'ANTHROPIC_API_KEY': 'x'}), patch('urllib.request.urlopen', side_effect=fake), patch.object(app, '_consume_quota'):
            with contextlib.suppress(Exception):
                fn(*args, **kw)
        return seen['body']

    def test_gemini_call_puts_images_before_text(self):
        body = self.capture(app._gemini_call, 'hola', {'type': 'OBJECT'}, 100, images=[('image/jpeg', 'QUJD')])
        parts = body['contents'][0]['parts']
        self.assertEqual(parts[0], {'inline_data': {'mime_type': 'image/jpeg', 'data': 'QUJD'}})
        self.assertEqual(parts[-1], {'text': 'hola'})
        plain = self.capture(app._gemini_call, 'hola', {'type': 'OBJECT'}, 100)
        self.assertEqual(plain['contents'][0]['parts'], [{'text': 'hola'}])

    def test_anthropic_call_puts_images_before_text(self):
        body = self.capture(app._anthropic_call, 'hola', {'type': 'OBJECT'}, 100, images=[('image/png', 'QUJD')])
        content = body['messages'][0]['content']
        self.assertEqual(content[0], {'type': 'image', 'source': {'type': 'base64', 'media_type': 'image/png', 'data': 'QUJD'}})
        self.assertEqual(content[1], {'type': 'text', 'text': 'hola'})
        plain = self.capture(app._anthropic_call, 'hola', {'type': 'OBJECT'}, 100)
        self.assertEqual(plain['messages'][0]['content'], 'hola')


if __name__ == '__main__':
    unittest.main()
