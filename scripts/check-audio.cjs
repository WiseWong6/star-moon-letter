'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const ROOT=path.resolve(__dirname,'..'),read=file=>fs.readFileSync(path.join(ROOT,file),'utf8');
class MockBuffer {
  constructor({length,sampleRate}){this.data=new Float32Array(length);this.duration=length/sampleRate;}
  getChannelData(){return this.data;}
}
const param=()=>({value:0,events:[],setValueAtTime(...v){this.events.push(['set',...v]);},linearRampToValueAtTime(...v){this.events.push(['ramp',...v]);},cancelScheduledValues(...v){this.events.push(['cancel',...v]);}});
const node=()=>({connect(){},disconnect(){}});
class MockContext {
  constructor(){this.state='suspended';this.currentTime=0;this.destination={};this.sources=[];}
  async resume(){this.state='running';}
  async suspend(){this.state='suspended';}
  async close(){this.state='closed';}
  createBuffer(ch,length,sampleRate){return new MockBuffer({length,sampleRate});}
  createGain(){return {...node(),gain:param()};}
  createStereoPanner(){return {...node(),pan:param()};}
  createDynamicsCompressor(){return {...node(),...Object.fromEntries(['threshold','knee','ratio','attack','release'].map(k=>[k,param()]))};}
  createBufferSource(){const source={...node(),start(...args){this.started=args;},stop(...args){this.stopped=args;}};this.sources.push(source);return source;}
}
function environment(bufferSupport=true,Context=MockContext){
  const timers=new Map();let id=0;
  const scope={AudioContext:Context,AudioBuffer:bufferSupport?MockBuffer:undefined,atob:s=>Buffer.from(s,'base64').toString('binary'),
    setTimeout:fn=>{timers.set(++id,fn);return id;},clearTimeout:id=>timers.delete(id)};
  vm.createContext(scope);vm.runInContext(read('audio/sound-bank.js'),scope);vm.runInContext(read('sound.js'),scope);
  return {scope,timers,flush(){while(timers.size){const [id,fn]=timers.entries().next().value;timers.delete(id);fn();}}};
}
function animationEvents(theme,options={}){
  const code=read('animation.js'),scope={Math,reduce:false,theme,W:660,SKY_LOOP:9,TYPE_INTERVAL:.175,WATER_LEAD:1.35/1.2,TRANSFORM_RATE:1.2,
    StarLetterMusic:require('../chime-score.js'),
    cycle:{value:'那些凌晨时分敲下的代码，是不会说谎的星星。',sendAt:5.375,firstSettle:11,loopStart:18,instant:false,...options},playback:{duration:90},
    particles:Array.from({length:12},(_,i)=>({type:'symbol',hasTrail:true,start:7+i*.3,x:180+i*18,y:616,endX:480+i*3,
      revealDuration:1.4/1.2,duration:5,flashAt:2.3,flashGap:1.9,layer:i%3}))};
  scope.poseAt=(p,age)=>({x:p.x+(p.endX-p.x)*Math.min(1,age/p.duration),y:610-480*Math.min(1,age/p.duration)});
  vm.createContext(scope);vm.runInContext(code.slice(code.indexOf('function makeSoundEvents(){'),code.indexOf('function buildCycle(')),scope);
  return scope.makeSoundEvents();
}
const endVoices=sound=>{for(const voice of [...sound.voices])voice.source.onended?.();};
(async()=>{
  const env=environment(),sound=new env.scope.StarLetterSound();
  assert.equal(sound.requested,true,'音效意愿默认开启');
  assert.equal(sound.context,null);assert.equal(sound.buffers.size,0);
  // 首次点击不等待任何后台任务，也不会现场合成长音。
  assert.equal(await sound.setEnabled(true),true);assert.equal(sound.buffers.size,0);
  env.flush();assert.equal(sound.buffers.size,64);
  for(const buffer of sound.buffers.values()){
    assert(buffer.data.every(Number.isFinite));assert(buffer.data.every(x=>Math.abs(x)<=.721));
    assert(Math.abs(buffer.data[0])<.001&&Math.abs(buffer.data.at(-1))<.001);
  }
  assert.equal(JSON.stringify(animationEvents('ink')),JSON.stringify(animationEvents('blue')),'两种配色共用动作音效与星河余音');
  assert(animationEvents('ink').filter(e=>e.kind==='leafTouch').every(e=>[e.time,e.gain,e.pitch,e.pan].every(Number.isFinite)),'风铃原始时间和强弱均有效，不能依赖播放端默认值修补');
  assert(!animationEvents('blue').some(e=>e.kind==='galaxy'),'移除与风铃不同调的随机低音云');
  const score=animationEvents('ink'),melody=score.filter(e=>e.role==='melody'),accompaniment=score.filter(e=>e.role==='accompaniment'),coda=score.filter(e=>e.role?.startsWith('coda'));
  assert.equal(melody.length,16);assert.equal(accompaniment.length,12);
  assert.equal(require('../chime-score.js').sustainDuration,72);
  const phrases=Array.from({length:8},(_,i)=>coda.filter(e=>e.time>=18+i*9&&e.time<18+(i+1)*9));
  assert(phrases.every(events=>events.some(e=>e.role==='coda')&&events.some(e=>e.role==='coda-accompaniment')),'每段都有旋律与伴奏');
  const signatures=phrases.map((events,i)=>JSON.stringify(events.map(e=>[e.time-18-i*9,e.pitch,e.gain])));
  assert.equal(new Set(signatures).size,8,'八段的旋律节奏不重复');
  const densities=phrases.map(events=>events.length),peaks=phrases.map(events=>Math.max(...events.map(e=>e.gain)));
  assert(Math.max(...densities)>Math.min(...densities)*2,'段落之间有疏密变化');
  assert(peaks[6]>peaks[4]*1.3&&peaks[6]>.9,'留白之后重新推至高点，不能一路减弱');
  assert(phrases.every(events=>Math.max(...events.filter(e=>e.role==='coda-accompaniment').map(e=>e.gain))<Math.min(...events.filter(e=>e.role==='coda').map(e=>e.gain))),'持续段伴奏始终轻于旋律');
  assert.equal(melody.at(-1).pitch,0,'主乐句回到主音');
  const peak=melody.reduce((a,b)=>a.gain>b.gain?a:b);
  assert.equal(peak.time,11,'旋律高点对应首次星星落定');
  assert(Math.max(...accompaniment.map(e=>e.gain))<Math.min(...melody.map(e=>e.gain)),'轻伴奏不能盖过主旋律');
  assert(coda.every(e=>e.time>=18&&e.time+e.duration<=90-.1),'整曲尾音在循环边界前收完');
  assert(coda.some(e=>e.time<36&&e.time+e.duration>36),'段落之间允许余音自然连接，无需每九秒静音');
  assert(score.filter(e=>e.kind==='leafTouch'&&!e.role?.startsWith('coda')).every(e=>e.time+e.duration<18),'主题不能跨进持续段循环而重叠');
  for(const theme of ['ink','blue']){
    sound.setEvents(animationEvents(theme));
    for(const rate of [.5,1,1.5,2]){
      sound.invalidate();endVoices(sound);
      for(const event of sound.events){
        const buffer=sound.bufferFor(event,rate);assert(buffer,`${theme} ${event.kind} ${event.pitch} ${rate}`);
        assert(buffer.duration+ .001>=event.duration/rate);
      }
      const keys=sound.events.filter(e=>e.kind==='typing'),before=sound.context.sources.length;
      const touches=sound.events.filter(e=>e.kind==='leafTouch');
      assert(touches.length>200&&touches.length<250,'主题与八段持续音乐完整');
      assert(touches.some(e=>e.time<9.3)&&touches.some(e=>e.time>=9.3),'轻碰覆盖显形与飞行阶段');
      assert(touches.every(e=>e.time>=6.5&&e.time+e.duration<=90&&[0,2,4,7,9].includes(e.pitch)));
      assert(new Set(touches.map(e=>e.pitch)).size===5,'高低五种音色交织');
      assert(Math.max(...touches.map(e=>e.gain))/Math.min(...touches.map(e=>e.gain))>2,'主音与轻碰有明确轻重差别');
      assert(touches.every(e=>e.panTo===e.pan),'音乐保持稳定声场，不随随机物品左右跳动');
      assert.equal(keys.length,1,'整段文字只使用一个连续键盘声源');
      assert.equal(keys[0].time,.65);assert.equal(keys[0].duration,21*.175);
      const finish=keys[0].time+keys[0].duration;
      // 逐帧推进到阅读停留，不能按字符重复触发或在文字结束后继续敲击。
      for(let t=0;t<finish+.4;t+=.025){sound.context.currentTime=t/rate;sound.sync({time:t,rate,playing:true});}
      assert.equal(sound.context.sources.length-before,1);
      const source=sound.context.sources.at(-1);
      assert.equal(source.started[1],0);assert.equal(source.started[2],keys[0].duration/rate);
      assert(Math.abs(source.started[0]+source.started[2]-finish/rate)<1e-8);
    }
  }
  for(const value of ['', '星', '星'.repeat(28)]){
    const keys=animationEvents('ink',{value}).filter(e=>e.kind==='typing');
    assert.equal(keys.length,value.length?1:0);
    if(keys.length)assert.equal(keys[0].duration,value.length*.175);
  }
  assert(!animationEvents('ink',{instant:true}).some(e=>e.kind==='typing'),'直接发送无需自动打字音');
  for(const options of [{instant:false,sendAt:5.375},{instant:true,sendAt:.35}]){
    const sends=animationEvents('ink',options).filter(e=>e.kind==='send');
    assert.equal(sends.length,1,'每次发送只有一声独立的按键音');
    assert.equal(sends[0].time,options.sendAt,'发送键声与开始变化的时刻一致');
    sound.setEvents(sends);
    for(const rate of [.5,1,1.5,2]){
      sound.invalidate();endVoices(sound);
      const before=sound.context.sources.length,event=sends[0],buffer=sound.bufferFor(event,rate);
      assert(buffer&&Math.abs(buffer.duration-.18/rate)<.001);
      assert(Math.max(...buffer.data.map(Math.abs))>.6,'发送按键有清楚的音头');
      for(let time=event.time-.15;time<event.time+.5;time+=.01){
        sound.context.currentTime=time/rate;sound.sync({time,rate,playing:true});
      }
      assert.equal(sound.context.sources.length-before,1,'逐帧更新不能重复播放发送键声');
      const source=sound.context.sources.at(-1);assert.equal(source.started[1],0);
      assert(Math.abs(source.started[2]-.18/rate)<.001);
    }
  }
  const touch=animationEvents('ink').find(e=>e.kind==='leafTouch');
  sound.setEvents([touch]);endVoices(sound);
  for(const rate of [.5,1,1.5,2]){
    sound.invalidate();endVoices(sound);
    const buffer=sound.bufferFor(touch,rate),data=buffer.getChannelData(0);
    const energy=(from,to)=>{
      let sum=0;const begin=Math.floor(from/rate*16000),end=Math.floor(to/rate*16000);
      for(let i=begin;i<end;i++)sum+=data[i]**2;return sum/(end-begin);
    };
    assert(energy(0,.08)>energy(.55,.75)*2,'保留清楚音头，余音自然减弱');
    assert(energy(.68,.86)>1e-8,'短余音自然衰减，不截成孤立提示音');
    const frequency=1046.502261*2**(touch.pitch/12);
    const strength=hz=>{
      let re=0,im=0;const count=Math.floor(.22/rate*16000);
      for(let i=0;i<count;i++){re+=data[i]*Math.cos(2*Math.PI*hz*i/16000);im+=data[i]*Math.sin(2*Math.PI*hz*i/16000);}
      return re*re+im*im;
    };
    assert(strength(frequency)>strength(frequency/2)*100,'不叠低八度；四档速度保留同一主音高');
    const time=touch.time+.18;
    sound.sync({time,rate,playing:true});let voice=[...sound.voices].at(-1);assert(voice);
    assert(Math.abs(voice.source.started[1]-.18/rate)<1e-8,'拖到轻碰中段时从余音续上');
    sound.sync({time,rate,playing:false});assert(voice.stopped);endVoices(sound);
    sound.context.currentTime+=.25;sound.sync({time,rate,playing:true});voice=[...sound.voices].at(-1);assert(voice);
    assert(Math.abs(voice.source.started[1]-.18/rate)<1e-8,'恢复播放不重新敲击');
    sound.invalidate();endVoices(sound);
    sound.sync({time:touch.time+touch.duration+.1,rate,playing:true});assert.equal(sound.voices.size,0);
  }
  const typing=animationEvents('ink').find(e=>e.kind==='typing');
  sound.setEvents([typing]);endVoices(sound);
  for(const rate of [.5,1,1.5,2]){
    sound.invalidate();endVoices(sound);
    const middle=typing.time+1.2;
    sound.sync({time:middle,rate,playing:true});
    let voice=[...sound.voices].at(-1);assert(voice);
    assert(Math.abs(voice.source.started[1]-1.2/rate)<1e-8,'拖到中段应从对应录音位置恢复');
    assert(Math.abs(voice.source.started[2]-(typing.duration-1.2)/rate)<1e-8);
    sound.sync({time:middle,rate,playing:false});assert(voice.stopped);endVoices(sound);
    sound.context.currentTime+=.25;
    sound.sync({time:middle,rate,playing:true});
    voice=[...sound.voices].at(-1);assert(voice);
    assert(Math.abs(voice.source.started[1]-1.2/rate)<1e-8,'暂停续播不能把录音从头开始');
    sound.sync({time:typing.time+typing.duration+.1,rate,playing:true});endVoices(sound);
    assert.equal(sound.voices.size,0);
    const before=sound.context.sources.length;
    sound.sync({time:typing.time+typing.duration+.2,rate,playing:true});
    assert.equal(sound.context.sources.length,before,'阅读停留阶段没有键盘声');
  }
  sound.setEvents([{kind:'galaxy',time:2,duration:2.7,pitch:0,gain:.4,pan:-.5,panTo:.5}]);
  sound.sync({time:3.1,rate:1,playing:true});
  const voice=[...sound.voices].at(-1);assert(voice);assert(Math.abs(voice.source.started[1]-1.1)<1e-8);
  assert(Math.abs(voice.source.started[2]-1.6)<1e-8);assert(voice.gain.gain.events.some(e=>e[0]==='ramp'&&e[1]===0));
  sound.sync({time:3.1,rate:1,playing:false});assert(voice.stopped);endVoices(sound);
  sound.sync({time:4,rate:1,playing:true});assert(sound.voices.size>0);endVoices(sound);
  sound.sync({time:1,rate:1,playing:true});assert.equal(sound.voices.size,0);
  assert.equal(await sound.setEnabled(false),false);sound.destroy();assert.equal(env.timers.size,0);
  const fallback=environment(false),other=new fallback.scope.StarLetterSound();
  assert.equal(await other.setEnabled(true),true);fallback.flush();assert.equal(other.buffers.size,64);other.destroy();
  class GatedContext extends MockContext{
    async resume(){if(!this.allowed)throw new Error('自动播放受限');this.state='running';}
  }
  const gated=environment(true,GatedContext),defaultSound=new gated.scope.StarLetterSound();
  let toggle;const listeners=[],button={setAttribute(){},addEventListener(type,fn){toggle=fn;}};
  Object.assign(gated.scope,{sound:defaultSound,controls:{sound:button},updateControls(){},document:{addEventListener(type,fn){listeners.push([type,fn]);}}});
  const animation=read('animation.js');
  vm.runInContext(animation.slice(animation.indexOf('function updateSoundButton(){'),animation.indexOf('function render(')),gated.scope);
  await gated.scope.unlockSound();
  assert(defaultSound.requested&&!defaultSound.enabled);assert.equal(button.textContent,'音效开');
  assert.deepEqual(listeners.map(([type])=>type),['click','keydown']);
  defaultSound.context.allowed=true;
  await listeners[0][1]({target:{closest:()=>null}});assert.equal(defaultSound.enabled,true);
  await toggle();assert(!defaultSound.requested&&!defaultSound.enabled);assert.equal(button.textContent,'音效关');
  await listeners[1][1]({target:{closest:()=>null}});assert.equal(defaultSound.enabled,false,'主动静音后普通交互不能重开');
  await toggle();assert(defaultSound.requested&&defaultSound.enabled);defaultSound.destroy();
  class PendingContext extends MockContext{resume(){return new Promise(resolve=>{this.finish=()=>{this.state='running';resolve();};});}}
  const delayed=environment(true,PendingContext),pendingSound=new delayed.scope.StarLetterSound();
  const opening=pendingSound.setEnabled(true);await pendingSound.setEnabled(false);
  pendingSound.context.finish();await opening;
  assert(!pendingSound.requested&&!pendingSound.enabled,'尚未解锁时关闭不能被旧请求重开');pendingSound.destroy();
  console.log('通过：默认音效开启、交互解锁与静音保持、64 组本地声音、两种配色和四档倍速、打字与发送音同步、风铃四句旋律和轻伴奏、音乐高点对应落定、八段音乐疏密起伏、整曲完整收音后循环、固定音高与稳定声场、暂停续播和拖动定位。');
})().catch(error=>{console.error(error);process.exitCode=1;});
