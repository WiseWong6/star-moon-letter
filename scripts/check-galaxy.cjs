'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=path.join(__dirname,'..'),src=fs.readFileSync(path.join(root,'animation.js'),'utf8');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const burstCount=Number(src.match(/^const BURST_COUNT = (\d+);/m)[1]);
const image=fs.readFileSync(path.join(root,'assets/galaxy-sky.png'));
assert.equal(image.subarray(1,4).toString(),'PNG');
assert.equal(image.readUInt32BE(16)/image.readUInt32BE(20),3/4,'底图比例与画面一致，不能拉伸变形');
assert(html.indexOf('assets/galaxy-stars.js')<html.indexOf('src="animation.js"'));
assert(html.indexOf('src="chime-score.js"')<html.indexOf('src="animation.js"'),'乐谱先于动画加载');
assert(html.includes('#galaxy{z-index:1;mix-blend-mode:screen}'),'黑色与正蓝均保留原背景');
assert(html.includes('#illumination{z-index:2;mix-blend-mode:screen}'),'光面在独立图层加光，不用灰色覆盖银河');
assert(html.includes('class="send-spinner"')&&html.includes('class="send-progress"'),'发送键包含转圈和停止图标');
assert(src.includes(`document.fonts.load('20px "Ma Shan Zheng"'),galaxyReady`));
let seed=2197,canvases=0,draws=0,balance=0,lastDraw=null,lastOrigin=null;
const textures=[],glints=[];
const math=Object.create(Math);math.random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
const finite=args=>assert(args.filter(v=>typeof v==='number').every(Number.isFinite));
const gradient=()=>({addColorStop(offset,color){
  assert(offset>=0&&offset<=1);assert(!color.includes('NaN'));
  const alpha=color.match(/rgba\([^,]+,[^,]+,[^,]+,([^)]+)\)/);if(alpha)assert(+alpha[1]>=0&&+alpha[1]<=1);
}});
const context=()=>new Proxy({globalAlpha:1,points:[],draws:0,clears:0,
  save(){balance++;},restore(){assert(--balance>=0);},
  clearRect(...args){this.clears++;finite(args);},
  arc(x,y,r,...args){finite([x,y,r,...args]);this.points.push({x,y,r,alpha:this.globalAlpha,color:this.fillStyle});},
  createImageData(width,height){return {width,height,data:new Uint8ClampedArray(width*height*4)};},
  putImageData(pixels){this.pixels=pixels;if(pixels.width===320&&pixels.height===512)textures.push(pixels);},
  translate(x,y){finite([x,y]);lastOrigin={x,y};},
  createRadialGradient(...args){finite(args);return gradient();},
  drawImage(...args){this.draws++;draws++;finite(args);lastDraw=args.slice(1);}},
  {get:(object,key)=>key in object?object[key]:(...args)=>finite(args)});
const scope={Math:math,W:660,H:880,SKY_LOOP:9,StarLetterMusic:require('../chime-score.js'),FLIGHT_RATE:1.44,TYPE_INTERVAL:.175,TRANSFORM_RATE:1.2,WATER_LEAD:1.35/1.2,
  theme:'ink',reduce:false,editing:false,clock:0,cycle:{},ctx:context(),glint(...args){finite(args);glints.push(args);},
  canvas:{style:{}},galaxyCanvas:{style:{}},
  drawSymbol(){throw new Error('星河尾声不能重新出现飞行物造型');},
  galaxyCtx:context(),illuminationCtx:context(),galaxyImage:{complete:true,naturalWidth:image.readUInt32BE(16)},
  galaxyFrameTime:-1,galaxyFrameCycle:null,galaxyRevealMask:null,galaxyMaskPixels:null,
  document:{createElement(tag){assert.equal(tag,'canvas');canvases++;const g=context();return {getContext:()=>g};}},
  random:(a,b)=>a+math.random()*(b-a),clamp:x=>Math.max(0,Math.min(1,x)),
  smooth:x=>{x=Math.max(0,Math.min(1,x));return x*x*(3-2*x);}};
