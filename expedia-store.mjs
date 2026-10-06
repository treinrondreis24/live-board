let db;
export async function initExpedia(database){
 db=database;
 for(const sql of [
  'CREATE TABLE IF NOT EXISTS expedia_subscription (id INTEGER PRIMARY KEY, payload TEXT NOT NULL)',
  'CREATE TABLE IF NOT EXISTS expedia_events (digest TEXT PRIMARY KEY, itinerary_id TEXT NOT NULL, event_id TEXT NOT NULL, updated_at TEXT NOT NULL, received_at TEXT NOT NULL, payload TEXT NOT NULL)'
 ]){if(db.pool)await db.pool.query(sql);else db.sqlite.exec(sql);}
}
export async function readSubscription(){const r=db.pool?(await db.pool.query('SELECT payload FROM expedia_subscription WHERE id=1')).rows[0]:db.sqlite.prepare('SELECT payload FROM expedia_subscription WHERE id=1').get();return r?JSON.parse(r.payload):{};}
export async function saveSubscription(value){const sql='INSERT INTO expedia_subscription(id,payload) VALUES(1,$1) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload';if(db.pool)await db.pool.query(sql,[JSON.stringify(value)]);else db.sqlite.prepare(sql.replace('$1','?')).run(JSON.stringify(value));}
// A durable reservation prevents concurrent/repeated creation after a timeout.
export async function reserveSubscription(value){const sql='INSERT INTO expedia_subscription(id,payload) VALUES(1,$1) ON CONFLICT(id) DO NOTHING RETURNING id';return !!(db.pool?(await db.pool.query(sql,[JSON.stringify(value)])).rows[0]:db.sqlite.prepare(sql.replace('$1','?')).get(JSON.stringify(value)));}
export async function storeEvent(event){const sql='INSERT INTO expedia_events(digest,itinerary_id,event_id,updated_at,received_at,payload) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(digest) DO NOTHING',args=[event.digest,event.itineraryId,event.eventId,event.updatedAt,event.receivedAt,event.raw];if(db.pool)await db.pool.query(sql,args);else db.sqlite.prepare(sql.replace(/\$\d/g,'?')).run(...args);}
export async function listEvents(itineraryId=''){const sql='SELECT itinerary_id,event_id,updated_at,received_at,payload FROM expedia_events'+(itineraryId?' WHERE itinerary_id=$1':'')+' ORDER BY received_at DESC LIMIT 100',args=itineraryId?[itineraryId]:[];const rows=db.pool?(await db.pool.query(sql,args)).rows:db.sqlite.prepare(sql.replace('$1','?')).all(...args);return rows.map(r=>({itineraryId:r.itinerary_id,eventId:r.event_id,updatedAt:r.updated_at,receivedAt:r.received_at,payload:JSON.parse(r.payload)}));}
// The history limit must never hide reservations from operational checks.
export async function listLatestEvents(){
 if(!db)return [];
 const sql='SELECT itinerary_id,event_id,updated_at,received_at,payload FROM (SELECT *,ROW_NUMBER() OVER(PARTITION BY itinerary_id ORDER BY updated_at DESC,received_at DESC,digest DESC) AS rank FROM expedia_events) AS snapshots WHERE rank=1';
 const rows=db.pool?(await db.pool.query(sql)).rows:db.sqlite.prepare(sql).all();
 return rows.map(r=>({itineraryId:r.itinerary_id,eventId:r.event_id,updatedAt:r.updated_at,receivedAt:r.received_at,payload:JSON.parse(r.payload)}));
}
