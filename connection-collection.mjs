// Collect arrivals needed for connections from already fetched station stops.
// Deliberately separate from departure-board selection; no additional DB calls.
const arrivals={
 'Mannheim Hbf':['225','1255'],
 'Wien Hbf':['66','146','40421'],
 'Innsbruck Hbf':['82','421'],
 'Berlin Hbf':['178'],
 'Berlin Hbf (tief)':['178'],
 'Köln Hbf':['106','108'],
 'Düsseldorf Hbf':['106','108'],
 'Frankfurt(Main)Hbf':['372'],
 'Frankfurt(M) Flughafen Fernbf':['28'],
 'Stuttgart Hbf':['225','1255'],
 'Dresden Hbf':['178'],
 'Hannover Hbf':['2440'],
 'Osnabrück Hbf':['145','143','141']
};
export function connectionArrivalSelector(name,stops){
 const numbers=new Set(arrivals[name]||[]);
 if(name==='Wien Hbf')for(const stop of stops)if(['RJ','RJX'].includes(String(stop.tl?.c||'').toUpperCase())&&stop.tl?.n)numbers.add(String(stop.tl.n));
 return numbers.size?{trainNumbers:[...numbers],arrivalTrainNumbers:[...numbers],categories:[]}:null;
}
