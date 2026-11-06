import {CoinLoader} from '@/components/coin/CoinLoader';
export default async function CoinPage({params}:{params:Promise<{mint:string}>}){return <CoinLoader mint={(await params).mint}/>;}
