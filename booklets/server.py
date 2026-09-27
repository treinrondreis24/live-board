"""Local pilot. PDF originals and published exports are immutable. No AI services; optional read-only Google Docs connection."""
import copy
import bulk_ops, preflight, google_sources, google_connection
from types import SimpleNamespace
from features import COUNTRIES, SIZES, pdf_format, resolved, plan, insert_fillers, refresh_blocks, library_stamp
import base64, hashlib, hmac, io, json, os, re, secrets, socket, sqlite3, subprocess, threading, time, uuid
from pathlib import Path
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs
from pypdf import PdfReader, PdfWriter
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from book_layout import rich_layout, draw_rich, contents_plan, render_contents, add_page_numbers, contents_field_layout, draw_contents_field, draw_number_box

ROOT = Path(__file__).resolve().parent
DATA = Path(os.environ.get('BOOKLETS_DATA', str(ROOT / 'data')))
DATA.mkdir(parents=True, exist_ok=True)
for folder in ('pdfs','exports','previews'): (DATA/folder).mkdir(exist_ok=True)
POPPLER = Path.home()/'.cache/codex-runtimes/codex-primary-runtime/dependencies/native/poppler/Library/bin/pdftoppm.exe'
FONT = ROOT/'fonts/OpenSans-Regular.ttf'
pdfmetrics.registerFont(TTFont('Booklet', str(FONT)))
for name,filename in [('Booklet-Bold','OpenSans-Bold.ttf'),('Booklet-Italic','OpenSans-Italic.ttf'),('Booklet-BoldItalic','OpenSans-BoldItalic.ttf')]:
    pdfmetrics.registerFont(TTFont(name,str(FONT.parent/filename)))
pdfmetrics.registerFontFamily('Booklet',normal='Booklet',bold='Booklet-Bold',italic='Booklet-Italic',boldItalic='Booklet-BoldItalic')
for suffix in ['', '-Bold', '-Italic', '-BoldItalic']:
    pdfmetrics.registerFont(TTFont('Montserrat'+suffix,str(ROOT/'fonts'/('Montserrat-'+(suffix[1:] or 'Regular')+'.ttf'))))
pdfmetrics.registerFontFamily('Montserrat',normal='Montserrat',bold='Montserrat-Bold',italic='Montserrat-Italic',boldItalic='Montserrat-BoldItalic')
def font_name(f):return 'Montserrat' if f.get('font')=='Montserrat' else 'Booklet'
LOCK = threading.RLock()
SESSIONS = {}
APP_VERSION = '2026.09.27.16'

def storage_remaining():
    limit=int(os.environ.get('BOOKLETS_STORAGE_LIMIT','5000000000'))
    return limit-sum(p.stat().st_size for p in DATA.rglob('*') if p.is_file())

def ensure_capacity(size):
    if size+16*1024*1024>storage_remaining():
        raise ValueError('De afgesproken opslagruimte van 5 GB is bijna vol. Neem contact op met de beheerder voordat u meer bestanden toevoegt.')

class QuotaWriter:
    def __init__(self,stream):self.stream=stream;self.remaining=storage_remaining()-16*1024*1024
    def write(self,raw):
        if len(raw)>self.remaining:raise ValueError('Het boekje past niet meer binnen de opslaglimiet van 5 GB.')
        self.remaining-=len(raw);return self.stream.write(raw)
    def __getattr__(self,name):return getattr(self.stream,name)
class ClosingConnection(sqlite3.Connection):
    def __exit__(self,*args):
        try:return super().__exit__(*args)
        finally:self.close()

def db():
    c=sqlite3.connect(DATA/'library.sqlite', timeout=15, factory=ClosingConnection)
    c.row_factory=sqlite3.Row
    return c
with db() as c:
    c.executescript('''
    CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, name TEXT UNIQUE, salt TEXT, password TEXT, admin INTEGER);
    CREATE TABLE IF NOT EXISTS objects(id TEXT PRIMARY KEY, kind TEXT, title TEXT, revision INTEGER, body TEXT);
    CREATE TABLE IF NOT EXISTS assets(id TEXT PRIMARY KEY, title TEXT, pages INTEGER, meta TEXT, created TEXT);
    CREATE TABLE IF NOT EXISTS bulk_history(id TEXT PRIMARY KEY, created TEXT, body TEXT, undone INTEGER);
    CREATE TABLE IF NOT EXISTS exports(id TEXT PRIMARY KEY, book_id TEXT, title TEXT, created TEXT, snapshot TEXT, report TEXT);
    ''')
def ident(): return uuid.uuid4().hex
def now(): return time.strftime('%Y-%m-%d %H:%M')
def pw(p,s): return hashlib.pbkdf2_hmac('sha256',p.encode(),bytes.fromhex(s),300000).hex()
def user_create(name,password,admin=False):
    if not name.strip() or len(password)<10: raise ValueError('Gebruik een naam en een wachtwoord van minimaal 10 tekens.')
    salt=secrets.token_hex(16)
    with db() as c: c.execute('INSERT INTO users VALUES(?,?,?,?,?)',(ident(),name.strip(),salt,pw(password,salt),int(admin)))
