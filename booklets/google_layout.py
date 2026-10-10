"""Flow Google Docs content into the approved A4/A5 house style, without AI."""
import hashlib, html, io, json, re
from PIL import Image as PILImage
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import BaseDocTemplate, PageTemplate, Frame, Paragraph, Spacer, Image, Table, TableStyle, KeepTogether
from features import SIZES

LAYOUT_VERSION='2026.09.27.2-compact-routes'

def normalize(doc,fetch_image):
    tabs=[]
    def visit(t):
        props=t.get('tabProperties',t);body=t.get('documentTab',t)
        tabs.append((props,body))
        for child in t.get('childTabs',[]):visit(child)
    for t in doc.get('tabs',[]):visit(t)
    if not tabs:tabs=[({'title':doc.get('title','Document')},doc)]
    blocks=[];images={};warnings=[]
    def image(obj):
        im=obj.get('embeddedObject',{}).get('imageProperties',{})
        if not im.get('contentUri'):raise ValueError('Een afbeelding of tekening kan niet worden overgenomen. Exporteer deze pagina als PDF.')
        raw=fetch_image(im['contentUri']);p=PILImage.open(io.BytesIO(raw));p.load()
        if p.width*p.height>25000000:raise ValueError('Een afbeelding is te groot. Verklein deze in Google Docs.')
        # Preserve the visible crop of the source; never retrieve arbitrary external links.
        crop=im.get('cropProperties',{})
        if any(crop.get(k,0) for k in ['offsetLeft','offsetTop','offsetRight','offsetBottom']):
            l,t,r,b=[max(0,min(.95,float(crop.get(k,0)))) for k in ['offsetLeft','offsetTop','offsetRight','offsetBottom']]
            if l+r>=1 or t+b>=1:raise ValueError('Een afbeeldingsuitsnede is ongeldig.')
            p=p.crop((round(l*p.width),round(t*p.height),round((1-r)*p.width),round((1-b)*p.height)))
        out=io.BytesIO();p.convert('RGB').save(out,format='PNG');raw=out.getvalue();key=hashlib.sha256(raw).hexdigest()
        images[key]=raw
        return {'type':'image','key':key,'width':p.width,'height':p.height,'sourceX':obj.get('positioning',{}).get('leftOffset',{}).get('magnitude',0)}
    def content(elements,tab):
        out=[];counters={}
        for e in elements:
            if 'paragraph' in e:
                p=e['paragraph'];text='';plain='';size=0;allbold=True;embedded=[]
                for run in p.get('elements',[]):
                    if 'textRun' in run:
                        r=run['textRun'];v=r.get('content','');plain+=v;style=r.get('textStyle',{});size=max(size,style.get('fontSize',{}).get('magnitude',0));allbold=allbold and (not v.strip() or style.get('bold',False))
                        s=html.escape(v).replace('\n','<br/>').replace('\x0b','<br/>')
                        if style.get('bold'):s='<b>'+s+'</b>'
                        if style.get('italic'):s='<i>'+s+'</i>'
                        link=style.get('link',{}).get('url','')
                        if re.match(r'^(https?://|mailto:)',link):s='<link href="'+html.escape(link,quote=True)+'" color="#000000">'+s+'</link>'
                        text+=s
                    elif 'inlineObjectElement' in run:
                        key=run['inlineObjectElement']['inlineObjectId'];embedded.append(image(tab.get('inlineObjects',{}).get(key,{}).get('inlineObjectProperties',{})))
                    elif any(k in run for k in ['person','richLink','dateElement','footnoteReference','equation']):
                        raise ValueError('Dit document bevat een chip, formule of voetnoot die nog niet wordt ondersteund. Gebruik gewone tekst of een PDF.')
                bullet=None
                if p.get('bullet'):
                    list_id=p['bullet'].get('listId');level=p['bullet'].get('nestingLevel',0)
                    levels=tab.get('lists',{}).get(list_id,{}).get('listProperties',{}).get('nestingLevels',[])
                    props=levels[level] if level<len(levels) else {};glyph=props.get('glyphType','GLYPH_TYPE_UNSPECIFIED')
                    if glyph in ('DECIMAL','ZERO_DECIMAL'):
                        key=(list_id,level);number=counters.get(key,props.get('startNumber',1));counters[key]=number+1;bullet=str(number)+'.'
                    elif glyph not in ('GLYPH_TYPE_UNSPECIFIED',None):raise ValueError('Deze opsomming gebruikt een niet ondersteunde nummerstijl. Gebruik gewone cijfers of opsommingstekens.')
                    else:bullet=props.get('glyphSymbol') or '•'
                if plain.strip():out.append({'type':'text','html':text.rstrip().removesuffix('<br/>'),'plain':plain.strip(),'heading':p.get('paragraphStyle',{}).get('namedStyleType','').startswith(('HEADING','TITLE')) or (allbold and len(plain.strip())<100),'size':size,'bullet':bullet})
                out.extend(embedded)
                for key in p.get('positionedObjectIds',[]):out.append(image(tab.get('positionedObjects',{}).get(key,{}).get('positionedObjectProperties',{})))
            elif 'table' in e:
                rows=[]
                for row in e['table'].get('tableRows',[]):
                    cells=[]
                    for cell in row.get('tableCells',[]):
                        if any(cell.get('tableCellStyle',{}).get(k,1)>1 for k in ['rowSpan','columnSpan']):raise ValueError('Samengevoegde tabelcellen worden nog niet ondersteund. Gebruik voor dit document een PDF.')
                        cells.append(content(cell.get('content',[]),tab))
                    rows.append(cells)
                out.append({'type':'table','rows':rows})
            elif 'tableOfContents' in e:raise ValueError('Gebruik de inhoudsopgave van de boekjesmaker; verwijder de automatische inhoudsopgave uit deze Google-bron.')
        return out
    for idx,(props,tab) in enumerate(tabs):
        if tab.get('headers') or tab.get('footers') or tab.get('footnotes'):
            raise ValueError('Dit document heeft kopteksten, voetteksten of voetnoten. Gebruik een bron zonder deze onderdelen, of voeg het document als PDF toe.')
        if len(tabs)>1:blocks.append({'type':'text','html':html.escape(props.get('title','Tabblad')),'plain':props.get('title','Tabblad'),'heading':True,'size':16,'tabHeading':True})
        blocks.extend(content(tab.get('body',{}).get('content',[]),tab))
    if not blocks:raise ValueError('Het Google-document bevat geen tekst of afbeeldingen.')
    title=doc.get('title','Google-document')
    if len(tabs)==1 and blocks[0]['type']=='text' and (blocks[0].get('size',0)>=14 or blocks[0]['heading']):title=blocks.pop(0)['plain']
    # Duplicate objects are kept: the source order remains meaningful.
    model={'title':title,'blocks':blocks,'warnings':warnings,'tabCount':len(tabs)}
    model['digest']=hashlib.sha256(json.dumps(model,sort_keys=True,ensure_ascii=False).encode()+LAYOUT_VERSION.encode()).hexdigest()
    return model,images

