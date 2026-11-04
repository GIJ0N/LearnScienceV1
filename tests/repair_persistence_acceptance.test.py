"""Controlled HTTP/SQLite acceptance for commit-then-response-loss reconciliation."""
import json
import socket
import sys
import tempfile
import threading
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from memory_store import DurableMemory

tmp = Path(tempfile.mkdtemp(prefix='learnscience-repair-acceptance-')) / 'acceptance.sqlite3'
memory = DurableMemory(tmp)
profile = memory.create_profile('Perfil sintético aceptación')
pid = profile['profile_id']
base = {'schema_version':5,'profile_id':pid,'active':'goal-1','goals':[{'id':'goal-1','profile_id':pid,'goal':'Álgebra','nodes':[{'id':'n1','name':'Ecuaciones','prerequisites':[]}],'coverage':[{'id':'n1','dimensions':[]}],'learner':{},'lessons':{'n1':{}},'reviews':[],'events':[],'repairEpisodes':[],'contextStack':[],'session':{'mode':'DIAGNOSTIC','node':None}}]}
saved = memory.save(pid, base, expected_revision=1)
revision = saved['revision']
committed = json.loads(json.dumps(base)); committed['goals'][0]['events']=[{'type':'EVIDENCE','attempt_id':'attempt-committed','evidence_id':'evidence-committed','activity_id':'activity-1','node_id':'n1','phase':'INDEPENDENT','result':'PARTIAL','status':'PARTIAL','answer':'respuesta sintética','help_used':0}]

class Handler(BaseHTTPRequestHandler):
    fail_response = True
    def do_POST(self):
        size = int(self.headers.get('Content-Length','0')); payload=json.loads(self.rfile.read(size) or '{}')
        try:
            result=memory.save(payload['profile_id'],payload['store'],payload.get('expected_revision'))
            if self.path == '/api/profile/save' and Handler.fail_response:
                Handler.fail_response=False
                self.connection.shutdown(socket.SHUT_RDWR); self.connection.close(); return
            body=json.dumps(result).encode(); self.send_response(200); self.send_header('Content-Type','application/json'); self.send_header('Content-Length',str(len(body))); self.end_headers(); self.wfile.write(body)
        except ValueError as exc:
            body=json.dumps({'error':str(exc)}).encode(); self.send_response(409); self.send_header('Content-Type','application/json'); self.send_header('Content-Length',str(len(body))); self.end_headers(); self.wfile.write(body)
    def log_message(self, *_): pass

server=ThreadingHTTPServer(('127.0.0.1',0),Handler);thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start();url=f'http://127.0.0.1:{server.server_port}/api/profile/save'
try:
    request=urllib.request.Request(url,data=json.dumps({'profile_id':pid,'store':committed,'expected_revision':revision}).encode(),headers={'Content-Type':'application/json'},method='POST')
    try:
        urllib.request.urlopen(request,timeout=3)
    except (urllib.error.URLError, ConnectionError, socket.error):
        pass
    disk_after_commit=memory.load(pid)
    assert disk_after_commit['revision']==revision+1
    assert [e['attempt_id'] for e in disk_after_commit['store']['goals'][0]['events']]==['attempt-committed']
    stale=json.loads(json.dumps(committed));stale['goals'][0]['events'].append({'type':'EVIDENCE','attempt_id':'attempt-duplicate-client','evidence_id':'evidence-duplicate-client','activity_id':'activity-2','node_id':'n1','phase':'INDEPENDENT','result':'CORRECT','status':'CORRECT','answer':'respuesta tardía','help_used':0})
    stale_request=urllib.request.Request(url,data=json.dumps({'profile_id':pid,'store':stale,'expected_revision':revision}).encode(),headers={'Content-Type':'application/json'},method='POST')
    try:
        urllib.request.urlopen(stale_request,timeout=3)
    except urllib.error.HTTPError as exc:
        assert exc.code==409
    reloaded=memory.load(pid)
    assert reloaded['revision']==revision+1
    assert [e['attempt_id'] for e in reloaded['store']['goals'][0]['events']]==['attempt-committed']
finally:
    server.shutdown();server.server_close();thread.join(timeout=2)
print('repair_persistence_acceptance.test.py PASS')
