'use strict';
const stage = document.querySelector('main');
const canvas = document.querySelector('#sky'), ctx = canvas.getContext('2d');
const words = document.querySelector('.words'), input = document.querySelector('#input');
const send = document.querySelector('#send'), field = document.querySelector('.field');
const composer = document.querySelector('.composer');
const sound = new StarLetterSound();
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const W = 660, H = 880;
const BURST_COUNT = 84;
const FLIGHT_RATE = 1.44;
const TYPE_INTERVAL = .175;
const TRAIL_FADE = 2.4;
const TRANSFORM_RATE = 1.2;
const WATER_LEAD = 1.35 / TRANSFORM_RATE;
const WATER_SPEED = 91 * TRANSFORM_RATE;
const MATERIALS = {
  white: {color:'#ffffff',light:'#ffffff',trail:'#ffffff'},
  silver: {color:'#f1f4f8',light:'#ffffff',trail:'#f1f4f8'},
  gold: {color:'#ffe39a',light:'#fff9e6',trail:'#ffe39a'}
};
let particles = [], text = '', busy = false, composing = false, clock = 0;
let theme = 'ink', cycle = null, typing = null, editing = false;
const playback = {time:0, duration:30, playing:false, rate:1, stamp:null, ready:false};
const DEFAULT_TEXT = '那些凌晨时分敲下的代码，是不会说谎的星星。';
const controls = {
  toggle:document.querySelector('#play-toggle'), progress:document.querySelector('#play-progress'),
  speed:document.querySelector('#play-speed'), theme:document.querySelector('#play-theme'),
  time:document.querySelector('#play-time'), sound:document.querySelector('#play-sound'),
  font:document.querySelector('#play-font')
};
let water = null, viewScale = 1;
const random = (a,b) => a + Math.random()*(b-a);
const clamp = x => Math.max(0,Math.min(1,x));
const smooth = x => {x=clamp(x);return x*x*(3-2*x);};

function resize(){
  const rect=stage.getBoundingClientRect(), d=Math.min(devicePixelRatio||1,2);
  viewScale=rect.width/W;
  canvas.width=Math.round(rect.width*d);canvas.height=Math.round(rect.height*d);
  ctx.setTransform(canvas.width/W,0,0,canvas.height/H,0,0);
  if(water)measureWater();
}
addEventListener('resize',resize);resize();

function setText(value){
  text=value;input.value=value;words.replaceChildren();
  for(const ch of Array.from(value)){const s=document.createElement('span');s.textContent=ch;words.append(s);}
  words.scrollLeft=words.scrollWidth;send.disabled=busy||!value.trim();
}

// 打字、波纹、飞行和控制条共用同一个可暂停、可回看的时间。
function prepareTyping(value){
  setText(value);
  const spans=[...words.querySelectorAll('span')],fontSize=parseFloat(getComputedStyle(words).fontSize);
  typing={value,chars:Array.from(value),spans,widths:spans.map(s=>s.getBoundingClientRect().width/fontSize),previous:[]};
}

function drawTyping(time){
  if(!typing||editing)return;
  const progress=cycle.instant?typing.chars.length:Math.max(0,(time-.65)/TYPE_INTERVAL);
  const sent=time>=cycle.sendAt;
  words.style.visibility=sent?'hidden':'visible';
  for(let i=0;i<typing.spans.length;i++){
    const amount=clamp(progress-i);if(typing.previous[i]===amount)continue;
    const span=typing.spans[i];span.style.width=`${typing.widths[i]*amount}em`;
    span.style.opacity=String(clamp(amount*2));span.style.overflow='hidden';typing.previous[i]=amount;
  }
  text=sent?'':typing.chars.slice(0,Math.ceil(progress)).join('');
  if(input.value!==text)input.value=text;
  words.scrollLeft=words.scrollWidth;
  busy=sent&&time<playback.duration;input.disabled=busy;send.disabled=busy||!text.trim();
  const pulse=reduce?0:Math.sin(clamp((time-cycle.sendAt)/.48)*Math.PI);
  send.firstElementChild.style.transform=`translateY(${-3*pulse}px)`;
  send.firstElementChild.style.opacity=String(1-.6*pulse);
}

// 每侧上下翅是一张固定轮廓，展翅只改变它绕身体转动后的可见宽度。
function makeButterflyWing(r,side){
  const path=new Path2D(),x=v=>side*v*r;
  path.moveTo(x(.04),-.22*r);
  path.bezierCurveTo(x(.38),-.92*r,x(1.12),-1.08*r,x(1),-.35*r);
  path.bezierCurveTo(x(.96),-.04*r,x(.61),.06*r,x(.4),.08*r);
  path.bezierCurveTo(x(.98),.18*r,x(.76),.94*r,x(.34),.66*r);
  path.bezierCurveTo(x(.14),.54*r,x(.09),.29*r,x(.04),.12*r);
  path.closePath();return path;
}

// 造型保持固定轮廓，只旋转与等比缩放。
function makeShape(kind,r){
  const path=new Path2D();
  if(kind==='heart'){
    path.moveTo(0,-.46*r);
    path.bezierCurveTo(-.46*r,-1.12*r,-1.14*r,-.64*r,-.86*r,-.06*r);
    path.bezierCurveTo(-.69*r,.3*r,-.22*r,.65*r,0,.9*r);
    path.bezierCurveTo(.22*r,.65*r,.69*r,.3*r,.86*r,-.06*r);
    path.bezierCurveTo(1.14*r,-.64*r,.46*r,-1.12*r,0,-.46*r);
  }else if(kind==='flower'){
    // 四瓣圆润小花，花瓣在中心轻轻收腰。
    path.moveTo(0,-.34*r);
    path.bezierCurveTo(.28*r,-1.28*r,1.28*r,-.28*r,.34*r,0);
    path.bezierCurveTo(1.28*r,.28*r,.28*r,1.28*r,0,.34*r);
    path.bezierCurveTo(-.28*r,1.28*r,-1.28*r,.28*r,-.34*r,0);
    path.bezierCurveTo(-1.28*r,-.28*r,-.28*r,-1.28*r,0,-.34*r);
  }else if(kind==='butterfly'){
    for(const side of [-1,1])path.addPath(makeButterflyWing(r,side));
    path.moveTo(.1*r,0);path.ellipse(0,0,.1*r,.53*r,0,0,Math.PI*2);path.closePath();
    return path;
  }else if(kind==='note'||kind==='notes'){
    // 实心符头、细符杆；直接画轮廓，避免依赖字体中的音乐字形。
    const head=(x,y)=>{
      path.moveTo((x+.36*Math.cos(-.3))*r,(y+.36*Math.sin(-.3))*r);
      path.ellipse(x*r,y*r,.36*r,.24*r,-.3,0,Math.PI*2);path.closePath();
    };
    if(kind==='note'){
      head(-.25,.63);path.rect(.02*r,-.94*r,.15*r,1.55*r);
      path.moveTo(.17*r,-.94*r);
      path.bezierCurveTo(.25*r,-.64*r,.9*r,-.56*r,.58*r,-.13*r);
      path.bezierCurveTo(.6*r,-.48*r,.23*r,-.43*r,.17*r,-.55*r);
      path.closePath();
    }else{
      head(-.54,.69);head(.49,.45);
      path.rect(-.27*r,-.62*r,.15*r,1.31*r);path.rect(.76*r,-.9*r,.15*r,1.35*r);
      path.moveTo(-.27*r,-.62*r);path.lineTo(.91*r,-.94*r);
      path.lineTo(.91*r,-.67*r);path.lineTo(-.27*r,-.35*r);path.closePath();
    }
    return path;
  }else if(kind==='moon'){
    path.moveTo(.48*r,-.96*r);
    path.bezierCurveTo(-.73*r,-1.06*r,-1.32*r,.13*r,-.62*r,.87*r);
    path.bezierCurveTo(-.13*r,1.4*r,.79*r,1.04*r,1.03*r,.38*r);
    path.bezierCurveTo(.33*r,.91*r,-.45*r,.27*r,-.33*r,-.34*r);
    path.bezierCurveTo(-.25*r,-.67*r,.08*r,-.89*r,.48*r,-.96*r);
  }else if(kind==='spark'){
    path.moveTo(0,-r);
    path.bezierCurveTo(.12*r,-.18*r,.18*r,-.12*r,.8*r,0);
    path.bezierCurveTo(.18*r,.12*r,.12*r,.18*r,0,r);
    path.bezierCurveTo(-.12*r,.18*r,-.18*r,.12*r,-.8*r,0);
    path.bezierCurveTo(-.18*r,-.12*r,-.12*r,-.18*r,0,-r);
  }else if(kind==='diamond'){
    path.moveTo(0,-r);path.lineTo(r*.62,0);path.lineTo(0,r);path.lineTo(-r*.62,0);
  }else if(kind==='cross'){
    for(const [i,[x,y]] of [[-.16,-1],[.16,-1],[.16,-.16],[1,-.16],[1,.16],[.16,.16],[.16,1],[-.16,1],[-.16,.16],[-1,.16],[-1,-.16],[-.16,-.16]].entries()){
      if(i===0)path.moveTo(x*r,y*r);else path.lineTo(x*r,y*r);
    }
  }else{
    for(let i=0;i<10;i++){
      const a=-Math.PI/2+i*Math.PI/5,rr=i%2?r*.43:r;
      const x=Math.cos(a)*rr,y=Math.sin(a)*rr;
      if(i===0)path.moveTo(x,y);else path.lineTo(x,y);
    }
  }
  path.closePath();return path;
}

