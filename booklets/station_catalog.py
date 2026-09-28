"""Private station address catalogue, separate from the customer library."""
import hashlib, json, re, sqlite3, unicodedata
from pathlib import Path

class Connection(sqlite3.Connection):
    def __exit__(self,*args):
        try:return super().__exit__(*args)
        finally:self.close()

def connect(data):return sqlite3.connect(data/'stations.sqlite',timeout=15,factory=Connection)

def normalize(value):
    value=''.join(c for c in unicodedata.normalize('NFKD',value.casefold()) if not unicodedata.combining(c))
    value=value.replace('ø','o').replace('ß','ss')
    return ' '.join(re.sub(r'[^\w]+',' ',value).split()).replace('hauptbahnhof','hbf')

def initialize(data):
    rows=json.loads((Path(__file__).parent/'stations-seed.json').read_text(encoding='utf-8'))
    with connect(data) as c:
        c.execute('CREATE TABLE IF NOT EXISTS stations(id TEXT PRIMARY KEY, body TEXT NOT NULL)')
        for row in rows:
            key=hashlib.sha256((row['country']+'|'+row['station']).encode()).hexdigest()[:24]
            # Repeated deployments never overwrite later corrections in the database.
            c.execute('INSERT OR IGNORE INTO stations VALUES(?,?)',(key,json.dumps(row,ensure_ascii=False)))

def records(data):
    with connect(data) as c:
        return [dict(json.loads(body),stationId=ident) for ident,body in c.execute('SELECT id,body FROM stations')]

def find(data,query,country=''):
    q=normalize(query)
    if len(q)<2:return []
    matches=[]
    for row in records(data):
        if country and normalize(country)!=normalize(row['country']):continue
        names=[normalize(n) for n in [row['station'],*row.get('aliases',[])]]
        if q in names:score=0
        elif any(n.startswith(q) for n in names):score=1
        elif all(word in normalize(' '.join(names)+' '+row['city']) for word in q.split()):score=2
        else:continue
        matches.append((score,row['station'],row))
    return [r for _,_,r in sorted(matches,key=lambda x:(x[0],x[1]))[:20]]

def get(data,ident):
    if not isinstance(ident,str):raise ValueError('Kies een station uit de lijst.')
    with connect(data) as c:
        row=c.execute('SELECT body FROM stations WHERE id=?',(ident,)).fetchone()
    if row is None:raise ValueError('Dit station staat niet in de adressenlijst.')
    return dict(json.loads(row[0]),stationId=ident)

def public(row):
    return {**row,'name':row['station'],'catalog':True}

def search(data,body):
    query=body.get('query','');country=body.get('country','')
    if not isinstance(query,str) or len(query)>300 or not isinstance(country,str) or len(country)>100:raise ValueError('Ongeldige zoekopdracht.')
    return {'results':[public(r) for r in find(data,query,country)]}

ISO=dict(zip('Nederland|België|Luxemburg|Duitsland|Oostenrijk|Zwitserland|Italië|Frankrijk|Verenigd Koninkrijk|Spanje|Portugal|Tsjechië|Slowakije|Hongarije|Polen|Slovenië|Kroatië|Denemarken|Zweden|Noorwegen|Finland|Estland|Letland|Litouwen'.split('|'),'nl be lu de at ch it fr gb es pt cz sk hu pl si hr dk se no fi ee lv lt'.split()))

def resolve(data,body,request,point):
    row=get(data,body.get('stationId'))
    if row['status']=='Straatadres nog niet bevestigd':
        raise ValueError('Voor dit station is nog geen straatadres bevestigd. Gebruik Een ander adres zoeken en controleer de stationsingang.')
    params={'text':row['address']+', '+row['country'],'lang':'nl','limit':5,'format':'json','filter':'countrycode:'+ISO[row['country']]}
    response=json.loads(request('api.geoapify.com','/v1/geocode/search',params))
    results=[]
    for p in response.get('results',[]):
        if p.get('country_code','').lower()!=ISO[row['country']]:continue
        result=point({'lat':p['lat'],'lon':p['lon'],'name':row['station'],'address':row['address']})
        results.append({**result,'stationId':row['stationId'],'resolvedAddress':p.get('formatted',''),'stationSource':row['source'],'stationNote':row['note'],'stationStatus':row['status']})
    return {'results':results,'station':public(row)}
