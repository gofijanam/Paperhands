/** Public origin is configured explicitly; forwarded headers are not trusted. */
export function publicRequestOrigin(requestUrl:string,configured?:string){
 const url=new URL(configured||requestUrl);
 if(url.protocol!=='https:'&&url.protocol!=='http:')throw new Error('Invalid site URL');
 return url.origin;
}
export function matchesRequestOrigin(origin:string|null,requestUrl:string,configured?:string){
 return !origin||origin===publicRequestOrigin(requestUrl,configured);
}
