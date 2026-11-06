export type PaperTrader={wallet:string;realizedSol:number;volumeSol:number;buys:number;sells:number;trades:number};
export function rankPaperTraders(rows:{wallet:string;data:string}[],mint:string):PaperTrader[]{
 const users=new Map<string,PaperTrader>();
 for(const row of rows){let f:any;try{f=JSON.parse(row.data);}catch{continue;}
  if(f.mint!==mint||!['buy','sell'].includes(f.side)||!Number.isFinite(f.sol)||f.sol<0)continue;
  const t=users.get(row.wallet)??{wallet:row.wallet,realizedSol:0,volumeSol:0,buys:0,sells:0,trades:0};
  t.volumeSol+=f.sol;t.trades++;if(f.side==='buy')t.buys++;else{t.sells++;if(Number.isFinite(f.pnlSol))t.realizedSol+=f.pnlSol;}
  users.set(row.wallet,t);
 }
 return [...users.values()].sort((a,b)=>b.realizedSol-a.realizedSol||b.volumeSol-a.volumeSol||a.wallet.localeCompare(b.wallet)).slice(0,100);
}