function createParticle(x,y,index,start){
  const kinds=['spark','star','moon','diamond','heart','note','star','butterfly','moon','spark','flower','star',
    'moon','notes','spark','cross','star','heart','moon','butterfly','note','flower','star','spark'];
  const kind=kinds[index%kinds.length],r=['flower','butterfly','heart','note','notes'].includes(kind)?random(8.4,10.5):kind==='moon'?random(7.7,9.8):random(6.3,9.1);
  const outline=kind==='heart'?index%2===0:(['star','moon','diamond','flower'].includes(kind)&&index%3!==0);
  // 快、中、慢三组交错分配，速度、深度与造型相互独立。
  const band=(index*37)%10;
  const speed=(band<3?random(240,312):band<7?random(176,228):random(116,156))*FLIGHT_RATE;
  // 三层分别拉开尺寸、透明度和终点，物品不会挤在同一张平面上。
  const layerSlot=(index*3)%7,layer=layerSlot<2?0:layerSlot<5?1:2;
  const depths=[{scale:[.94,1.04],depth:[.9,1.5],light:1},
    {scale:[.79,.9],depth:[1.7,2.5],light:.88},
    {scale:[.65,.75],depth:[2.8,3.8],light:.7}],depth=depths[layer];
  const endX=random(W*.72,W*1.16),endY=random(-H*.12,H*(.13+layer*.09));
  const p={type:'symbol',x,y,kind,r,outline,path:makeShape(kind,r),
    start,speed,revealDuration:1.4/TRANSFORM_RATE,hasTrail:index%5===0,
    layer,luminosity:depth.light,
    endX:Math.max(x+95,endX),endY,
    gust:random(3,6)*(1-layer*.17),wave:random(1,2),
    depthEnd:random(...depth.depth),nearScale:random(...depth.scale),
    phase:random(0,Math.PI*2),spin:random(-.9,.9),
    material:['white','silver','gold','white','silver','gold','white'][index%7]};
  if(kind==='butterfly')p.wings=[makeButterflyWing(r,-1),makeButterflyWing(r,1)];
  // 按画面中的路径长度分配时间，消除透视投影造成的前快后慢。
  p.flight=buildFlight(p);
  p.duration=p.flight.at(-1).distance/p.speed;
  p.flashAt=p.revealDuration*.5+p.duration*random(.12,.25);p.flashGap=p.duration*random(.23,.37);
  return p;
}

function flightEnd(p){
  if(p.settle)return p.duration;
  const end=p.duration+(p.revealDuration||0)*.5;
  if(!p.kite)return end;
  const {brakeAt,releaseAt,departSpeed}=p.kite;
  return releaseAt+.3+(end-brakeAt-.3)/departSpeed;
}

function chooseKites(burst){
  const pool=burst.slice(),selected=[];
  const count=Math.min(burst.length,Math.floor(random(1,4)));
  for(let i=0;i<count;i++){
    // 全部远近层均可被抽中，不固定造型、颜色或前后位置，也不重复选取。
    selected.push(pool.splice(Math.floor(Math.random()*pool.length),1)[0]);
  }
  const lastOther=Math.max(0,...pool.map(p=>p.start+flightEnd(p)+(p.hasTrail?TRAIL_FADE:0)));
  for(const p of selected){
    p.duration=Math.max(2.4,p.duration);p.speed=p.flight.at(-1).distance/p.duration;
    const brakeAt=Math.max(p.revealDuration,p.revealDuration*.5+p.duration*random(.4,.64)-.3);
    p.hasTrail=true;p.kite={brakeAt,releaseAt:0,departSpeed:.65,recoil:random(2.8,4.2)*p.nearScale};
  }
  // 等所有普通物品及残留光丝退场，再给被勾住的物品至少 3 秒独立尾声。
  const soloAt=Math.max(lastOther,...selected.map(p=>p.start+p.kite.brakeAt+.6));
  // 同一阵风从左下扫向右上，按被牵住的位置先后触达。
  const held=selected.map(p=>({p,q:position(p,p.kite.brakeAt-.4)}));
  const fronts=held.map(({q})=>q.x-q.y),low=Math.min(...fronts),span=Math.max(1,Math.max(...fronts)-low);
  held.forEach(({p,q})=>{
    const arrival=(q.x-q.y-low)/span;
    p.kite.windAt=soloAt+1.7+arrival*.45-p.start;
    p.kite.releaseAt=p.kite.windAt+1.3+random(0,.12);
    p.kite.windPush=random(11,16)*(.75+.25*p.nearScale);
    p.kite.windSway=random(4,6)*(.8+.2*p.nearScale);
  });
  return selected;
}