def obj(i):
    with db() as c: r=c.execute('SELECT * FROM objects WHERE id=?',(i,)).fetchone()
    if not r: raise ValueError('Niet gevonden.')
    return {**dict(r),'body':json.loads(r['body'])}
def asset(i):
    with db() as c: r=c.execute('SELECT * FROM assets WHERE id=?',(i,)).fetchone()
    if not r: raise ValueError('PDF ontbreekt.')
    return {**dict(r),'meta':json.loads(r['meta'])}
def inspect_pdf(raw):
    r=PdfReader(io.BytesIO(raw),strict=False)
    if r.is_encrypted: raise ValueError('Gebruik een PDF zonder wachtwoord.')
    if not 0<len(r.pages)<=200: raise ValueError('Een bouwsteen moet 1 tot 200 pagina’s bevatten.')
    meta=[]
    for p in r.pages:
        if any(a.get_object().get('/Subtype')!='/Link' for a in p.get('/Annots',[])): raise ValueError('Deze PDF bevat formulieren of andere interactieve elementen. Exporteer voor deze proef een statische Canva druk-PDF. Gewone hyperlinks zijn wel toegestaan.')
        if p.get('/UserUnit',1)!=1: raise ValueError('Afwijkende PDF-schaaleenheid wordt nog niet ondersteund.')
        meta.append({'width':float(p.mediabox.width),'height':float(p.mediabox.height),'rotation':p.rotation,'crop':list(map(float,p.cropbox))})
    return r,meta
TOKEN = re.compile(r'\{\{\s*([^{}]+?)\s*\}\}')
def field_keys(f):
    if f.get('type') in ('contents','pageNumber'):return []
    if f.get('type','field')=='text':
        template=f.get('template','')
        if not isinstance(template,str) or not template.strip(): raise ValueError('Vul de tekst van het persoonlijke tekstblok in.')
        if len(template)>20000: raise ValueError('Een tekstblok mag maximaal 20.000 tekens bevatten.')
        rest=TOKEN.sub('',template)
        if '{{' in rest or '}}' in rest: raise ValueError('Een invulcode is onvolledig. Gebruik bijvoorbeeld {{bestemming}}.')
        keys=list(dict.fromkeys(m.group(1).strip() for m in TOKEN.finditer(template)))
    else: keys=[f.get('key','')]
    for key in keys:
        if not key or len(key)>80 or not all(c.isalnum() or c in ' _-' for c in key):
            raise ValueError('Gebruik in invulcodes alleen letters, cijfers, spaties, streepjes of underscores.')
    return keys

def field_text(f,values,title):
    if f.get('type')=='prefilled':
        value=str(values.get(f['key'],f.get('template','')))
        if f.get('required') and not value.strip():raise ValueError('Vul '+f['key']+' in.')
        return value
    for key in field_keys(f):
        if not str(values.get(key,'')).strip() and f.get('required',True): raise ValueError(f"Vul ‘{key}’ in voor {title}.")
    if f.get('type')=='text':
        return TOKEN.sub(lambda m:str(values.get(m.group(1).strip(),'')).strip(),f['template'])
    return str(values.get(f['key'],'')).strip()

def wrap_text(value,width,size):
    lines=[]
    for paragraph in value.replace('\r\n','\n').replace('\r','\n').split('\n'):
        line=''
        for word in paragraph.split():
            candidate=(line+' '+word).strip()
            if pdfmetrics.stringWidth(candidate,'Booklet',size)<=width:
                line=candidate;continue
            if line: lines.append(line);line=''
            # Long names and codes are split rather than drawn outside the box.
            for char in word:
                if pdfmetrics.stringWidth(line+char,'Booklet',size)>width:
                    if not line: raise ValueError('Het tekstblok is te smal voor één letter. Vergroot de breedte.')
                    lines.append(line);line=''
                line+=char
        lines.append(line)
    return lines

def fields_validate(fields,meta):
    for f in fields:
        key=f.get('key','')
        if not isinstance(key,str) or not key.strip() or len(key)>80 or not all(c.isalnum() or c in ' _-' for c in key):
            raise ValueError('Gebruik een veldnaam van maximaal 80 tekens met letters, cijfers, spaties, streepjes of underscores.')
        if f.get('type','field') not in ('field','text','prefilled','contents','pageNumber'): raise ValueError('Onbekend soort tekstveld.')
        if f.get('font','Open Sans') not in ('Open Sans','Montserrat'):raise ValueError('Onbekend lettertype.')
        if f.get('align','left') not in ('left','center','right'):raise ValueError('Ongeldige tekstuitlijning.')
        field_keys(f)
        if f.get('type')=='prefilled' and (not isinstance(f.get('template',''),str) or len(f.get('template',''))>20000):raise ValueError('Standaardtekst mag maximaal 20.000 tekens bevatten.')
        n=int(f['page'])
        if not 0<=n<len(meta): raise ValueError('Ongeldige veldpagina.')
        if meta[n]['rotation'] or meta[n]['crop'][:2]!=[0,0]: raise ValueError('Personalisatie vereist ongedraaide pagina’s met oorsprong 0,0.')
        for k in ['x','y','w','h']:
            if not 0<=float(f[k])<=100: raise ValueError('Veldpositie buiten pagina.')
        if float(f['w'])<=0 or float(f['h'])<=0 or float(f['x'])+float(f['w'])>100 or float(f['y'])+float(f['h'])>100: raise ValueError('Het invulveld valt buiten de pagina.')
        if not 6<=float(f.get('size',11))<=72: raise ValueError('Lettergrootte moet tussen 6 en 72 pt liggen.')
        if not re.fullmatch(r'#[0-9a-fA-F]{6}',f.get('color','#172d35')): raise ValueError('Ongeldige tekstkleur.')