vm.createContext(scope);
vm.runInContext(fs.readFileSync(path.join(root,'assets/galaxy-stars.js'),'utf8')+'\nthis.starMap=GALAXY_STARS;this.ridge=GALAXY_RIDGE;',scope);
assert.equal(scope.starMap.length,320);
assert.equal(scope.ridge.length,33);assert.equal(scope.ridge[0][0],0);assert.equal(scope.ridge.at(-1)[0],1);
assert(scope.ridge.every(p=>p.every(Number.isFinite)&&p[1]>0&&p[1]<.65&&p[2]>0&&p[3]>0),'中轴和两侧宽度必须有效');
const positions=new Set(scope.starMap.map(p=>`${p[0]*660},${p[1]*880}`));
for(const [start,end] of [['function flightPoint(','function flashPulse('],['let sourceBeamTexture=','function waterGlyph('],['function galaxyTargets(','function composerOpacity('],['function composerOpacity(','function paint('],['function makeSoundEvents(){','function buildCycle(']]){
  vm.runInContext(src.slice(src.indexOf(start),src.indexOf(end)),scope);
}
let maxEnding=0,minSparks=99,maxSparks=0,minCloudRatio=Infinity;
for(let round=0;round<12;round++){
  scope.theme=round%2?'blue':'ink';
  scope.cycle={value:'那些凌晨时分敲下的代码，是不会说谎的星星。',instant:false,sendAt:5.375};
  const burst=Array.from({length:burstCount},(_,i)=>({type:'symbol',x:scope.random(120,514),y:scope.random(610,622),
    start:scope.random(6.6,8.5),nearScale:.8,luminosity:.85,phase:scope.random(0,Math.PI*2),revealDuration:1.4/1.2}));
  scope.arrangeStarfield(burst);scope.particles=burst;
  const cycle=scope.cycle;assert.equal(cycle.dust.length,32);assert.equal(cycle.symbols.length,burstCount);
  assert.equal(cycle.sky.regions.length,6);assert(cycle.sky.start>cycle.firstSettle);
  assert(cycle.sky.start>=Math.max(...burst.map(p=>p.start+p.duration))+.5,'所有物品先落定，底图再由星带中间展开');
  assert(cycle.sky.end<=cycle.settledAt);
  const allPoints=[...burst.map(p=>({x:p.endX,y:p.endY})),...cycle.dust];
  const chosen=allPoints.map(p=>`${p.x},${p.y}`);
  assert.equal(new Set(chosen).size,burstCount+32,'每件物品与动态亮星分别占据不同的星点');
  assert(chosen.every(p=>positions.has(p)),'所有落点必须与银河底图的亮星位置对齐');
  for(const region of cycle.sky.regions){
    const arrival=region.source.start+region.source.duration;
    assert(region.source.hasTrail&&region.source.settle.anchor,'触发星河的物品必须能沿光丝追到落点');
    assert(region.born>arrival+.5&&region.born<arrival+.7,'落定闪光后留一小段衔接，再出现星河');
    assert.equal(scope.landingFlash(region.source,arrival-.01),0);
    assert(scope.landingFlash(region.source,arrival+.2)>.9);
    assert.equal(scope.landingFlash(region.source,arrival+1.3),0);
    assert(region.born+cycle.sky.rise<=cycle.settledAt);
  }
  const cloudAt=p=>scope.starMap.find(q=>q[0]*660===p.x&&q[1]*880===p.y)[6];
  const anchorCloud=cycle.sky.regions.reduce((sum,p)=>sum+cloudAt(p),0)/6;
  const skyCloud=scope.starMap.reduce((sum,p)=>sum+p[6],0)/scope.starMap.length;
  assert(anchorCloud>skyCloud*1.5,'主要落点集中在银河亮部，不能全在周围暗处');
  const selectedCloud=burst.reduce((sum,p)=>sum+cloudAt({x:p.endX,y:p.endY}),0)/burst.length;
  minCloudRatio=Math.min(minCloudRatio,selectedCloud/skyCloud);
  assert(selectedCloud>skyCloud*1.3,'增加的物品更多落在明亮银心与星带，不能只均匀铺满画面');
  assert(burst.filter(p=>p.hasTrail).length<=20,'增加物品后仍保持稀疏光丝');
  const anchorTimes=cycle.sky.regions.map(p=>p.born);
  assert(Math.max(...anchorTimes)-Math.min(...anchorTimes)<.7,'主要落点接近同时抵达，不能按左右顺序间隔出现');
  const {start:exitStart,end:exitEnd}=cycle.composerExit;
  assert.equal(scope.composerOpacity(exitStart-.1),1);
  assert(scope.composerOpacity((exitStart+exitEnd)/2)>.4&&scope.composerOpacity((exitStart+exitEnd)/2)<.6);
  assert.equal(scope.composerOpacity(exitEnd),0,'输入框最后完全退场');
  assert.equal(scope.composerOpacity(0),1,'回到开头时输入框恢复');
  assert(exitEnd<cycle.settledAt,'完整夜空阶段只留下星空');
  for(const p of burst){
    assert(p.endX>0&&p.endX<660&&p.endY>0&&p.endY<550);
    assert(p.flight.every(q=>Number.isFinite(q.x+q.y+q.distance)));
    const start=scope.poseAt(p,0),end=scope.poseAt(p,p.duration);
    assert(Math.hypot(start.x-p.x,start.y-p.y)<1e-8);assert(Math.hypot(end.x-p.endX,end.y-p.endY)<1e-8);
    assert(p.flight.every((q,i)=>!i||q.y<=p.flight[i-1].y),'全程向上落定，没有末段掉头');
    const arrival=p.start+p.duration;
    assert.equal(scope.starAmount(p,arrival-.01),0,'落定之前不能提前在终点画出星星');
    assert.equal(scope.starAmount(p,arrival+1),1,'物品落定后连续凝成同位置的星点');
    assert(scope.landingFlash(p,arrival+.2)>.4,'每个落点都有抵达闪光');
  }
  for(const p of cycle.dust){
    assert(Number.isFinite(p.x+p.y+p.r+p.alpha+p.born+p.rise));
    assert(p.alpha>0&&p.alpha<=1);assert(p.born>p.source.start+p.source.duration+.65);
    assert(p.born+p.rise<=cycle.settledAt);
  }
  const sparked=cycle.dust.filter(p=>p.sparkle),accented=burst.filter(p=>p.settle.accent);
  const accents=[...sparked,...accented.map(p=>({x:p.endX,y:p.endY}))],count=accents.length;
  assert(count>=6&&count<=10);minSparks=Math.min(minSparks,count);maxSparks=Math.max(maxSparks,count);
  for(const p of accents)for(const q of accents)if(p!==q)assert(Math.hypot(p.x-q.x,p.y-q.y)>=85);
  assert(accented.filter(p=>p.endX>660*.26&&p.endX<660*.74&&p.endY>880*.07&&p.endY<880*.56).length>=3,'银河内部保留多颗清楚闪烁的主星');
  const before=JSON.stringify({regions:cycle.sky.regions,dust:cycle.dust});
  const allocated=canvases,skyDraws=scope.galaxyCtx.draws;
  scope.clock=cycle.sky.start-.01;scope.drawStarfield();assert.equal(scope.galaxyCtx.draws,skyDraws,'落定前不显示底图');
  const sky=cycle.sky,indexAt=(x,y)=>Math.floor(y/880*sky.height)*sky.width+Math.floor(x/660*sky.width);
  const sections=[.08,.24,.4,.56,.72,.9].map(fraction=>{
    const x=fraction*scope.W,band=scope.galaxyBand(x);
    return {center:indexAt(x,band.center),upper:indexAt(x,band.center-band.upper),lower:indexAt(x,band.center+band.lower)};
  });
  for(const section of sections)for(const side of ['upper','lower']){
    assert(sky.onsets[section[side]]>sky.onsets[section.center]+1.5,'两侧比星带中轴更晚显现');
  }
  const centerTimes=sections.map(section=>sky.onsets[section.center]);
  assert(Math.max(...centerTimes)-Math.min(...centerTimes)<.15,'整条中轴一起开始，不能从左到右展开');
  scope.clock=sky.start+.95;scope.drawStarfield();
  const mask=scope.galaxyRevealMask.getContext('2d').pixels;
  const alpha=i=>mask.data[i*4+3];
  for(const section of sections){
    assert(alpha(section.center)>30&&alpha(section.center)<100,'中轴先微亮，不能出现一条突然发白的光线');
    assert.equal(alpha(section.upper),0);assert.equal(alpha(section.lower),0);
  }
  scope.clock=sky.start+3.25;scope.drawStarfield();
  for(const section of sections){
    assert.equal(alpha(section.center),255);
    for(const side of ['upper','lower'])assert(alpha(section[side])>80&&alpha(section[side])<200,'星带两侧柔和渐入，没有硬边');
  }
  const delayed=scope.prepareGalaxyReveal(burst.map(p=>({...p,duration:p.duration+2})));
  for(const i of [0,sections[2].center,sky.onsets.length-1])assert(Math.abs(delayed.onsets[i]-sky.onsets[i]-2)<1e-5,'延迟抵达必须同步延迟银河形成');
  assert(Math.abs(delayed.end-sky.end-2)<1e-5);
  if(round===0){
    let previous=new Uint8ClampedArray(sky.onsets.length);
    for(let time=sky.start+.2;time<sky.end;time+=.2){
      scope.clock=time;scope.drawStarfield();
      for(let i=0;i<previous.length;i++){
        const value=alpha(i);assert(value>=previous[i],'显现中不能出现亮度回退或闪跳');previous[i]=value;
      }
    }
    scope.clock=sky.end-1/60;scope.drawStarfield();
    for(let i=0;i<sky.onsets.length;i++)assert(alpha(i)>=254,'过渡末帧与完整底图连续，不能突然整图跳亮');
  }
  for(const time of [cycle.sky.start+.3,cycle.sky.start+2,cycle.settledAt+4,cycle.firstSettle-.1,cycle.settledAt+4]){
    scope.clock=time;scope.drawStarfield();
  }
  const finalDraws=scope.galaxyCtx.draws;
  scope.clock+=.5;scope.drawStarfield();assert.equal(scope.galaxyCtx.draws,finalDraws,'完全显现后不重绘底图');
  assert.equal(canvases-allocated,round===0?2:0,'每一轮都共用一张低分辨率遮罩和一张星点光晕');
  assert.equal(before,JSON.stringify({regions:cycle.sky.regions,dust:cycle.dust}));assert.equal(balance,0);
  if(round<2){
    for(const p of burst){
      glints.length=0;
      for(let time=cycle.settledAt;time<cycle.settledAt+9;time+=.25){
        scope.clock=time;scope.drawSettlingItem(p,time-p.start);
      }
      assert(glints.length>0,'每件物品落定后在尾声继续闪烁，不能只剩静止的小亮点');
      assert(glints.some(g=>g[2]>.4),'普通落点也保留可见的星芒');
      assert(glints.every(g=>g[0]===p.endX&&g[1]===p.endY),'持续闪光始终固定在该物品对应的底图星位');
    }
    assert.equal(balance,0);
  }
  scope.playback={duration:cycle.loopStart+scope.StarLetterMusic.sustainDuration};maxEnding=Math.max(maxEnding,scope.playback.duration);
  const events=scope.makeSoundEvents(),touches=events.filter(e=>e.kind==='leafTouch');
  assert(events.every(e=>e.time+(e.duration||.09)<=scope.playback.duration));
  assert(touches.length>200&&touches.length<250,'主题、伴奏和八段持续音乐完整');
  const lead=touches.filter(e=>e.role==='melody'),peak=lead.reduce((a,b)=>a.gain>b.gain?a:b);
  assert(Math.abs(peak.time-cycle.firstSettle)<1e-8,'音乐高点随实际首次落定同步');
  assert(touches.filter(e=>e.role?.startsWith('coda')).every(e=>e.time>=cycle.loopStart&&e.time+e.duration<=scope.playback.duration-.1),'整曲音乐不跨循环接缝');
  for(const event of events)assert(events.filter(e=>e.time<=event.time&&e.time+e.duration>event.time).length<=14,'密集叠加不能超出声源上限而丢音');
}
assert.equal(canvases,2);
const beforeDraws=draws;scope.reduce=true;scope.drawStarfield();assert.equal(draws,beforeDraws);
scope.reduce=false;scope.theme='ink';scope.drawStarfield();
const inkDraws=scope.ctx.draws;scope.drawStarfield();const amount=scope.ctx.draws-inkDraws;
scope.theme='blue';scope.drawStarfield();assert(amount>0);assert.equal(scope.ctx.draws-inkDraws,amount*2);
const loadedDraws=scope.galaxyCtx.draws;scope.galaxyImage.naturalWidth=0;scope.drawGalaxySky();
assert.equal(scope.galaxyCtx.draws,loadedDraws,'图片不可用时正常保留飞行与动态星点');
scope.galaxyImage.naturalWidth=image.readUInt32BE(16);
scope.water={x:90,y:590,width:480,height:52,start:5.375};scope.cycle.lightEnd=15;scope.editing=false;
for(const theme of ['ink','blue']){
  scope.theme=theme;
  assert.equal(scope.sourceLight(5.375).glow,0);
  assert(scope.sourceLight(5.5).glow>0,'涟漪出现后立即亮起');
  assert(scope.sourceLight(6.6).beam>.99,'化形时已向上照亮');
  assert(scope.sourceLight(10).beam>.99,'飞行中继续照亮');
  assert(scope.sourceLight(14).beam>0&&scope.sourceLight(14).beam<1,'落定时平缓收光');
  assert.equal(scope.sourceLight(15).beam,0);
  const before=draws,skyDraws=scope.ctx.draws,clears=scope.illuminationCtx.clears;
  scope.drawSourceBeam(scope.sourceLight(4));assert.equal(draws,before);
  assert.equal(scope.illuminationCtx.clears,clears+1,'没有光时也清空光层，回看不能留下光面');
  scope.drawSourceBeam(scope.sourceLight(5.52));const earlyBeam=lastDraw;
  scope.drawSourceBeam(scope.sourceLight(9));assert.deepEqual(lastDraw,earlyBeam,'光束一起亮起，长度不随时间生长');
  assert.equal(lastOrigin.x,scope.water.x+scope.water.width/2);
  assert(Math.abs(lastOrigin.y-scope.water.y)<scope.water.height*.1,'发光面与输入框上沿衔接');
  const first=JSON.stringify(scope.sourceLight(7));
  for(const t of [6,9,14,7])scope.drawSourceBeam(scope.sourceLight(t));
  assert.equal(JSON.stringify(scope.sourceLight(7)),first);
  assert.equal(scope.ctx.draws,skyDraws,'光面不再画到物品层，避免将灰雾覆盖在底图上');
}
assert.equal(canvases,3,'遮罩、星点光晕与光束都共用缓存');assert.equal(balance,0);
assert.equal(textures.length,1);
const beam=textures[0];
function crossSection(height){
  const row=Math.floor(beam.height*height),light=Array.from({length:beam.width},(_,col)=>{
    const i=(row*beam.width+col)*4;
    return (.2126*beam.data[i]+.7152*beam.data[i+1]+.0722*beam.data[i+2])*beam.data[i+3]/255*.16;
  });
  const peak=Math.max(...light),left=light.findIndex(a=>a>peak*.25),right=light.findLastIndex(a=>a>peak*.25);
  return {light,peak,left,right,width:right-left+1};
}
const near=crossSection(.9),far=crossSection(.35),aperture=crossSection(.96);
const sourceWidth=aperture.width/beam.width*lastDraw[2];
assert(sourceWidth>scope.water.width*.78&&sourceWidth<scope.water.width,'发光面覆盖输入框上沿');
assert(far.width>near.width,'宽光面沿两侧向外展开');
assert(near.peak>far.peak*2,'底部亮，向远处自然减淡');
const frameTop=crossSection(-(lastOrigin.y+lastDraw[1])/lastDraw[3]);
assert(frameTop.peak>3&&frameTop.peak<9,'画面顶部保留清淡的光，避免厚重灰雾');
assert(far.peak<15&&aperture.peak<40,'光束整体保持薄亮，不能盖住下面的星空');
assert.equal(lastOrigin.x+lastDraw[0],0);assert.equal(lastOrigin.y+lastDraw[1],0);
assert.equal(lastDraw[2],scope.W,'光面顶部与画面宽度对齐');
assert(frameTop.left/beam.width*scope.W<8&&(beam.width-1-frameTop.right)/beam.width*scope.W<8,'柔边连接到画面两个上角');
const lower=crossSection(.9),upper=crossSection(.1);
for(const height of [.1,.3,.5,.7,.9]){
  const section=crossSection(height),ratio=(height-.1)/.8;
  for(const side of ['left','right'])assert(Math.abs(section[side]-(upper[side]+(lower[side]-upper[side])*ratio))<=1.5,'两侧光边必须共线');
  assert(Math.abs(section.left+section.right-beam.width+1)<=1,'左右光边对称，没有右偏');
}
for(const side of [.34,.66])assert(aperture.light[Math.floor(beam.width*side)]>aperture.peak*.85,'发光面左右同样明亮，没有中心聚光点');
scope.reduce=true;assert.equal(scope.sourceLight(7).beam,0);
scope.reduce=false;scope.editing=true;assert.equal(scope.sourceLight(7).glow,0);

