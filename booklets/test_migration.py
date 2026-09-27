import hashlib
import io
import json
import os
import sqlite3
import tempfile
from pathlib import Path
from types import SimpleNamespace
import threading
import migration
import prepare_import

with tempfile.TemporaryDirectory() as directory:
    root=Path(directory);source=root/'source';source.mkdir();target=root/'target';target.mkdir()
    for folder in ['pdfs','exports']:(source/folder).mkdir();(target/folder).mkdir()
    ident='a'*32;(source/'pdfs'/(ident+'.pdf')).write_bytes(b'%PDF-test-immutable')
    schema=';'.join('CREATE TABLE '+table+' ('+','.join(column+' TEXT' for column in columns)+')' for table,columns in migration.TABLES.items())
    for folder in [source,target]:
        db=sqlite3.connect(folder/'library.sqlite');db.executescript(schema);db.close()
    db=sqlite3.connect(source/'library.sqlite');db.execute('INSERT INTO assets VALUES(?,?,?,?,?)',(ident,'Test',1,'[]','today'));db.commit();db.close()
    output=root/'import';prepare_import.prepare(source,output)
    class Closing(sqlite3.Connection):
        def __exit__(self,*args):
            try:return super().__exit__(*args)
            finally:self.close()
    app=SimpleNamespace(DATA=target,LOCK=threading.RLock(),db=lambda:sqlite3.connect(target/'library.sqlite',factory=Closing))
    os.environ['BOOKLETS_IMPORT_ENABLED']='1'
    def call(path,body,query=''):
        return migration.handle('/api/migration/'+path,{'REQUEST_METHOD':'POST','CONTENT_LENGTH':str(len(body)),'QUERY_STRING':query,'wsgi.input':io.BytesIO(body)},app)
    info=json.loads((output/'import.json').read_text())
    for i,part in enumerate(info['files']):
        raw=(output/part['name']).read_bytes()
        assert call('part',raw,f'index={i}&sha256='+ '0'*64)[0]==400
        assert call('part',raw,f'index={i}&sha256='+part['sha256'])[0]==200
    assert call('finish',json.dumps({'parts':len(info['files']),'sha256':'0'*64}).encode())[0]==400
    status,result=call('finish',json.dumps({'parts':len(info['files']),'sha256':info['sha256']}).encode())
    assert status==200,result
    assert (target/'pdfs'/(ident+'.pdf')).read_bytes()==b'%PDF-test-immutable'
    assert call('finish',b'{}')[0]==409
    assert not (target/'import-stage').exists()
    os.environ.pop('BOOKLETS_IMPORT_ENABLED')
    assert call('finish',b'{}')[0]==404
print('Migration: checksum failure, full round-trip, existing-data protection and closure passed')
