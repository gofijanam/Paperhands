import {rankPaperTraders} from '../paper-ranking';
import {publicRequestOrigin,matchesRequestOrigin} from './request-origin';
import { env } from '@/lib/server/runtime';
import { applyOrder,quoteOrder,newLedger,cycleAt,DAY,LAMPORTS,BANKROLL,rewardShares,type Ledger,type Order } from '../paper-engine';
import { marketCoin,validMint,upstream } from './market';
const db=()=>{if(!env.DB)throw new Error('Account storage is temporarily unavailable.');return env.DB;};
const cfg=(k:string)=>(env as unknown as Record<string,string>)[k]||process.env[k]||'';
export function configuration(){return {mint:cfg('PAPER_MINT')||null,required:50000,ranked:cfg('PAPER_RANKED')==='1'&&validMint(cfg('PAPER_MINT')),bankroll:10,cycle:cycleAt(),endsAt:(cycleAt()+1)*DAY,source:'real-market',rewardStatus:'pending funding and reviewed distribution'};}
const hash=async(s:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)))).map(x=>x.toString(16).padStart(2,'0')).join('');
const random=()=>crypto.randomUUID()+crypto.randomUUID();
const B58='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
export function base58(s:string){let n=0n;for(const c of s){const i=B58.indexOf(c);if(i<0)throw new Error('Invalid wallet address');n=n*58n+BigInt(i);}const bytes=[];while(n>0){bytes.unshift(Number(n%256n));n/=256n;}for(const c of s){if(c!=='1')break;bytes.unshift(0);}return new Uint8Array(bytes);}
export async function limit(req:Request,tag:string,max=60){
 const ip=req.headers.get('cf-connecting-ip')||req.headers.get('x-real-ip')||req.headers.get('x-forwarded-for')?.split(',').at(-1)?.trim()||'unknown',minute=Math.floor(Date.now()/60000),key=`${tag}:${await hash(ip)}:${minute}`;
 const r=await db().prepare('INSERT INTO paper_limits (key,count,expires) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count').bind(key,Date.now()+120000).first<{count:number}>();
 if((r?.count||0)>max)throw Object.assign(new Error('Too many requests. Try again in a minute.'),{status:429});
}
export async function balance(wallet:string){
 const mint=cfg('PAPER_MINT');if(!validMint(mint))return {balance:0,ok:false,configured:false};
 const rpc=cfg('SOLANA_RPC_URL')||'https://api.mainnet-beta.solana.com';
 const r=await fetch(rpc,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'getTokenAccountsByOwner',params:[wallet,{mint},{encoding:'jsonParsed',commitment:'confirmed'}]}),signal:AbortSignal.timeout(8000)});
 const j:any=await r.json();if(!r.ok||j.error||!Array.isArray(j.result?.value))throw new Error('Token balance could not be verified. Try again shortly.');
 let total=0n,decimals:number|undefined;
 for(const a of j.result.value){const t=a.account?.data?.parsed?.info?.tokenAmount;if(!t||!/^\d+$/.test(t.amount)||!Number.isInteger(t.decimals))throw new Error('Invalid token balance response');if(decimals!=null&&decimals!==t.decimals)throw new Error('Token decimals mismatch');decimals=t.decimals;total+=BigInt(t.amount);}
 const d=decimals??0;return {balance:Number(total)/10**d,ok:total>=50000n*10n**BigInt(d),configured:true};
}
export async function newSession(user:string,wallet:string|null){
 const token=random(),expires=Date.now()+7*DAY;
 await db().prepare('INSERT INTO paper_sessions(hash,user,wallet,expires) VALUES(?,?,?,?)').bind(await hash(token),user,wallet,expires).run();
 return {token,expires};
}
export async function session(req:Request){
 const token=req.headers.get('authorization')?.replace(/^Bearer /,'')||'';
 if(!token||token.length>150)throw Object.assign(new Error('Connect your wallet or start practice first.'),{status:401});
 const s=await db().prepare('SELECT * FROM paper_sessions WHERE hash=? AND expires>?').bind(await hash(token),Date.now()).first<{hash:string;user:string;wallet:string|null;expires:number}>();
 if(!s)throw Object.assign(new Error('Session expired. Connect again.'),{status:401});return s;
}
export async function account(s:{user:string;wallet:string|null}){
 const cycle=cycleAt(),id=`${s.user}:${cycle}`;
 await db().batch([
 db().prepare('INSERT OR IGNORE INTO paper_cycles(id,status,pool_lamports,updated) VALUES(?,?,0,?)').bind(cycle,'active',Date.now()),
 db().prepare('INSERT OR IGNORE INTO paper_accounts(id,user,wallet,cycle,data,version,closed) VALUES(?,?,?,?,?,0,0)').bind(id,s.user,s.wallet,cycle,JSON.stringify(newLedger()))]);
 const row=await db().prepare('SELECT * FROM paper_accounts WHERE id=?').bind(id).first<any>();
 return {...row,ledger:JSON.parse(row.data) as Ledger};
}
export async function snapshot(s:{user:string;wallet:string|null},hold?:any){
 const a=await account(s),l:Ledger=a.ledger;
 const positions=await Promise.all(l.positions.map(async p=>{const c=await marketCoin(p.mint).catch(()=>null);return {...p,costSol:p.costLamports/LAMPORTS,valueSol:c&&c.status==='tradeable'?p.tokens*c.priceSol:p.lastPriceSol?p.tokens*p.lastPriceSol:undefined,markStatus:c&&c.status==='tradeable'?(Date.now()-c.observedAt<30000?'fresh':'stale'):p.lastPriceSol?'stale':'unknown',markAsOf:c?.observedAt||p.markAt||null};}));
 const fills=await db().prepare('SELECT data FROM paper_fills WHERE account=? ORDER BY created DESC LIMIT 200').bind(a.id).all<{data:string}>();
 const h=hold??(s.wallet?await balance(s.wallet):{balance:0,ok:true,configured:!!cfg('PAPER_MINT')});
 return {version:a.version,accountId:a.id,wallet:s.wallet,practice:!s.wallet,source:'live',balance:l.cash/LAMPORTS,bankroll:10,paperHeld:h.balance,minHold:50000,passes:!s.wallet||h.ok,gateConfigured:h.configured,cycle:a.cycle,positions,fills:fills.results.map(x=>JSON.parse(x.data)),equity:l.equity,eligible:!!s.wallet&&l.eligible&&h.ok};
}
function fastAccount(l:Ledger,version:number,accountId:string){return {version,accountId,balance:l.cash/LAMPORTS,positions:l.positions.map(p=>({...p,costSol:p.costLamports/LAMPORTS,valueSol:p.lastPriceSol?p.tokens*p.lastPriceSol:undefined,markStatus:p.markAt&&Date.now()-p.markAt<30000?'fresh':p.lastPriceSol?'stale':'unknown',markAsOf:p.markAt||null})),equity:l.equity};}
export async function checkHold(s:{wallet:string|null},a:any){
 if(!s.wallet)return;
 const h=await balance(s.wallet);if(!h.ok){
 await db().prepare("UPDATE paper_accounts SET data=json_set(data,'$.eligible',json('false')),version=version+1 WHERE id=?").bind(a.id).run();
 throw Object.assign(new Error(h.configured?'Hold at least 50,000 PAPER to place orders.':'The PAPER token has not been configured. Practice is available.'),{status:403});}
}
export async function publicBoard(){
 const cycle=cycleAt();const rs=await db().prepare('SELECT wallet,data FROM paper_accounts WHERE cycle=? AND wallet IS NOT NULL').bind(cycle).all<any>();
 const rows=await Promise.all(rs.results.slice(0,500).map(async r=>{
 const l:Ledger=JSON.parse(r.data);const values=await Promise.all(l.positions.map(async p=>{const c=await marketCoin(p.mint).catch(()=>null);return c&&c.status==='tradeable'?p.tokens*c.priceSol:0;}));
 const pnl=l.cash/LAMPORTS+values.reduce((a,b)=>a+b,0)-10;
 return {wallet:r.wallet,handle:r.wallet.slice(0,4)+'…'+r.wallet.slice(-4),pnlPct:pnl*10,pnlSol:pnl,volumeSol:l.volume/LAMPORTS,trades:l.trades,eligible:l.eligible&&l.trades>=3&&configuration().ranked,ineligibleReason:!configuration().ranked?'Competition not activated':!l.eligible?'Token requirement not met':l.trades<3?'Minimum 3 fills':null,firstTrade:l.firstTrade};
 }));rows.sort((a,b)=>b.pnlPct-a.pnlPct||b.pnlSol-a.pnlSol||b.volumeSol-a.volumeSol||a.firstTrade-b.firstTrade);
 const c=await db().prepare('SELECT pool_lamports FROM paper_cycles WHERE id=?').bind(cycle).first<any>();
 return {cycle:{id:cycle,startsAt:cycle*DAY,endsAt:(cycle+1)*DAY,poolSol:c?.pool_lamports?c.pool_lamports/LAMPORTS:null,rankedCount:rows.length,bankrollSol:10,status:configuration().ranked?'active':'preview'},rows:rows.map((r,i)=>({...r,rank:i+1})),payouts:[],payoutsMock:false,mock:false,poolDemo:false};
}
export async function tokenPaperTraders(mint:string){
 const rows=await db().prepare("SELECT a.wallet,f.data FROM paper_fills f JOIN paper_accounts a ON a.id=f.account WHERE a.cycle=? AND a.wallet IS NOT NULL AND json_extract(f.data,'$.mint')=?").bind(cycleAt(),mint).all<{wallet:string;data:string}>();
 return rankPaperTraders(rows.results,mint);
}
export async function handlePaper(req:Request,action:string){
 const read=req.method==='GET';
 if(read&&action==='config')return configuration();
 if(read&&action==='leaderboard')return publicBoard();
 if(read&&action==='health'){await db().prepare('SELECT 1').first();return {status:'ok',storage:'SQLite persistent volume',market:'real',...configuration()};}
 const publicOrigin=publicRequestOrigin(req.url,cfg('NEXT_PUBLIC_SITE_URL'));
 if(!read){if(!matchesRequestOrigin(req.headers.get('origin'),req.url,publicOrigin))throw Object.assign(new Error('Invalid request origin'),{status:403});await limit(req,action,['practice','nonce','verify'].includes(action)?15:60);}
 if(action==='practice'&&!read){const s=await newSession('practice:'+crypto.randomUUID(),null);return {...s,...await snapshot({user:(await session(new Request(req.url,{headers:{authorization:`Bearer ${s.token}`}}))).user,wallet:null})};}
 if(action==='nonce'&&!read){const b:any=await req.json();if(!validMint(b.wallet)||base58(b.wallet).length!==32)throw new Error('Invalid wallet');const id=crypto.randomUUID(),issued=Date.now(),host=new URL(publicOrigin).host;
 const message=`${host} wants you to sign in with your Solana account:\n${b.wallet}\n\nSign in to Paperhands. This does not authorize a transaction.\n\nURI: ${publicOrigin}\nVersion: 1\nChain ID: solana:mainnet\nNonce: ${id}\nIssued At: ${new Date(issued).toISOString()}\nExpiration Time: ${new Date(issued+300000).toISOString()}`;
 await db().prepare('INSERT INTO paper_nonces(id,wallet,message,expires,used) VALUES(?,?,?,?,0)').bind(id,b.wallet,message,issued+300000).run();return {id,message};}
 if(action==='verify'&&!read){const b:any=await req.json();if(typeof b.id!=='string'||typeof b.signature!=='string'||b.signature.length>200)throw new Error('Invalid signature');
 const n=await db().prepare('SELECT * FROM paper_nonces WHERE id=? AND used=0 AND expires>?').bind(b.id,Date.now()).first<any>();if(!n)throw new Error('Sign-in request expired. Try again.');
 const sig=Uint8Array.from(atob(b.signature),c=>c.charCodeAt(0));const key=await crypto.subtle.importKey('raw',base58(n.wallet),'Ed25519',false,['verify']);
 if(!await crypto.subtle.verify('Ed25519',key,sig,new TextEncoder().encode(n.message)))throw new Error('Wallet signature did not match.');
 const used=await db().prepare('UPDATE paper_nonces SET used=1 WHERE id=? AND used=0').bind(n.id).run();if(!used.meta.changes)throw new Error('Sign-in request already used.');
 const s=await newSession(n.wallet,n.wallet);return {...s,...await snapshot({user:n.wallet,wallet:n.wallet})};}
 const s=await session(req);
 if(action==='logout'){await db().prepare('DELETE FROM paper_sessions WHERE hash=?').bind(s.hash).run();return {ok:true};}
 if(action==='account'||action==='hold')return snapshot(s);
 const a=await account(s);
 if(action==='reset'&&!read){if(s.wallet)throw new Error('Competition accounts cannot be reset.');await db().batch([db().prepare('UPDATE paper_accounts SET data=?,version=version+1 WHERE id=?').bind(JSON.stringify(newLedger()),a.id),db().prepare('DELETE FROM paper_fills WHERE account=?').bind(a.id),db().prepare('DELETE FROM paper_quotes WHERE account=?').bind(a.id)]);return snapshot(s);}
 if(action==='quote'&&!read){await checkHold(s,a);const b:any=await req.json();if(!validMint(b.mint))throw new Error('Invalid mint');const c=await marketCoin(b.mint,true);if(!c)throw new Error('No supported pool for this token.');if(Date.now()-c.observedAt>30000)throw new Error('Price feed is stale. Trading resumes after a fresh market observation.');
 const q=quoteOrder(a.ledger,c,b.side,Number(b.side==='buy'?b.amountSol:b.amountToken),Number(b.slippageBps));const id=crypto.randomUUID();await db().prepare('INSERT INTO paper_quotes(id,account,data,expires,used) VALUES(?,?,?,?,0)').bind(id,a.id,JSON.stringify(q),q.expires).run();
 return {id,outAmount:q.side==='buy'?q.tokens:q.credit/LAMPORTS,outUnit:q.side==='buy'?'token':'sol',minOut:(q.side==='buy'?q.tokens:q.credit/LAMPORTS)*(1-Number(b.slippageBps)/10000),priceSol:q.priceSol,impactPct:q.impactPct,feeSol:q.fee/LAMPORTS,expiresAt:q.expires,route:'pool liquidity model',warnings:['Simulated execution using observed pool price and liquidity.'],venue:c.venue};}
 if(action==='trade'&&!read){
 const b:any=await req.json(),intent=req.headers.get('idempotency-key');if(!intent||intent.length>120||typeof b.quoteId!=='string')throw new Error('Order ID is required');
 const prior=await db().prepare('SELECT data FROM paper_fills WHERE account=? AND intent=?').bind(a.id,intent).first<any>();if(prior)return {fill:JSON.parse(prior.data),account:fastAccount(a.ledger,a.version,a.id)};
 await checkHold(s,a);
 const row=await db().prepare('SELECT * FROM paper_quotes WHERE id=? AND account=? AND used=0 AND expires>?').bind(b.quoteId,a.id,Date.now()).first<any>();if(!row)throw new Error('Quote expired or already filled.');
 const q:Order=JSON.parse(row.data);const c=await marketCoin(q.mint,true);if(!c||c.status!=='tradeable'||Date.now()-c.observedAt>30000)throw new Error('Fresh market liquidity is unavailable.');
 if(Math.abs(c.priceSol/q.spot-1)>q.slippageBps/10000)throw new Error('Market moved. Request a fresh quote.');
 const {next,pnl}=applyOrder(a.ledger,q);const id=crypto.randomUUID();
 const fill={id,mint:q.mint,symbol:q.symbol,side:q.side,sol:q.side==='buy'?(q.debit-100000)/LAMPORTS:q.credit/LAMPORTS,tokens:q.tokens,priceSol:q.priceSol,feeSol:q.fee/LAMPORTS,pnlSol:pnl,ts:Date.now()};
 for(const p of next.positions)if(p.mint===q.mint){p.lastPriceSol=c.priceSol;p.markAt=c.observedAt;}
 // Confirmation does not wait on unrelated markets. Unknown marks never become fabricated zero prices.
 if(next.positions.every(p=>p.lastPriceSol))next.equity=[...next.equity,{t:fill.ts,v:next.cash/LAMPORTS+next.positions.reduce((v,p)=>v+p.tokens*p.lastPriceSol!,0)}].slice(-500);
 const result=await db().batch([
 db().prepare('UPDATE paper_accounts SET data=?,version=version+1,last_trade=? WHERE id=? AND version=? AND closed=0 AND cycle=? AND EXISTS(SELECT 1 FROM paper_quotes WHERE id=? AND used=0 AND expires>?)').bind(JSON.stringify(next),id,a.id,a.version,cycleAt(),q?b.quoteId:'',Date.now()),
 db().prepare('INSERT INTO paper_fills(id,account,intent,data,created) SELECT ?,?,?,?,? WHERE EXISTS(SELECT 1 FROM paper_accounts WHERE id=? AND last_trade=?)').bind(id,a.id,intent,JSON.stringify(fill),fill.ts,a.id,id),
 db().prepare('UPDATE paper_quotes SET used=1 WHERE id=? AND EXISTS(SELECT 1 FROM paper_fills WHERE id=?)').bind(b.quoteId,id)]);
 if(!result[0].meta.changes)throw Object.assign(new Error('Account changed. Request a fresh quote.'),{status:409});return {fill,account:fastAccount(next,a.version+1,a.id)};
 }
 throw Object.assign(new Error('Unknown endpoint'),{status:404});
}