// 运行真实的发送与总时长计算；仅用简单边界替代输入框的浏览器排版。
const icon=()=>({style:{},animations:[],getAnimations(){return this.animations;},animate(frames,options){
  this.animations.push({frames,options,cancel(){this.cancelled=true;}});
}});
Object.assign(scope,{
  send:icon(),sendArrow:icon(),sendProgress:icon(),
  DEFAULT_TEXT:'那些凌晨时分敲下的代码，是不会说谎的星星。',BURST_COUNT:burstCount,TRAIL_FADE:2.4,WATER_SPEED:91*1.2,
  stage:{getBoundingClientRect:()=>({left:0,top:0,width:660,height:880})},
  words:{style:{},getBoundingClientRect:()=>({left:112,right:514,y:608,height:24}),querySelectorAll:()=>[]},input:{},
  getComputedStyle:()=>({fontSize:'20px',fontFamily:'WenKai'}),
  measureWater:()=>Object.assign(scope.water,{x:90,y:590,width:480,height:52}),waterCenter:()=>({x:330,y:616}),
  createParticle:(x,y,i,start)=>({type:'symbol',x,y,start,layer:i%3,nearScale:.8,luminosity:.85,revealDuration:1.4/1.2}),
  setText(){},prepareTyping(){},paint(){},updateControls(){},sound:{setEvents(events){this.events=events;}}
});
for(const [start,end] of [['function flightEnd(','function chooseKites('],['function prepareBurst(','function release('],['function buildCycle(','function clockText(']]){
  vm.runInContext(src.slice(src.indexOf(start),src.indexOf(end)),scope);
}
for(const instant of [false,true]){
  const snapshots=[];
  for(const theme of ['ink','blue']){
    seed=2197;scope.theme=theme;scope.reduce=false;scope.playback={};scope.buildCycle(scope.DEFAULT_TEXT,instant);
    assert.equal(scope.cycle.sky.regions.length,6);assert.equal(scope.cycle.drawOrder.length,burstCount);
    assert(scope.cycle.symbols.every(p=>p.settle&&!p.kite));
    assert.equal(scope.playback.duration,scope.cycle.loopStart+scope.StarLetterMusic.sustainDuration);
    assert(scope.cycle.transformEnd>scope.cycle.sendAt&&scope.cycle.transformEnd<scope.cycle.composerExit.start,'化形完成后先恢复发送图标，再让输入框退场');
    assert(scope.sound.events.some(e=>e.role==='coda'));
    assert(scope.sound.events.every(e=>e.time+e.duration<=scope.playback.duration));
    snapshots.push(JSON.stringify({
      targets:scope.cycle.symbols.map(p=>[p.endX,p.endY,p.duration,p.settle]),
      regions:scope.cycle.sky.regions,skyEnd:scope.cycle.sky.end,composerExit:scope.cycle.composerExit,
      duration:scope.playback.duration,events:scope.sound.events
    }));
    scope.reduce=true;scope.buildCycle(scope.DEFAULT_TEXT,instant);
    assert.equal(scope.cycle.sky,undefined);assert(Number.isFinite(scope.playback.duration));
    assert(scope.sound.events.every(e=>['typing','send'].includes(e.kind)));
  }
  assert.equal(snapshots[0],snapshots[1],'相同随机起点下，两种配色的路径、渐亮与声音完全一致');
}
// 尾声循环保持同一幅夜空与同一闪光相位，不重新播放发送过程。
vm.runInContext(src.slice(src.indexOf('function advancePlayback('),src.indexOf('function render(')),scope);
scope.reduce=false;scope.buildCycle();
for(const rate of [.5,1,1.5,2]){
  const {loopStart,symbols}=scope.cycle;
  Object.assign(scope.playback,{time:loopStart+8.9,rate,playing:true});
  scope.advancePlayback(.4/rate);
  assert(Math.abs(scope.playback.time-loopStart-9.3)<1e-8,'星星完成一次闪光周期后音乐继续发展，不回到第一句');
  Object.assign(scope.playback,{time:scope.playback.duration-.1,rate,playing:true});
  scope.advancePlayback(.4/rate);
  assert(Math.abs(scope.playback.time-loopStart-.3)<1e-8);assert(scope.playback.playing);
  assert(scope.playback.time>scope.cycle.transformEnd,'结尾回绕不能重新触发发送或化形');
  for(const p of symbols){
    const age=loopStart-p.start-p.duration;
    assert(Math.abs(scope.starTwinkle(age,p.settle.period,p.settle.offset)-scope.starTwinkle(age+scope.StarLetterMusic.sustainDuration,p.settle.period,p.settle.offset))<1e-8,'整曲循环接缝处星芒一致');
  }
  scope.playback.playing=false;const paused=scope.playback.time;
  scope.advancePlayback(1);assert.equal(scope.playback.time,paused,'手动暂停仍能停住闪光');
}
// 实际按钮状态与停止处理；浏览器排版、聚焦和声音输出以简单对象替代。
Object.assign(scope,{
  reduce:false,editing:false,busy:false,text:'测试发送',composing:false,
  cycle:{value:'测试发送',sendAt:2,transformEnd:5},
  playback:{ready:true,playing:true,time:0,stamp:null},
  send:{...icon(),dataset:{},setAttribute(key,value){this[key]=value;}},
  sendArrow:icon(),sendProgress:icon(),sendSpinner:{setAttribute(key,value){this[key]=value;}},
  field:{style:{setProperty(){}}},composer:{style:{}},
  setText(value){scope.text=value;scope.input.value=value;},
  updateControls(){scope.lastSoundFrame={time:scope.playback.time,playing:scope.playback.playing&&!scope.editing};}
});
scope.input.focus=()=>{scope.focused=true;};
for(const [start,end] of [['function sendWorkingAt(','function drawTyping('],['function stopTransformation(',"input.addEventListener('focus',manual);"],['function release(){','function flightPoint(']]){
  vm.runInContext(src.slice(src.indexOf(start),src.indexOf(end)),scope);
}
scope.updateSendState(1);assert.equal(scope.send.dataset.state,'idle');assert.equal(scope.send.disabled,false);
scope.busy=true;scope.text='';scope.updateSendState(2);
assert.equal(scope.send.dataset.state,'working');assert.equal(scope.send.disabled,false);assert.equal(scope.send['aria-label'],'停止变化');
scope.updateSendState(3);const rotation=scope.sendSpinner.transform;
scope.updateSendState(3);assert.equal(scope.sendSpinner.transform,rotation,'暂停时转圈一同停住');
scope.updateSendState(4);assert.notEqual(scope.sendSpinner.transform,rotation);
scope.updateSendState(5);assert.equal(scope.send.dataset.state,'idle');assert.equal(scope.send['aria-busy'],'false');
assert.equal(+scope.sendProgress.style.opacity,1,'完成这一帧圆环不能直接消失');
const finishAngle=scope.sendSpinner.transform;
scope.updateSendState(5.32);
assert(Math.abs(+scope.sendProgress.style.opacity-.5)<1e-8&&Math.abs(+scope.sendArrow.style.opacity-.5)<1e-8,'圆环与箭头中途交叠渐变');
assert.notEqual(scope.sendSpinner.transform,finishAngle,'圆环淡出时继续减速转动');
const middleStyle=JSON.stringify([scope.send.style,scope.sendArrow.style,scope.sendProgress.style,scope.sendSpinner.transform]);
scope.updateSendState(5.32);assert.equal(JSON.stringify([scope.send.style,scope.sendArrow.style,scope.sendProgress.style,scope.sendSpinner.transform]),middleStyle,'暂停时图标过渡一起停住');
scope.updateSendState(5.64);assert.equal(+scope.sendProgress.style.opacity,0);assert.equal(+scope.sendArrow.style.opacity,1);
scope.updateSendState(5.32);assert.equal(JSON.stringify([scope.send.style,scope.sendArrow.style,scope.sendProgress.style,scope.sendSpinner.transform]),middleStyle,'回看恢复过渡中间态');
scope.updateSendState(3);assert.equal(scope.sendSpinner.transform,rotation,'回看恢复对应的转圈角度');
scope.playback.time=3;scope.stopTransformation();
assert.equal(scope.playback.time,0);assert.equal(scope.playback.playing,false);assert(scope.editing&&scope.focused);
assert.equal(scope.input.value,'测试发送');assert.equal(scope.input.disabled,false);assert.equal(scope.send.dataset.state,'idle');
assert.equal(scope.composer.style.opacity,'1');assert.equal(scope.lastSoundFrame.playing,false,'终止同时停止声音');
assert.equal(scope.sendProgress.animations.length,1,'手动停止也有图标交接');
assert.equal(scope.sendProgress.animations[0].frames[0].opacity,'1');
assert.equal(scope.sendProgress.animations[0].frames[1].opacity,'0');
scope.release();assert.equal(scope.editing,false);assert.equal(scope.playback.playing,true);
assert(scope.sendProgress.animations[0].cancelled,'立即重发会取消未结束的图标交接');
assert.equal(scope.sound.events.filter(e=>e.kind==='send').length,1,'终止后可以重新发送，按键声只触发一次');
console.log(`通过：12 轮、每轮 ${burstCount} 件物品与底图星位对应；所有落点持续闪烁，${minSparks}–${maxSparks} 处较亮星芒；星带中轴一起微亮再向两侧渐显，亮度单调过渡且末帧无跳变，推迟抵达同步推迟显现，输入框完全退场且回看恢复；银心落点周围平均亮度至少为全图采样的 ${minCloudRatio.toFixed(2)} 倍，缓存复用，最长一轮 ${maxEnding.toFixed(1)} 秒。`);
console.log('通过：旧银河底图与落点对应、尾声持续闪光且循环衔接、发送时转圈和可用的停止按钮、完成后图标减速渐变、暂停回看保留中间态、终止后可立即重新发送、两种配色共用动效、光束边界、音效结束时间、完整尾声及减少动态效果降级。未执行浏览器视觉验收。');