def render(model,images,fmt,layout):
    W,H=SIZES[fmt];margin=28;gap=24;width=W-2*margin
    title=Paragraph(html.escape(model['title']),ParagraphStyle('title',fontName='Montserrat',fontSize=model.get('titleSize',22),leading=model.get('titleLeading',28),textColor='#000000'))
    _,th=title.wrap(width,H);top=margin+th+8
    if th>90:raise ValueError('De documenttitel is te lang. Gebruik een kortere titel in Google Docs.')
    avail=H-top-42
    def para(b):
        size=b.get('renderSize',model.get('headingSize',10.5) if b.get('heading') else model.get('bodySize',10.5))
        style=ParagraphStyle('body',fontName='Booklet-Bold' if b.get('heading') else 'Booklet',fontSize=size,leading=size*model.get("lineSpacing",1.6),textColor='#000000',spaceAfter=b.get('spaceAfter',7),spaceBefore=7 if b.get('heading') else 0,keepWithNext=b.get('heading',False))
        if b.get('bullet'):style.leftIndent=12*b.get('bulletLevel',1);style.bulletIndent=style.leftIndent-12
        return Paragraph(b['html'],style,bulletText=b.get('bullet') or None)
    def picture(b,w,h=avail):
        scale=min(w/b['width'],h/b['height']);im=Image(io.BytesIO(images[b['key']]),width=b['width']*scale,height=b['height']*scale);im.hAlign='LEFT';return im
    def flows(blocks,w):
        result=[]
        for b in blocks:
            if b['type']=='text':result.append(para(b))
            elif b['type']=='image':result.extend([picture(b,w,avail-12),Spacer(1,10)])
            else:
                n=max((len(r) for r in b['rows']),default=0)
                if not n:continue
                if n>8:raise ValueError('De tabel is te breed. Gebruik maximaal 8 kolommen of voeg de tabel als PDF toe.')
                rows=[[flows(cell,w/n-12) for cell in row]+['']*(n-len(row)) for row in b['rows']]
                t=Table(rows,colWidths=[w/n]*n,hAlign='LEFT',repeatRows=1)
                t.setStyle(TableStyle([('VALIGN',(0,0),(-1,-1),'TOP'),('GRID',(0,0),(-1,-1),.4,'#bbbbbb'),('LEFTPADDING',(0,0),(-1,-1),6),('RIGHTPADDING',(0,0),(-1,-1),6)]));result.extend([t,Spacer(1,10)])
        return result
    buf=io.BytesIO();doc=BaseDocTemplate(buf,pagesize=(W,H),leftMargin=margin,rightMargin=margin,topMargin=top,bottomMargin=42,title=model['title'],author='Treinrondreis')
    def heading(c,d):title.drawOn(c,margin,H-margin-th)
    blocks=model['blocks']
    if layout=='text':
        cw=(width-gap)/2
        frames=[Frame(margin,42,cw,avail,leftPadding=0,rightPadding=0,topPadding=0,bottomPadding=0),Frame(margin+cw+gap,42,cw,avail,leftPadding=0,rightPadding=0,topPadding=0,bottomPadding=0)]
        story=flows(blocks,cw)
    else:
        frames=[Frame(margin,42,width,avail,leftPadding=0,rightPadding=0,topPadding=0,bottomPadding=0)]
        story=[];texts=[b for b in blocks if b['type']=='text'];pics=[b for b in blocks if b['type']=='image']
        # Route layout is limited to one tab and paragraph/image documents.
        if model['tabCount']>1 or any(b['type']=='table' for b in blocks):story=flows(blocks,width)
        elif pics:
            contacts=[b for b in texts if b['plain'].startswith(('Adres','Telefoon'))]
            body=[b for b in texts if b not in contacts]
            contact_flows=[para({**b,'renderSize':10,'spaceAfter':0}) for b in contacts]
            contact_height=sum(f.wrap(width,avail)[1] for f in contact_flows)+6
            story.extend(contact_flows);story.append(Spacer(1,6))
            unique=[];seen=set()
            for pic in pics:
                if pic['key'] not in seen:unique.append(pic);seen.add(pic['key'])
            pics=unique
            def is_qr(b):
                if not .85<b['width']/b['height']<1.15:return False
                im=PILImage.open(io.BytesIO(images[b['key']])).convert('RGB');im.thumbnail((120,120));px=list(im.getdata())
                # QR modules can be dark blue instead of neutral black. Require
                # a predominantly light/dark image, rather than grayscale only.
                return sum(max(v)<100 or min(v)>180 for v in px)/len(px)>.8 and .18<sum(max(v)<100 for v in px)/len(px)<.7
            qrs=[b for b in pics if is_qr(b)];pics=[b for b in pics if b not in qrs]
            if not pics:raise ValueError('Deze route bevat alleen QR-codes. Kies Tekstpagina voor dit document.')
            first=pics[0];cw=(width-gap)/2
            caption=[b for b in body if 'QR' in b['plain'] or 'hotel in Google Maps' in b['plain']]
            body=[b for b in body if b not in caption]
            if body and len(' '.join(b['plain'] for b in body))<=200:
                intro=flows([{**b,'renderSize':10,'spaceAfter':5} for b in body],width)
                contact_height+=sum(f.wrap(width,avail)[1]+getattr(f,'spaceAfter',0) for f in intro)
                story.extend(intro);body=[]
            wide_a4=fmt=='A4' and not body and len(pics)>1
            if wide_a4:
                main=picture(first,width,340);story.extend([main,Spacer(1,12)])
                contact_height+=main.drawHeight+12
                left=[picture(pics[1],cw,avail-contact_height-10)];right=[];remaining=pics[2:]
            elif body and len(' '.join(b['plain'] for b in body))>200:
                left=[picture(first,cw,250 if fmt=='A5' else 285)];right=flows(body,cw);remaining=pics[1:]
            elif len(pics)>1:
                left=[picture(first,cw,avail-contact_height-90)]+flows(body,cw);right=[picture(pics[1],cw,avail-contact_height-10)];remaining=pics[2:]
            else:left=[picture(first,cw,avail-20)];right=flows(body,cw);remaining=[]
            if qrs:
                qrs.sort(key=lambda b:b.get('sourceX',0))
                qrrow=Table([[picture(q,72,72) for q in qrs[:2]]],colWidths=[90]*min(2,len(qrs)),hAlign='LEFT')
                qrrow.setStyle(TableStyle([('VALIGN',(0,0),(-1,-1),'TOP'),('LEFTPADDING',(0,0),(-1,-1),0),('RIGHTPADDING',(0,0),(-1,-1),0),('TOPPADDING',(0,0),(-1,-1),0),('BOTTOMPADDING',(0,0),(-1,-1),0)]))
                (right if wide_a4 else left).extend([Spacer(1,8),*flows(caption,cw),qrrow]);remaining+=qrs[2:]
            else:right.extend(flows(caption,cw))
            pair=Table([[left,right]],colWidths=[cw+gap,cw],hAlign='LEFT')
            pair.setStyle(TableStyle([('VALIGN',(0,0),(-1,-1),'TOP'),('LEFTPADDING',(0,0),(-1,-1),0),('RIGHTPADDING',(0,0),(0,0),gap),('RIGHTPADDING',(1,0),(1,0),0),('TOPPADDING',(0,0),(-1,-1),0),('BOTTOMPADDING',(0,0),(-1,-1),10)]))
            _,ph=pair.wrap(width,avail)
            if ph>avail-contact_height:
                # Do not enlarge every image to a full page when a combined
                # map/text column is too tall. Put maps in bounded pairs and
                # let ordinary text flow separately at the approved size.
                compact=pics[1:] if wide_a4 else pics
                for n in range(0,len(compact),2):
                    height=min(250,avail-contact_height-16) if n==0 else min(250,avail-16)
                    if height<120:height=min(250,avail-16)
                    row=[picture(pic,cw,height) for pic in compact[n:n+2]]
                    row+=['']*(2-len(row))
                    maps=Table([row],colWidths=[cw+gap,cw],hAlign='LEFT')
                    maps.setStyle(TableStyle([('VALIGN',(0,0),(-1,-1),'TOP'),('LEFTPADDING',(0,0),(-1,-1),0),('RIGHTPADDING',(0,0),(0,0),gap),('RIGHTPADDING',(1,0),(1,0),0),('TOPPADDING',(0,0),(-1,-1),0),('BOTTOMPADDING',(0,0),(-1,-1),10)]))
                    story.append(maps)
                if not wide_a4:story.extend(flows(body,width))
                story.extend(flows(caption,width))
                if qrs:
                    ordered=sorted(qrs,key=lambda b:b.get('sourceX',0))
                    for n in range(0,len(ordered),4):
                        codes=Table([[picture(q,72,72) for q in ordered[n:n+4]]],colWidths=[90]*len(ordered[n:n+4]),hAlign='LEFT')
                        codes.setStyle(TableStyle([('VALIGN',(0,0),(-1,-1),'TOP'),('LEFTPADDING',(0,0),(-1,-1),0),('TOPPADDING',(0,0),(-1,-1),0)]))
                        story.append(codes)
                remaining=[]
            else:story.append(pair)
            for pic in remaining:
                limit=72 if pic in qrs else ((110 if fmt=='A5' else 135) if pic['width']/pic['height']>3 else (180 if fmt=='A5' else 150))
                story.extend([picture(pic,72 if pic in qrs else width,limit),Spacer(1,10)])
        else:story=flows(blocks,width)
    doc.addPageTemplates(PageTemplate(id='content',frames=frames,onPage=heading))
    try:doc.build(story)
    except Exception as e:
        from reportlab.platypus.doctemplate import LayoutError
        if isinstance(e,LayoutError):raise ValueError('Deze tabel of alinea past niet in de gekozen indeling. Kies Tekstpagina of pas de bron aan.') from None
        raise
    return buf.getvalue()
