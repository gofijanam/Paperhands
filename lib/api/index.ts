import {createMarketApi} from './market-client';
export const API_MODE='live' as const;
export const API_BASE='';
export let LIVE_DOWN=false;
export function onApiDown(_f:()=>void){return ()=>{};}
let api:ReturnType<typeof createMarketApi>|null=null;
export function getApi(){return api??=createMarketApi();}
export * from './schema';
