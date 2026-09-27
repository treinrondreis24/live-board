"""Server-only Geoapify adapter and immutable route documents."""
import base64, html, io, json, math, os, re
from urllib.request import Request, urlopen
from urllib.parse import urlencode
from urllib.error import HTTPError, URLError
from PIL import Image as PILImage, ImageOps
from reportlab.platypus import SimpleDocTemplate, Paragraph, Image, Spacer, Table, TableStyle
from reportlab.lib.styles import ParagraphStyle

ATTRIBUTION='Powered by Geoapify | © OpenStreetMap contributors | © OpenMapTiles'

def text(value,limit=500):
    if not isinstance(value,str) or len(value)>limit:raise ValueError('Deze tekst is te lang of ongeldig.')
    return value.strip()

def folder(s):
    p=s.DATA/'routes';p.mkdir(exist_ok=True);return p

def stored(s,ident,suffix):
    if not isinstance(ident,str) or not re.fullmatch('[a-f0-9]{32}',ident):raise ValueError('Ongeldige route.')
    p=folder(s)/(ident+suffix)
    if not p.is_file():raise ValueError('Route niet gevonden. Bereken de route opnieuw.')
    return p

def request(host,path,params=None,body=None):
    key=os.environ.get('GEOAPIFY_API_KEY','').strip()
    if not key:raise ValueError('De Geoapify-sleutel is nog niet ingesteld. Voeg GEOAPIFY_API_KEY toe bij de Boekjesmaker in Railway.')
    url='https://'+host+path+'?'+urlencode({**(params or {}),'apiKey':key})
    try:
        req=Request(url,data=json.dumps(body).encode() if body is not None else None,headers={'User-Agent':'Treinrondreis-Boekjesmaker/1','Content-Type':'application/json'})
        with urlopen(req,timeout=35) as r:raw=r.read(8*1024*1024+1)
        if len(raw)>8*1024*1024:raise ValueError('Het kaartantwoord is te groot.')
        return raw
    except HTTPError as e:
        if e.code in (401,403):raise ValueError('Geoapify weigert de sleutel. Controleer de sleutel en eventuele beperkingen in Geoapify.') from None
        if e.code==429:raise ValueError('Geoapify is tijdelijk druk of de gebruikslimiet is bereikt. Probeer later opnieuw.') from None
        raise ValueError('Geoapify kon deze locatie of route niet verwerken. Controleer de gekozen locaties en probeer opnieuw.') from None
    except (URLError,TimeoutError,OSError):raise ValueError('Geoapify is niet bereikbaar. Probeer het later opnieuw.') from None

def point(p):
    if not isinstance(p,dict):raise ValueError('Kies een station en hotel uit de zoekresultaten.')
    try:lat=float(p['lat']);lon=float(p['lon'])
    except (KeyError,TypeError,ValueError):raise ValueError('Ongeldige locatie.') from None
    if not math.isfinite(lat) or not math.isfinite(lon) or not -85<=lat<=85 or not -180<=lon<=180:raise ValueError('Ongeldige coördinaten.')
    return {'lat':lat,'lon':lon,'name':text(p.get('name',''),200),'address':text(p.get('address',''),500)}

def search(b):
    q=text(b.get('query',''),300)
    if len(q)<3:raise ValueError('Vul een naam met stad in, of een volledig adres.')
    data=json.loads(request('api.geoapify.com','/v1/geocode/search',{'text':q,'lang':'nl','limit':5,'format':'json'}))
    return {'results':[point({'lat':p['lat'],'lon':p['lon'],'name':p.get('name') or p.get('address_line1') or p.get('formatted',''),'address':p.get('formatted','')}) for p in data.get('results',[])]}

