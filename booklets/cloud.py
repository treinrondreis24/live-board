"""Private WSGI adapter. Seinhuis authenticates every customer-data request."""
import hmac
import json
import os
import re
import shutil
import threading
from email.message import Message
from types import SimpleNamespace
from urllib.parse import urlsplit
from wsgiref.util import FileWrapper
import server

PREFIX='/seinhuis/boekjesmaker'
SECRET=os.environ.get('BOOKLETS_GATEWAY_SECRET','')
if len(SECRET)<32:
    raise RuntimeError('BOOKLETS_GATEWAY_SECRET must contain at least 32 characters')
server.POPPLER=shutil.which('pdftoppm') or server.POPPLER
BUSY=threading.BoundedSemaphore(1)

def page(raw):
    text=raw.decode('utf-8')
    for path in ('/api/','/files/','/digital/'):
        text=text.replace(path,PREFIX+path)
    return text.replace('/seinhuis-logout-placeholder','/api/admin-security/logout').replace('href="/"','href="'+PREFIX+'/"').encode()

class Handler(server.Handler):
    def auth(self):
        return {'user':{'name':'Seinhuis-beheerder','admin':True}}

    def send(self,status,body,ctype='application/json',headers=None):
        if ctype=='application/json':
            if isinstance(body,dict) and isinstance(body.get('url'),str) and body['url'].startswith('/files/'):
                body={**body,'url':PREFIX+body['url']}
            raw=json.dumps(body,ensure_ascii=False).encode()
        elif ctype.startswith('text/html'):
            raw=page(body)
        else:
            raw=body
        self.result=(status,raw,ctype,headers or {})

def application(environ,start_response):
    def response(status,body,ctype='application/json',headers=None):
        raw=json.dumps(body).encode() if ctype=='application/json' else body
        start_response(str(status)+' '+{200:'OK',400:'Bad Request',401:'Unauthorized',404:'Not Found',405:'Method Not Allowed',413:'Content Too Large',429:'Too Many Requests',500:'Internal Server Error'}.get(status,'Response'),
            [('Content-Type',ctype),('Content-Length',str(len(raw))),('Cache-Control','no-store'),('X-Content-Type-Options','nosniff'),*(headers or {}).items()])
        return [raw]
    path=environ.get('PATH_INFO','/')
    if path=='/health' and environ['REQUEST_METHOD']=='GET':
        return response(200,{'ok':True})
    supplied=environ.get('HTTP_X_BOOKLETS_GATEWAY','')
    if not hmac.compare_digest(supplied.encode(),SECRET.encode()):
        return response(401,{'error':'Geen toegang.'})
    method=environ['REQUEST_METHOD']
    if method not in ('GET','POST','HEAD'):
        return response(405,{'error':'Ongeldige methode.'})
    if path in ('/api/setup','/api/login','/api/users','/api/logout','/api/google/configure'):
        return response(404,{'error':'Beheer dit via Seinhuis of Railway Secrets.'})
    if path=='/api/session':
        return response(200,{'setup':False,'user':{'name':'Seinhuis-beheerder','admin':True},'version':server.APP_VERSION+'-online','cloud':True})
    if path=='/import' and method=='GET' and os.environ.get('BOOKLETS_IMPORT_ENABLED')=='1':
        return response(200,(server.ROOT/'import.html').read_bytes(),'text/html; charset=utf-8')
    try:
        size=int(environ.get('CONTENT_LENGTH') or 0)
    except ValueError:
        return response(400,{'error':'Ongeldige uploadlengte.'})
    if not 0<=size<=50*1024*1024:
        return response(413,{'error':'Maximaal 50 MB per upload.'})
    # Stream immutable PDFs without retaining the document in memory.
    match=re.fullmatch(r'/files/(asset|export)/([a-f0-9]{32})',path)
    if match and method in ('GET','HEAD'):
        kind,ident=match.groups()
        filename=server.DATA/('pdfs' if kind=='asset' else 'exports')/(ident+'.pdf')
        if not filename.is_file():return response(404,{'error':'Niet gevonden.'})
        mode='attachment' if 'download=' in environ.get('QUERY_STRING','') else 'inline'
        start_response('200 OK',[('Content-Type','application/pdf'),('Content-Length',str(filename.stat().st_size)),('Content-Disposition',f'{mode}; filename="boekje-{ident[:8]}.pdf"'),('Cache-Control','no-store')])
        return [] if method=='HEAD' else FileWrapper(filename.open('rb'),64*1024)
    # One mutation/render at a time. Busy requests are rejected, not queued in RAM.
    heavy=method=='POST' or path.startswith('/files/') or path=='/google/callback'
    if heavy and not BUSY.acquire(blocking=False):
        return response(429,{'error':'Er wordt al een boekje of pagina verwerkt. Probeer het zo nog eens.'},headers={'Retry-After':'3'})
    try:
        if path.startswith('/api/migration/'):
            import migration
            result=migration.handle(path,environ,server)
            return response(*result)
        handler=Handler.__new__(Handler)
        handler.path=path+('?' + environ['QUERY_STRING'] if environ.get('QUERY_STRING') else '')
        handler.server=SimpleNamespace(server_port=8766)
        handler.headers=Message()
        for key,value in {'Host':'127.0.0.1:8766','Origin':'http://127.0.0.1:8766','X-Booklets':'1','Content-Length':str(size),'Content-Type':environ.get('CONTENT_TYPE','application/json')}.items():handler.headers[key]=value
        handler.rfile=environ['wsgi.input']
        handler.result=(500,b'{"error":"Verwerking mislukt."}','application/json',{})
        (handler.do_POST if method=='POST' else handler.do_GET)()
        status,raw,ctype,headers=handler.result
        return response(status,raw,ctype if ctype!='application/json' else 'application/json; charset=utf-8',headers)
    except Exception:
        return response(500,{'error':'Verwerking mislukt. De oorspronkelijke bestanden blijven bewaard.'})
    finally:
        if heavy:BUSY.release()
