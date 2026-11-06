import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,readFileSync,readdirSync} from 'node:fs';
import {dirname,join} from 'node:path';
type Value=string|number|bigint|null|Uint8Array;
export class SqliteStatement {
 private db:DatabaseSync;private sql:string;private values:Value[];
 constructor(db:DatabaseSync,sql:string,values:Value[]=[]){this.db=db;this.sql=sql;this.values=values;}
 bind(...values:Value[]){return new SqliteStatement(this.db,this.sql,values);}
 execute(){const result=this.db.prepare(this.sql).run(...this.values);return {success:true,meta:{changes:Number(result.changes),last_row_id:Number(result.lastInsertRowid)}};}
 async run(){return this.execute();}
 async first<T=Record<string,unknown>>(){return (this.db.prepare(this.sql).get(...this.values)??null) as T|null;}
 async all<T=Record<string,unknown>>(){return {results:this.db.prepare(this.sql).all(...this.values) as T[],success:true};}
}
export function createDatabase(path:string,migrations=join(process.cwd(),'drizzle')){
 if(path!==':memory:')mkdirSync(dirname(path),{recursive:true});
 const db=new DatabaseSync(path);db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;');
 db.exec('CREATE TABLE IF NOT EXISTS app_migrations (name TEXT PRIMARY KEY, applied INTEGER NOT NULL)');
 for(const name of readdirSync(migrations).filter(x=>x.endsWith('.sql')).sort()){
  if(db.prepare('SELECT name FROM app_migrations WHERE name=?').get(name))continue;
  db.exec('BEGIN IMMEDIATE');try{db.exec(readFileSync(join(migrations,name),'utf8'));db.prepare('INSERT INTO app_migrations VALUES(?,?)').run(name,Date.now());db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
 }
 const seed=process.env.PAPER_MIGRATION_BASE64;
 if(seed&&!db.prepare("SELECT name FROM app_migrations WHERE name='source-preview-v14'").get()){
  const tables=['paper_cycles','paper_accounts','paper_fills','paper_payouts','paper_sessions'];
  const payload=JSON.parse(Buffer.from(seed,'base64').toString('utf8'));
  db.exec('BEGIN IMMEDIATE');try{
   for(const table of tables){
    if(Number((db.prepare(`SELECT count(*) AS n FROM ${table}`).get() as any).n)>0)throw new Error('Migration requires an empty destination ledger');
    const columns=new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((c:any)=>c.name));
    for(const row of payload[table]||[]){const names=Object.keys(row);if(names.some(k=>!columns.has(k)))throw new Error('Unexpected migration column');db.prepare(`INSERT INTO ${table} (${names.join(',')}) VALUES (${names.map(()=>'?').join(',')})`).run(...names.map(k=>row[k]));}
   }
   db.prepare('INSERT INTO app_migrations VALUES(?,?)').run('source-preview-v14',Date.now());db.exec('COMMIT');
  }catch(e){db.exec('ROLLBACK');throw e;}
 }
 return {prepare:(sql:string)=>new SqliteStatement(db,sql),async batch(statements:SqliteStatement[]){db.exec('BEGIN IMMEDIATE');try{const results=statements.map(s=>s.execute());db.exec('COMMIT');return results;}catch(e){db.exec('ROLLBACK');throw e;}},close:()=>db.close()};
}
let instance:ReturnType<typeof createDatabase>|undefined;
export function openDatabase(){return instance??=createDatabase(process.env.DATABASE_PATH||join(process.cwd(),'.data','paperhands.sqlite'));}