def validate_body(kind,b,prepared=False):
    def toc_info(item):
        if not isinstance(item.get('tocTitle',''),str) or len(item.get('tocTitle',''))>300:raise ValueError('De titel voor de inhoudsopgave mag maximaal 300 tekens bevatten.')
    if kind=='choice':
        slot=b.get('slot',{})
        if slot.get('choice') not in ('manual','route'):raise ValueError('Kies het soort keuzepagina.')
        options=slot.get('options',[])
        if not isinstance(options,list) or len(options)>100:raise ValueError('Maximaal 100 keuzes per keuzepagina.')
        if slot['choice']=='manual':
            if not options:raise ValueError('Selecteer ten minste één bouwsteen.')
            if slot.get('selected') and not any(o.get('block')==slot['selected'].get('block') for o in options):raise ValueError('De standaardkeuze moet bij de toegestane bouwstenen horen.')
        else:slot['options']=[]
        for item in [*slot.get('options',[]),*([slot['selected']] if slot.get('selected') else [])]:item['values']={}
        slot.pop('values',None);slot.pop('choiceSource',None);slot.pop('choiceRevision',None)
        validate_body('template',{'format':b.get('format','A4'),'sections':[slot]})
    elif kind=='block':
        if b.get('googleDoc'):
            google_sources.settings(b['googleDoc'])
            if b.get('fillerOrder'):raise ValueError('Gebruik een vaste PDF voor vulpagina’s; Google-bronnen kunnen van lengte veranderen.')
            google_sources.number_fields(SimpleNamespace(**globals()),b,b['pages'])
        toc_info(b)
        actual=pdf_format(asset(b['asset'])['meta'])
        b['format']=actual
        if 'Routes' in b.get('categories',[b.get('category')]) and b.get('country') not in COUNTRIES:raise ValueError('Kies een land voor deze route.')
        if b.get('fillerOrder') and (b.get('pages')!=1 or int(b['fillerOrder']) not in (1,2,3)):raise ValueError('Een vulbouwsteen bevat één pagina en heeft volgorde 1, 2 of 3.')
        a=asset(b['asset']);b['pages']=a['pages']; fields_validate(b.get('fields',[]),a['meta'])
    elif kind in ('template','book'):
        if len(b.get('sections',[]))>100: raise ValueError('Maximaal 100 bouwstenen.')
        if b.get('format','A4') not in SIZES:raise ValueError('Kies A4 of A5.')
        for slot in b.get('sections',[]):
            if kind=='template' and slot.get('oneOff'):raise ValueError('Eenmalige PDF’s horen alleen bij een persoonlijk boekje.')
            if slot.get('choice'):
                if slot.get('choice') not in ('manual','route'):raise ValueError('Ongeldige keuzeplek.')
                if slot.get('choice')=='route' and slot.get('country') not in COUNTRIES:raise ValueError('Kies een land voor de routekeuze.')
            candidates=([*slot.get('options',[]),*([slot['selected']] if slot.get('selected') else [])] if slot.get('choice') else [slot])
            for candidate in candidates:
                if candidate.get('googleDoc'):
                    source=google_sources.settings(candidate['googleDoc'])
                    if source['format']!=b.get('format','A4'):raise ValueError('Google-bron past niet bij dit boekformaat.')
                    google_sources.number_fields(SimpleNamespace(**globals()),candidate,candidate['pages'])
                a=asset(candidate['asset'])
                if candidate.get('pages')!=a['pages'] and not prepared:raise ValueError('Aantal bouwsteenpagina’s klopt niet.')
                if pdf_format(asset(candidate['asset'])['meta'])!=b.get('format','A4'):raise ValueError('Bouwsteen past niet bij het gekozen boekformaat: '+candidate.get('title',''))
                fields_validate(candidate.get('fields',[]),asset(candidate['asset'])['meta'])
        for s in resolved(b):
            toc_info(s)
            a=asset(s['asset']);fields_validate(s.get('fields',[]),a['meta'])
        if kind=='book' and b.get('status','Concept') not in ['Concept','Gecontroleerd','Verzonden']: raise ValueError('Ongeldige status.')
    else: raise ValueError('Onbekend onderdeel.')
