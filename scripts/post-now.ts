/** Post one video now: moves all its armed platform posts to two minutes from now. Usage: post-now.ts [ITEM_ID] */
import {createDatabaseConnection} from '../src/database/client.js';
import {postNow} from '../src/publishing/lanes.js';
const db=createDatabaseConnection();
try{console.log(JSON.stringify(await postNow(db.pool,process.argv[2]),null,1));}finally{await db.close();}
