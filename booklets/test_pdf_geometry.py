import io
import json
import unittest
from pypdf import PdfReader, PdfWriter
from pypdf.annotations import Link
from pypdf.generic import RectangleObject
from reportlab.pdfgen import canvas
from pdf_geometry import display_meta, normalize_page


def fixture(rotation=180, shifted=False):
    stream=io.BytesIO()
    cv=canvas.Canvas(stream,pagesize=(595.276,841.89))
    cv.drawString(50,700,'Source text')
    cv.save()
    writer=PdfWriter()
    page=writer.add_page(PdfReader(stream).pages[0])
    page.rotate(rotation)
    if shifted:page.cropbox=RectangleObject([10,20,585,820])
    writer.add_annotation(0,Link(rect=(40,690,140,710),url='https://example.org'))
    output=io.BytesIO();writer.write(output)
    return output.getvalue()


class PdfGeometryTests(unittest.TestCase):
    def test_rotations_offsets_and_links(self):
        for rotation in (0,90,180,270):
            for shifted in (False,True):
                with self.subTest(rotation=rotation,shifted=shifted):
                    page=PdfReader(io.BytesIO(fixture(rotation,shifted))).pages[0]
                    expected=display_meta([{'width':float(page.mediabox.width),
                        'height':float(page.mediabox.height),'crop':list(page.cropbox),'rotation':rotation}])[0]
                    old_rect=list(page['/Annots'][0].get_object()['/Rect'])
                    normalize_page(page)
                    self.assertEqual(page.rotation,0)
                    self.assertEqual(list(page.cropbox)[:2],[0,0])
                    self.assertAlmostEqual(float(page.mediabox.width),expected['width'])
                    self.assertAlmostEqual(float(page.mediabox.height),expected['height'])
                    self.assertIn('Source text',page.extract_text())
                    link=page['/Annots'][0].get_object()
                    self.assertEqual(link['/A']['/URI'],'https://example.org')
                    if rotation or shifted:self.assertNotEqual(list(link['/Rect']),old_rect)
                    before=list(page.cropbox)
                    normalize_page(page)
                    self.assertEqual(list(page.cropbox),before)

    def test_existing_asset_can_save_and_export_without_changing_original(self):
        from test_cloud import cloud
        s=cloud.server
        raw=fixture(180,False)
        reader=PdfReader(io.BytesIO(raw));page=reader.pages[0]
        legacy=[{'width':float(page.mediabox.width),'height':float(page.mediabox.height),
                 'rotation':180,'crop':list(map(float,page.cropbox))}]
        ident=s.ident();path=s.DATA/'pdfs'/f'{ident}.pdf';path.write_bytes(raw)
        with s.db() as conn:
            conn.execute('INSERT INTO assets VALUES(?,?,?,?,?)',(ident,'Rotated',1,json.dumps(legacy),s.now()))
        body={'asset':ident,'pages':1,'fields':[{'type':'prefilled','page':0,'key':'Test',
            'template':'Personal text','x':10,'y':10,'w':70,'h':20,'size':11}]}
        s.validate_body('block',body)
        self.assertEqual(s.asset(ident)['meta'][0]['rotation'],0)
        result=s.make_export({'id':'geometry-test','title':'Geometry','body':{
            'format':'A4','duplex':False,'sections':[{**body,'title':'Test','values':{}}]}},
            {'allowUneven':True})
        exported=PdfReader(s.DATA/'exports'/f"{result['id']}.pdf").pages[0]
        self.assertEqual(exported.rotation,0)
        self.assertEqual(list(exported.cropbox)[:2],[0,0])
        self.assertIn('Personal text',exported.extract_text())
        self.assertEqual(path.read_bytes(),raw)


if __name__=='__main__':unittest.main()
