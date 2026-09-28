import json,unittest
from test_cloud import request,cloud
class TemplateStatusTests(unittest.TestCase):
 def test_lifecycle_preserves_books_and_conflicts(self):
  s=cloud.server
  with s.db() as c:
   c.execute('INSERT INTO objects VALUES(?,?,?,?,?)',('template-status-test','template','Test',1,json.dumps({'sections':[]})))
   c.execute('INSERT INTO objects VALUES(?,?,?,?,?)',('template-book-test','book','Existing',1,json.dumps({'sections':[],'templateName':'Test'})))
  for rev,action in enumerate(['archive','unarchive','trash','restore'],1):
   payload=json.dumps({'id':'template-status-test','revision':rev,'action':action}).encode()
   self.assertEqual(request('/api/template-status','POST',payload,False)[0],401)
   self.assertEqual(request('/api/template-status','POST',payload)[0],200)
   self.assertEqual(request('/api/template-status','POST',payload)[0],409)
   with s.db() as c:
    row=c.execute('SELECT * FROM objects WHERE id=?',('template-status-test',)).fetchone()
    book=c.execute('SELECT * FROM objects WHERE id=?',('template-book-test',)).fetchone()
   self.assertEqual(book['revision'],1)
   body=json.loads(row['body'])
   self.assertEqual(bool(body.get('deletedAt')),action=='trash')
  self.assertFalse(body.get('archived'))
