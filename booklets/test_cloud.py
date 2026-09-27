import io
import json
import os
import tempfile
import unittest
from pathlib import Path
test_data=tempfile.TemporaryDirectory()
os.environ['BOOKLETS_DATA']=test_data.name
os.environ['BOOKLETS_GATEWAY_SECRET']='test-secret-'*4
os.environ['BOOKLETS_PUBLIC_ORIGIN']='https://treinbord.up.railway.app'
from cryptography.fernet import Fernet
os.environ['BOOKLETS_ENCRYPTION_KEY']=Fernet.generate_key().decode()
import cloud
import google_connection

def request(path,method='GET',body=b'',authorized=True):
    status=[]
    env={'PATH_INFO':path,'QUERY_STRING':'','REQUEST_METHOD':method,'CONTENT_LENGTH':str(len(body)),'wsgi.input':io.BytesIO(body)}
    if authorized:env['HTTP_X_BOOKLETS_GATEWAY']=os.environ['BOOKLETS_GATEWAY_SECRET']
    result=cloud.application(env,lambda code,headers:status.extend([int(code.split()[0]),dict(headers)]))
    try:raw=b''.join(result)
    finally:
        if hasattr(result,'close'):result.close()
    return *status,raw

class CloudTests(unittest.TestCase):
    def test_private(self):
        for path in ['/','/api/state','/files/export/'+'a'*32,'/import','/google/callback']:
            self.assertEqual(request(path,authorized=False)[0],401)
        self.assertEqual(request('/health',authorized=False)[0],200)
    def test_session_and_removed_local_auth(self):
        self.assertFalse(json.loads(request('/api/session')[2])['setup'])
        for path in ['/api/login','/api/users','/api/setup','/api/google/configure']:
            self.assertEqual(request(path,'POST')[0],404)
    def test_prefix_and_logout(self):
        text=request('/')[2].decode()
        self.assertIn("api('/seinhuis/boekjesmaker/api/state')",text)
        self.assertIn("fetch('/api/admin-security/logout'",text)
        self.assertNotIn('Lokaal op deze computer',text)
        self.assertNotIn('Herstart Boekjesmaker.cmd',text)
        digital=cloud.page((cloud.server.ROOT/'digital.html').read_bytes()).decode()
        self.assertIn("fetch('/seinhuis/boekjesmaker/api/digital/'",digital)
        self.assertNotIn('/api/seinhuis/',digital)
    def test_quota_rejects_new_files(self):
        os.environ['BOOKLETS_STORAGE_LIMIT']='1000'
        try:
            status,_,raw=request('/api/upload','POST',b'%PDF')
            self.assertEqual(status,400)
            self.assertIn('opslagruimte',json.loads(raw)['error'])
        finally:os.environ.pop('BOOKLETS_STORAGE_LIMIT')
    def test_single_heavy_operation(self):
        cloud.BUSY.acquire()
        try:
            self.assertEqual(request('/api/upload','POST')[0],429)
            self.assertEqual(request('/api/state')[0],200)
        finally:cloud.BUSY.release()
    def test_stream_pdf(self):
        path=cloud.server.DATA/'exports'/('a'*32+'.pdf');path.write_bytes(b'private pdf')
        self.assertEqual(request('/files/export/'+'a'*32)[2],b'private pdf')
        self.assertEqual(request('/files/export/'+'a'*32,authorized=False)[0],401)
    def test_google_encryption(self):
        google_connection.write(cloud.server.DATA,{'client_id':'test','refresh_token':'not-a-real-token'})
        raw=(cloud.server.DATA/'google-connection.bin').read_bytes()
        self.assertNotIn(b'not-a-real-token',raw)
        self.assertEqual(json.loads(google_connection.protect(raw,True))['refresh_token'],'not-a-real-token')
    def test_pdf_upload_generate_preview(self):
        from reportlab.pdfgen import canvas
        stream=io.BytesIO();pdf=canvas.Canvas(stream,pagesize=(595,420));pdf.drawString(30,390,'Test route');pdf.showPage();pdf.save()
        status,_,raw=request('/api/upload','POST',stream.getvalue())
        self.assertEqual(status,200,raw);asset=json.loads(raw)
        self.assertEqual(asset['format'],'A5')
        status,_,raw=request('/files/preview/'+asset['id']+'/0')
        self.assertEqual(status,200,raw[:100]);self.assertTrue(raw.startswith(b'\x89PNG'))
        body={'format':'A5','sections':[{'asset':asset['id'],'pages':1,'fields':[],'title':'Test route','values':{}}]}
        status,_,raw=request('/api/save','POST',json.dumps({'kind':'book','title':'Testboekje','body':body}).encode())
        self.assertEqual(status,200,raw);saved=json.loads(raw)
        status,_,raw=request('/api/export','POST',json.dumps({**saved,'allowUneven':True}).encode())
        self.assertEqual(status,200,raw);export=json.loads(raw)
        self.assertTrue(export['url'].startswith('/seinhuis/boekjesmaker/files/export/'))
        self.assertEqual(export['report']['pages'],1)
        status,_,raw=request(export['url'].removeprefix(cloud.PREFIX))
        self.assertEqual(status,200);self.assertTrue(raw.startswith(b'%PDF'))

if __name__=='__main__':
    unittest.main()
