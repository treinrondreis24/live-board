import copy, unicodedata

COUNTRIES = 'Albanië|Andorra|Armenië|Azerbeidzjan|België|Bosnië en Herzegovina|Bulgarije|Cyprus|Denemarken|Duitsland|Estland|Finland|Frankrijk|Georgië|Griekenland|Hongarije|Ierland|IJsland|Italië|Kazachstan|Kosovo|Kroatië|Letland|Liechtenstein|Litouwen|Luxemburg|Malta|Moldavië|Monaco|Montenegro|Nederland|Noord-Macedonië|Noorwegen|Oekraïne|Oostenrijk|Polen|Portugal|Roemenië|Rusland|San Marino|Servië|Slovenië|Slowakije|Spanje|Tsjechië|Turkije|Vaticaanstad|Verenigd Koninkrijk|Wit-Rusland|Zweden|Zwitserland'.split('|')
SIZES={'A4':(595.276,841.89),'A5':(595.276,419.528)}
def norm(v):return ''.join(c for c in unicodedata.normalize('NFD',str(v)) if not unicodedata.combining(c)).lower().strip()
def pdf_format(meta):
    formats=[]
    for m in meta:
        w,h=m['width'],m['height']
        if m.get('rotation',0)%180:w,h=h,w
        # Canva exports may include 3 mm bleed on every edge without a TrimBox.
        # Classify that known size without changing or cropping the source PDF.
        bleed=6*72/25.4
        formats.append(next((k for k,(x,y) in SIZES.items()
                             if (abs(w-x)<3 and abs(h-y)<3)
                             or (abs(w-x-bleed)<1 and abs(h-y-bleed)<1)), 'Onbekend'))
    return formats[0] if formats and len(set(formats))==1 else 'Onbekend'
def snapshot(o):
    b=o['body'];return dict(block=o['id'],revision=o['revision'],title=o['title'],**{k:copy.deepcopy(b[k]) for k in ('asset','pages','fields','numberingConfigured','tocTitle','tocHidden','googleDoc') if k in b},values={},recto=False)
def resolved(b):
    return [copy.deepcopy(s['selected'] if s.get('choice') else s) for s in b.get('sections',[]) if not s.get('choice') or s.get('selected')]

def refresh_blocks(body,objects):
    """Update referenced block content, preserving the booking's choices and values."""
    b=copy.deepcopy(body);blocks={o['id']:o for o in objects if o['kind']=='block'}
    def refresh(s):
        o=blocks.get(s.get('block'))
        if not o:return s
        fresh=snapshot(o)
        fresh['values']=copy.deepcopy(s.get('values',{}));fresh['recto']=s.get('recto',False)
        return fresh
    for i,s in enumerate(b.get('sections',[])):
        if s.get('choice'):
            s['options']=[refresh(o) for o in s.get('options',[])]
            if s.get('selected'):s['selected']=refresh(s['selected'])
        else:b['sections'][i]=refresh(s)
    return b

def library_stamp(objects):
    return '|'.join(sorted(o['id']+':'+str(o['revision']) for o in objects if o['kind']=='block'))
def count_pages(b,sections):
    from book_layout import contents_plan
    toc=contents_plan(sections) if b.get('contents') and not any(f.get('type')=='contents' for s in sections for f in s.get('fields',[])) else []
    at=1 if b.get('contentsAfterFirst',True) and len(sections)>1 else 0
    n=0
    for i,s in enumerate(sections):
        if i==at:n+=len(toc)
        if b.get('duplex',True) and s.get('recto') and n%2:n+=1
        n+=s['pages']
    return n
def insert_fillers(sections,fillers):
    out=copy.deepcopy(sections);last=out.pop();start=last.get('sourceStart',0)
    if last['pages']>1:
        first=copy.deepcopy(last);first['pages']-=1;out.append(first)
        last['sourceStart']=start+first['pages'];last['pages']=1;last['recto']=False;last['tocHidden']=True
    else:last['recto']=False
    return out+copy.deepcopy(fillers)+[last]
def plan(b,objects):
    sections=resolved(b)
    if not sections:raise ValueError('Kies of voeg ten minste één bouwsteen toe.')
    pages=count_pages(b,sections);needed=(-pages)%4
    available=sorted([o for o in objects if o['kind']=='block' and not o['body'].get('archived') and o['body'].get('fillerOrder') and o['body'].get('format')==b.get('format','A4')],key=lambda o:(int(o['body']['fillerOrder']),o['title']))
    # At most one page per fixed position, never two competing page 1 designs.
    available=list({int(o['body']['fillerOrder']):o for o in reversed(available)}.values())
    available.sort(key=lambda o:int(o['body']['fillerOrder']))
    chosen=[]
    if needed:
        for o in available:
            s=snapshot(o);s['tocHidden']=True;chosen.append(s)
            if sum(x['pages'] for x in chosen)>3:break
            proposed=insert_fillers(sections,chosen)
            if count_pages(b,proposed)%4==0:break
        else:chosen=[]
        if chosen and count_pages(b,insert_fillers(sections,chosen))%4:chosen=[]
    return dict(pages=pages,needed=needed,missing=[s['title'] for s in b.get('sections',[]) if s.get('choice') and not s.get('selected')],fillers=chosen,canFill=bool(chosen),sections=sections)