function prepareBurst(at){
  water=reduce?null:{start:at};if(water)measureWater();
  const rect=stage.getBoundingClientRect(),scale=W/rect.width,bounds=words.getBoundingClientRect();
  const css=getComputedStyle(words),font=`400 ${parseFloat(css.fontSize)*scale}px ${css.fontFamily}`;
  const left=(bounds.left-rect.left)*scale,right=(bounds.right-rect.left)*scale;
  const centerY=(bounds.y+bounds.height/2-rect.top)*scale;
  const center=water?waterCenter():{x:(left+right)/2,y:centerY};
  const arrival=(x,y)=>at+WATER_LEAD+Math.hypot(x-center.x,y-center.y)/WATER_SPEED;
  cycle.origin={left,right,centerY};
  const spans=[...words.querySelectorAll('span')];
  spans.forEach((s,i)=>{
    const b=s.getBoundingClientRect();
    if(!s.textContent.trim())return;
    const hidden=b.right<=bounds.left||b.left>=bounds.right;
    const x=(Math.max(bounds.left,Math.min(bounds.right,b.x+b.width/2))-rect.left)*scale;
    const y=(b.y+b.height/2-rect.top)*scale;
    // 涟漪中心的文字先模糊，再按距波心的距离向左右散开。
    particles.push({type:'text',sourceIndex:i,hidden,ch:s.textContent,x,y,font,start:reduce?at:arrival(x,y),duration:reduce?.5:2.05/TRANSFORM_RATE});
  });
  let finishAt=at+4.5;
  if(!reduce){
    const burst=[];
    // 物品与文字共用向外扩散的时序，显形后继续沿各自的飞行轨迹离开。
    for(let i=0;i<BURST_COUNT;i++){
      const x=random(left+9,right-9),y=centerY+random(-6,6);
      burst.push(createParticle(x,y,i,arrival(x,y)+random(.12,.38)));
    }
    if(theme==='ink')arrangeStarfield(burst);else chooseKites(burst);
    particles.push(...burst);
    finishAt=Math.max(finishAt,...burst.map(p=>p.start+flightEnd(p)+(p.hasTrail?TRAIL_FADE:0)));
  }
  return finishAt;
}

function release(){
  if(busy||!text.trim()||composing||!playback.ready)return;
  const value=text;editing=false;buildCycle(value,true);playback.playing=true;
  playback.stamp=null;paint();updateControls();
}

function flightPoint(p,travel){
  if(p.settle){
    const t=travel,v=1-t,{c1,c2}=p.settle;
    return {x:v*v*v*p.x+3*v*v*t*c1.x+3*v*t*t*c2.x+t*t*t*p.endX,
      y:v*v*v*p.y+3*v*v*t*c1.y+3*v*t*t*c2.y+t*t*t*p.endY,perspective:1};
  }
  const t=travel,perspective=1/(1+p.depthEnd*t);
  const dx=p.endX-p.x,dy=p.endY-p.y,length=Math.hypot(dx,dy);
  // 气流沿右上方向持续输送，仅叠加细微横向起伏，不绕弯或盘旋。
  const envelope=Math.sin(Math.PI*t)**2;
  const sway=(Math.sin(t*Math.PI*2)*p.gust+
    Math.sin(t*Math.PI*4+p.phase)*p.wave)*envelope;
  return {x:p.x+dx*t-sway*dy/length,
    y:p.y+dy*t+sway*dx/length,perspective};
}

function buildFlight(p){
  const points=[];let distance=0;
  for(let i=0;i<=128;i++){
    const point=flightPoint(p,i/128),previous=points.at(-1);
    if(previous)distance+=Math.hypot(point.x-previous.x,point.y-previous.y);
    points.push({...point,distance});
  }
  return points;
}

function position(p,age){
  const u=clamp(age/p.duration),points=p.flight;
  const distance=u*points.at(-1).distance;
  let lo=0,hi=points.length-1;
  while(hi-lo>1){const mid=(lo+hi)>>1;if(points[mid].distance<distance)lo=mid;else hi=mid;}
  const a=points[lo],b=points[hi],t=(distance-a.distance)/(b.distance-a.distance||1);
  const perspective=a.perspective+(b.perspective-a.perspective)*t;
  return {x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,
    scale:p.nearScale*Math.pow(perspective,.7),
    alpha:p.luminosity*(.68+.32*Math.sqrt(perspective))*(1-smooth((u-.78)/.22))};
}

function catchRecoil(p,age){
  if(!p.kite)return 0;
  const t=age-p.kite.brakeAt-.6;
  if(t<=0||age>=p.kite.releaseAt)return 0;
  // 沿原轨迹轻轻退回，再逐渐收住；起止位移和速度均连续。
  const pulse=t=>t>0?Math.exp(-1.35*t)*(1-Math.cos(7.5*t)):0;
  const settle=pulse(t);
  return -p.kite.recoil*settle*smooth((p.kite.releaseAt-age)/.45);
}

function kiteWind(p,age){
  if(!p.kite)return 0;
  const {windAt,releaseAt}=p.kite;
  return smooth((age-windAt)/(releaseAt-windAt))*(1-smooth((age-releaseAt)/1));
}

function flightAgeAt(p,age){
  // 风先沿原路把物品和光丝轻轻带紧，松开后接上飞行，不突然跳变。
  const windAdvance=p.kite?kiteWind(p,age)*p.kite.windPush/p.speed:0;
  if(p.kite&&age>p.kite.brakeAt){
    const {brakeAt,releaseAt,departSpeed}=p.kite;
    // 半秒多的减速、牵住、加速连续衔接，避免突然停住或跳到前方。
    if(age<brakeAt+.6){const u=(age-brakeAt)/.6;age=brakeAt+.6*(u-u*u*.5);}
    else if(age<releaseAt)age=brakeAt+.3+catchRecoil(p,age)/p.speed;
    else if(age<releaseAt+.6){const u=(age-releaseAt)/.6;age=brakeAt+.3+departSpeed*.3*u*u;}
    else age=brakeAt+.3+departSpeed*(age-releaseAt-.3);
  }
  // 显形时由风渐渐带起，速度平滑接上各自的匀速飞行，没有停顿或突然起飞。
  if(age>=p.revealDuration)return age-p.revealDuration*.5+windAdvance;
  const t=clamp(age/p.revealDuration);
  return p.revealDuration*(t*t*t-.5*t*t*t*t)+windAdvance;
}

function windSway(p,age){
  if(!p.kite)return {x:0,y:0,turn:0};
  const strength=kiteWind(p,age),phase=(age-p.kite.windAt)*Math.PI*2/1.15;
  const wave=Math.sin(phase)*strength,offset=wave*p.kite.windSway;
  const dx=p.endX-p.x,dy=p.endY-p.y,length=Math.hypot(dx,dy);
  return {x:-dy/length*offset,y:dx/length*offset,turn:wave*.09};
}

function poseAt(p,age){
  if(p.settle){
    const t=clamp(age/p.duration),travel=t*t*t*(10+t*(-15+6*t));
    const q=flightPoint(p,travel);
    return {...q,scale:p.nearScale+(p.settle.scale-p.nearScale)*smooth(t),alpha:p.luminosity};
  }
  const q=position(p,flightAgeAt(p,age)),sway=windSway(p,age);
  return {...q,x:q.x+sway.x,y:q.y+sway.y};
}

function flashPulse(age,start){
  const t=age-start;
  if(t<0||t>.27)return 0;
  if(t<.045)return smooth(t/.045);
  if(t<.085)return 1;
  return 1-smooth((t-.085)/.185);
}

