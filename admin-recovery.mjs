// Deliberately CLI-only. Requires access to the Railway service console.
import {createInterface} from 'node:readline/promises';
import {DatabaseSync} from 'node:sqlite';
import pg from 'pg';
import {fileURLToPath} from 'node:url';
if(!process.stdin.isTTY)throw Error('Start dit herstel interactief in de hostingconsole.');
const rl=createInterface({input:process.stdin,output:process.stdout});
console.log('Dit verwijdert het beheeraccount, vertrouwde browsers en sessies. Stations en appgegevens blijven behouden. Daarna stel je via /stationschef opnieuw een account in met BOARD_ADMIN_PASSWORD.');
const answer=await rl.question('Typ BEHEER HERSTELLEN om door te gaan: ');rl.close();
if(answer!=='BEHEER HERSTELLEN'){console.log('Geannuleerd.');process.exit(0);}
if(!process.env.BOARD_ADMIN_PASSWORD||process.env.BOARD_ADMIN_PASSWORD.length<12)throw Error('Stel eerst BOARD_ADMIN_PASSWORD in met minimaal 12 tekens.');
if(process.env.DATABASE_URL){const pool=new pg.Pool({connectionString:process.env.DATABASE_URL});try{await pool.query('DELETE FROM admin_security WHERE id=1');}finally{await pool.end();}}
else{const db=new DatabaseSync(process.env.SQLITE_PATH||fileURLToPath(new URL('./history.sqlite',import.meta.url)));db.exec('DELETE FROM admin_security WHERE id=1');db.close();}
console.log('Beheer hersteld. Stel nu vanuit Nederland je account opnieuw in via /stationschef.');
