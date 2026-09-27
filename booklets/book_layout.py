"""Deterministic rich text, contents and page-number layout; no network calls."""
import io,re
from reportlab.pdfbase import pdfmetrics
from xml.sax.saxutils import escape
from reportlab.pdfgen import canvas
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import Paragraph
from pypdf import PdfReader

def draw_number_box(cv,number,center,baseline,page_width,page_height):
    """Fixed 9 x 7 mm badge; preserve the previous number's baseline anchor."""
    font='Booklet-Bold';size=10;bw=9*72/25.4;bh=7*72/25.4
    ascent,descent=pdfmetrics.getAscentDescent(font,size)
    cy=baseline+(ascent+descent)/2
    left=center-bw/2;bottom=cy-bh/2
    if left<0 or bottom<0 or left+bw>page_width or bottom+bh>page_height:
        raise ValueError('Het zwarte paginanummerblokje valt buiten de pagina. Verplaats het nummer verder naar binnen.')
    if pdfmetrics.stringWidth(str(number),font,size)>bw-4:
        raise ValueError('Het paginanummer past niet in het blokje van 9 mm.')
    cv.saveState();cv.setFillColorRGB(0,0,0);cv.rect(left,bottom,bw,bh,stroke=0,fill=1)
    cv.setFillColorRGB(1,1,1);cv.setFont(font,size);cv.drawCentredString(center,baseline,str(number));cv.restoreState()

def inline_markup(text):
    # Escape everything first. Only our simple formatting syntax becomes XML.
    text=escape(text)
    text=re.sub(r'\*\*\*([^\n]+?)\*\*\*',r'<b><i>\1</i></b>',text)
    text=re.sub(r'\*\*([^\n]+?)\*\*',r'<b>\1</b>',text)
    return re.sub(r'(?<!\*)\*([^*\n]+?)\*(?!\*)',r'<i>\1</i>',text)

def rich_layout(template,values,width,size,color,token,font="Booklet",align="left"):
    items=[]
    # Parse formatting before substitution so customer data cannot introduce markup.
    def markup(line):
        parts=[];pos=0
        for m in token.finditer(line):
            parts.append(line[pos:m.start()]);parts.append('\x00'+str(len(substitutions))+'\x00')
            substitutions.append(str(values.get(m.group(1).strip(),'')).strip());pos=m.end()
        parts.append(line[pos:]);result=inline_markup(''.join(parts))
        for i,value in enumerate(substitutions):result=result.replace('\x00'+str(i)+'\x00',escape(value).replace('\n','<br/>'))
        return result
    for line in template.replace('\r\n','\n').replace('\r','\n').split('\n'):
        substitutions=[]
        if not line.strip():items.append((None,size*1.5));continue
        heading=re.match(r'^(#{1,3})\s+(.*)$',line)
        scale={1:1.5,2:1.3,3:1.15}.get(len(heading[1]),1) if heading else 1
        content=heading[2] if heading else line
        style=ParagraphStyle('text',fontName=font+'-Bold' if heading else font,fontSize=size*scale,leading=size*scale*1.5,textColor=color,splitLongWords=True,alignment={'left':0,'center':1,'right':2}.get(align,0))
        bullet=re.match(r'^\s*(?:[-*•]|(\d+)[.)])\s+(.*)$',content)
        if bullet:
            style.leftIndent=size*1.3;style.bulletIndent=0
            paragraph=Paragraph(markup(bullet[2]),style,bulletText=(bullet[1]+'.') if bullet[1] else '•')
        else:paragraph=Paragraph(markup(content),style)
        _,height=paragraph.wrap(width,100000)
        items.append((paragraph,height))
    return items

def draw_rich(cv,items,x,top,width):
    for paragraph,height in items:
        top-=height
        if paragraph:paragraph.drawOn(cv,x,top)

def contents_plan(sections):
    pages=[];rows=[];used=0
    for index,section in enumerate(sections):
        if section.get('tocHidden',False):continue
        title=section.get('tocTitle','').strip() or section['title']
        p=Paragraph(escape(title),ParagraphStyle('toc',fontName='Booklet',fontSize=11,leading=15,textColor='#183c3c'))
        _,h=p.wrap(425,100000);height=h+15
        if height>640:raise ValueError('Een titel voor de inhoudsopgave is te lang.')
        if rows and used+height>640:pages.append(rows);rows=[];used=0
        rows.append((index,p,h));used+=height
    if rows:pages.append(rows)
    if not pages:raise ValueError('Alle bouwstenen zijn verborgen voor de inhoudsopgave. Zet de inhoudsopgave uit of maak een titel zichtbaar.')
    return pages

def render_contents(rows,starts,number,pagesize=(595.276,841.89)):
    out=io.BytesIO();c=canvas.Canvas(out,pagesize=(595.276,841.89))
    c.setFillColor('#183c3c');c.setFont('Booklet-Bold',26)
    c.drawString(54,768,'Inhoudsopgave' if number==0 else 'Inhoudsopgave (vervolg)')
    y=717
    for index,paragraph,h in rows:
        paragraph.drawOn(c,54,y-h);c.setFont('Booklet',11)
        c.drawRightString(541,y-11,str(starts[index]+1));y-=h+15
    c.save();page=PdfReader(out).pages[0]
    if pagesize!=(595.276,841.89):page.scale_to(*pagesize)
    return page

def add_page_numbers(writer,blank_indices,hide_first,position='center'):
    for index,page in enumerate(writer.pages):
        if index in blank_indices or (hide_first and index==0):continue
        if page.rotation:raise ValueError('Automatische nummering ondersteunt nog geen gedraaide pagina’s. Exporteer de bron-PDF rechtop of schakel nummering uit.')
        box=page.trimbox;x0,y0=float(box.left),float(box.bottom);w,h=float(box.width),float(box.height)
        out=io.BytesIO();c=canvas.Canvas(out,pagesize=(float(page.mediabox.right),float(page.mediabox.top)))
        c.setFillColor('#183c3c');c.setFont('Booklet',9)
        center=x0+34 if position=='left' else x0+w-34 if position=='right' else x0+w/2
        draw_number_box(c,index+1,center,y0+24,float(page.mediabox.right),float(page.mediabox.top))
        c.save();page.merge_page(PdfReader(out).pages[0])


def contents_field_layout(sections,starts,width,size,color,font):
    rows=[]
    for i,section in enumerate(sections):
        if section.get('tocHidden',False):continue
        title=section.get('tocTitle','').strip() or section['title']
        paragraph=Paragraph(escape(title),ParagraphStyle('toc-field',fontName=font,fontSize=size,leading=size*1.5,textColor=color,splitLongWords=True))
        _,height=paragraph.wrap(max(1,width-size*4),100000)
        rows.append((paragraph,height,str(starts[i]+1)))
    return rows

def draw_contents_field(cv,rows,x,top,width,size,font,color):
    cv.setFillColor(color);cv.setFont(font,size)
    for paragraph,height,number in rows:
        paragraph.drawOn(cv,x,top-height)
        cv.drawRightString(x+width,top-size,number)
        top-=height+size*.5