// 缓存物品与星空的光芒图，避免每枚每帧重复创建渐变。
const glintTextures = new Map();
function glintTexture(material){
  const key=material==='star'?'star':material==='gold'?'gold':'white';
  if(glintTextures.has(key))return glintTextures.get(key);
  const texture=document.createElement('canvas');texture.width=texture.height=160;
  const g=texture.getContext('2d');g.setTransform(2,0,0,2,80,80);
  const tint=key==='gold'?'255,238,189':'255,255,255';
  // 闪光独立叠在纯色物体上：白亮核、尖细星芒与紧贴亮核的小光晕。
  const halo=g.createRadialGradient(0,0,0,0,0,6.5);
  halo.addColorStop(0,'#ffffff');halo.addColorStop(.16,`rgba(${tint},.95)`);
  halo.addColorStop(.42,`rgba(${tint},.3)`);halo.addColorStop(1,`rgba(${tint},0)`);
  g.fillStyle=halo;g.fillRect(-6.5,-6.5,13,13);
  const reach=key==='star'?22:12*2.6,halfWidth=key==='star'?.38:1.3;
  const rays=key==='star'?[[0,reach,1],[Math.PI/2,reach,1]]:
    [[.1,reach,1],[Math.PI/2+.1,reach*.75,1],[Math.PI/4+.1,reach*.43,.38],[Math.PI*.75+.1,reach*.43,.38]];
  for(const [angle,length,gain] of rays){
    g.save();g.rotate(angle);g.globalAlpha*=gain;
    const ray=g.createLinearGradient(-length,0,length,0);
    ray.addColorStop(0,`rgba(${tint},0)`);ray.addColorStop(.25,`rgba(${tint},.5)`);
    ray.addColorStop(.45,'#ffffff');ray.addColorStop(.55,'#ffffff');
    ray.addColorStop(.75,`rgba(${tint},.5)`);ray.addColorStop(1,`rgba(${tint},0)`);
    // 尖端收至零宽，亮核附近保留可见宽度，缩小画面后仍然读得出闪光。
    g.fillStyle=ray;g.beginPath();g.moveTo(-length,0);
    g.quadraticCurveTo(-2,-halfWidth*.27,0,-halfWidth);g.quadraticCurveTo(2,-halfWidth*.27,length,0);
    g.quadraticCurveTo(2,halfWidth*.27,0,halfWidth);g.quadraticCurveTo(-2,halfWidth*.27,-length,0);g.fill();g.restore();
  }
  g.fillStyle='#ffffff';g.beginPath();g.arc(0,0,1.2,0,Math.PI*2);g.fill();
  glintTextures.set(key,texture);return texture;
}

function glint(x,y,energy,r,material){
  if(energy<.015)return;
  const texture=glintTexture(material),size=80*(r/12)*(.68+.32*energy);
  ctx.save();ctx.globalAlpha*=energy;ctx.globalCompositeOperation='screen';
  ctx.drawImage(texture,x-size/2,y-size/2,size,size);ctx.restore();
}

function butterflySpread(age,phase,side){
  if(reduce)return 1;
  const beat=age*(2.1+.25*Math.sin(phase))*Math.PI*2+phase+side*.07;
  return .24+.76*(.5+.5*Math.sin(beat));
}

function drawButterfly(p,age,alpha,depthScale){
  const {r}=p,material=MATERIALS[p.material];
  for(let i=0;i<2;i++){
    const side=i===0?-1:1,spread=butterflySpread(age,p.phase,side);
    ctx.save();ctx.scale(spread,1);
    ctx.globalAlpha=alpha*(.82+.18*spread);ctx.fillStyle=material.color;ctx.fill(p.wings[i]);
    ctx.globalAlpha=alpha*.8;ctx.strokeStyle=material.light;
    ctx.lineWidth=Math.min(1.1,.55/Math.max(.5,depthScale));ctx.stroke(p.wings[i]);ctx.restore();
  }
  // 身体和触角不随翅膀压缩，双翼从同一条身体中轴开合。
  ctx.globalAlpha=alpha;ctx.fillStyle=material.light;
  ctx.beginPath();ctx.ellipse(0,0,r*.1,r*.53,0,0,Math.PI*2);ctx.fill();
  ctx.lineWidth=.65;ctx.strokeStyle=material.light;ctx.beginPath();
  for(const side of [-1,1]){
    ctx.moveTo(0,-r*.42);ctx.quadraticCurveTo(side*r*.09,-r*.64,side*r*.24,-r*.7);
  }
  ctx.stroke();
}

function drawSymbol(p,age,alpha,depthScale=1){
  const material=MATERIALS[p.material],r=p.r;
  const rotationAge=p.settle?Math.min(age,p.duration):p.kite?flightAgeAt(p,age):age;
  const tilt=p.spin*rotationAge*.06+Math.sin(rotationAge*.45+p.phase)*.12+kiteWind(p,age)*.12+windSway(p,age).turn;
  const shimmer=Math.pow(.5+.5*Math.sin(age*1.65+p.phase),4);
  const stroke=Math.min(r*.28,Math.max(1.9,.85/depthScale));
  ctx.save();ctx.rotate(tilt);ctx.lineJoin='round';ctx.lineCap='round';
  if(p.kind==='butterfly'){
    drawButterfly(p,age,alpha,depthScale);
  }else{
  // 明亮轮廓直接描绘；移除每枚每帧的模糊运算，避免密集起飞时卡顿。
  // 纯色本体与清晰轮廓；不拉伸、不压扁，内外形状始终一致。
  ctx.shadowBlur=0;ctx.globalAlpha=alpha*(p.outline?1:.9);
  ctx.fillStyle=material.color;ctx.strokeStyle=material.color;ctx.lineWidth=stroke;
  if(p.outline)ctx.stroke(p.path);else ctx.fill(p.path);
  // 空心物品在粗亮边中再留一道亮芯；实心物品用薄亮边增加透亮感。
  ctx.save();ctx.globalCompositeOperation='screen';ctx.globalAlpha=alpha*(.5+shimmer*.22);
  ctx.strokeStyle=material.light;ctx.lineWidth=p.outline?stroke*.4:.65;ctx.stroke(p.path);
  // 借鉴金叶化蝶：短亮纹贴着物体轮廓移动，不覆盖成灰暗的渐变面。
  if(depthScale>.55){
    ctx.globalAlpha=alpha*(.5+.4*shimmer);ctx.lineWidth=p.outline?stroke*.65:.95;
    ctx.setLineDash([r*.65,r*6]);ctx.lineDashOffset=-age*r*.65-p.phase*r;
    ctx.stroke(p.path);
  }
  ctx.restore();
  }
  ctx.restore();
  const shine=Math.max(flashPulse(age,p.flashAt),flashPulse(age,p.flashAt+p.flashGap));
  const tip=p.kind==='moon'?{x:.48*r,y:-.96*r}:{x:0,y:-r};
  ctx.save();ctx.globalAlpha=alpha;
  glint(tip.x*Math.cos(tilt)-tip.y*Math.sin(tilt),tip.x*Math.sin(tilt)+tip.y*Math.cos(tilt),shine,r,p.material);
  ctx.restore();
}