def calculate(s,b):
    start=point(b.get('start'));end=point(b.get('end'))
    if abs(start['lat']-end['lat'])+abs(start['lon']-end['lon'])>1:raise ValueError('Deze locaties liggen te ver uit elkaar voor een hotelwandeling. Controleer de stad.')
    data=json.loads(request('api.geoapify.com','/v1/routing',{'waypoints':f"{start['lat']},{start['lon']}|{end['lat']},{end['lon']}",'mode':'walk','lang':'nl','units':'metric','details':'instruction_details'}))
    if not data.get('features'):raise ValueError('Er is geen looproute gevonden.')
    f=data['features'][0];p=f['properties'];geometry=f['geometry']
    distance=float(p['distance']);seconds=float(p['time'])
    if distance>25000:raise ValueError('Deze looproute is langer dan 25 km. Controleer de gekozen locaties.')
    steps=[{'text':str(x.get('instruction',{}).get('text','')).strip(),'distance':round(float(x.get('distance',0)))} for leg in p.get('legs',[]) for x in leg.get('steps',[]) if x.get('instruction',{}).get('text')]
    if not steps:raise ValueError('De route bevat geen aanwijzingen. Probeer andere vertrek- en aankomstpunten.')
    coords=geometry['coordinates'] if geometry['type']=='LineString' else [c for line in geometry['coordinates'] for c in line]
    if not coords:raise ValueError('Geen kaartlijn gevonden.')
    # Fit the full route with a generous margin, capped at street-level zoom.
    xs=[(c[0]+180)/360 for c in coords]
    ys=[(1-math.asinh(math.tan(math.radians(c[1])))/math.pi)/2 for c in coords]
    zoom=min(18,math.log2(850/(256*max(max(xs)-min(xs),.00001))),math.log2(500/(256*max(max(ys)-min(ys),.00001))))
    center=[(min(xs)+max(xs))/2*360-180,math.degrees(math.atan(math.sinh(math.pi*(1-(min(ys)+max(ys))))))]
    map_body={'style':'osm-bright','width':1100,'height':700,'format':'png','center':center,'zoom':zoom,'geojson':{'type':'Feature','geometry':geometry,'properties':{'linecolor':'#176b58','linewidth':6}},'markers':[{'lon':a['lon'],'lat':a['lat'],'color':color,'type':'circle','text':label,'size':36} for a,color,label in [(start,'#176b58','A'),(end,'#b54727','B')]]}
    raw=request('maps.geoapify.com','/v1/staticmap',body=map_body)
    try:
        with PILImage.open(io.BytesIO(raw)) as im:im.verify()
    except Exception:raise ValueError('Het kaartbeeld kon niet worden gemaakt. Probeer opnieuw.') from None
    ident=s.ident();model={'id':ident,'start':start,'end':end,'distance':round(distance),'minutes':max(1,math.ceil(seconds/60)),'steps':steps,'checkedAt':s.now(),'geometry':geometry}
    serialized=json.dumps(model,ensure_ascii=False).encode();s.ensure_capacity(len(raw)+len(serialized))
    (folder(s)/(ident+'.png')).write_bytes(raw);(folder(s)/(ident+'.json')).write_bytes(serialized)
    return {k:v for k,v in model.items() if k!='geometry'}

def photo(raw):
    if not isinstance(raw,str) or len(raw)>7*1024*1024:raise ValueError('Gebruik een JPG of PNG van maximaal 5 MB.')
    try:
        data=base64.b64decode(raw,validate=True)
        if len(data)>5*1024*1024:raise ValueError()
        with PILImage.open(io.BytesIO(data)) as im:
            if im.format not in ('JPEG','PNG') or im.width*im.height>20000000:raise ValueError()
            im=ImageOps.exif_transpose(im).convert('RGB');im.thumbnail((1400,1000));buf=io.BytesIO();im.save(buf,'JPEG',quality=88);return buf.getvalue()
    except Exception:raise ValueError('Gebruik een geldige JPG of PNG van maximaal 5 MB en 20 megapixels.') from None

def configuration(s,b):
    model=json.loads(stored(s,b.get('id'),'.json').read_text(encoding='utf-8'))
    fmt=b.get('format','A5')
    if fmt not in s.SIZES:raise ValueError('Kies A4 of A5.')
    country=text(b.get('country',''),100)
    if country not in s.COUNTRIES:raise ValueError('Kies een land voor deze route.')
    city=text(b.get('destination',''),160);hotel=text(b.get('hotel',model['end']['name']),160)
    title=text(b.get('title',''),160) or 'Route - '+hotel+(' - '+city if city and city.casefold() not in hotel.casefold() else '')
    steps=b.get('instructions')
    if steps is None:steps='\n'.join(x['text']+(f" ({x['distance']} m)" if x['distance'] else '') for x in model['steps'])
    cfg={'id':model['id'],'format':fmt,'country':country,'destination':city,'hotel':hotel,'title':title,'instructions':text(steps,16000),'extra':text(b.get('extra',''),8000),'checkedAt':model['checkedAt']}
    if not cfg['instructions']:raise ValueError('Vul de route-instructies in.')
    if b.get('photoData'):
        raw=photo(b['photoData']);i=s.ident();s.ensure_capacity(len(raw));(folder(s)/(i+'.jpg')).write_bytes(raw);cfg['photo']=i
    elif b.get('photo'):stored(s,b['photo'],'.jpg');cfg['photo']=b['photo']
    return model,cfg

