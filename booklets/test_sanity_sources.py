import copy, io, json, unittest
from unittest.mock import patch
from types import SimpleNamespace
import test_cloud
import sanity_sources as source
from features import snapshot
from pypdf import PdfReader

s=test_cloud.cloud.server

def document(text='Dit is de nieuwste informatie.',rev='one'):
    return {'_id':'test-text','_rev':rev,'title':'Reisinformatie','content':[{'_type':'block','style':'normal','children':[{'_type':'span','text':text,'marks':['strong']}]}]}

class SanityTests(unittest.TestCase):
    def test_search_and_auth(self):
        with patch.object(source,'query',return_value=[{'_id':'a','title':'Nightjet','text':'Slapen in de trein'}]):
            status,_,raw=test_cloud.request('/api/sanity/search','POST',json.dumps({'q':'slapen'}).encode())
            self.assertEqual(status,200);self.assertEqual(json.loads(raw)['items'][0]['id'],'a')
        self.assertEqual(test_cloud.request('/api/sanity/search','POST',authorized=False)[0],401)

    def test_latest_export_reflows_and_preserves_old_pdf(self):
        context=SimpleNamespace(**vars(s));cfg={'ids':['test-text'],'format':'A5','columns':2}
        with patch.object(source,'query',return_value=[document()]):r=source.load(context,cfg)
        old=(s.DATA/'pdfs'/f"{r['asset']}.pdf").read_bytes()
        body={'asset':r['asset'],'pages':r['pages'],'format':'A5','sanityText':r['sanityText'],'fields':[],'numberingConfigured':True}
        sec=snapshot({'id':'test','revision':1,'title':'Reisinformatie','body':body})
        book={'id':'test','title':'Test','body':{'format':'A5','duplex':False,'sections':[sec]}}
        original=copy.deepcopy(book)
        with patch.object(source,'query',return_value=[document('Actuele inhoud. '*900,'two')]):
            report=s.make_export(book,{'allowUneven':True,'dryRun':True})
        self.assertGreater(report['report']['pages'],r['pages'])
        self.assertEqual(book,original)
        self.assertEqual(old,(s.DATA/'pdfs'/f"{r['asset']}.pdf").read_bytes())
        with patch.object(source,'query',side_effect=ValueError('Sanity is niet bereikbaar.')):
            with self.assertRaisesRegex(ValueError,'niet bereikbaar'):s.make_export(book,{'allowUneven':True})

    def test_missing_source_and_restrictions(self):
        with patch.object(source,'query',return_value=[]):
            with self.assertRaisesRegex(ValueError,'verwijderd'):source.load(SimpleNamespace(**vars(s)),{'ids':['missing']})
        for ids in [[],['drafts.foo'],['x','x']]:
            with self.assertRaises(ValueError):source.settings({'ids':ids})
        d=document();d['content']=[{'_type':'image','asset':{'_ref':'https://example.com/private'}}]
        with self.assertRaisesRegex(ValueError,'afbeelding'):source.model([d],{'title':''})

    def test_order_and_markup(self):
        a=document('Eerste');b=document('Tweede');b['_id']='other';b['title']='Tweede bron'
        m,_=source.model([b,a],{'title':'Gids'})
        self.assertEqual(m['blocks'][0]['plain'],'Tweede bron')
        self.assertEqual(m['blocks'][1]['html'],'<b>Tweede</b>')
        self.assertEqual((m['bodySize'],m['headingSize'],m['titleSize'],m['lineSpacing']),(10,11,28,1.65))

if __name__=='__main__':unittest.main()
