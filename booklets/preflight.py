"""Collect all user-fixable field errors before rendering, without writing exports."""
import io

def check(s,body,objects,fill=False):
    b=s.refresh_blocks(body,objects);errors=[];missing=[]
    try:b=s.sanity_sources.refresh_export(s,b)
    except ValueError as e:return {'pages':0,'needed':0,'missing':[],'canFill':False,'fillers':[],'libraryStamp':s.library_stamp(objects),'errors':[{'section':None,'title':'Sanity-bron','message':str(e)}]}
    def error(index,title,message):errors.append({'section':index,'title':title,'message':str(message)})
    if not b.get('sections'):error(None,'Boekje','Voeg eerst een bouwsteen toe.')
    for i,slot in enumerate(b.get('sections',[])):
        sec=slot.get('selected') if slot.get('choice') else slot
        if not sec:missing.append(slot.get('title','Keuzepagina'));continue
        title=sec.get('title','Bouwsteen')
        try:
            s.validate_body('book',{'format':b.get('format','A4'),'sections':[sec]})
            meta=s.asset(sec['asset'])['meta'];values={**b.get('values',{}),**sec.get('values',{})}
            for f in sec.get('fields',[]):
                try:
                    if f.get('type') in ('contents','pageNumber'):continue
                    value=s.field_text(f,values,title)
                    if not value:continue
                    m=meta[int(f['page'])];w=m['width']*f['w']/100;h=m['height']*f['h']/100;size=float(f.get('size',11))
                    if f.get('type') in ('text','prefilled'):
                        items=s.rich_layout(value if f['type']=='prefilled' else f['template'],{} if f['type']=='prefilled' else values,w,size,f.get('color','#183c3c'),s.TOKEN,s.font_name(f),f.get('align','left'))
                        fits=sum(height for _,height in items)<=h
                    else:fits=len(value.splitlines())*size*1.5<=h and all(s.pdfmetrics.stringWidth(line,s.font_name(f),size)<=w for line in value.splitlines())
                    if not fits:error(i,title,'Pagina '+str(f['page']+1)+': tekst past niet in “'+f['key']+'”.')
                except (ValueError,KeyError,TypeError) as e:error(i,title,e)
        except (ValueError,KeyError,TypeError) as e:error(i,title,e)
    result={'pages':0,'needed':0,'missing':missing,'canFill':False,'fillers':[],'libraryStamp':s.library_stamp(objects),'errors':errors}
    try:result.update(s.plan(b,objects))
    except ValueError as e:
        if not errors:error(None,'Boekje',e)
    if not errors:
        try:
            report=s.make_export({'id':'preview','title':'Controle','body':b},{'skipChoices':True,'allowUneven':True,'fill':fill,'dryRun':True,'libraryStamp':result['libraryStamp']})
            result['checkedPages']=report['report']['pages']
        except (ValueError,KeyError,TypeError) as e:error(None,'PDF-controle',e)
    return result
