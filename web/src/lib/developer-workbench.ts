import type { NormalizedBox } from "./replay-buffer";
export type DevLog = { text: string; level: "info" | "error" | "muted"; time: string };
export type WorkbenchState = { compact: boolean; filter: "all" | "draft"; guarded: boolean; phase: string; posts: string[]; logs: DevLog[]; file: "code" | "response"; response: string };
export function workbenchLayout(compact: boolean) {
  return { width: compact ? 720 : 1440, height: compact ? 1260 : 900, terminalY: compact ? 920 : 596,
    hits: [
      { key: "code", label: "PostList.js 파일 열기", x: compact ? 16 : 218, y: 42, w: 178, h: 48 },
      { key: "response", label: "response.json 파일 열기", x: compact ? 194 : 396, y: 42, w: 196, h: 48 },
      { key: "all", label: "전체 게시글 필터", x: compact ? 32 : 926, y: compact ? 718 : 258, w: 150, h: 46 },
      { key: "draft", label: "임시저장 필터", x: compact ? 192 : 1086, y: compact ? 718 : 258, w: 150, h: 46 },
      { key: "guard", label: "빈 응답 기본값 처리", x: compact ? 30 : 246, y: compact ? 474 : 494, w: compact ? 660 : 600, h: 48 },
      { key: "run", label: "새로고침 실행", x: compact ? 504 : 1250, y: compact ? 718 : 258, w: compact ? 184 : 162, h: 46 },
    ] };
}
export function drawWorkbench(ctx: CanvasRenderingContext2D, state: WorkbenchState): NormalizedBox | undefined {
  const {compact,filter,guarded,phase,posts,logs,file,response}=state;
  const {width,height,terminalY,hits}=workbenchLayout(compact);
  const rect=(x:number,y:number,w:number,h:number,color:string)=>{ctx.fillStyle=color;ctx.fillRect(x,y,w,h);};
  const text=(s:string,x:number,y:number,size=18,color="#c9ced5",bold=false)=>{ctx.fillStyle=color;ctx.font=`${bold?600:400} ${size}px Consolas, "Noto Sans KR", monospace`;ctx.fillText(s,x,y);};
  const line=(x:number,y:number,w:number)=>rect(x,y,w,1,"#34373d");
  const ex=compact?0:218, ew=compact?720:670, previewY=compact?550:90, previewX=compact?0:888;
  rect(0,0,width,height,"#1e1e1e");rect(0,0,width,40,"#181818");
  text("〈〉",14,27,20,"#6baee7",true);text("File   Edit   View   Run   Terminal",58,26,14,"#a7abb3");
  if(!compact) { rect(535,7,440,26,"#252526"); text("⌕  posts-web",696,25,14,"#a9adb4"); text("−    □    ×",1327,26,17,"#9fa5af"); }
  else text("posts-web",577,26,15,"#a9adb4");
  if(!compact) {
    rect(0,40,48,height-62,"#181818");rect(48,40,170,height-62,"#181818");
    ["▣","⌕","⑂","▷","⊞"].forEach((v,i)=>text(v,12,82+i*63,27,i===0?"#e3e7ec":"#727982"));
    rect(0,52,2,42,"#5ea3d9");text("EXPLORER",67,72,13,"#b8bdc5");text("⌄ POSTS-WEB",62,115,14,"#d3d6db",true);
    text("⌄ public",73,150,15);text("  ⌄ developer-lab",73,181,13);rect(48,192,170,32,file==="code"?"#2b2d2f":"#181818");
    text("JS",81,214,13,"#d8c172");text("PostList.js",110,214,14,"#d3d6db");
    text("⌄ network",73,263,15);rect(48,273,170,32,file==="response"?"#2b2d2f":"#181818");text("{}",81,296,13,"#d8c172");text("response.json",108,296,12);
    text("OUTLINE",66,height-89,12,"#9199a4");text("TIMELINE",66,height-57,12,"#9199a4");
  }
  rect(ex,40,ew,50,"#181818");
  hits.slice(0,2).forEach((h,i)=>{const active=file===(i===0?"code":"response");rect(h.x,h.y,h.w,h.h,active?"#1e1e1e":"#181818");if(active)rect(h.x,h.y,h.w,2,"#d38b55");text(i===0?"JS  PostList.js  ×":"{}  response.json  ×",h.x+13,h.y+30,15,active?"#e0e2e7":"#888f99");});
  text(file==="code"?"public  ›  developer-lab  ›  PostList.js":"network  ›  GET /api/developer-posts",ex+25,120,14,"#9098a3");
  const code = file==="code" ? [
    "export function renderPosts(","  response, guarded = false", ") {", "  const items = guarded", "    ? response.items ?? []", "    : response.items;", "  return items.map(title => title);", "}",
  ] : response.split("\n");
  // Wrapped display lines map back to the real four-line module.
  const numbers=file==="code"?["1","","", "2","","", "3","4"]:code.map((_,i)=>String(i+1));
  const fontSize=compact?23:23;
  code.forEach((value,i)=>{
    const y=164+i*35;
    if (file==="code" && i===6)rect(ex+57,y-25,ew-78,33,"#252526");
    text(numbers[i],ex+24,y,16,"#6e7681");
    // Token highlighting preserves the exact displayed source text.
    const tokens=value.split(/(\b(?:export|function|return|const|false)\b|\b(?:renderPosts|map)\b|\b(?:response|items|guarded|title)\b|\?\?)/g);
    let x=ex+65;
    for(const token of tokens){const color=/^(export|function|return|const|false)$/.test(token)?"#c586c0":/^(renderPosts|map)$/.test(token)?"#dcdcaa":/^(response|items|guarded|title)$/.test(token)?"#9cdcfe":"#d4d4d4";text(token,x,y,fontSize,color);x+=ctx.measureText(token).width;}
  });
  const guard=hits[4];rect(guard.x,guard.y,guard.w,guard.h,guarded?"#20382c":"#2a2b2d");text(`${guarded?"☑":"□"} guarded = ${guarded}   · 기본값 처리`,guard.x+14,guard.y+31,compact?22:20,guarded?"#a1d5ad":"#aeb6c1");
  // An ordinary browser preview, visually separate from the editor chrome.
  rect(previewX,previewY,compact?width:width-previewX,compact?370:terminalY-previewY,"#f8fafc");
  rect(previewX,previewY,compact?width:width-previewX,45,"#e5e8ec");
  text("↻",previewX+18,previewY+29,22,"#637083");rect(previewX+55,previewY+9,compact?636:475,27,"#f5f6f8");text("localhost / posts",previewX+72,previewY+28,16,"#697584");
  text("workspace",previewX+32,previewY+80,14,"#708097");text("게시글",previewX+32,previewY+125,32,"#172536",true);
  text("콘텐츠를 관리하고 발행 상태를 확인하세요.",previewX+32,previewY+153,compact?18:16,"#738092");
  for(const h of hits.slice(2,4)){const active=filter===(h.key==="all"?"all":"draft");rect(h.x,h.y,h.w,h.h,active?"#e1eaf3":"#eef1f5");text(h.key==="all"?"전체 게시글":"임시저장",h.x+18,h.y+30,20,active?"#245379":"#6a7786",active);}
  const run=hits[5];rect(run.x,run.y,run.w,run.h,"#273c53");text(phase==="loading"?"요청 중…":"↻ 새로고침",run.x+17,run.y+30,19,"#f2f6fa");
  const listY=compact?805:348;
  if(posts.length){posts.forEach((post,i)=>{text(post,previewX+32,listY+i*61,22,"#344355");text("게시됨",previewX+(compact?618:440),listY+i*61,15,"#607c65");rect(previewX+32,listY+21+i*61,(compact?width:width-previewX)-64,1,"#e0e5eb");});}
  else { text("표시할 게시글이 없습니다",previewX+(compact?187:106),listY+39,22,"#8895a4"); text("0 posts",previewX+32,compact?883:552,14,"#98a1ad"); }
  // Fixed-height console: appending entries moves the old lines out of view.
  rect(ex,terminalY,width-ex,height-terminalY-22,"#181818");line(ex,terminalY,width-ex);
  text("PROBLEMS    OUTPUT    DEBUG CONSOLE    TERMINAL",ex+24,terminalY+32,14,"#8d959f");
  rect(ex+211,terminalY+42,118,2,"#d0d5dc");text("browser",width-160,terminalY+31,14,"#a1abb7");text("⌄  ×",width-65,terminalY+31,17,"#9da4ad");
  const rows=compact?7:7, rowH=compact?34:31, visible=logs.flatMap(log => { const limit=compact?50:104; return Array.from({length:Math.max(1, Math.ceil(log.text.length/limit))}, (_,i)=>({...log, time:i?"":log.time, text:log.text.slice(i*limit,(i+1)*limit)})); }).slice(-rows);
  let firstError=-1,lastError=-1,errorRight=0;
  visible.forEach((log,i)=>{const y=terminalY+80+i*rowH; if(log.level==="error"){rect(ex+10,y-23,width-ex-20,rowH,"#342021");if(firstError<0)firstError=i;lastError=i;}text(log.time,ex+20,y,compact?14:14,"#5f6b79");text(log.text,ex+(compact?99:112),y,20,log.level==="error"?"#f48771":log.level==="muted"?"#778592":"#bdc6d0");if(log.level==="error")errorRight=Math.max(errorRight,ex+(compact?99:112)+ctx.measureText(log.text).width+15);});
  rect(0,height-22,width,22,"#254c70");text(`⑂ main*    0 ↓  0 ↑     ${phase==="error"?"× 1":"✓"}`,15,height-6,12,"#d7e6f4");text("UTF-8     JavaScript     ◉ Live Preview",width-355,height-6,12,"#d7e6f4");
  return firstError<0?undefined:[(ex+(compact?90:102))/width,(terminalY+57+firstError*rowH)/height,Math.min(width-10,errorRight)/width,(terminalY+57+(lastError+1)*rowH)/height];
}
