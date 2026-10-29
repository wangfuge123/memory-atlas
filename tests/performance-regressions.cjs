const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const config = read('js/config.js').replaceAll('export const', 'const');

async function testInference() {
  let captureCount = 0, rejectCapture = false;
  const warnings = [];
  const bitmaps = [];
  const context = vm.createContext({
    assert, console:{...console,warn:(...args)=>warnings.push(args)}, performance, setTimeout, clearTimeout,
    createImageBitmap: async () => {
      captureCount++;
      if (rejectCapture) throw new Error('Synthetic capture failure');
      const bitmap = { closed:false, close() { this.closed=true; } };
      bitmaps.push(bitmap);
      return bitmap;
    },
    Worker: class {
      constructor() { this.messages=[]; }
      postMessage(message) {
        this.messages.push(message);
        if (message.type==='init') queueMicrotask(()=>this.onmessage({data:{type:'ready'}}));
      }
      terminate() { this.terminated=true; }
    },
    URL,
  });
  const gestures = read('js/gestures.js').replace(/^import .*;\r?\n/gm,'')
    .replace('export class GestureController','class GestureController')
    .replaceAll('import.meta.url',JSON.stringify('http://localhost/js/gestures.js'));
  vm.runInContext(`${config}\n${gestures}\nglobalThis.controller=new GestureController();`,context);
  const gc = context.controller;
  await gc.init();
  assert.equal(gc.backend,'后台线程');
  const worker = gc.worker;
  const video = {readyState:2,currentTime:1,videoWidth:1920,videoHeight:1080};
  gc.update(video,1000);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(captureCount,1);
  for (let t=1010;t<=2000;t+=10) {
    video.currentTime+=.01; gc.update(video,t);
  }
  assert.equal(captureCount,1,'An outstanding inference must not build a capture queue');
  assert.equal(worker.messages.filter(m=>m.type==='frame').length,1);
  worker.onmessage({data:{type:'result',landmarks:[],timestamp:1000,elapsed:1000}});
  assert.equal(gc.version,1); assert.equal(gc.busy,false);
  video.currentTime+=.1; gc.update(video,2100);
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(captureCount,2,'Inference must resume with a fresh frame after a slow result');
  assert.equal(worker.messages.at(-1).timestamp,2100);
  worker.onmessage({data:{type:'result',landmarks:[],timestamp:2100,elapsed:20}});
  video.currentTime+=.001; gc.update(video,2101);
  assert.equal(captureCount,2,'Rate limit must apply even when rendering is fast');
  rejectCapture=true;
  gc.update(video,2200); await new Promise(resolve=>setImmediate(resolve));
  assert.equal(gc.busy,false,'Capture failure must not lock the scheduler');
  assert.equal(warnings.length,1,'Capture failure should be reported once');
  // A failed running worker must clear stale tracking and enter the fallback.
  let fallbackCalls=0;
  gc._initMainThread=async()=>{fallbackCalls++;gc.ready=true;gc.backend='兼容模式';};
  worker.onmessage({data:{type:'error',message:'Synthetic worker failure'}});
  assert.equal(fallbackCalls,1); assert.equal(worker.terminated,true);
  assert.equal(gc.worker,null); assert.equal(gc.frame.hands.length,0);
  assert.equal(gc.backend,'兼容模式');
  gc.landmarker={detectForVideo(){return {landmarks:[]};}};
  video.currentTime+=1; gc.update(video,3000);
  const version=gc.version;
  video.currentTime+=.01; gc.update(video,3010);
  assert.equal(gc.version,version,'Fallback inference must also be rate limited');
  console.log('PASS: one in-flight frame, no queue, fresh-frame scheduling, capture recovery, worker fallback and inference rate limits');
}

