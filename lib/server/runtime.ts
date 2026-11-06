import {openDatabase} from './sqlite';
export const env = new Proxy({} as Record<string,any> & {DB:ReturnType<typeof openDatabase>}, {
 get(_target,key:string){return key==='DB'?openDatabase():process.env[key];}
});