// 参考动作库“自身轨迹光丝”：回看本体的真实历史位置，不另造飘带。
function motionRibbon(p,age,current){
  if(reduce||!p.hasTrail||age<=.12)return [];
  const depth=Math.sqrt(current.scale),progress=flightAgeAt(p,age);
  // 停留中的物品按已走过的路程取样，避免停留时间挤成折线或松开时整条变形。
  const history=p.kite?progress:age-.12;
  const duration=Math.min(17.28,1872*depth/p.speed,history);
  const gain=smooth((age-.12)/.3),points=[],sway=windSway(p,age);
  const segments=24;
  for(let i=0;i<=segments;i++){
    const lag=duration*i/segments;
    const q=i===0?current:p.kite?position(p,progress-lag):poseAt(p,age-lag);
    // 受风时光丝跟随头部柔和弯动，尾端留在原处；风弱后连续收回。
    const follow=i===0?0:(1-i/segments)**2;
    points.push({x:q.x+sway.x*follow,y:q.y+sway.y*follow,alpha:gain*(1-i/segments)**1.2});
  }
  return points;
}

function trailState(p,age){
  const end=flightEnd(p);
  // 本体到达终点后，保留最后走过的光丝，缓慢淡去，不继续编造路径。
  const sampleAge=Math.min(age,end),current=poseAt(p,sampleAge);
  const fade=1-smooth((age-(end-.6))/(TRAIL_FADE+.6));
  const alpha=smooth(age/p.revealDuration)*p.luminosity*
    (.68+.32*Math.sqrt(current.scale/p.nearScale))*fade;
  return {sampleAge,current,alpha};
}

function drawTrail(p,age,alpha,current){
  const points=motionRibbon(p,age,current);if(points.length<2)return;
  const depth=Math.sqrt(current.scale);
  ctx.save();ctx.globalCompositeOperation='screen';ctx.lineCap='round';
  ctx.strokeStyle=MATERIALS[p.material].trail;
  // 淡外光与细亮芯均直接描线，无实时模糊；远处随物体一起变细、变淡。
  for(let i=1;i<points.length;i++){
    const a=points[i-1],b=points[i];
    for(const [width,gain] of [[2.2,.045],[.7,.46]]){
      ctx.globalAlpha=alpha*b.alpha*gain;ctx.lineWidth=width*depth;
      ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();
    }
  }
  ctx.restore();
}

function measureWater(){
  const stageRect=stage.getBoundingClientRect(),box=field.getBoundingClientRect(),scale=W/stageRect.width;
  Object.assign(water,{x:(box.left-stageRect.left)*scale,y:(box.top-stageRect.top)*scale,
    width:box.width*scale,height:box.height*scale});
}

function waterCenter(){return {x:water.x+water.width*.5,y:water.y+water.height*.5};}

function waterWaves(time){
  if(!water||reduce)return [];
  const age=(time-water.start)*TRANSFORM_RATE;
  if(age<=0||age>=4.4)return [];
  // 一次扰动形成向外传播、逐渐展宽的波包；没有等间隔重复生成的圆圈。
  const radius=age*WATER_SPEED/TRANSFORM_RATE;
  const gain=smooth(age/.22)*Math.exp(-age*.38)/Math.sqrt(1+radius/75)*
    (1-smooth((age-3.1)/1.3));
  return [{...waterCenter(),
    radius,width:12+age*3.6,frequency:Math.PI*2/(27+age*2.8),gain}];
}

function waterSlope(x,y,waves){
  let dx=0,dy=0;
  for(const wave of waves){
    const vx=x-wave.x,vy=y-wave.y,distance=Math.hypot(vx,vy);
    if(distance<.001)continue;
    const d=distance-wave.radius,z=d/wave.width;
    if(Math.abs(z)>3.5)continue;
    const envelope=Math.exp(-z*z),phase=d*wave.frequency;
    // 高度的径向变化同时决定折射和明暗，使两者确实来自同一片水。
    const slope=1.65*wave.gain*envelope*(-wave.frequency*Math.sin(phase)-
      2*d/(wave.width*wave.width)*Math.cos(phase));
    // 中心与胶囊边缘平滑收住，避免圆心刺点或边沿突然截断。
    const boundary=smooth(Math.min(x-water.x,water.x+water.width-x,
      y-water.y,water.y+water.height-y)/5);
    const strength=slope*smooth(distance/6)*boundary;
    dx+=vx/distance*strength;dy+=vy/distance*strength;
  }
  return {x:dx,y:dy};
}

let waterLight=null;
function drawWater(waves){
  if(!waves.length)return;
  // 只在胶囊大小的低分辨率透明层上计算柔光，不扫描整幅画面。
  const width=Math.ceil(water.width*.75),height=Math.ceil(water.height*.75);
  if(!waterLight||waterLight.width!==width||waterLight.height!==height){
    const surface=document.createElement('canvas');surface.width=width;surface.height=height;
    const context=surface.getContext('2d');
    waterLight={surface,context,width,height,pixels:context.createImageData(width,height),
      dx:new Float32Array(width*height),dy:new Float32Array(width*height)};
  }
  const {pixels,context,surface}=waterLight,data=pixels.data;
  for(let row=0;row<height;row++){
    const y=water.y+(row+.5)*water.height/height;
    for(let col=0;col<width;col++){
      const x=water.x+(col+.5)*water.width/width,slope=waterSlope(x,y,waves);
      // 左上方柔光照到朝向不同的波面：宽柔的亮暗对，不描画完整轮廓。
      waterLight.dx[row*width+col]=slope.x*5.5;waterLight.dy[row*width+col]=slope.y*5.5;
      const light=slope.x*.55-slope.y*.83;
      const i=(row*width+col)*4,bright=light>0;
      data[i]=bright?239:0;data[i+1]=bright?246:0;data[i+2]=bright?255:0;
      data[i+3]=Math.round(255*Math.min(.16,Math.abs(light)*(bright?.72:.24)));
    }
  }
  context.putImageData(pixels,0,0);
  ctx.save();ctx.beginPath();ctx.roundRect(water.x+1,water.y+1,water.width-2,water.height-2,(water.height-2)/2);ctx.clip();
  ctx.imageSmoothingEnabled=true;ctx.drawImage(surface,water.x,water.y,water.width,water.height);ctx.restore();
}

function waterRefraction(x,y,waves){
  const slope=waterSlope(x,y,waves);
  return {x:slope.x*5.5,y:slope.y*5.5};
}

function waterGlyph(p){
  const ratio=Math.min(2,canvas.width/W),key=`${p.font}|${ratio}`;
  if(p.waterGlyph&&p.waterGlyph.key===key)return p.waterGlyph;
  const size=parseFloat(p.font.split(' ')[1]),surface=document.createElement('canvas');
  const g=surface.getContext('2d');g.font=p.font;
  const width=Math.ceil(g.measureText(p.ch).width+8),height=Math.ceil(size*1.6+8);
  surface.width=Math.ceil(width*ratio);surface.height=Math.ceil(height*ratio);
  g.setTransform(surface.width/width,0,0,surface.height/height,0,0);
  g.font=p.font;g.fillStyle='#f9f3fb';g.textAlign='center';g.textBaseline='middle';
  g.fillText(p.ch,width/2,height/2);
  const refracted=document.createElement('canvas');refracted.width=surface.width;refracted.height=surface.height;
  const layer=refracted.getContext('2d'),pixels=layer.createImageData(surface.width,surface.height);
  for(let i=0;i<pixels.data.length;i+=4){pixels.data[i]=249;pixels.data[i+1]=243;pixels.data[i+2]=251;}
  p.waterGlyph={key,surface,refracted,layer,width,height,pixels,
    original:g.getImageData(0,0,surface.width,surface.height).data};return p.waterGlyph;
}