/** Idempotent daily close. Missing cutoff candles leave settlement pending, never invent rewards. */
export async function settleCycle(cycle:number){
 if(!Number.isInteger(cycle)||cycle>=cycleAt()||cycle<cycleAt()-30)throw new Error('Only completed cycles in the last 30 days can be settled.');
 const c=await db().prepare('SELECT * FROM paper_cycles WHERE id=?').bind(cycle).first<any>();if(!c)return {status:'empty'};if(c.status==='closed')return {status:'closed',snapshot:JSON.parse(c.snapshot||'[]')};
 await db().batch([db().prepare("UPDATE paper_cycles SET status='settling',updated=? WHERE id=? AND status!='closed'").bind(Date.now(),cycle),db().prepare('UPDATE paper_accounts SET closed=1 WHERE cycle=?').bind(cycle)]);
 const all=await db().prepare('SELECT wallet,data FROM paper_accounts WHERE cycle=? AND wallet IS NOT NULL').bind(cycle).all<any>();
 if(all.results.length>500)throw new Error('Settlement requires batching for more than 500 entrants.');
 const {closingPriceSol}=await import('./market');const prices=new Map<string,number>();
 for(const r of all.results){const l:Ledger=JSON.parse(r.data);for(const p of l.positions)if(!prices.has(p.mint))prices.set(p.mint,await closingPriceSol(p.mint,(cycle+1)*DAY));}
 const rows=all.results.map(r=>{const l:Ledger=JSON.parse(r.data);const equity=l.cash/LAMPORTS+l.positions.reduce((sum,p)=>sum+p.tokens*(prices.get(p.mint)??0),0);return {wallet:r.wallet,equity,pnlSol:equity-10,pnlPct:(equity-10)*10,trades:l.trades,volume:l.volume,firstTrade:l.firstTrade,eligible:l.eligible&&l.trades>=3};}).sort((a,b)=>b.pnlSol-a.pnlSol||b.volume-a.volume||a.firstTrade-b.firstTrade);
 // Hold checks at order time are recorded in eligibility; close requires another verified hold.
 const eligible=[];for(const row of rows){if(row.eligible&&(await balance(row.wallet)).ok)eligible.push(row);}
 const amounts=rewardShares(c.pool_lamports,eligible.length);
 const statements=[db().prepare("UPDATE paper_cycles SET snapshot=?,status='closed',updated=? WHERE id=? AND status!='closed'").bind(JSON.stringify(rows),Date.now(),cycle)];
 eligible.slice(0,25).forEach((r,i)=>{if(amounts[i]>0)statements.push(db().prepare("INSERT OR IGNORE INTO paper_payouts(id,cycle,wallet,rank,lamports,status) VALUES(?,?,?,?,?,'pending')").bind(`${cycle}:${r.wallet}`,cycle,r.wallet,i+1,amounts[i]));});
 await db().batch(statements);return {status:'closed',entrants:rows.length,payouts:amounts.filter(x=>x>0).length};
}
export async function maintenance(req:Request){
 const token=cfg('PAPER_ADMIN_TOKEN');if(!token||req.headers.get('authorization')!==`Bearer ${token}`)throw Object.assign(new Error('Unauthorized'),{status:401});
 const body:any=await req.json();
 if(body.action==='fund'){
 if(!Number.isSafeInteger(body.lamports)||body.lamports<0||body.lamports>1e14||body.cycle!==cycleAt()+1)throw new Error('Declare a verified funded pool for the next cycle only.');
 await db().prepare("INSERT INTO paper_cycles(id,status,pool_lamports,updated) VALUES(?,'scheduled',?,?) ON CONFLICT(id) DO UPDATE SET pool_lamports=excluded.pool_lamports,updated=excluded.updated WHERE status='scheduled'").bind(body.cycle,body.lamports,Date.now()).run();return {ok:true,warning:'Funding declaration only. No transfer performed.'};}
 if(body.action==='paid'){
 if(!/^[1-9A-HJ-NP-Za-km-z]{64,100}$/.test(body.tx||''))throw new Error('Valid transaction signature required.');
 // Record only after an independent operator has confirmed recipient and amount on chain.
 throw new Error('Payout signing and on-chain receipt verification must be configured before marking payments paid.');}
 const pending=await db().prepare("SELECT id FROM paper_cycles WHERE id<? AND status!='closed' ORDER BY id LIMIT 3").bind(cycleAt()).all<{id:number}>();
 const results=[];for(const c of pending.results)results.push(await settleCycle(c.id));
 await db().batch([db().prepare('DELETE FROM paper_limits WHERE expires<?').bind(Date.now()),db().prepare('DELETE FROM paper_nonces WHERE expires<?').bind(Date.now()),db().prepare('DELETE FROM paper_quotes WHERE expires<?').bind(Date.now()-DAY),db().prepare('DELETE FROM paper_sessions WHERE expires<?').bind(Date.now())]);return {results};
}
