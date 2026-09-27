"""Google source assets and generation checks. Existing PDFs remain immutable."""
import copy, hashlib, io, json, secrets, time
from pypdf import PdfReader, PdfWriter
import google_connection as connection
import google_layout

PREPARED={}

def settings(source):
    if not isinstance(source,dict):raise ValueError('Ongeldige Google-bron.')
    i=connection.document_id(source.get('url',''))
    fmt=source.get('format','A5');layout=source.get('layout','route')
    if fmt not in ('A4','A5') or layout not in ('route','text'):raise ValueError('Kies een geldig formaat en een pagina-indeling.')
    return {'url':'https://docs.google.com/document/d/'+i+'/edit','documentId':i,'format':fmt,'layout':layout}

def load(s,source,cache):
    cfg=settings(source);key=cfg['documentId']
    if key not in cache:
        doc=connection.fetch_document(s.DATA,cfg['url'])
        cache[key]=google_layout.normalize(doc,connection.fetch_image)
    model,images=cache[key]
    digest=hashlib.sha256((model['digest']+json.dumps(cfg,sort_keys=True)).encode()).hexdigest()
    selection=source.get('selectedPages')
    if selection is not None and digest!=source.get('sourceDigest'):
        raise ValueError('De Google-bron of pagina-indeling is gewijzigd. Controleer de paginaselectie via Nu vernieuwen / pagina’s kiezen bij de bouwsteen, of Pagina’s kiezen / vernieuwen bij het eenmalige reisschema. De opgeslagen selectie blijft behouden.')
    if digest==source.get('sourceDigest',source.get('digest')) and source.get('fullAsset',source.get('asset')):
        a=s.asset(source.get('fullAsset',source.get('asset')))
    else:
        raw=google_layout.render(model,images,cfg['format'],cfg['layout']);r,meta=s.inspect_pdf(raw);i=s.ident()
        s.ensure_capacity(len(raw))
        (s.DATA/'pdfs'/f'{i}.pdf').write_bytes(raw)
        with s.db() as c:c.execute('INSERT INTO assets VALUES(?,?,?,?,?)',(i,model['title'],len(r.pages),json.dumps(meta),s.now()))
        a=s.asset(i)
    result={'title':model['title'],'asset':a['id'],'pages':a['pages'],'meta':a['meta'],'format':cfg['format'],'googleDoc':{**cfg,'digest':digest,'asset':a['id'],'checkedAt':s.now()},'warnings':model['warnings']}
    if selection is not None:
        if source.get('asset') and source.get('sourceDigest')==digest:
            chosen=s.asset(source['asset'])
            return {**result,'asset':chosen['id'],'pages':chosen['pages'],'meta':chosen['meta'],'googleDoc':{**source,'checkedAt':s.now()}}
        return select_pages(s,result,selection)
    return result

def select_pages(s,result,pages):
    source=result['googleDoc'];settings(source)
    asset=s.asset(result['asset']);count=asset['pages']
    if not isinstance(pages,list) or not pages or any(type(n) is not int or not 0<=n<count for n in pages) or pages!=sorted(set(pages)):
        raise ValueError('Kies minstens één geldige pagina, in de oorspronkelijke volgorde.')
    if pages==list(range(count)):return result
    reader=PdfReader(s.DATA/'pdfs'/f"{asset['id']}.pdf");writer=PdfWriter()
    for n in pages:writer.add_page(reader.pages[n])
    out=io.BytesIO();writer.write(out);raw=out.getvalue();r,meta=s.inspect_pdf(raw);s.ensure_capacity(len(raw));ident=s.ident()
    (s.DATA/'pdfs'/f'{ident}.pdf').write_bytes(raw)
    with s.db() as c:c.execute('INSERT INTO assets VALUES(?,?,?,?,?)',(ident,result['title'],len(r.pages),json.dumps(meta),s.now()))
    digest=hashlib.sha256((source['digest']+json.dumps(pages)).encode()).hexdigest()
    return {**result,'asset':ident,'pages':len(r.pages),'meta':meta,'googleDoc':{**source,'asset':ident,'digest':digest,'sourceDigest':source['digest'],'fullAsset':asset['id'],'sourcePages':count,'selectedPages':pages}}

