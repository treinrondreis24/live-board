import json,sqlite3,tempfile,unittest
from pathlib import Path
from unittest.mock import Mock
import station_catalog as catalog
import route_maker

class StationCatalogTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.data=Path(self.tmp.name);catalog.initialize(self.data)
    def test_import_is_repeatable_preserves_corrections_and_matches_aliases(self):
        self.assertEqual(len(catalog.records(self.data)),337)
        row=catalog.find(self.data,'Wenen Hbf')[0]
        self.assertEqual(row['station'],'Wien Hbf')
        self.assertEqual(catalog.find(self.data,'Budapest Keleti')[0]['station'],'Budapest-Keleti')
        self.assertEqual(catalog.find(self.data,'Stary Smokovec')[0]['station'],'Starý Smokovec')
        self.assertEqual(len(catalog.find(self.data,'Tirano')),2)
        self.assertEqual(catalog.find(self.data,'Rotterdam','België'),[])
        self.assertEqual(catalog.find(self.data,'onbekendxyz'),[])
        row['address']='Een latere correctie'
        with catalog.connect(self.data) as c:c.execute('UPDATE stations SET body=? WHERE id=?',(json.dumps(row),row['stationId']))
        catalog.initialize(self.data)
        self.assertEqual(len(catalog.records(self.data)),337)
        self.assertEqual(catalog.get(self.data,row['stationId'])['address'],'Een latere correctie')
    def test_geocoder_uses_database_address_and_country_not_client_address(self):
        row=catalog.find(self.data,'Rotterdam Centraal')[0]
        request=Mock(return_value=json.dumps({'results':[{'lat':51.925,'lon':4.469,'formatted':'Stationsplein 1, Rotterdam','country_code':'nl'},{'lat':50,'lon':4,'country_code':'be'}]}).encode())
        r=catalog.resolve(self.data,{'stationId':row['stationId'],'address':'verkeerd adres'},request,route_maker.point)
        self.assertEqual(request.call_args.args[2]['text'],row['address']+', Nederland')
        self.assertEqual(request.call_args.args[2]['filter'],'countrycode:nl')
        self.assertEqual(len(r['results']),1)
        self.assertEqual(r['results'][0]['address'],row['address'])
        self.assertEqual(r['results'][0]['name'],'Rotterdam Centraal')
        self.assertIn('stationSource',r['results'][0])
    def test_incomplete_and_unknown_station_never_silently_geocode_city(self):
        request=Mock()
        row=catalog.find(self.data,'Lugano Paradiso')[0]
        with self.assertRaisesRegex(ValueError,'geen straatadres'):catalog.resolve(self.data,{'stationId':row['stationId']},request,route_maker.point)
        with self.assertRaises(ValueError):catalog.get(self.data,"' OR 1=1 --")
        request.assert_not_called()

class PrivateStationAPITests(unittest.TestCase):
    def test_private_lookup(self):
        from test_cloud import request
        for path in ['/api/routes/stations','/api/routes/station-location']:
            self.assertEqual(request(path,'POST',b'{}',False)[0],401)
        status,_,body=request('/api/routes/stations','POST',json.dumps({'query':'Budapest Keleti'}).encode())
        self.assertEqual(status,200)
        self.assertEqual(json.loads(body)['results'][0]['name'],'Budapest-Keleti')

if __name__=='__main__':unittest.main()
