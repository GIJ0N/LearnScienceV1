"""Actual loopback HTTP/SQLite checks for the separate demo, not visual acceptance."""
import json
import os
import queue
import socket
import subprocess
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from memory_store import DurableMemory


class Demo(unittest.TestCase):
    def test_controlled_save_failure_is_harness_only_and_one_shot(self):
        with tempfile.TemporaryDirectory() as directory:
            db=Path(directory)/'save-failure.sqlite3'
            command=[sys.executable,'tools/serve_controlled_demo.py','--db',str(db)]
            subprocess.run(command+['--prepare'],cwd=ROOT,check=True,capture_output=True,timeout=20)
            memory=DurableMemory(db);profile=memory.profiles()[0];loaded=memory.load(profile['profile_id'])
            with socket.socket() as sock:sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
            env=dict(os.environ);env.pop('GEMINI_API_KEY',None);env['PYTHONIOENCODING']='utf-8'
            proc=subprocess.Popen(command+['--resume','--port',str(port),'--fail-save-once'],cwd=ROOT,
                stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,encoding='utf-8',env=env)
            ready=queue.Queue();reader=threading.Thread(target=lambda:ready.put(proc.stdout.readline()),daemon=True);reader.start()
            try:
                self.assertIn('DEMOSTRACIÓN',ready.get(timeout=15));base=f'http://127.0.0.1:{port}'
                payload={'profile_id':profile['profile_id'],'store':loaded['store'],'expected_revision':loaded['revision']}
                request=lambda:urllib.request.Request(base+'/api/profile/save',data=json.dumps(payload).encode(),headers={'Content-Type':'application/json'})
                with self.assertRaises(urllib.error.HTTPError) as failed:urllib.request.urlopen(request(),timeout=5)
                self.assertEqual(failed.exception.code,503);failed.exception.close()
                with urllib.request.urlopen(request(),timeout=5) as response:self.assertEqual(json.load(response)['revision'],loaded['revision']+1)
            finally:
                proc.terminate();proc.communicate(timeout=10);reader.join(timeout=2)

    def test_restart_and_private_contract(self):
        with tempfile.TemporaryDirectory() as directory:
            db=Path(directory)/'demo.sqlite3'
            command=[sys.executable,'tools/serve_controlled_demo.py','--db',str(db)]
            subprocess.run(command+['--prepare'],cwd=ROOT,check=True,capture_output=True,timeout=20)
            memory=DurableMemory(db);pid=memory.profiles()[0]['profile_id']
            payload=dict(profile_id=pid,goal_id='visual-goal',activity_id='criterion-visual-demo',attempt_id='demo-attempt',
                selected_option_id='subtract-both',explanation='La misma operación reversible conserva ambos miembros.',help_used=1)
            result=None
            for semantic in ['SATISFIED','NOT_SATISFIED']:
                with socket.socket() as sock:sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
                env=dict(os.environ);env.pop('GEMINI_API_KEY',None);env['PYTHONIOENCODING']='utf-8'
                proc=subprocess.Popen(command+['--resume','--port',str(port),'--semantic',semantic],cwd=ROOT,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,encoding='utf-8',env=env)
                ready=queue.Queue()
                reader=threading.Thread(target=lambda:ready.put(proc.stdout.readline()),daemon=True);reader.start()
                try:
                    self.assertIn('DEMOSTRACIÓN',ready.get(timeout=15))
                    base=f'http://127.0.0.1:{port}'
                    with urllib.request.urlopen(base+'/api/health',timeout=5) as response:self.assertFalse(json.load(response)['configured'])
                    with urllib.request.urlopen(base,timeout=5) as response:self.assertIn('DEMOSTRACIÓN',response.read().decode())
                    request=urllib.request.Request(base+'/api/criteria/evaluate',data=json.dumps(payload).encode(),headers={'Content-Type':'application/json'})
                    with urllib.request.urlopen(request,timeout=5) as response:current=json.load(response)
                    self.assertEqual(current['overall'],'CORRECT');self.assertFalse(current['independent'])
                    if result is not None:self.assertEqual(current,result,'restart returns persisted result, not new provider judgement')
                    result=current
                    self.assertNotIn('correct_option_id',json.dumps(current))
                finally:
                    proc.terminate();proc.communicate(timeout=10);reader.join(timeout=2)
            self.assertNotIn('correct_option_id',json.dumps(memory.export(pid)))


if __name__=='__main__':unittest.main()
