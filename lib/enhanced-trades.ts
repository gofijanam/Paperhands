import type {TTrade} from './api/schema';
const SOL='So11111111111111111111111111111111111111112';
const amount=(x:any)=>Number(x?.rawTokenAmount?.tokenAmount)/10**Number(x?.rawTokenAmount?.decimals);
/** Only an explicit, successful swap with matching token and SOL legs becomes a trade. */
export function enhancedTrades(rows:any[],c:{mint:string;symbol:string;solUsd:number}):TTrade[]{
 return rows.flatMap(tx=>{
  const s=tx.events?.swap;if(tx.transactionError||tx.type!=='SWAP'||!s||!tx.signature||!(tx.timestamp>0)||!(c.solUsd>0))return [];
  const inputs=s.tokenInputs||[],outputs=s.tokenOutputs||[];
  const buy=outputs.filter((x:any)=>x.mint===c.mint),sell=inputs.filter((x:any)=>x.mint===c.mint);
  if(Boolean(buy.length)===Boolean(sell.length))return [];
  const side=buy.length?'buy':'sell',leg=buy.length?buy:sell,opposite=buy.length?inputs:outputs;
  const native=buy.length?s.nativeInput:s.nativeOutput;
  const sol=native?Number(native.amount)/1e9:opposite.filter((x:any)=>x.mint===SOL).reduce((v:number,x:any)=>v+amount(x),0);
  const tokens=leg.reduce((v:number,x:any)=>v+amount(x),0),wallets=new Set(leg.map((x:any)=>x.userAccount));
  if(wallets.size!==1||!(sol>0)||!(tokens>0)||!Number.isFinite(sol/tokens))return [];
  const trader=leg[0].userAccount;if(typeof trader!=='string')return [];
  return [{id:tx.signature,mint:c.mint,symbol:c.symbol,trader,side,sol,tokens,priceUsd:sol/tokens*c.solUsd,ts:tx.timestamp*1000} as TTrade];
 }).sort((a,b)=>b.ts-a.ts);
}