function drawRefractedGlyph(p,waves){
  const {surface,refracted,layer,width,height,pixels,original}=waterGlyph(p);
  const left=p.x-width/2,top=p.y-height/2,pw=surface.width,ph=surface.height;
  // 波前未到或已离开的字直接画原字，不反复重采样平静区域。
  const affected=waves.some(w=>{
    const near=Math.hypot(Math.max(0,Math.abs(w.x-p.x)-width/2),Math.max(0,Math.abs(w.y-p.y)-height/2));
    const far=Math.hypot(Math.abs(w.x-p.x)+width/2,Math.abs(w.y-p.y)+height/2);
    return near<w.radius+w.width*2.8&&far>w.radius-w.width*2.8;
  });
  if(!affected||!waterLight){ctx.fillText(p.ch,p.x,p.y);return;}
  const fw=waterLight.width,fh=waterLight.height,rx=pw/width,ry=ph/height;
  const sx=fw/water.width,sy=fh/water.height,fx=waterLight.dx,fy=waterLight.dy;
  const output=pixels.data;
  // 重采样缓存字形的透明度，连续扭动笔画。只读字形一次，没有切片接缝。
  for(let row=0;row<ph;row++){
    const y=top+(row+.5)/ry,gy=Math.max(0,Math.min(fh-1,(y-water.y)*sy-.5));
    const y0=Math.floor(gy),y1=Math.min(fh-1,y0+1),v=gy-y0;
    for(let col=0;col<pw;col++){
      const x=left+(col+.5)/rx,gx=Math.max(0,Math.min(fw-1,(x-water.x)*sx-.5));
      const x0=Math.floor(gx),x1=Math.min(fw-1,x0+1),u=gx-x0;
      const a=y0*fw+x0,b=y0*fw+x1,c=y1*fw+x0,d=y1*fw+x1;
      const dx=((fx[a]*(1-u)+fx[b]*u)*(1-v)+(fx[c]*(1-u)+fx[d]*u)*v)*rx;
      const dy=((fy[a]*(1-u)+fy[b]*u)*(1-v)+(fy[c]*(1-u)+fy[d]*u)*v)*ry;
      const px=col-dx,py=row-dy,index=(row*pw+col)*4+3;
      if(px<0||py<0||px>=pw-1||py>=ph-1){output[index]=0;continue;}
      const ix=Math.floor(px),iy=Math.floor(py),tx=px-ix,ty=py-iy;
      const o=(iy*pw+ix)*4+3,n=o+pw*4;
      output[index]=(original[o]*(1-tx)+original[o+4]*tx)*(1-ty)+
        (original[n]*(1-tx)+original[n+4]*tx)*ty;
    }
  }
  layer.putImageData(pixels,0,0);
  // 折射先合成完整字形，随后只对整字应用一次模糊。
  ctx.drawImage(refracted,left,top,width,height);
}

function drawDepartingText(p,age,waves=[]){
  const u=clamp(age/p.duration),blur=reduce?0:4*smooth(u/.8);
  ctx.save();
  ctx.globalAlpha=1-smooth(u);ctx.font=p.font;ctx.fillStyle='#f9f3fb';
  ctx.textAlign='center';ctx.textBaseline='middle';
  ctx.filter=blur>0?`blur(${blur*canvas.width/W}px)`:'none';
  // 先折射，再从波心向外逐字模糊；比波纹经过保留一小段清晰时间。
  if(waves.length){drawRefractedGlyph(p,waves);}
  else{
    const refraction=waterRefraction(p.x,p.y,waves);
    ctx.fillText(p.ch,p.x+refraction.x,p.y+refraction.y);
  }
  ctx.restore();
}

// 星河只以点的疏密形成流向；同一轮固定落点，不画星座连线。
function galaxyPoint(){
  const gaussian=()=>Math.sqrt(-2*Math.log(Math.max(.0001,Math.random())))*Math.cos(random(0,Math.PI*2));
  for(let attempt=0;attempt<40;attempt++){
    const t=Math.random(),inBand=Math.random()<.86;
    const x=inBand?W*(.06+.88*t+gaussian()*.035):random(W*.035,W*.965);
    const y=inBand?H*(.57-.4*t+.045*Math.sin(t*Math.PI*1.6)+gaussian()*(.037+.04*Math.sin(t*Math.PI))):random(H*.055,H*.62);
    if(x>W*.03&&x<W*.97&&y>H*.045&&y<H*.63)return {x,y,inBand};
  }
  return {x:random(W*.08,W*.92),y:random(H*.1,H*.55)};
}

function arrangeStarfield(burst){
  const targets=[];
  for(let i=0;i<burst.length;i++){
    let point;
    for(let attempt=0;attempt<60;attempt++){
      point=galaxyPoint();
      if(targets.every(q=>Math.hypot(q.x-point.x,q.y-point.y)>13))break;
    }
    targets.push(point);
  }
  burst.forEach((p,i)=>{
    const target=targets[i],dx=target.x-p.x,dy=target.y-p.y,length=Math.hypot(dx,dy)||1;
    p.endX=target.x;p.endY=target.y;
    p.settle={accent:i%6===0,period:random(3.6,6),offset:random(0,6),scale:random(.25,.48),radius:random(.85,1.65),
      brightness:random(.8,1),
      c1:{x:p.x+dx*.3+random(-16,20),y:p.y+dy*.4},
      c2:{x:target.x-dx/length*random(24,42),y:target.y-dy/length*random(24,42)}};
    p.duration=random(6.8,9.8)/FLIGHT_RATE;
    p.hasTrail=i%5===0;p.flashAt=p.duration*.46;p.flashGap=p.duration*.38;
    p.flight=buildFlight(p);p.speed=p.flight.at(-1).distance/p.duration;
  });
  cycle.symbols=burst;
  cycle.firstSettle=Math.min(...burst.map(p=>p.start+p.duration+.65));
  cycle.settledAt=Math.max(...burst.map(p=>p.start+p.duration+2.5));
  // 远处的大量小星点衬出星河，近处只留少量亮点，不增加飞行物品负担。
  cycle.dust=[];
  for(let i=0;i<1440;i++){
    const point=galaxyPoint(),near=i%8===0;
    cycle.dust.push({...point,r:near?random(.85,1.2):random(.34,.74),
      alpha:(near?random(.65,.9):random(.34,.65))*(point.inBand?1:.65),phase:random(0,Math.PI*2),
      born:cycle.firstSettle+random(-1,4.6),rise:random(1.8,3.4),rate:random(.22,.62),
      sparkle:i%48===0?{period:random(4,7),offset:random(0,7),size:random(7,10)}:null});
  }
}

function starAmount(p,time){return smooth((time-p.start-p.duration-.65)/1.8);}
// 参考花落成蝶的停驻星光：亮核升起、细长十字展开，再缓缓收回。
function starTwinkle(age,period,offset){
  if(reduce||age<=0)return 0;
  const phase=(age+offset)%period;
  return smooth(age/1.2)*smooth(phase/.45)*(1-smooth((phase-.45)/.85));
}
function drawStarfield(){
  if(theme!=='ink'||!cycle.symbols||reduce)return;
  ctx.save();ctx.fillStyle='#f5f7ff';
  for(const p of cycle.dust){
    const appear=smooth((clock-p.born)/p.rise);
    if(appear<=0)continue;
    const shimmer=.84+.11*Math.sin(clock*p.rate+p.phase)+.05*Math.sin(clock*p.rate*1.71+p.phase*2);
    ctx.globalAlpha=appear*p.alpha*shimmer;
    ctx.beginPath();ctx.arc(p.x,p.y,p.r,0,Math.PI*2);ctx.fill();
    if(p.sparkle){
      const flash=starTwinkle(clock-p.born,p.sparkle.period,p.sparkle.offset);
      ctx.globalAlpha=appear;
      glint(p.x,p.y,flash,p.sparkle.size,'star');
    }
  }
  ctx.restore();
}

