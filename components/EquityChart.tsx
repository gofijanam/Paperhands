'use client';
import {useEffect,useMemo,useRef,useState} from 'react';
import {BaselineSeries,ColorType,CrosshairMode,createChart,type AutoscaleInfo,type IChartApi,type ISeriesApi,type UTCTimestamp} from 'lightweight-charts';
import {Maximize2,RotateCcw,Table2} from 'lucide-react';
import {equityPoints} from '@/lib/portfolio-values';
import {pct,sol,usd} from '@/lib/format';
type Point={t:number;v:number};
export function EquityChart({points,base,solUsd,estimated=false}:{points:Point[];base:number;solUsd:number|null;estimated?:boolean}){
 const box=useRef<HTMLDivElement>(null),chart=useRef<IChartApi|null>(null),series=useRef<ISeriesApi<'Baseline'>|null>(null);
 const [ready,setReady]=useState(false),[period,setPeriod]=useState('Cycle'),[unit,setUnit]=useState<'SOL'|'USD'>('SOL'),[hover,setHover]=useState<Point|null>(null),[table,setTable]=useState(false),[expanded,setExpanded]=useState(false);
 const all=useMemo(()=>equityPoints(points),[points]);
 const end=all.at(-1)?.t??Date.now(),since=period==='1h'?end-3600000:period==='6h'?end-21600000:0;
 const visible=useMemo(()=>all.filter(p=>p.t>=since),[all,since]);
 const rate=unit==='USD'?(solUsd??1):1,readout=hover??all.at(-1),value=readout?.v??base;
 const current=useRef({visible,rate,unit});current.current={visible,rate,unit};
 const format=(v:number)=>unit==='USD'?usd(v,false):sol(v,4);
 useEffect(()=>{if(!box.current)return;
  const c=createChart(box.current,{autoSize:true,layout:{background:{type:ColorType.Solid,color:'#0e0e10'},textColor:'#a1a1aa',fontFamily:'Geist Mono, monospace',fontSize:11},grid:{vertLines:{visible:false},horzLines:{color:'#ffffff08'}},crosshair:{mode:CrosshairMode.Normal,vertLine:{color:'#a1a1aa66',labelBackgroundColor:'#252529'},horzLine:{color:'#a1a1aa44',labelBackgroundColor:'#252529'}},rightPriceScale:{borderVisible:false,minimumWidth:90,scaleMargins:{top:.2,bottom:.16}},timeScale:{borderVisible:false,timeVisible:true,secondsVisible:false,rightOffset:4,fixLeftEdge:true},handleScroll:{mouseWheel:false,pressedMouseMove:true,horzTouchDrag:true,vertTouchDrag:false},handleScale:{mouseWheel:true,pinch:true,axisPressedMouseMove:true}});
  const s=c.addSeries(BaselineSeries,{baseValue:{type:'price',price:base},topLineColor:'#c6ff3d',topFillColor1:'#c6ff3d24',topFillColor2:'#c6ff3d00',bottomLineColor:'#ff5d5d',bottomFillColor1:'#ff5d5d00',bottomFillColor2:'#ff5d5d24',lineWidth:2,priceLineVisible:true,crosshairMarkerRadius:4,priceFormat:{type:'custom',formatter:(v:number)=>current.current.unit==='USD'?usd(v,false):sol(v,4)}});
  c.subscribeCrosshairMove(e=>{const point=e.seriesData.get(s);if(!e.time||!point||!('value' in point)){setHover(null);return;}setHover({t:Number(e.time)*1000,v:point.value/current.current.rate});});
  chart.current=c;series.current=s;setReady(true);return()=>{c.remove();chart.current=null;series.current=null;};
 },[]);
 const lastRange=useRef('');
 useEffect(()=>{if(!ready||!series.current)return;
  const s=series.current,baseline=base*rate;
  s.applyOptions({baseValue:{type:'price',price:baseline},autoscaleInfoProvider:(original:()=>AutoscaleInfo|null)=>{const r=original();if(!r?.priceRange)return null;const pad=base*rate*.002;return {...r,priceRange:{minValue:Math.min(r.priceRange.minValue,baseline-pad),maxValue:Math.max(r.priceRange.maxValue,baseline+pad)}};}});
  s.setData(visible.map(p=>({time:Math.floor(p.t/1000) as UTCTimestamp,value:p.v*rate})));
  if(lastRange.current!==period+unit){chart.current?.timeScale().fitContent();lastRange.current=period+unit;}
 },[visible,base,rate,ready,period,unit]);
 useEffect(()=>{if(!expanded)return;const close=(e:KeyboardEvent)=>{if(e.key==='Escape')setExpanded(false);};window.addEventListener('keydown',close);return()=>window.removeEventListener('keydown',close);},[expanded]);
 const move=(direction:number)=>{const index=hover?visible.findIndex(p=>p.t===hover.t):visible.length-1;setHover(visible[Math.min(visible.length-1,Math.max(0,index+direction))]??null);};
 return <section aria-label="Portfolio performance" className={`panel performance-panel ${expanded?'performance-expanded':''}`}>
  <div className="performance-heading"><div><h2>Portfolio performance</h2><p className="text-xs text-muted">{hover?new Date(hover.t).toLocaleString():'This cycle'}{estimated?' · includes last known prices':''}</p></div><div className="flex items-center gap-1"><button className="icon-button" title="Reset chart view" aria-label="Reset portfolio chart" onClick={()=>{chart.current?.timeScale().fitContent();setHover(null);}}><RotateCcw size={15}/></button><button className="icon-button" aria-label="Show portfolio chart data" aria-pressed={table} onClick={()=>setTable(v=>!v)}><Table2 size={15}/></button><button className="icon-button" aria-label={expanded?'Collapse portfolio chart':'Expand portfolio chart'} onClick={()=>setExpanded(v=>!v)}><Maximize2 size={15}/></button></div></div>
  <div className="performance-toolbar"><div className="performance-value num"><strong>{format(value*rate)}</strong><span className={(value-base)>=0?'text-up':'text-down'}>{pct((value/base-1)*100)} <span className="text-muted text-xs">vs. starting balance</span></span></div><div className="flex flex-wrap items-center gap-3"><div className="segmented" role="group" aria-label="Performance period">{['1h','6h','Cycle'].map(x=><button key={x} aria-pressed={period===x} onClick={()=>{setPeriod(x);setHover(null);}}>{x}</button>)}</div><div className="segmented" role="group" aria-label="Chart currency">{(['SOL','USD'] as const).map(x=><button key={x} aria-pressed={unit===x} disabled={x==='USD'&&!solUsd} onClick={()=>setUnit(x)}>{x}</button>)}</div></div></div>
  <div className="performance-canvas" ref={box} tabIndex={0} role="group" aria-label="Interactive equity chart. Use left and right arrows to inspect observations." onKeyDown={e=>{if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();move(e.key==='ArrowLeft'?-1:1);}if(e.key==='Escape')setHover(null);}}/>
  {visible.length<2&&<p className="px-5 pb-3 text-xs text-muted">{all.length?'A second account observation will start the curve.':'Your performance history starts with your paper account.'}</p>}
  <div className="performance-footer"><span><i className="performance-line"/> Account equity <span className="ml-3 text-muted">Baseline {format(base*rate)}</span></span><span>{unit==='USD'?'USD equivalent at the current SOL rate':'Recorded account observations · SOL'}</span></div>
  {table&&<div className="max-h-48 overflow-auto border-t border-line"><table className="w-full num text-xs"><caption className="p-2 text-left text-muted">Latest 30 account observations</caption><thead><tr><th className="p-2 text-left">Time</th><th className="p-2 text-right">Equity (SOL)</th><th className="p-2 text-right">USD equivalent now</th></tr></thead><tbody>{visible.slice(-30).reverse().map(p=><tr className="border-t border-line" key={p.t}><td className="p-2">{new Date(p.t).toLocaleTimeString()}</td><td className="p-2 text-right">{sol(p.v,4)}</td><td className="p-2 text-right">{solUsd?usd(p.v*solUsd,false):'—'}</td></tr>)}</tbody></table></div>}
 </section>;
}
