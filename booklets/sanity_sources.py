"""Published reusable Sanity texts. Refresh on every export; never use stale fallback."""
import copy, hashlib, html, io, json, os, re
from collections import OrderedDict
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from PIL import Image
import google_layout, google_sources
from features import norm

PROJECT=os.environ.get('BOOKLETS_SANITY_PROJECT_ID','il9cyh3m')
DATASET=os.environ.get('BOOKLETS_SANITY_DATASET','production')
VERSION='sanity-layout-1'
RENDERED=OrderedDict()

def request(url,limit=8*1024*1024):
    try:
        with urlopen(Request(url,headers={'User-Agent':'Treinrondreis-Boekjesmaker/1'}),timeout=25) as response:
            raw=response.read(limit+1)
        if len(raw)>limit:raise ValueError('De Sanity-bron is te groot.')
        return raw
    except ValueError:raise
    except Exception:raise ValueError('Sanity is niet bereikbaar. De PDF is niet gemaakt; probeer opnieuw.') from None

def query(groq,params=None):
    if not re.fullmatch(r'[a-z0-9]+',PROJECT) or not re.fullmatch(r'[a-z0-9_-]+',DATASET):raise ValueError('Ongeldige Sanity-instellingen.')
    args={'query':groq,'perspective':'published','returnQuery':'false'}
    args.update({'$'+k:json.dumps(v) for k,v in (params or {}).items()})
    try:return json.loads(request(f'https://{PROJECT}.api.sanity.io/v2025-02-19/data/query/{DATASET}?'+urlencode(args)))['result']
    except (KeyError,TypeError,json.JSONDecodeError):raise ValueError('Sanity gaf geen geldige tekst terug.') from None

def search(payload):
    docs=query('*[_type == "reusableText" && !(_id in path("drafts.**"))] | order(title asc){_id,title,"text":pt::text(content),_updatedAt}')
    terms=norm(str(payload.get('q',''))[:200]).split()
    return {'items':[{'id':d['_id'],'title':(d.get('title') or 'Tekst'),'preview':d.get('text',''),'updatedAt':d.get('_updatedAt','')} for d in docs if all(t in norm((d.get('title') or '')+' '+(d.get('text') or '')) for t in terms)][:500]}

def settings(source):
    if not isinstance(source,dict):raise ValueError('Ongeldige Sanity-bron.')
    ids=source.get('ids');fmt=source.get('format','A5');columns=source.get('columns',2)
    if not isinstance(ids,list) or not 1<=len(ids)<=30 or len(set(ids))!=len(ids) or any(not isinstance(i,str) or (not re.fullmatch(r'[A-Za-z0-9_.-]{1,128}',i) or i.startswith(('drafts.','versions.'))) for i in ids):raise ValueError('Kies één tot dertig gepubliceerde Sanity-teksten.')
    if fmt not in ('A4','A5') or type(columns) is not int or columns not in (1,2):raise ValueError('Kies een geldig formaat en één of twee kolommen.')
    title=str(source.get('title','')).strip()[:200]
    return {'ids':ids,'format':fmt,'columns':columns,'title':title}