function drawInkItem(p,age){
  const q=poseAt(p,age),star=starAmount(p,clock),visible=smooth(age/p.revealDuration);
  if(star<.999){
    ctx.save();ctx.translate(q.x,q.y);ctx.scale(q.scale,q.scale);
    drawSymbol(p,Math.min(age,p.duration),visible*q.alpha*(1-star),q.scale);ctx.restore();
  }
  if(star>0){
    const flash=p.settle.accent?starTwinkle(clock-p.start-p.duration-.65,p.settle.period,p.settle.offset):0;
    const shimmer=.86+.14*Math.sin(clock*.8+p.phase),r=p.settle.radius+flash*.65;
    ctx.save();ctx.globalAlpha=star*(shimmer*p.settle.brightness*(1-flash)+flash);ctx.fillStyle='#eef3ff';
    ctx.beginPath();ctx.arc(p.endX,p.endY,r,0,Math.PI*2);ctx.fill();
    ctx.globalAlpha=star;
    if(p.settle.accent)glint(p.endX,p.endY,flash,10+p.settle.radius*2,'star');
    ctx.restore();
  }
}

function paint(){
  clock=playback.time;ctx.clearRect(0,0,W,H);
  if(!cycle)return;
  const quiet=theme==='ink'&&!reduce&&!editing?smooth((clock-cycle.settledAt+2.8)/3.6):0;
  composer.style.opacity=String(1-quiet*.76);
  if(editing)return;
  drawTyping(clock);drawStarfield();
  if(clock<cycle.sendAt)return;
  const waves=waterWaves(clock);drawWater(waves);
  for(const p of particles){
    if(p.type==='text'&&!p.hidden&&clock-p.start<p.duration)drawDepartingText(p,clock-p.start,waves);
  }
  // 光丝先整体画在后面，本体再由远及近绘制，避免近处形状被后方线条穿过。
  for(const p of cycle.drawOrder){
    const age=clock-p.start;
    if(age<0||!p.hasTrail||reduce||age>flightEnd(p)+TRAIL_FADE)continue;
    const trail=trailState(p,age);if(trail.alpha>.005)drawTrail(p,trail.sampleAge,trail.alpha,trail.current);
  }
  for(const p of cycle.drawOrder){
    const age=clock-p.start;if(age<0)continue;
    if(p.settle){drawInkItem(p,age);continue;}
    if(age>flightEnd(p))continue;
    const q=poseAt(p,age),alpha=smooth(age/p.revealDuration)*q.alpha;
    if(alpha<.005)continue;
    ctx.save();ctx.translate(q.x,q.y);ctx.scale(q.scale,q.scale);drawSymbol(p,age,alpha,q.scale);ctx.restore();
  }
}

function makeSoundEvents(){
  const events=[],push=(time,kind,extra={})=>events.push({time,kind,...extra});
  if(!cycle.instant)Array.from(cycle.value).forEach((ch,i)=>{
    if(!/[，。！？、\s]/.test(ch))push(.65+i*TYPE_INTERVAL+.04,'type',{gain:[.25,.22,.24][i%3],pan:-.15+i*.012,pitch:[0,-1,1][i%3]});
  });
  if(reduce)return events;
  // 水声从中心向两边轻轻展开，没有滴答音头，随本轮发送开始和结束。
  push(cycle.sendAt+.03,'ripple',{gain:.28,duration:2.8/TRANSFORM_RATE,pan:0,panTo:-.65,pitch:-3});
  push(cycle.sendAt+.03,'ripple',{gain:.28,duration:2.8/TRANSFORM_RATE,pan:0,panTo:.65,pitch:3});
  push(cycle.sendAt+WATER_LEAD+.2,'wind',{duration:4.1,gain:.16,pan:-.2,panTo:.3});
  // 选取几条光丝作飞行声，依据物品的起点、终点移动，尾音逐渐远去。
  const flights=particles.filter(p=>p.type==='symbol'&&p.hasTrail).sort((a,b)=>a.start-b.start);
  let last=-Infinity,count=0;
  for(const p of flights){
    if(p.start-last<.48||count>=4)continue;
    push(p.start+.18,'flight',{duration:4.4/FLIGHT_RATE,gain:.46,pan:p.x/W*1.6-.8,panTo:Math.max(-.8,Math.min(.8,p.endX/W*1.6-.8)),pitch:[0,7,-5,2][count]});
    last=p.start;count++;
  }
  if(theme==='blue'){
    const held=particles.filter(p=>p.kite).sort((a,b)=>a.start+a.kite.windAt-b.start-b.kite.windAt);
    if(held.length){
      push(held[0].start+held[0].kite.windAt,'wind',{duration:2.5,gain:.14,pan:.1,panTo:.45});
      held.forEach((p,i)=>push(p.start+p.kite.releaseAt,'flight',{duration:3.2/FLIGHT_RATE,gain:.32,pan:.2,panTo:.75,pitch:[0,7,-5][i]}));
    }
  }else{
    // 细碎光点组成连续的声音底色，不为每颗闪光触发一声铃响。
    const start=cycle.firstSettle-.6,end=playback.duration-.15;
    for(let time=start,i=0;time<end-1.8;time+=5.6,i++){
      push(time,'galaxy',{duration:Math.min(8,end-time),gain:.62,pan:i%2? .35:-.35,panTo:i%2?-.25:.25,pitch:i%2?7:0});
    }
  }
  return events.sort((a,b)=>a.time-b.time);
}

function buildCycle(value=DEFAULT_TEXT,instant=false){
  particles=[];busy=false;editing=false;input.disabled=false;words.style.visibility='visible';
  cycle={value,instant,sendAt:instant?.35:.65+Array.from(value).length*TYPE_INTERVAL+1.05};
  setText(value);
  const finish=prepareBurst(cycle.sendAt);
  cycle.drawOrder=particles.filter(p=>p.type==='symbol').sort((a,b)=>b.layer-a.layer||a.start-b.start);
  playback.duration=theme==='ink'&&!reduce?cycle.settledAt+9:finish+1.2;
  playback.time=0;clock=0;playback.stamp=null;
  sound.setEvents(makeSoundEvents());
  prepareTyping(value);paint();updateControls();
}

function clockText(time){const seconds=Math.floor(time);return `${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`;}
function updateControls(){
  const {time,duration,playing,rate}=playback;
  controls.toggle.textContent=playing?'暂停':time>=duration?'重播':'播放';
  controls.toggle.setAttribute('aria-label',`${controls.toggle.textContent}动画`);
  controls.progress.max=duration;controls.progress.value=time;
  controls.progress.style.setProperty('--progress',`${time/duration*100}%`);
  controls.progress.setAttribute('aria-valuetext',`${clockText(time)}，共 ${clockText(duration)}`);
  controls.time.textContent=`${clockText(time)} / ${clockText(duration)}`;
  controls.speed.textContent=`${rate}×`;
  controls.speed.setAttribute('aria-label',`播放速度 ${rate} 倍，点击切换`);
  sound.sync({time,rate,playing:playing&&!editing&&!document.hidden&&!dragging});
}

