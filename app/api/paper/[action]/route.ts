import { handlePaper,maintenance } from '@/lib/server/paper';
async function handle(req:Request,{params}:{params:Promise<{action:string}>}){
 try {const {action}=await params; if(req.method==='GET'&&!['config','leaderboard','health','account'].includes(action))return Response.json({error:'Method not allowed'},{status:405});
 if(Number(req.headers.get('content-length')||0)>8192)return Response.json({error:'Request too large'},{status:413});
 const result=action==="maintenance"&&req.method==="POST"?await maintenance(req):await handlePaper(req,action);return Response.json(result,{headers:{'Cache-Control':'no-store'}});
 }catch(e:any){return Response.json({error:e.message||'Service temporarily unavailable'},{status:e.status||400,headers:{'Cache-Control':'no-store'}});}
}
export const GET=handle;export const POST=handle;