def model(documents,cfg):
    blocks=[];images={}
    for doc in documents:
        blocks.append({'type':'text','html':html.escape((doc.get('title') or 'Tekst')),'plain':(doc.get('title') or 'Tekst'),'heading':True})
        counters={}
        for b in doc.get('content') or []:
            if b.get('_type')=='image':
                ref=(b.get('asset') or {}).get('_ref','')
                match=re.fullmatch(r'image-([a-f0-9]+)-(\d+)x(\d+)-(jpg|jpeg|png|webp)',ref)
                if not match:raise ValueError('Een Sanity-afbeelding kan niet worden gelezen. Gebruik een gewone afbeelding in de brontekst.')
                digest,w,h,extension=match.groups()
                if int(w)*int(h)>25000000:raise ValueError('Een Sanity-afbeelding is te groot.')
                raw=request(f'https://cdn.sanity.io/images/{PROJECT}/{DATASET}/{digest}-{w}x{h}.{extension}')
                try:
                    im=Image.open(io.BytesIO(raw));im.load()
                    crop=b.get('crop') or {};l,t,r,bottom=[max(0,min(.99,float(crop.get(k,0)))) for k in ('left','top','right','bottom')]
                    if l+r>=1 or t+bottom>=1:raise ValueError('Ongeldige uitsnede in Sanity.')
                    im=im.crop((int(l*im.width),int(t*im.height),int((1-r)*im.width),int((1-bottom)*im.height)))
                    out=io.BytesIO();im.convert('RGB').save(out,format='PNG');raw=out.getvalue()
                except Exception:raise ValueError('Een Sanity-afbeelding kan niet worden verwerkt.') from None
                key=hashlib.sha256(raw).hexdigest();images[key]=raw
                blocks.append({'type':'image','key':key,'width':im.width,'height':im.height});continue
            if b.get('_type')!='block':raise ValueError('Deze Sanity-tekst bevat een niet ondersteund onderdeel. Pas de bron aan voordat u een PDF maakt.')
            definitions={m['_key']:m for m in b.get('markDefs',[]) if '_key' in m};parts=[];plain=[]
            for span in b.get('children',[]):
                if span.get('_type')!='span':raise ValueError('Deze Sanity-tekst bevat een niet ondersteund tekstonderdeel.')
                value=str(span.get('text',''));plain.append(value);text=html.escape(value).replace('\n','<br/>')
                for mark in span.get('marks',[]):
                    tag={'strong':'b','em':'i','underline':'u','strike-through':'strike'}.get(mark)
                    if tag:text=f'<{tag}>{text}</{tag}>'
                    elif mark in definitions:
                        d=definitions[mark];link=d.get('href',d.get('url',''))
                        if d.get('_type')=='link' and re.match(r'^(https?://|mailto:)',link):text='<link href="'+html.escape(link,quote=True)+'" color="#000000">'+text+'</link>'
                        else:raise ValueError('Een Sanity-tekst bevat een niet ondersteunde koppeling.')
                    else:raise ValueError('Een Sanity-tekst bevat een niet ondersteunde tekstmarkering.')
                parts.append(text)
            if not ''.join(plain).strip():continue
            bullet=None
            if b.get('listItem'):
                level=b.get('level',1)
                if b['listItem']=='number':counters[level]=counters.get(level,0)+1;bullet=str(counters[level])+'.'
                else:bullet='•'
            else:counters={}
            blocks.append({'type':'text','html':''.join(parts),'plain':''.join(plain),'heading':str(b.get('style','normal')).startswith('h'),'bullet':bullet,'bulletLevel':max(1,min(5,int(b.get('level',1))))})
    title=cfg['title'] or ((documents[0].get('title') or 'Sanity-tekst') if len(documents)==1 else 'Reisinformatie')
    # A single document's title is already printed as the page title.
    if len(documents)==1:blocks=blocks[1:]
    if not blocks:raise ValueError('De geselecteerde Sanity-tekst is leeg.')
    return {'title':title,'blocks':blocks,'warnings':[],'tabCount':2,'bodySize':10,'headingSize':11,'titleSize':28,'titleLeading':35.56,'lineSpacing':1.65},images

def load(s,source,cache=None):
    cfg=settings(source);cache=cache if cache is not None else {};key=tuple(cfg['ids'])
    if key not in cache:cache[key]=query('*[_type == "reusableText" && _id in $ids && !(_id in path("drafts.**"))]{_id,_rev,title,content}',{'ids':cfg['ids']})
    byid={d['_id']:d for d in cache[key]}
    if any(i not in byid for i in cfg['ids']):raise ValueError('Een gekoppelde Sanity-tekst is verwijderd of niet gepubliceerd. Kies een andere tekst voordat u de PDF maakt.')
    docs=[byid[i] for i in cfg['ids']]
    digest=hashlib.sha256((json.dumps([cfg,docs],sort_keys=True,ensure_ascii=False)+VERSION).encode()).hexdigest()
    cached=source.get('asset') if digest==source.get('digest') else RENDERED.get(digest)
    if cached and (s.DATA/'pdfs'/f'{cached}.pdf').is_file():
        a=s.asset(cached);title=cfg['title'] or ((docs[0].get('title') or 'Sanity-tekst') if len(docs)==1 else 'Reisinformatie')
    else:
        m,images=model(docs,cfg);title=m['title'];raw=google_layout.render(m,images,cfg['format'],'text' if cfg['columns']==2 else 'route')
        reader,meta=s.inspect_pdf(raw);s.ensure_capacity(len(raw));ident=s.ident();(s.DATA/'pdfs'/f'{ident}.pdf').write_bytes(raw)
        with s.db() as c:c.execute('INSERT INTO assets VALUES(?,?,?,?,?)',(ident,title,len(reader.pages),json.dumps(meta),s.now()))
        a=s.asset(ident)
    RENDERED[digest]=a['id'];RENDERED.move_to_end(digest)
    while len(RENDERED)>64:RENDERED.popitem(last=False)
    return {'title':title,'asset':a['id'],'pages':a['pages'],'meta':a['meta'],'format':cfg['format'],'sanityText':{**cfg,'digest':digest,'asset':a['id'],'checkedAt':s.now()}}

def update_body(s,body,result):
    b=copy.deepcopy(body);b['format']=result['format'];b['fields']=google_sources.number_fields(s,b,result['pages']);b.update({k:result[k] for k in ('asset','pages','format','sanityText')});b['numberingConfigured']=True
    return b

def refresh_export(s,body):
    # Update this generation's snapshots only; existing books and printed PDFs stay intact.
    b=copy.deepcopy(body);cache={}
    for slot in google_sources.selected(b):
        if slot.get('sanityText'):slot.update(update_body(s,slot,load(s,slot['sanityText'],cache)))
    return b