function updateSoundButton(){
  controls.sound.textContent=sound.enabled?'音效开':'音效关';
  controls.sound.setAttribute('aria-pressed',String(sound.enabled));
  controls.sound.setAttribute('aria-label',sound.enabled?'关闭音效':'开启音效');
}
controls.sound.addEventListener('click',async()=>{
  controls.sound.disabled=true;
  try{
    const requested=!sound.enabled;
    controls.sound.textContent=requested?'准备音效…':'音效关';
    controls.sound.setAttribute('aria-label',requested?'正在准备音效':'关闭音效');
    const enabled=await sound.setEnabled(requested);
    updateSoundButton();
    if(requested&&!enabled){controls.sound.textContent='重试音效';controls.sound.setAttribute('aria-label','音效未能开启，点击重试');}
  }finally{controls.sound.disabled=!sound.supported;updateControls();}
});

function render(stamp){
  const elapsed=playback.stamp===null?0:Math.max(0,(stamp-playback.stamp)/1000);
  playback.stamp=stamp;
  if(playback.ready&&playback.playing&&!document.hidden&&!editing){
    playback.time=Math.min(playback.duration,playback.time+elapsed*playback.rate);
    if(playback.time>=playback.duration)playback.playing=false;
    paint();updateControls();
  }
  requestAnimationFrame(render);
}

controls.toggle.addEventListener('click',()=>{
  if(editing){buildCycle(text.trim()||DEFAULT_TEXT);}
  if(playback.time>=playback.duration){playback.time=0;}
  playback.playing=!playback.playing;playback.stamp=null;paint();updateControls();
});
let dragging=false,resumeAfterDrag=false;
controls.progress.addEventListener('pointerdown',()=>{
  dragging=true;resumeAfterDrag=playback.playing;playback.playing=false;updateControls();
});
controls.progress.addEventListener('input',()=>{
  const target=Number(controls.progress.value);
  if(editing)buildCycle(text.trim()||DEFAULT_TEXT);
  playback.time=Math.max(0,Math.min(playback.duration,target));playback.stamp=null;paint();updateControls();
});
function endScrub(){if(!dragging)return;dragging=false;playback.playing=resumeAfterDrag&&playback.time<playback.duration;playback.stamp=null;updateControls();}
addEventListener('pointerup',endScrub);addEventListener('pointercancel',endScrub);
controls.speed.addEventListener('click',()=>{
  const rates=[.5,1,1.5,2];playback.rate=rates[(rates.indexOf(playback.rate)+1)%rates.length];playback.stamp=null;updateControls();
});
controls.theme.addEventListener('change',()=>{
  const wasPlaying=playback.playing,value=editing?text.trim()||DEFAULT_TEXT:cycle.value;
  dragging=false;theme=controls.theme.value;stage.dataset.theme=theme;document.body.dataset.theme=theme;
  stage.setAttribute('aria-label',theme==='ink'?'星月来信，墨黑星河':'星月来信，三比四画幅');
  buildCycle(value);playback.playing=wasPlaying;updateControls();
});
function applyFont(){
  stage.dataset.font=controls.font.value;
  const name=controls.font.value==='brush'?'马善政书法（Ma Shan Zheng）':'霞鹜文楷';
  controls.font.title=`文案字体：${name}`;
  controls.font.setAttribute('aria-label',controls.font.title);
}
controls.font.addEventListener('change',()=>{
  applyFont();
  // 字形和水波中的文字一起更新，保持本轮的进度、轨迹和音效。
  if(editing)setText(text);else reflowCycle();
});
function reflowCycle(){
  if(!playback.ready||!cycle||editing)return;
  // 窗口或字体变化时只重测输入框和文字；保留随机落点、播放时刻与星河布局。
  const old=cycle.origin;
  setText(cycle.value);
  const rect=stage.getBoundingClientRect(),scale=W/rect.width,bounds=words.getBoundingClientRect();
  const css=getComputedStyle(words),font=`400 ${parseFloat(css.fontSize)*scale}px ${css.fontFamily}`;
  const left=(bounds.left-rect.left)*scale,right=(bounds.right-rect.left)*scale;
  const centerY=(bounds.y+bounds.height/2-rect.top)*scale,spans=[...words.querySelectorAll('span')];
  for(const p of particles){
    if(p.type==='text'){
      const b=spans[p.sourceIndex].getBoundingClientRect();
      p.hidden=b.right<=bounds.left||b.left>=bounds.right;
      p.x=(Math.max(bounds.left,Math.min(bounds.right,b.x+b.width/2))-rect.left)*scale;
      p.y=(b.y+b.height/2-rect.top)*scale;p.font=font;
    }else if(left!==old.left||right!==old.right||centerY!==old.centerY){
      const x=left+(p.x-old.left)/(old.right-old.left)*(right-left),y=p.y+centerY-old.centerY;
      if(p.settle){p.settle.c1.x+=x-p.x;p.settle.c1.y+=y-p.y;}
      p.x=x;p.y=y;p.flight=buildFlight(p);p.speed=p.flight.at(-1).distance/p.duration;
    }
  }
  cycle.origin={left,right,centerY};prepareTyping(cycle.value);paint();
}
addEventListener('resize',reflowCycle);
document.addEventListener('visibilitychange',()=>{playback.stamp=null;updateControls();});
addEventListener('pagehide',()=>{sound.sync({time:playback.time,rate:playback.rate,playing:false});});

function manual(){
  if(busy||editing||!playback.ready)return;
  editing=true;playback.playing=false;particles=[];water=null;
  setText(text);words.style.visibility='visible';send.firstElementChild.style.transform='';send.firstElementChild.style.opacity='';
  ctx.clearRect(0,0,W,H);composer.style.opacity='1';updateControls();
}
input.addEventListener('focus',manual);
input.addEventListener('compositionstart',()=>composing=true);
input.addEventListener('compositionend',()=>{composing=false;setText(input.value);});
input.addEventListener('input',()=>{text=input.value;if(!composing)setText(text);});
input.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.isComposing&&!composing){e.preventDefault();release();}});
send.addEventListener('click',release);
setText('');
function ready(){
  playback.ready=true;buildCycle();playback.playing=!reduce;
  for(const control of [controls.toggle,controls.progress,controls.speed,controls.theme])control.disabled=false;
  controls.sound.disabled=!sound.supported;updateSoundButton();
  if(!sound.supported){controls.sound.textContent='音效不可用';controls.sound.setAttribute('aria-label','当前浏览器不支持音效');}
  if(reduce){playback.time=cycle.sendAt-.01;paint();}updateControls();
}
// 本地字体加载完成后再量字宽，避免切换时先使用备用字体造成跳动。
Promise.allSettled([
  document.fonts.load('20px "霞鹜文楷"'),
  document.fonts.load('20px "Ma Shan Zheng"')
]).then(results=>{
  const options=[...controls.font.options];
  results.forEach((result,i)=>{options[i].disabled=result.status!=='fulfilled'||!result.value.length;});
  const available=options.filter(option=>!option.disabled);
  if(options[controls.font.selectedIndex].disabled&&available.length)controls.font.value=available[0].value;
  applyFont();ready();
  controls.font.disabled=available.length<2;
});
requestAnimationFrame(render);
