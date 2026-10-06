// Hotel locations observed in Sanity TODOs and visible customer itinerary lines, 2026-10-05.
// Used only to locate the adjacent hotel for Nightjet checks; not a reservation approval.
export const HOTEL_LOCATIONS=[
  {
    "city": "Wenen",
    "hotel": "Premier Inn Wien City Hauptbahnhof",
    "aliases": [
      "Premier inn Wien"
    ]
  },
  {
    "city": "Wenen",
    "hotel": "Leonardo Wien Hauptbahnhof",
    "aliases": [
      "Leonardo Wien Hbf"
    ]
  },
  {
    "city": "Wenen",
    "hotel": "Josefshof am Rathaus",
    "aliases": [
      "Josefshof am Rathaus"
    ]
  },
  {
    "city": "Wenen",
    "hotel": "Garner Hotel Vienna Prinz Eugen",
    "aliases": [
      "Garner Hotel Vienna Prinz Eugen"
    ]
  },
  {
    "city": "Wenen",
    "hotel": "MOOONS Vienna",
    "aliases": [
      "MOOONS Wenen",
      "MOOONS Vienna"
    ]
  },
  {
    "city": "Wenen",
    "hotel": "Graben Hotel Wenen",
    "aliases": [
      "Graben Hotel"
    ]
  },
  {
    "city": "Wenen",
    "hotel": "Adina Apartment Hotel Vienna Belvedere",
    "aliases": [
      "Adina Apartment Vienna",
      "Adina Apartment Hotel Vienna Belvedere"
    ]
  },
  {
    "city": "Wenen",
    "hotel": "Adina Serviced Apartments Vienna",
    "aliases": [
      "Adina Serviced Apartments Vienna"
    ]
  },
  {
    "city": "Wenen",
    "hotel": "Hotel Daniël Wenen",
    "aliases": [
      "Hotel Daniel Wenen"
    ]
  },
  {
    "city": "Innsbruck",
    "hotel": "Hotel Central Innsbruck",
    "aliases": [
      "Hotel Central Inns",
      "Hotel Central Innsbruck"
    ]
  },
  {
    "city": "Innsbruck",
    "hotel": "ibis Innsbruck",
    "aliases": [
      "ibis Innsbruck"
    ]
  },
  {
    "city": "Salzburg",
    "hotel": "Austria Trend Hotel Europa Salzburg",
    "aliases": [
      "Austria Trend Hotel Europa Salzburg"
    ]
  },
  {
    "city": "Salzburg",
    "hotel": "Cocoon Salzburg",
    "aliases": [
      "Cocoon Salzburg"
    ]
  },
  {
    "city": "Verona",
    "hotel": "Novo Hotel Rossi",
    "aliases": [
      "Novo Hotel Rossi",
      "Novo Rossi"
    ]
  },
  {
    "city": "Verona",
    "hotel": "Hotel Firenze Verona",
    "aliases": [
      "Hotel Firenze Verona"
    ]
  },
  {
    "city": "Venetië",
    "hotel": "Hotel Principe Venetië",
    "aliases": [
      "Hotel Principe Venetie"
    ]
  },
  {
    "city": "Milaan",
    "hotel": "Hotel Flora Milaan",
    "aliases": [
      "Hotel Flora Milaan"
    ]
  },
  {
    "city": "Milaan",
    "hotel": "WorldHotel Casati 18",
    "aliases": [
      "WorldHotel Casati 18"
    ]
  },
  {
    "city": "Milaan",
    "hotel": "43 Station Hotel",
    "aliases": [
      "43 Station Hotel"
    ]
  },
  {
    "city": "Zürich",
    "hotel": "Sorell Hotel Rex Zürich",
    "aliases": [
      "Sorell Hotel Rex",
      "SorellZurich"
    ]
  },
  {
    "city": "Lugano",
    "hotel": "Hotel Federale Lugano",
    "aliases": [
      "Hotel Federale Lugano",
      "Lugano Federale"
    ]
  },
  {
    "city": "Chur",
    "hotel": "Central Hotel Post",
    "aliases": [
      "Central Hotel Post",
      "PostChur"
    ]
  },
  {
    "city": "Chur",
    "hotel": "Hotel ABC",
    "aliases": [
      "Hotel ABC Chur",
      "ABC Hotel Chur",
      "hotelabc.ch"
    ]
  },
  {
    "city": "Filisur",
    "hotel": "Hotel Schöntal",
    "aliases": [
      "Hotel Schontal"
    ]
  },
  {
    "city": "Interlaken",
    "hotel": "Hotel Bernerhof",
    "aliases": [
      "Hotel Bernerhof",
      "Interlaken Bernerhof"
    ]
  },
  {
    "city": "Zermatt",
    "hotel": "Hotel Excelsior Zermatt",
    "aliases": [
      "Hotel Excelsior Zermatt",
      "Zermatt Hotel Excelsior"
    ]
  },
  {
    "city": "Zermatt",
    "hotel": "Hotel Garni Testa Grigia",
    "aliases": [
      "Hotel Garni Testa Grigia"
    ]
  },
  {
    "city": "Zermatt",
    "hotel": "Alpen Resort Hotel & Spa",
    "aliases": [
      "Alpen Resort Hotel"
    ]
  },
  {
    "city": "Zermatt",
    "hotel": "Hotel Pollux",
    "aliases": [
      "Hotel Pollux"
    ]
  },
  {
    "city": "Bratislava",
    "hotel": "Clarion Hotel Bratislava",
    "aliases": [
      "Clarion Hotel Bratislava"
    ]
  },
  {
    "city": "Hoge Tatra",
    "hotel": "Hotel Panorama Resort",
    "aliases": [
      "Hotel Panorama Resort Hoge Tatra",
      "Panorama H (e-travel)"
    ]
  },
  {
    "city": "Budapest",
    "hotel": "IntercityHotel Budapest",
    "aliases": [
      "IntercityHotel Budapest",
      "IC Hotel Budapest"
    ]
  },
  {
    "city": "Budapest",
    "hotel": "Prestige Hotel Budapest",
    "aliases": [
      "Prestige Hotel Budapest",
      "Prestige Hotel Boedapest"
    ]
  },
  {
    "city": "Budapest",
    "hotel": "T62 Hotel",
    "aliases": [
      "T62 Hotel",
      "T62 Budapest"
    ]
  }
];
const normalize=s=>String(s||'').normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase().replace(/ł/g,'l').replace(/[^a-z0-9]+/g,' ').trim();
export function knownHotelCity(title){
 const text=' '+normalize(String(title||'').split('|')[0])+' ';
 const cities=[...new Set(HOTEL_LOCATIONS.filter(row=>row.aliases.some(alias=>text.includes(' '+normalize(alias)+' '))).map(row=>row.city))];
 return cities.length===1?cities[0]:'';
}
