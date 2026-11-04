export interface ScreenWord {text:string;x:number;y:number;width:number;height:number}
const token=(s:string)=>s.toLowerCase().replace(/[^a-z0-9]/g,'');
/** Full word sequence in a bounded region. Only the known AI/Al and I/| OCR confusions are allowed.
 * draftCursor: an unsent draft still shows the text cursor after its last character. OCR reads it as "l", "|" or "I"
 * glued to the final punctuation ("pitch?l"; with the I/| rule this clears 10 of the 16 items that failed readback Oct 27 to
 * Nov 4). Long drafts that scroll inside the box still fail closed. Drop that one glyph, only right after
 * the comment's own closing ?, . or !, and only for the draft check; a posted comment has no cursor. */
export function locateComment(words:ScreenWord[],text:string,minY:number,maxY:number,options:{draftCursor?:boolean}={}) {
 const expected=text.split(/\s+/).map(token).filter(Boolean);
 const last=text.trim().split(/\s+/).at(-1)??'';
 const cursorAfter=options.draftCursor&&/[?.!]$/.test(last)?last:undefined;
 // A lone "|" is OCR's reading of a capital I ("and | will DM you", Nov 1 and 2); token() would drop it as empty.
 const read=(w:ScreenWord)=>w.text==='|'?{...w,text:'I'}:cursorAfter&&w.text.length===cursorAfter.length+1&&w.text.startsWith(cursorAfter)&&/[l|I]$/.test(w.text)?{...w,text:cursorAfter}:w;
 const candidates=words.map(read).filter(w=>w.y>=minY&&w.y<=maxY&&w.x>=150&&token(w.text));
 for(let i=0;i<=candidates.length-expected.length;i++) {
  // OCR reads a capital I after A as a lowercase l, also inside words ("Al-built", Oct 7): read "Al" not followed by a lowercase letter as "AI".
  if(expected.every((t,n)=>token(candidates[i+n].text)===t || token(candidates[i+n].text.replace(/Al(?![a-z])/g,'AI'))===t))return candidates.slice(i,i+expected.length);
 }
 // Oct 11 21:27 (iOS 27): OCR merged "your team?" into "yourteam?|". Compare the same letters with spacing removed;
 // the full text must still appear in order, contiguously, within the region.
 const want=expected.join('');
 const parts=candidates.map(w=>token(w.text.replace(/Al(?![a-z])/g,'AI')));
 for(let i=0;i<parts.length;i++){
  let joined='';
  for(let j=i;j<parts.length&&joined.length<want.length;j++){
   joined+=parts[j];
   if(joined===want)return candidates.slice(i,j+1);
   if(!want.startsWith(joined))break;
  }
 }
 return null;
}
