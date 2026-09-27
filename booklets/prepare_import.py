"""Run locally: python prepare_import.py SOURCE_DATA OUTPUT_DIRECTORY.
Produces a consistent database snapshot and hashed PDF archive, without users,
passwords, OAuth credentials or disposable previews. Keep output out of Git.
"""
import hashlib
import json
import sqlite3
import sys
import zipfile
from pathlib import Path
from migration import TABLES,digest

def prepare(source,output):
    output.mkdir(parents=True,exist_ok=True)
    if any(output.iterdir()):raise ValueError('Use an empty output directory.')
    archive=output/'library.zip'
    source_db=sqlite3.connect(source/'library.sqlite')
    snapshot=sqlite3.connect(':memory:');snapshot.row_factory=sqlite3.Row
    try:
        source_db.backup(snapshot)
        tables={table:[dict(row) for row in snapshot.execute('SELECT '+','.join(columns)+' FROM '+table)] for table,columns in TABLES.items()}
    finally:source_db.close();snapshot.close()
    files={}
    for folder,table in [('pdfs','assets'),('exports','exports')]:
        for row in tables[table]:
            name=folder+'/'+row['id']+'.pdf';files[name]=digest(source/name)
    manifest={'version':1,'tables':tables,'files':files}
    with zipfile.ZipFile(archive,'w',compression=zipfile.ZIP_STORED) as z:
        z.writestr('manifest.json',json.dumps(manifest,ensure_ascii=False))
        for name in files:z.write(source/name,name)
    info={'sha256':digest(archive),'files':[]}
    with archive.open('rb') as stream:
        i=0
        while chunk:=stream.read(32*1024*1024):
            name=f'library-{i:03d}.part';(output/name).write_bytes(chunk)
            info['files'].append({'name':name,'sha256':hashlib.sha256(chunk).hexdigest()});i+=1
    (output/'import.json').write_text(json.dumps(info),encoding='utf-8')
    # Archive is a redundant intermediate, recreated from the parts when needed.
    archive.unlink()
    print(json.dumps({'counts':{table:len(rows) for table,rows in tables.items()},'parts':len(info['files']),'bytes':sum(p.stat().st_size for p in output.iterdir())}))

if __name__=='__main__':prepare(Path(sys.argv[1]).resolve(),Path(sys.argv[2]).resolve())
