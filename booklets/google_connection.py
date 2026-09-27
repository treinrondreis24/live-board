"""Read-only Google Docs OAuth for the local Windows pilot. No Codex credentials."""
import base64, ctypes, hashlib, json, os, re, secrets, threading, time
from urllib.parse import urlencode, urlparse, parse_qs
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

LOCK=threading.RLock()
PENDING={}
SCOPE='https://www.googleapis.com/auth/documents.readonly'

def document_id(url):
    p=urlparse(str(url))
    match=re.fullmatch(r'/document/d/([A-Za-z0-9_-]{15,150})(?:/[^?]*)?',p.path)
    if p.scheme!='https' or p.netloc!='docs.google.com' or not match:
        raise ValueError('Plak een Google Docs-link: https://docs.google.com/document/d/…')
    return match[1]

def request(url,data=None,token=None,limit=20*1024*1024):
    headers={'User-Agent':'Treinrondreis-Boekjesmaker/1'}
    if token:headers['Authorization']='Bearer '+token
    if data is not None:headers['Content-Type']='application/x-www-form-urlencoded'
    try:
        with urlopen(Request(url,urlencode(data).encode() if data is not None else None,headers),timeout=25) as r:
            raw=r.read(limit+1)
            if len(raw)>limit:raise ValueError('Het Google-document of de afbeelding is te groot.')
            return raw
    except HTTPError as e:
        if e.code==401:raise ValueError('Google-aanmelding verlopen. Koppel Google opnieuw via de bibliotheek.') from None
        if e.code in (403,404):raise ValueError('Geen toegang tot dit Google-document. Controleer de link, deelrechten en of de Google Docs API is ingeschakeld.') from None
        raise ValueError('Google kon het document niet leveren. Probeer opnieuw of koppel Google opnieuw.') from None
    except (URLError,TimeoutError,OSError):raise ValueError('Google is niet bereikbaar. Controleer uw internetverbinding.') from None

def protect(raw,decrypt=False):
    if os.environ.get('BOOKLETS_ENCRYPTION_KEY'):
        from cryptography.fernet import Fernet
        cipher=Fernet(os.environ['BOOKLETS_ENCRYPTION_KEY'].encode())
        return cipher.decrypt(raw) if decrypt else cipher.encrypt(raw)
    # DPAPI binds tokens to the current Windows account; never serve this file.
    if os.name!='nt':raise ValueError('Deze lokale Google-koppeling vereist Windows.')
    from ctypes import wintypes
    class Blob(ctypes.Structure):_fields_=[('size',wintypes.DWORD),('data',ctypes.POINTER(ctypes.c_ubyte))]
    buf=ctypes.create_string_buffer(raw);src=Blob(len(raw),ctypes.cast(buf,ctypes.POINTER(ctypes.c_ubyte)));dst=Blob()
    dll=ctypes.windll.crypt32
    fn=dll.CryptUnprotectData if decrypt else dll.CryptProtectData
    if not fn(ctypes.byref(src),None,None,None,None,1,ctypes.byref(dst)):
        raise ValueError('De Google-koppeling kan niet door dit Windows-account worden gelezen. Koppel Google opnieuw.')
    try:return ctypes.string_at(dst.data,dst.size)
    finally:ctypes.windll.kernel32.LocalFree(dst.data)

def read(data):
    p=data/'google-connection.bin'
    value=json.loads(protect(p.read_bytes(),True)) if p.exists() else {}
    if os.environ.get('BOOKLETS_PUBLIC_ORIGIN'):
        client=os.environ.get('GOOGLE_CLIENT_ID','')
        if value.get('client_id')!=client:value={}
        value.update(client_id=client,client_secret=os.environ.get('GOOGLE_CLIENT_SECRET',''))
    return value

def write(data,value):
    p=data/'google-connection.bin';tmp=p.with_suffix('.tmp')
    tmp.write_bytes(protect(json.dumps(value).encode()));tmp.replace(p)

