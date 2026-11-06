import {heliusStream} from '@/lib/server/helius';
import {validMint} from '@/lib/server/market';
import {limit} from '@/lib/server/paper';
export async function GET(req:Request){const mint=new URL(req.url).searchParams.get('mint')||'';if(!validMint(mint))return Response.json({error:'Invalid mint'},{status:400});try{await limit(req,'stream',12);return await heliusStream(req,mint);}catch{return Response.json({error:'Live connection unavailable. Market snapshots remain available.'},{status:503});}}