def check_layout(body,values):
    validate_body('block',body)
    meta=asset(body['asset'])['meta'];results=[]
    for f in body.get('fields',[]):
        size=float(f.get('size',11));m=meta[int(f['page'])]
        width=m['width']*float(f['w'])/100;available=m['height']*float(f['h'])/100
        sample={key:str(values.get(key,f.get('template','') if f.get('type')=='prefilled' else '')).strip() or '['+key+']' for key in field_keys(f)}
        example_keys=[key for key in sample if not str(values.get(key,'')).strip()]
        if f.get('type') in ('contents','pageNumber'):
            results.append({'name':f['key'],'page':int(f['page'])+1,'fits':True,'dynamic':True,'font':f.get('font','Open Sans'),'size':size,'exampleKeys':[]});continue
        value=field_text(f,sample,'voorbeeld')
        if f.get('type') in ('text','prefilled'):
            items=rich_layout(value if f.get('type')=='prefilled' else f['template'],{} if f.get('type')=='prefilled' else sample,width,size,f.get('color','#183c3c'),TOKEN,font_name(f),f.get('align','left'))
            needed=sum(h for _,h in items);width_ok=True
        else:
            lines=value.splitlines();needed=len(lines)*size*1.5
            width_ok=all(pdfmetrics.stringWidth(line,font_name(f),size)<=width for line in lines)
        results.append({'name':f['key'],'page':int(f['page'])+1,'fits':needed<=available and width_ok,'heightPercent':round(needed/m['height']*100,1),'availablePercent':float(f['h']),'widthFits':width_ok,'size':size,'font':f.get('font','Open Sans'),'exampleKeys':example_keys})
    return {'results':results,'fits':all(r['fits'] for r in results)}