def status(data):
    with LOCK:
        v=read(data)
        return {'configured':bool(v.get('client_id') and v.get('client_secret')),'connected':bool(v.get('refresh_token'))}

def configure(data,config):
    try:v=json.loads(config)['installed']
    except (ValueError,KeyError,TypeError):raise ValueError('Gebruik het gedownloade OAuth-clientbestand voor een Google Desktop-app.') from None
    if not str(v.get('client_id','')).endswith('.apps.googleusercontent.com') or not v.get('client_secret'):
        raise ValueError('Het Google OAuth-clientbestand is niet compleet.')
    with LOCK:write(data,{'client_id':v['client_id'],'client_secret':v['client_secret']})

def connect(data,port):
    with LOCK:
        v=read(data)
        if not v.get('client_id'):raise ValueError('Stel eerst de Google Desktop-app in.')
        state=secrets.token_urlsafe(32);verifier=secrets.token_urlsafe(48)
        redirect=f'http://127.0.0.1:{port}/google/callback'
        if os.environ.get('BOOKLETS_PUBLIC_ORIGIN'):
            redirect=os.environ['BOOKLETS_PUBLIC_ORIGIN'].rstrip('/')+'/seinhuis/boekjesmaker/google/callback'
        for key,p in list(PENDING.items()):
            if p['expires']<time.time():PENDING.pop(key,None)
        PENDING[state]={'expires':time.time()+600,'verifier':verifier,'redirect':redirect,'client':v}
        return 'https://accounts.google.com/o/oauth2/v2/auth?'+urlencode(dict(client_id=v['client_id'],redirect_uri=redirect,response_type='code',scope=SCOPE,state=state,access_type='offline',prompt='consent',code_challenge_method='S256',code_challenge=base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip('=')))

def callback(data,query):
    q=parse_qs(query)
    with LOCK:
        p=PENDING.pop(q.get('state',[''])[0],None)
        if not p or p['expires']<time.time():raise ValueError('Deze Google-aanmelding is verlopen. Start opnieuw vanuit de boekjesmaker.')
        if q.get('error') or not q.get('code'):raise ValueError('Google-aanmelding is niet afgerond.')
        v=p['client'];result=json.loads(request('https://oauth2.googleapis.com/token',dict(client_id=v['client_id'],client_secret=v['client_secret'],code=q['code'][0],code_verifier=p['verifier'],redirect_uri=p['redirect'],grant_type='authorization_code')))
        if not result.get('refresh_token'):raise ValueError('Google gaf geen blijvende toegang. Trek de oude toestemming bij Google in en koppel opnieuw.')
        if read(data).get('client_id')!=v['client_id']:raise ValueError('De Google-instellingen zijn inmiddels gewijzigd. Koppel opnieuw.')
        write(data,{**v,'refresh_token':result['refresh_token']})

def disconnect(data):
    with LOCK:
        v=read(data);v.pop('refresh_token',None);write(data,v);PENDING.clear()

def token(data):
    with LOCK:
        v=read(data)
        if not v.get('refresh_token'):raise ValueError('Koppel eerst uw Google-account via Bibliotheek → Google koppelen.')
        result=json.loads(request('https://oauth2.googleapis.com/token',dict(client_id=v['client_id'],client_secret=v['client_secret'],refresh_token=v['refresh_token'],grant_type='refresh_token')))
        return result['access_token']

def fetch_document(data,url):
    i=document_id(url)
    return json.loads(request('https://docs.googleapis.com/v1/documents/'+i+'?includeTabsContent=true',token=token(data)))

def fetch_image(url):
    p=urlparse(url)
    if p.scheme!='https' or not p.hostname or not p.hostname.endswith('.googleusercontent.com') or p.port not in (None,443):
        raise ValueError('Deze afbeelding heeft geen ondersteunde Google-bron. Plaats de afbeelding rechtstreeks in Google Docs.')
    return request(url,limit=15*1024*1024)
