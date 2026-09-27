"""Atomic library metadata changes, with revision-checked undo."""
import copy,json,unicodedata

def norm(value):return ''.join(c for c in unicodedata.normalize('NFD',str(value)) if not unicodedata.combining(c)).casefold().strip()
def merge(values,add,remove):
    result=[];seen=set();removed={norm(v) for v in remove}
    for v in [*values,*add]:
        v=str(v).strip();key=norm(v)
        if key and key not in seen and key not in removed:result.append(v);seen.add(key)
    return result
def apply_changes(body,changes):
    b=copy.deepcopy(body)
    allowed={'categoriesAdd','categoriesRemove','tagsAdd','tagsRemove','country','pageType','tocHidden'}
    if not changes or set(changes)-allowed:raise ValueError('Kies geldige wijzigingen.')
    for key in ['categoriesAdd','categoriesRemove','tagsAdd','tagsRemove']:
        if key in changes and (not isinstance(changes[key],list) or len(changes[key])>100 or any(not isinstance(v,str) or len(v)>160 for v in changes[key])):raise ValueError('Ongeldige categorieën of labels.')
    if 'categoriesAdd' in changes or 'categoriesRemove' in changes:
        b['categories']=merge(b.get('categories') or [b.get('category','Algemeen')],changes.get('categoriesAdd',[]),changes.get('categoriesRemove',[])) or ['Algemeen']
        b['category']=b['categories'][0]
    if 'tagsAdd' in changes or 'tagsRemove' in changes:b['tags']=merge(b.get('tags',[]),changes.get('tagsAdd',[]),changes.get('tagsRemove',[]))
    for key in ('country','pageType'):
        if key in changes:
            if not isinstance(changes[key],str) or len(changes[key])>160:raise ValueError('Ongeldige '+key)
            b[key]=changes[key].strip()
    if 'tocHidden' in changes:
        if not isinstance(changes['tocHidden'],bool):raise ValueError('Ongeldige inhoudsopgave-instelling.')
        b['tocHidden']=changes['tocHidden']
    return b

def update(c,items,changes,validate,token,created):
    if not isinstance(items,list) or not 1<=len(items)<=500 or len({x['id'] for x in items})!=len(items):raise ValueError('Selecteer 1 tot 500 verschillende bouwstenen.')
    pending=[]
    for item in items:
        row=c.execute('SELECT * FROM objects WHERE id=?',(item['id'],)).fetchone()
        if not row or row['kind']!='block' or row['revision']!=item.get('revision'):raise ValueError('Een geselecteerde bouwsteen is gewijzigd. Vernieuw de bibliotheek en probeer opnieuw.')
        before=json.loads(row['body']);after=apply_changes(before,changes);validate('block',after)
        pending.append(dict(id=row['id'],before=before,afterRevision=row['revision']+1,after=after))
    for change in pending:c.execute('UPDATE objects SET body=?,revision=? WHERE id=?',(json.dumps(change['after'],ensure_ascii=False),change['afterRevision'],change['id']))
    c.execute('INSERT INTO bulk_history VALUES(?,?,?,0)',(token,created,json.dumps(pending,ensure_ascii=False)))
    return {'undoId':token,'count':len(pending)}

def undo(c,token,validate):
    row=c.execute('SELECT * FROM bulk_history WHERE id=?',(token,)).fetchone()
    if not row or row['undone']:raise ValueError('Deze groepswijziging is niet meer ongedaan te maken.')
    changes=json.loads(row['body'])
    for change in changes:
        current=c.execute('SELECT revision,kind FROM objects WHERE id=?',(change['id'],)).fetchone()
        if not current or current['kind']!='block' or current['revision']!=change['afterRevision']:raise ValueError('Een bouwsteen is ondertussen gewijzigd. Ongedaan maken zou die wijziging overschrijven en is daarom gestopt.')
        validate('block',change['before'])
    for change in changes:c.execute('UPDATE objects SET body=?,revision=revision+1 WHERE id=?',(json.dumps(change['before'],ensure_ascii=False),change['id']))
    c.execute('UPDATE bulk_history SET undone=1 WHERE id=?',(token,))
    return {'count':len(changes)}