def make_export(book,options=None):
    options=options or {}
    book=copy.deepcopy(book);b=book['body']
    with db() as c:objects=[{**dict(r),'body':json.loads(r['body'])} for r in c.execute('SELECT * FROM objects')]
    for o in objects:
        if o['kind']=='block':o['body']['format']=pdf_format(asset(o['body']['asset'])['meta'])
    if options.get('libraryStamp') is not None and options['libraryStamp']!=library_stamp(objects):raise ValueError('De bibliotheek is gewijzigd tijdens de controle. Maak de PDF opnieuw om de nieuwste pagina’s te controleren.')
    b=refresh_blocks(b,objects);book['body']=b
    validate_body('book',b)
    google_warnings=google_sources.verify(b)
    preparation=plan(b,objects)
    if preparation['missing'] and not options.get('skipChoices'):raise ValueError('Bevestig eerst dat niet ingestelde keuzes mogen worden overgeslagen.')
    sections=preparation['sections']
    for chapter_index,section in enumerate(sections):section['_digitalChapter']=chapter_index
    if preparation['needed'] and options.get('fill'):
        if not preparation['canFill']:raise ValueError('Stel eerst passende vulpagina’s in voor dit formaat.')
        sections=insert_fillers(sections,preparation['fillers'])
    elif preparation['needed'] and not options.get('allowUneven'):raise ValueError('Bevestig eerst het aantal pagina’s dat niet deelbaar is door vier.')
    b['sections']=sections
    if not sections: raise ValueError('Voeg eerst een bouwsteen toe.')
    validate_body('book',b,prepared=True)
    writer=PdfWriter(); report={'warnings':google_warnings, 'pages':0, 'blanks':0, 'created':now(), 'checks':['Originele PDF-pagina’s overgenomen; niet gerasterd.','Personalisatie als vaste tekst met ingesloten lettertype.','Verplichte velden en tekstpassing gecontroleerd.']}
    dynamic=[];configured_pages=set()
    has_contents=any(f.get('type')=='contents' for sec in sections for f in sec.get('fields',[]))
    toc=contents_plan(sections) if b.get('contents',False) and not has_contents else []
    toc_at=1 if b.get('contentsAfterFirst',True) and len(sections)>1 else 0
    toc_indices=[];starts={};blank_indices=set()
    for section_index,s in enumerate(sections):
        if toc and section_index==toc_at:
            for _ in toc:
                toc_indices.append(len(writer.pages));writer.add_blank_page(width=SIZES[b.get('format','A4')][0],height=SIZES[b.get('format','A4')][1])
        a=asset(s['asset']); reader=PdfReader(DATA/'pdfs'/f"{a['id']}.pdf")
        if b.get('duplex',True) and s.get('recto') and len(writer.pages)%2:
            blank_indices.add(len(writer.pages))
            writer.add_blank_page(width=float(reader.pages[0].mediabox.width),height=float(reader.pages[0].mediabox.height));report['blanks']+=1
        starts[section_index]=len(writer.pages)
        for n in range(s.get('sourceStart',0),s.get('sourceStart',0)+s['pages']):
            source=reader.pages[n]
            if s.get('numberingConfigured'):configured_pages.add(len(writer.pages))
            w,h=float(source.mediabox.width),float(source.mediabox.height)
            if pdf_format([a['meta'][n]])!=b.get('format','A4'): report['warnings'].append(f"{s['title']}, pagina {n+1}: afwijkend van A4 ({w/72*25.4:.1f} × {h/72*25.4:.1f} mm).")
            fields=[f for f in s.get('fields',[]) if int(f['page'])==n]
            if fields:
                stream=io.BytesIO(); cv=canvas.Canvas(stream,pagesize=(w,h))
                for f in fields:
                    if f.get('type') in ('contents','pageNumber'):
                        dynamic.append((len(writer.pages),f,s['title']));continue
                    value=field_text(f,{**b.get('values',{}),**s.get('values',{})},s['title'])
                    if not value: continue
                    size=float(f.get('size',11)); fw=w*float(f['w'])/100; fh=h*float(f['h'])/100
                    if f.get('type') in ('text','prefilled'):
                        items=rich_layout(value if f.get('type')=='prefilled' else f['template'],{} if f.get('type')=='prefilled' else {**b.get('values',{}),**s.get('values',{})},fw,size,f.get('color','#172d35'),TOKEN,font_name(f),f.get('align','left'))
                        required_height=sum(height for _,height in items)
                        if required_height>fh:raise ValueError(f"Het tekstblok bij {s['title']} is te laag: ingesteld {float(f['h']):g}%, nodig ongeveer {required_height/h*100:.1f}% bij de huidige breedte en lettergrootte. Vergroot Hoogte % in Bouwsteen beheren, of verkort de tekst. Neem daarna de nieuwe bouwsteenversie over in dit boekje.")
                        draw_rich(cv,items,w*float(f['x'])/100,h*(1-float(f['y'])/100),fw)
                        continue
                    lines=wrap_text(value,fw,size) if f.get('type')=='text' else value.splitlines(); lineheight=size*1.5
                    if len(lines)*lineheight>fh or any(pdfmetrics.stringWidth(line,font_name(f),size)>fw for line in lines): raise ValueError(f"Tekst past niet in ‘{f['key']}’ bij {s['title']}. Verkort de tekst of vergroot het veld.")
                    if any(ord(char)>0xFFFF for char in value): raise ValueError('Emoji’s worden in deze proef nog niet ondersteund.')
                    cv.setFont(font_name(f),size);cv.setFillColor(f.get('color','#172d35'))
                    x=w*float(f['x'])/100; y=h*(1-float(f['y'])/100)-size
                    for line in lines:
                        if f.get('align')=='center':cv.drawCentredString(x+fw/2,y,line)
                        elif f.get('align')=='right':cv.drawRightString(x+fw,y,line)
                        else:cv.drawString(x,y,line)
                        y-=lineheight
                cv.showPage();cv.save();source.merge_page(PdfReader(stream).pages[0])
            writer.add_page(source)
    for page_index,f,title in dynamic:
        page=writer.pages[page_index];w,h=float(page.mediabox.width),float(page.mediabox.height)
        fw=w*float(f['w'])/100;fh=h*float(f['h'])/100;x=w*float(f['x'])/100;top=h*(1-float(f['y'])/100)
        size=float(f.get('size',11));font=font_name(f);color=f.get('color','#183c3c')
        out=io.BytesIO();cv=canvas.Canvas(out,pagesize=(w,h))
        if f['type']=='contents':
            if fw<size*5:raise ValueError(f'Inhoudsopgaveveld is te smal bij {title}. Vergroot de breedte.')
            rows=contents_field_layout(sections,starts,fw,size,color,font)
            if sum(height+size*.5 for _,height,_ in rows)>fh:raise ValueError(f'Inhoudsopgave past niet in het veld bij {title}. Vergroot het veld of verklein de lettergrootte.')
            draw_contents_field(cv,rows,x,top,fw,size,font,color)
        else:
            number=str(page_index+1)
            draw_number_box(cv,number,x+fw/2,top-size,w,h)
        cv.save();page.merge_page(PdfReader(out).pages[0])
    for n,index in enumerate(toc_indices):writer.pages[index].merge_page(render_contents(toc[n],starts,n,SIZES[b.get('format','A4')]))
    if b.get('pageNumbers',False):add_page_numbers(writer,blank_indices|configured_pages|{i for i,f,_ in dynamic if f['type']=='pageNumber'},b.get('hideFirstNumber',True),b.get('numberPosition','center'))
    report['contentsPages']=len(toc_indices)
    report['chapterStarts']=[{'title':s.get('tocTitle') or s['title'],'page':starts[n]+1,'hidden':bool(s.get('tocHidden'))} for n,s in enumerate(sections)]
    digital_chapters={}
    for n,section in enumerate(sections):
        key=section.get('_digitalChapter')
        if key is None:continue
        if key not in digital_chapters:digital_chapters[key]={'title':section.get('tocTitle') or section['title'],'hidden':bool(section.get('tocHidden')),'pageNumbers':[]}
        digital_chapters[key]['pageNumbers'].extend(range(starts[n]+1,starts[n]+section['pages']+1))
    report['digitalChapters']=[{**chapter,'page':chapter['pageNumbers'][0],'end':chapter['pageNumbers'][-1]} for chapter in digital_chapters.values() if not chapter['hidden']]
    report['warnings']=list(dict.fromkeys(report['warnings']))
    report['warnings'].append('Geen PDF/X-certificering, kleurconversie of automatische controle van fotoresolutie/afloop. Stem dit af op het gekozen drukproduct en controleer een proefdruk.')
    report['pages']=len(writer.pages)
    report['fillersAdded']=sum(x['pages'] for x in preparation['fillers']) if options.get('fill') else 0
    if preparation['missing']:report['warnings'].append('Niet ingestelde keuzeplekken overgeslagen: '+', '.join(preparation['missing']))
    if report['pages']%4:report['warnings'].append('Op uw keuze geëxporteerd zonder aanvulling: aantal pagina’s is niet deelbaar door vier.')
    if options.get('dryRun'):return {'report':report}
    i=ident();target=DATA/'exports'/f'{i}.pdf'
    writer.remove_annotations(subtypes='/Link')
    writer.add_metadata({'/Title':book['title'],'/Creator':'Treinrondreis Boekjesmaker'})
    try:
        with target.open('wb') as f: writer.write(QuotaWriter(f))
    except Exception:
        target.unlink(missing_ok=True)
        raise
    result=PdfReader(target)
    if len(result.pages)!=report['pages'] or result.get_fields(): raise ValueError('PDF-controle mislukt.')
    with db() as c:c.execute('INSERT INTO exports VALUES(?,?,?,?,?,?)',(i,book['id'],book['title'],now(),json.dumps(book,ensure_ascii=False),json.dumps(report,ensure_ascii=False)))
    return {'id':i,'report':report,'url':f'/files/export/{i}'}

