import io
import unittest
from types import SimpleNamespace
from unittest.mock import patch
from reportlab.pdfgen import canvas
from pypdf import PdfReader
import test_cloud
import google_sources

class GoogleSelectionTests(unittest.TestCase):
    def setUp(self):
        self.app=SimpleNamespace(**vars(test_cloud.cloud.server))
        self.source={'url':'https://docs.google.com/document/d/'+'a'*32+'/edit','format':'A5','layout':'route'}
        self.cache={'a'*32:({'digest':'v1','title':'Selection test','warnings':[]},{})}
        stream=io.BytesIO();pdf=canvas.Canvas(stream,pagesize=(595.276,419.528))
        for n in range(3):pdf.drawString(30,300,f'Source page {n+1}');pdf.showPage()
        pdf.save();self.raw=stream.getvalue()

    def load(self,source=None):
        with patch.object(google_sources.google_layout,'render',return_value=self.raw):
            return google_sources.load(self.app,source or self.source,self.cache)

    def test_subset_roundtrip_and_changed_source_requires_review(self):
        full=self.load();chosen=google_sources.select_pages(self.app,full,[0,2])
        self.assertEqual(chosen['pages'],2)
        self.assertEqual(chosen['googleDoc']['sourcePages'],3)
        pdf=PdfReader(self.app.DATA/'pdfs'/f"{chosen['asset']}.pdf")
        self.assertIn('Source page 1',pdf.pages[0].extract_text())
        self.assertIn('Source page 3',pdf.pages[1].extract_text())
        self.assertEqual(self.load(chosen['googleDoc'])['asset'],chosen['asset'])
        self.cache['a'*32][0]['digest']='v2'
        with self.assertRaisesRegex(ValueError,'paginaselectie'):self.load(chosen['googleDoc'])
        reviewed=self.load({**chosen['googleDoc'],'selectedPages':None})
        self.assertEqual(reviewed['pages'],3)
        self.assertNotIn('selectedPages',reviewed['googleDoc'])

    def test_invalid_selections_and_all_pages(self):
        full=self.load()
        for bad in [[],[-1],[3],[1,1],[2,0],[True],None]:
            with self.subTest(bad=bad),self.assertRaises(ValueError):google_sources.select_pages(self.app,full,bad)
        self.assertEqual(google_sources.select_pages(self.app,full,[0,1,2])['asset'],full['asset'])
        self.cache['a'*32][0]['digest']='v2'
        self.assertEqual(self.load(full['googleDoc'])['pages'],3)

if __name__=='__main__':unittest.main()