def number_fields(s,body,pages):
    # Source text is edited in Google Docs, so reflow cannot strand personal overlays.
    if any(f.get('type')!='pageNumber' for f in body.get('fields',[])):
        raise ValueError('Een Google-bron ondersteunt alleen paginanummervelden. Bewerk de tekst in Google Docs of gebruik een vaste PDF voor persoonlijke invulvelden.')
    old={f['page']:f for f in body.get('fields',[])}
    if body.get('numberingConfigured') and not old:return []
    return [copy.deepcopy(old.get(n,dict(key='Paginanummer',type='pageNumber',page=n,x=45,y=100-34/s.SIZES[body.get('format','A5')][1]*100,w=10,h=3,size=10,font='Open Sans',color='#ffffff',required=False))) for n in range(pages) if n in old or n>=body.get('pages',0)]

def update_body(s,body,result):
    b=copy.deepcopy(body)
    fields=number_fields(s,b,result['pages'])
    b.update({k:result[k] for k in ('asset','pages','format','googleDoc')})
    b['fields']=fields;b['numberingConfigured']=True
    return b

def selected(body):
    return [slot.get('selected') if slot.get('choice') else slot for slot in body.get('sections',[]) if not slot.get('choice') or slot.get('selected')]

def signature(body):
    return hashlib.sha256(json.dumps([(x.get('block'),x.get('asset'),x.get('googleDoc')) for x in selected(body) if x.get('googleDoc')],sort_keys=True).encode()).hexdigest()

def prepare(s,body,allow_cached=False):
    with s.db() as c:objects=[{**dict(r),'body':json.loads(r['body'])} for r in c.execute('SELECT * FROM objects')]
    b=s.refresh_blocks(body,objects);byid={o['id']:o for o in objects};cache={};updated={};failures=[];oneoffs=[]
    for slot in selected(b):
        source=slot.get('googleDoc')
        if not source:continue
        block=byid.get(slot.get('block'))
        if block and block['id'] in updated:continue
        try:
            result=load(s,source,cache)
            if block:updated[block['id']]=(block,update_body(s,block['body'],result))
            else:oneoffs.append((slot,update_body(s,slot,result)))
        except ValueError as e:failures.append({'title':slot.get('title','Google-document'),'message':str(e)})
    if failures and not allow_cached:return {'errors':failures,'body':None}
    with s.LOCK,s.db() as c:
        c.execute('BEGIN IMMEDIATE')
        for key,(old,new) in updated.items():
            row=c.execute('SELECT revision FROM objects WHERE id=?',(key,)).fetchone()
            if not row or row['revision']!=old['revision']:raise ValueError('Een Google-bouwsteen is ondertussen gewijzigd. Controleer het boekje opnieuw.')
            # Checking a source without a content change does not create a new revision.
            if new['googleDoc']['digest']!=old['body']['googleDoc'].get('digest'):
                s.validate_body('block',new)
                c.execute('UPDATE objects SET body=?,revision=revision+1 WHERE id=?',(json.dumps(new,ensure_ascii=False),key))
                byid[key]={**old,'body':new,'revision':old['revision']+1}
    for slot,new in oneoffs:slot.update(new)
    b=s.refresh_blocks(b,list(byid.values()))
    key=secrets.token_urlsafe(32)
    for k,v in list(PREPARED.items()):
        if v['expires']<time.time():PREPARED.pop(k,None)
    PREPARED[key]={'expires':time.time()+900,'signature':signature(b),'warnings':['Laatste opgeslagen Google-versie gebruikt: '+f['title'] for f in failures]}
    b['_googlePreparation']=key
    return {'body':b,'errors':[],'warnings':PREPARED[key]['warnings'],'checked':len(cache)}

def verify(body):
    if not any(x.get('googleDoc') for x in selected(body)):return []
    p=PREPARED.get(body.get('_googlePreparation'))
    if not p or p['expires']<time.time() or p['signature']!=signature(body):raise ValueError('Controleer de Google-bronnen opnieuw voordat u de PDF maakt.')
    return p['warnings']