class Handler(BaseHTTPRequestHandler):
    def log_message(self,*a): pass
    def send(self,status,body,ctype='application/json',headers=None):
        raw=json.dumps(body,ensure_ascii=False).encode() if ctype=='application/json' else body
        self.send_response(status);self.send_header('Content-Type',ctype);self.send_header('Content-Length',str(len(raw)));self.send_header('Cache-Control','no-store');self.send_header('X-Content-Type-Options','nosniff');self.send_header('Referrer-Policy','no-referrer')
        for k,v in (headers or {}).items():self.send_header(k,v)
        self.end_headers();self.wfile.write(raw)
    def auth(self):
        cookie=self.headers.get('Cookie','');m=re.search(r'(?:^|; )session=([a-f0-9]+)',cookie)
        s=SESSIONS.get(m.group(1) if m else '')
        return s if s and s['expires']>time.time() else None
    def do_GET(self):
        try:self.get()
        except ConnectionError:pass
        except (ValueError,KeyError) as e:self.send(400,{'error':str(e)})
        except Exception:self.send(500,{'error':'Dit kon niet worden verwerkt. De oorspronkelijke bestanden blijven bewaard.'})
    def get(self):
        path=urlparse(self.path).path
        if path=='/':return self.send(200,(ROOT/'index.html').read_bytes(),'text/html; charset=utf-8')
        if path=='/api/session':
            with db() as c:setup=c.execute('SELECT COUNT(*) FROM users').fetchone()[0]==0
            s=self.auth();return self.send(200,{'setup':setup,'user':s['user'] if s else None,'version':APP_VERSION})
        if path=='/google/callback':
            try:
                google_connection.callback(DATA,urlparse(self.path).query)
                message='Google is gekoppeld. U kunt dit tabblad sluiten en teruggaan naar de boekjesmaker.'
            except ValueError as e:message=str(e)
            import html
            return self.send(200,('<!doctype html><meta charset=utf-8><title>Google koppelen</title><p>'+html.escape(message)+'</p>').encode(),'text/html; charset=utf-8',{'Cache-Control':'no-store','Referrer-Policy':'no-referrer'})
        session=self.auth()
        if not session:return self.send(401,{'error':'Log eerst in.'})
        if path=='/api/google/status':
            return self.send(200,google_connection.status(DATA))
        if path=='/api/state':
            with db() as c:
                rows=[{**dict(r),'body':json.loads(r['body'])} for r in c.execute("SELECT objects.*, COALESCE((SELECT rowid FROM assets WHERE assets.id=json_extract(objects.body,'$.asset')),0) AS uploadOrder FROM objects ORDER BY title")]
                exports=[{k:r[k] for k in ('id','book_id','title','created','report')} for r in c.execute('SELECT * FROM exports ORDER BY rowid DESC')]
            for o in rows:
                if o['kind']=='block':o['body']['format']=pdf_format(asset(o['body']['asset'])['meta'])
            for r in exports:r['report']=json.loads(r['report'])
            return self.send(200,{'objects':rows,'exports':exports,'countries':COUNTRIES})
        m=re.fullmatch(r'/(digital|api/digital|files/export-preview)/([a-f0-9]{32})(?:/(\d+))?',path)
        if m:
            kind,i,page=m.groups()
            with db() as c:row=c.execute('SELECT * FROM exports WHERE id=?',(i,)).fetchone()
            if not row:return self.send(404,{'error':'Deze drukversie bestaat niet.'})
            report=json.loads(row['report'])
            if kind=='digital':return self.send(200,(ROOT/'digital.html').read_bytes(),'text/html; charset=utf-8')
            if kind=='api/digital':
                starts=report.get('chapterStarts',[])
                chapters=[{**item,'end':starts[n+1]['page']-1 if n+1<len(starts) else report['pages']} for n,item in enumerate(starts) if not item.get('hidden')]
                if 'digitalChapters' in report:chapters=report['digitalChapters']
                if not chapters:chapters=[{'title':'Uw reisboekje','page':1,'end':report['pages']}]
                return self.send(200,{'title':row['title'],'created':row['created'],'pages':report['pages'],'chapters':chapters})
            page=int(page or 0)
            if not 0<=page<report['pages']:raise ValueError('Pagina bestaat niet.')
            preview=DATA/'previews'/f'export-{i}-{page}.png'
            with LOCK:
                if not preview.exists():
                    ensure_capacity(20*1024*1024)
                    subprocess.run([str(POPPLER),'-f',str(page+1),'-l',str(page+1),'-scale-to','1600','-singlefile','-png',str(DATA/'exports'/f'{i}.pdf'),str(preview.with_suffix(''))],check=True,timeout=60,creationflags=0x08000000 if os.name=='nt' else 0)
            return self.send(200,preview.read_bytes(),'image/png')
        m=re.fullmatch(r'/files/(asset|export|preview)/([a-f0-9]{32})(?:/(\d+))?',path)
        if m:
            kind,i,page=m.groups()
            if kind=='export':
                p=DATA/'exports'/f'{i}.pdf'
                if not p.exists():return self.send(404,{'error':'Niet gevonden.'})
                return self.send(200,p.read_bytes(),'application/pdf',{'Content-Disposition':f'{"attachment" if parse_qs(urlparse(self.path).query).get("download") else "inline"}; filename="boekje-{i[:8]}.pdf"'})
            a=asset(i);p=DATA/'pdfs'/f'{i}.pdf'
            if kind=='asset':return self.send(200,p.read_bytes(),'application/pdf')
            page=int(page or 0)
            if not 0<=page<a['pages']:raise ValueError('Pagina bestaat niet.')
            preview=DATA/'previews'/f'{i}-{page}.png'
            with LOCK:
                if not preview.exists():
                    ensure_capacity(20*1024*1024)
                    subprocess.run([str(POPPLER),'-f',str(page+1),'-l',str(page+1),'-scale-to','950','-singlefile','-png',str(p),str(preview.with_suffix(''))],check=True,timeout=40,creationflags=0x08000000 if os.name=='nt' else 0)
            return self.send(200,preview.read_bytes(),'image/png')
        self.send(404,{'error':'Niet gevonden.'})
    def do_POST(self):
        try:
            # Local app: reject cross-origin mutations and require JSON/custom headers.
            host=self.headers.get('Host','')
            if host not in (f'127.0.0.1:{self.server.server_port}',f'localhost:{self.server.server_port}'):return self.send(403,{'error':'Ongeldige host.'})
            origin=self.headers.get('Origin')
            if origin and origin not in ('http://'+host,):return self.send(403,{'error':'Andere oorsprong geweigerd.'})
            if self.headers.get('X-Booklets')!='1':return self.send(403,{'error':'Ongeldig verzoek.'})
            size=int(self.headers.get('Content-Length','0'))
            if size>50*1024*1024:raise ValueError('Maximaal 50 MB per upload.')
            raw=self.rfile.read(size);path=urlparse(self.path).path
            b={} if path=='/api/upload' else json.loads(raw or b'{}')
            if path in ('/api/setup','/api/login'):
                with LOCK:
                    with db() as c: count=c.execute('SELECT COUNT(*) FROM users').fetchone()[0]
                    if path=='/api/setup':
                        if count:raise ValueError('Er is al een beheerder.')
                        user_create(b['name'],b['password'],True)
                    with db() as c:r=c.execute('SELECT * FROM users WHERE name=?',(b['name'].strip(),)).fetchone()
                    if not r or not hmac.compare_digest(r['password'],pw(b['password'],r['salt'])):
                        time.sleep(1);return self.send(401,{'error':'Naam of wachtwoord klopt niet.'})
                    token=secrets.token_hex(32);u={'name':r['name'],'admin':bool(r['admin'])};SESSIONS[token]={'user':u,'expires':time.time()+8*3600}
                return self.send(200,{'user':u},'application/json',{'Set-Cookie':f'session={token}; HttpOnly; SameSite=Strict; Path=/'})
            session=self.auth()
            if not session:return self.send(401,{'error':'Log eerst in.'})
            if path=='/api/logout':return self.send(200,{'ok':True},headers={'Set-Cookie':'session=; Max-Age=0; HttpOnly; SameSite=Strict; Path=/'})
            if path=='/api/users':
                if not session['user']['admin']:return self.send(403,{'error':'Alleen de beheerder kan accounts toevoegen.'})
                user_create(b['name'],b['password']);return self.send(200,{'ok':True})
            if path.startswith('/api/google/'):
                context=SimpleNamespace(**globals())
                action=path.rsplit('/',1)[-1]
                if action in ('configure','connect','disconnect'):
                    if not session['user']['admin']:return self.send(403,{'error':'Alleen de beheerder kan Google koppelen.'})
                    if action=='configure':google_connection.configure(DATA,b.get('config',''));return self.send(200,{'ok':True})
                    if action=='connect':return self.send(200,{'url':google_connection.connect(DATA,self.server.server_port)})
                    google_connection.disconnect(DATA);return self.send(200,{'ok':True})
                if action=='import':return self.send(200,google_sources.load(context,b,{}))
                if action=='select-pages':return self.send(200,google_sources.select_pages(context,b['document'],b['pages']))
                if action=='prepare':return self.send(200,google_sources.prepare(context,b['body'],b.get('allowCached') is True))
                return self.send(404,{'error':'Niet gevonden.'})
            if path=='/api/upload':
                reader,meta=inspect_pdf(raw);i=ident();title=parse_qs(urlparse(self.path).query).get('title',['Bouwsteen'])[0][:160]
                ensure_capacity(len(raw))
                (DATA/'pdfs'/f'{i}.pdf').write_bytes(raw)
                with db() as c:c.execute('INSERT INTO assets VALUES(?,?,?,?,?)',(i,title,len(reader.pages),json.dumps(meta),now()))
                return self.send(200,{'id':i,'pages':len(reader.pages),'meta':meta,'format':pdf_format(meta)})
            if path=='/api/check-layout':
                return self.send(200,check_layout(b['body'],b.get('values',{})))
            if path=='/api/book-trash':
                with LOCK,db() as c:
                    old=c.execute('SELECT * FROM objects WHERE id=?',(b['id'],)).fetchone()
                    if not old or old['kind']!='book':raise ValueError('Boeking niet gevonden.')
                    if old['revision']!=b.get('revision'):return self.send(409,{'error':'Deze boeking is gewijzigd. Vernieuw het overzicht en probeer opnieuw.'})
                    body=json.loads(old['body'])
                    if b.get('restore') is True:body.pop('deletedAt',None)
                    else:body['deletedAt']=now()
                    c.execute('UPDATE objects SET body=?,revision=revision+1 WHERE id=?',(json.dumps(body,ensure_ascii=False),b['id']))
                return self.send(200,{'ok':True})
            if path=='/api/bulk':
                with LOCK,db() as c:
                    c.execute('BEGIN IMMEDIATE')
                    result=bulk_ops.update(c,b.get('items'),b.get('changes'),validate_body,ident(),now())
                return self.send(200,result)
            if path=='/api/bulk-undo':
                with LOCK,db() as c:
                    c.execute('BEGIN IMMEDIATE')
                    result=bulk_ops.undo(c,b['id'],validate_body)
                return self.send(200,result)
            if path=='/api/save':
                kind=b['kind'];title=b['title'].strip()[:160]
                if not title:raise ValueError('Vul een naam in.')
                validate_body(kind,b['body']);i=b.get('id') or ident()
                with LOCK,db() as c:
                    old=c.execute('SELECT * FROM objects WHERE id=?',(i,)).fetchone()
                    if old and (old['revision']!=b.get('revision') or old['kind']!=kind):return self.send(409,{'error':'Een collega heeft dit onderdeel gewijzigd. Herlaad voordat u verdergaat.'})
                    if old and json.loads(old['body']).get('deletedAt'):raise ValueError('Deze boeking staat in de prullenbak. Herstel hem eerst vanuit het overzicht.')
                    b['body'].pop('deletedAt',None)
                    rev=old['revision']+1 if old else 1
                    c.execute('INSERT OR REPLACE INTO objects VALUES(?,?,?,?,?)',(i,kind,title,rev,json.dumps(b['body'],ensure_ascii=False)))
                return self.send(200,{'id':i,'revision':rev})
            if path=='/api/export-plan':
                with db() as c:objects=[{**dict(r),'body':json.loads(r['body'])} for r in c.execute('SELECT * FROM objects')]
                for o in objects:
                    if o['kind']=='block':o['body']['format']=pdf_format(asset(o['body']['asset'])['meta'])
                return self.send(200,preflight.check(SimpleNamespace(**globals()),b['body'],objects,bool(b.get('fill'))))
            if path=='/api/export':
                book=obj(b['id'])
                if book['body'].get('deletedAt'):raise ValueError('Deze boeking staat in de prullenbak. Herstel hem eerst.')
                if book['kind']!='book':raise ValueError('Alleen boekingen kunnen worden geëxporteerd.')
                if book['revision']!=b['revision']:raise ValueError('Het boekje is gewijzigd. Herlaad eerst.')
                return self.send(200,make_export(book,b))
            self.send(404,{'error':'Niet gevonden.'})
        except sqlite3.IntegrityError:self.send(400,{'error':'Deze gebruikersnaam bestaat al.'})
        except (ValueError,KeyError,TypeError) as e:self.send(400,{'error':str(e)})
        except Exception:self.send(500,{'error':'Verwerking mislukt. Controleer of dit een geldige PDF is. De bronbestanden blijven bewaard.'})

class BookletServer(ThreadingHTTPServer):
    allow_reuse_address = False
    def server_bind(self):
        if hasattr(socket,'SO_EXCLUSIVEADDRUSE'):
            self.socket.setsockopt(socket.SOL_SOCKET,socket.SO_EXCLUSIVEADDRUSE,1)
        super().server_bind()

if __name__=='__main__':
    port=int(os.environ.get('BOOKLETS_PORT','8766'))
    server=BookletServer(('127.0.0.1',port),Handler)
    print(f'Boekjesmaker staat klaar op http://127.0.0.1:{port}',flush=True)
    server.serve_forever()
