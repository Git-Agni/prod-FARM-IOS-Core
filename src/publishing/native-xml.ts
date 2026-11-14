/** Read only visible accessibility nodes. Decode XML entities without treating labels as markup. */
export function visibleNativeNodes(xml: string): Array<{type:string;name:string;label:string;x:number;y:number;width:number;height:number}> {
 const decode=(s:string)=>s.replace(/&(#x[\da-f]+|#\d+|amp|quot|apos|lt|gt);/gi,(_m,v:string)=>v[0]==='#'?String.fromCodePoint(v[1].toLowerCase()==='x'?parseInt(v.slice(2),16):Number(v.slice(1))):({amp:'&',quot:'"',apos:"'",lt:'<',gt:'>'} as Record<string,string>)[v]);
 const nodes=[];
 for(const tag of xml.matchAll(/<XCUIElementType\w+\b[^>]*>/g)){
  const attrs=Object.fromEntries([...tag[0].matchAll(/([\w-]+)="([^"]*)"/g)].map(m=>[m[1],decode(m[2])]));
  if(attrs.visible!=='true')continue;
  nodes.push({type:attrs.type??'',name:attrs.name??'',label:attrs.label??'',x:Number(attrs.x),y:Number(attrs.y),width:Number(attrs.width),height:Number(attrs.height)});
 }
 return nodes;
}
export const normalizeNativeText=(s:string)=>s.replace(/\s+/g,' ').trim();
export function ownReelViewer(xml:string,account:string):boolean{
 const nodes=visibleNativeNodes(xml),owner=account.replace(/^@/,'');
 return nodes.some(n=>n.label===`Reel by ${owner}.`)
  ||(nodes.some(n=>n.label===`Post by ${owner}`)
    &&nodes.some(n=>n.label==='Trial insights')
    &&nodes.some(n=>n.name==='back-button')
    &&nodes.some(n=>n.name==='comment-button'));
}
export function exactOwnReelCaption(xml:string,caption:string,account:string):boolean{
 const nodes=visibleNativeNodes(xml);
 return ownReelViewer(xml,account)&&nodes.some(n=>normalizeNativeText(n.label)===normalizeNativeText(caption));
}

export function hasPreparedTrialEvidence(nodes:ReturnType<typeof visibleNativeNodes>):boolean {
 return nodes.some(n=>n.label==='This is a trial reel and will only be shown to non-followers at first.' || (n.type==='XCUIElementTypeSwitch' && n.label.startsWith('Checked, Trial, In feed and Reels,') && n.label.includes('it will automatically be shared to everyone.')));
}
