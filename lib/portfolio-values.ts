export type MarkedPosition={tokens:number;costSol:number;valueSol?:number;markStatus?:string;markAsOf?:number|null};
export function positionMark(p:MarkedPosition,coin?:{priceSol:number;observedAt?:number},now=Date.now()){
 if(coin&&Number.isFinite(coin.priceSol)&&coin.priceSol>0&&coin.observedAt&&now-coin.observedAt<60000)return {value:p.tokens*coin.priceSol,status:'fresh' as const};
 if(Number.isFinite(p.valueSol))return {value:p.valueSol!,status:p.markStatus==='fresh'&&p.markAsOf&&now-p.markAsOf<60000?'fresh' as const:'stale' as const};
 return {value:null,status:'unknown' as const};
}
export function equityPoints(points:{t:number;v:number}[],since=0){
 const unique=new Map<number,number>();
 for(const p of points)if(Number.isFinite(p.t)&&Number.isFinite(p.v)&&p.t>=since)unique.set(Math.floor(p.t/1000),p.v);
 return [...unique].sort((a,b)=>a[0]-b[0]).map(([t,v])=>({t:t*1000,v}));
}
