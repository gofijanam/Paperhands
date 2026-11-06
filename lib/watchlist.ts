'use client';
import {useEffect,useState} from 'react';
const KEY='paperhands.watchlist';
export function useWatchlist(){const [list,setList]=useState<string[]>([]);useEffect(()=>{const read=()=>{try{const j=JSON.parse(localStorage.getItem(KEY)||'[]');setList(Array.isArray(j)?j:[]);}catch{setList([]);}};read();window.addEventListener('paper-watchlist',read);window.addEventListener('storage',read);return()=>{window.removeEventListener('paper-watchlist',read);window.removeEventListener('storage',read);};},[]);return {list,toggle:(mint:string)=>{const next=list.includes(mint)?list.filter(x=>x!==mint):[...list,mint];localStorage.setItem(KEY,JSON.stringify(next));window.dispatchEvent(new Event('paper-watchlist'));}};}