function testAnimation() {
  const context=vm.createContext({assert,console});
  const sphere=read('js/sphere.js').replace(/^import .*;\r?\n/gm,'').replace('export class','class');
  vm.runInContext(`${config}\n${sphere}
    function simulate(fps,idle) {
      const sphere=Object.create(PhotoSphere.prototype);
      Object.assign(sphere,{
        radiusScale:1,targetRadiusScale:1.7,opacity:1,targetOpacity:1,
        spin:{x:.04,y:.09},controlCards:true,cards:[],
        group:{rotation:{x:0,y:0}},layouts:0,
        _layout(){this.layouts++;}
      });
      for(let i=0;i<fps*2;i++) sphere.update('idle',idle,1/fps);
      return sphere;
    }
    for(const idle of [true,false]) {
      const baseline=simulate(60,idle);
      for(const fps of [20,30,120,144]) {
        const actual=simulate(fps,idle);
        assert.ok(Math.abs(actual.group.rotation.x-baseline.group.rotation.x)<1e-9);
        assert.ok(Math.abs(actual.group.rotation.y-baseline.group.rotation.y)<1e-9);
        assert.ok(Math.abs(actual.radiusScale-baseline.radiusScale)<.0001);
      }
    }
    const settled=simulate(60,true);
    const layouts=settled.layouts;
    for(let i=0;i<60;i++) settled.update('idle',true,1/60);
    assert.equal(settled.layouts,layouts,'Settled radius must not recompute card layout');
    settled.controlCards=false;
    const rotation=settled.group.rotation.y;
    settled.update('zoomed',false,1/60);
    assert.equal(settled.group.rotation.y,rotation,'Hidden sphere must pause in zoom view');
  `,context);
  console.log('PASS: animation consistency at 20/30/60/120/144 fps, settled-layout caching and paused zoom background');
}

function testDesktopRotation() {
  const main=read('js/main.js');
  const motion=main.slice(main.indexOf('function updateSphereMotion('),main.indexOf('function loop('));
  const sphere=read('js/sphere.js').replace(/^import .*;\r?\n/gm,'').replace('export class','class');
  vm.runInNewContext(`${config}\n${sphere}\n${motion}
    let gestureActive=false,state=STATE.IDLE,drag=null,dialogOpen=false;
    const document={querySelector:()=>dialogOpen};
    const sphere=Object.create(PhotoSphere.prototype);
    Object.assign(sphere,{selectedIndex:-1,radiusScale:1,targetRadiusScale:1,opacity:1,targetOpacity:1,
      spin:{x:0,y:0},controlCards:true,cards:[],group:{rotation:{x:0,y:0}}});
    const empty={hands:[]},hands={hands:[{}]};
    for(let i=0;i<60;i++)updateSphereMotion(empty,1/60);
    assert.ok(sphere.group.rotation.y>0,'Fourth layer rotates from rest without a camera or hand detection');
    for(const reason of ['drag','hover','dialog','zoom']){
      drag=reason==='drag'?{}:null;sphere.selectedIndex=reason==='hover'?0:-1;
      dialogOpen=reason==='dialog';state=reason==='zoom'?STATE.ZOOMED:STATE.IDLE;
      const before=sphere.group.rotation.y;
      updateSphereMotion(empty,1/60);
      assert.equal(sphere.group.rotation.y,before,'Pause immediately during '+reason);
    }
    drag=null;sphere.selectedIndex=-1;dialogOpen=false;state=STATE.IDLE;
    const before=sphere.group.rotation.y;updateSphereMotion(empty,1/60);
    assert.ok(sphere.group.rotation.y>before,'Resume automatically after desktop interaction ends');
    // Exhaustively compare the gesture branch to the previous condition, including
    // dragging/hover/dialog flags that must never change gesture mode behavior.
    gestureActive=true;
    for(const s of Object.values(STATE))for(const frame of [empty,hands]){
      state=s;drag={};sphere.selectedIndex=0;dialogOpen=true;
      sphere.spin={x:.02,y:.03};
      sphere.update=(actualState,idle)=>{
        assert.equal(actualState,s);
        assert.equal(idle,frame.hands.length>0&&s===STATE.IDLE);
        assert.equal(sphere.spin.y,.03,'Desktop pause must not clear gesture impulses');
      };
      updateSphereMotion(frame,1/60);
    }
  `,{assert,console});
  console.log('PASS: desktop auto-rotation, immediate interaction pause, automatic resume and unchanged gesture-mode rotation gates');
}

testInference().then(()=>{testAnimation();testDesktopRotation();}).catch(error=>{console.error(error);process.exitCode=1;});
