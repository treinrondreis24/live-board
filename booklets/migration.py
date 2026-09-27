"""One-time, owner-only import into an empty library; never imports accounts."""
import hashlib
import json
import os
import re
import shutil
import zipfile
from urllib.parse import parse_qs

TABLES={'assets':('id','title','pages','meta','created'),'objects':('id','kind','title','revision','body'),'exports':('id','book_id','title','created','snapshot','report'),'bulk_history':('id','created','body','undone')}
MAX_TOTAL=3*1024**3

def digest(path):
    with path.open('rb') as stream:return hashlib.file_digest(stream,'sha256').hexdigest()

def handle(path,environ,app):
    if os.environ.get('BOOKLETS_IMPORT_ENABLED')!='1':return 404,{'error':'Import is gesloten.'}
    with app.db() as db:
        if any(db.execute('SELECT COUNT(*) FROM '+table).fetchone()[0] for table in TABLES):return 409,{'error':'Import kan alleen in een lege bibliotheek.'}
    stage=app.DATA/'import-stage';stage.mkdir(exist_ok=True)
    parts=stage/'parts';parts.mkdir(exist_ok=True)
    query=parse_qs(environ.get('QUERY_STRING',''))
    try:
        if path=='/api/migration/part' and environ['REQUEST_METHOD']=='POST':
            index=int(query['index'][0]);checksum=query['sha256'][0]
            if not 0<=index<100 or not re.fullmatch('[a-f0-9]{64}',checksum):raise ValueError('Ongeldig importdeel.')
            raw=environ['wsgi.input'].read(int(environ['CONTENT_LENGTH']))
            if hashlib.sha256(raw).hexdigest()!=checksum:raise ValueError('Het importdeel is beschadigd.')
            target=parts/f'{index:03d}.part'
            if sum(p.stat().st_size for p in parts.glob('*.part'))- (target.stat().st_size if target.exists() else 0)+len(raw)>MAX_TOTAL:raise ValueError('Import is te groot.')
            temp=target.with_suffix('.tmp');temp.write_bytes(raw);temp.replace(target)
            return 200,{'ok':True,'part':index}
        if path=='/api/migration/finish' and environ['REQUEST_METHOD']=='POST':
            body=json.loads(environ['wsgi.input'].read(int(environ['CONTENT_LENGTH'])))
            count=int(body['parts'])
            if not 1<=count<=100:raise ValueError('Ongeldig aantal delen.')
            archive=stage/'library.zip'
            if hasattr(app,'ensure_capacity'):app.ensure_capacity(sum(p.stat().st_size for p in parts.glob('*.part')))
            with archive.open('wb') as out:
                for i in range(count):
                    with (parts/f'{i:03d}.part').open('rb') as source:shutil.copyfileobj(source,out,1024*1024)
            if digest(archive)!=body['sha256']:raise ValueError('De import is onvolledig of beschadigd.')
            with zipfile.ZipFile(archive) as z:
                if z.getinfo('manifest.json').file_size>20*1024**2:raise ValueError('Manifest is te groot.')
                manifest=json.loads(z.read('manifest.json'))
                if manifest.get('version')!=1:raise ValueError('Onbekend importformaat.')
                files=manifest['files'];rows=manifest['tables']
                if set(rows)!=set(TABLES) or len(files)>10000:raise ValueError('Onvolledige bibliotheek.')
                if set(z.namelist())!={'manifest.json',*files} or len(z.namelist())!=len(files)+1:raise ValueError('Onverwachte bestanden.')
                if sum(i.file_size for i in z.infolist())>MAX_TOTAL:raise ValueError('Import is te groot.')
                if hasattr(app,'ensure_capacity'):app.ensure_capacity(sum(i.file_size for i in z.infolist()))
                extracted=stage/'validated';extracted.mkdir(exist_ok=True)
                for name,checksum in files.items():
                    if not re.fullmatch(r'(pdfs|exports)/[a-f0-9]{32}\.pdf',name):raise ValueError('Ongeldige bestandsnaam.')
                    target=extracted/name;target.parent.mkdir(exist_ok=True)
                    with z.open(name) as source,target.open('wb') as out:shutil.copyfileobj(source,out,1024*1024)
                    if digest(target)!=checksum:raise ValueError('PDF-controle mislukt.')
                for table,columns in TABLES.items():
                    if any(set(row)!=set(columns) for row in rows[table]):raise ValueError('Ongeldige bibliotheekgegevens.')
                if any('pdfs/'+row['id']+'.pdf' not in files for row in rows['assets']):raise ValueError('Bouwsteen-PDF ontbreekt.')
                if any('exports/'+row['id']+'.pdf' not in files for row in rows['exports']):raise ValueError('Boekje-PDF ontbreekt.')
                with app.LOCK,app.db() as db:
                    db.execute('BEGIN IMMEDIATE')
                    if any(db.execute('SELECT COUNT(*) FROM '+table).fetchone()[0] for table in TABLES):raise ValueError('Bibliotheek is inmiddels in gebruik.')
                    for name in files:(extracted/name).replace(app.DATA/name)
                    for table,columns in TABLES.items():
                        db.executemany('INSERT INTO '+table+' ('+','.join(columns)+') VALUES ('+','.join('?' for _ in columns)+')',([row[key] for key in columns] for row in rows[table]))
            # Only transient files under this dedicated staging directory.
            shutil.rmtree(stage)
            return 200,{'ok':True,'counts':{key:len(value) for key,value in rows.items()}}
        return 404,{'error':'Niet gevonden.'}
    except (ValueError,KeyError,FileNotFoundError,zipfile.BadZipFile):
        return 400,{'error':'Importcontrole mislukt. De bestaande bibliotheek is niet vervangen.'}