def render_pdf(s,model,cfg):
    W,H=s.SIZES[cfg['format']];width=W-56
    style=ParagraphStyle('route',fontName='Booklet',fontSize=10.5,leading=16.8,spaceAfter=6,textColor='#000000')
    bold=ParagraphStyle('routeheading',parent=style,fontName='Booklet-Bold',spaceBefore=6)
    small=ParagraphStyle('source',parent=style,fontSize=7,leading=10,spaceAfter=7)
    title=ParagraphStyle('title',parent=style,fontName='Montserrat-Bold',fontSize=19,leading=24,spaceAfter=9)
    def para(t,st=style):return Paragraph(html.escape(t).replace('\n','<br/>'),st)
    def pic(path,w,h):
        with PILImage.open(path) as im:iw,ih=im.size
        scale=min(w/iw,h/ih);return Image(str(path),width=iw*scale,height=ih*scale,hAlign='LEFT')
    steps=[para(f'{n+1}. {line}') for n,line in enumerate(cfg['instructions'].splitlines()) if line.strip()]
    heading=[para(cfg['title'],title),para(f"Vanaf {model['start']['name']} | circa {model['distance']} meter | {model['minutes']} minuten lopen")]
    leftwidth=width*.55;rightwidth=width-leftwidth-18
    left=[pic(stored(s,model['id'],'.png'),leftwidth,210),para(ATTRIBUTION,small)]
    right=[para('Uw looproute',bold),*steps,para('Uw hotel',bold),para(model['end']['address'])]
    pair=Table([[left,right]],colWidths=[leftwidth+18,rightwidth]);pair.setStyle(TableStyle([('VALIGN',(0,0),(-1,-1),'TOP'),('LEFTPADDING',(0,0),(-1,-1),0),('RIGHTPADDING',(0,0),(0,0),18),('RIGHTPADDING',(1,0),(1,0),0),('TOPPADDING',(0,0),(-1,-1),0),('BOTTOMPADDING',(0,0),(-1,-1),0)]))
    available=H-28-44-sum(p.wrap(width,H)[1]+p.getSpaceAfter() for p in heading)
    tail=[]
    if cfg['extra']:tail=[para('Goed om te weten',bold),para(cfg['extra'])]
    if cfg.get('photo'):tail += [pic(stored(s,cfg['photo'],'.jpg'),width,130),Spacer(1,8)]
    tailheight=sum(p.wrap(width,H)[1]+p.getSpaceBefore()+p.getSpaceAfter() for p in tail)
    # Keep a compact one-page route when it fits; otherwise flow every instruction
    # at its original readable size instead of shrinking or clipping a table.
    if pair.wrap(width,H)[1]+tailheight<=available:story=heading+[pair]+tail
    else:story=heading+[pic(stored(s,model['id'],'.png'),width,200 if cfg['format']=='A5' else 320),para(ATTRIBUTION,small),*right]+tail
    buf=io.BytesIO();doc=SimpleDocTemplate(buf,pagesize=(W,H),leftMargin=28,rightMargin=28,topMargin=28,bottomMargin=44,title=cfg['title'],author='Treinrondreis')
    doc.build(story);return buf.getvalue()

def render(s,b):
    model,cfg=configuration(s,b);raw=render_pdf(s,model,cfg);reader,meta=s.inspect_pdf(raw);i=s.ident();s.ensure_capacity(len(raw))
    (s.DATA/'pdfs'/f'{i}.pdf').write_bytes(raw)
    with s.db() as c:c.execute('INSERT INTO assets VALUES(?,?,?,?,?)',(i,cfg['title'],len(reader.pages),json.dumps(meta),s.now()))
    return {'title':cfg['title'],'asset':i,'pages':len(reader.pages),'format':cfg['format'],'routeMaker':cfg}
