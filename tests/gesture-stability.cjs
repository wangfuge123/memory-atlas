const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const config = read('js/config.js').replaceAll('export const', 'const');
const gestures = read('js/gestures.js').replace(/^import .*;\r?\n/gm, '')
  .replace('export class', 'class').replaceAll('import.meta.url', "'http://localhost/js/gestures.js'");
const sphere = read('js/sphere.js').replace(/^import .*;\r?\n/gm, '').replace('export class', 'class');
vm.runInNewContext(`${config}\n${gestures}\n${sphere}
function swipe(samples) {
  const gc=new GestureController(); let hits=0;
  gc.onSwipe=()=>hits++;
  for(const [t,x,enabled=true] of samples) gc._detectSwipe(t,x===null?null:{centroid:{x}},enabled);
  return hits;
}
// The old 220ms/three-sample detector never fires at a 120ms sampling interval.
assert.equal(swipe(Array.from({length:8},(_,i)=>[1000+i*120,.25+i*.06])),1);
assert.equal(swipe([[0,.2],[200,.32],[400,.44]]),1);
assert.equal(swipe([[0,.2],[70,.32]]),1);
assert.equal(swipe([[0,.2,false],[100,.32,true]]),1);
assert.equal(swipe([[0,.5],[70,.507],[140,.49],[210,.51],[280,.495],[350,.505]]),0);
assert.equal(swipe([[0,.8],[100,.7],[200,.6],[300,.5]]),0);
assert.equal(swipe([[0,.2],[400,.5]]),0,'Long tracking gaps must not form a swipe');
assert.equal(swipe([[0,.2],[50,null],[100,.5]]),0);
assert.equal(swipe([[0,.2],[100,.32],[200,.4],[300,.3],[400,.2],[600,.35]]),2);

// Include mode confirmation: the first sample must survive mode-1 warmup.
const gc=new GestureController(); let startupHits=0; gc.onSwipe=()=>startupHits++;
gc._analyzeHand=(lm,label)=>({numberCount:label==='L'?1:0,gesture:'open',centroid:{x:lm[9].x}});
const hand=x=>Array.from({length:21},()=>({x:1-x,y:.5,z:0}));
gc._consume({landmarks:[hand(.1),hand(.4)]},0);
gc._consume({landmarks:[hand(.1),hand(.52)]},100);
assert.equal(gc.frame.mode,1); assert.equal(startupHits,1);
console.log('PASS: sparse/fast swipes, startup history, jitter rejection, left return, cooldown and tracking gaps');

const pinchGc=new GestureController();
const pose=ratio=>{
  const lm=Array.from({length:21},()=>({x:.5,y:.5,z:0}));
  lm[0]={x:.5,y:.8}; lm[4]={x:.4,y:.5}; lm[8]={x:.4+ratio*.3,y:.5};
  return lm;
};
let time=0;
function sample(ratio){time+=40;return pinchGc._analyzeHand(pose(ratio),'R',time).pinchActive;}
for(let i=0;i<10;i++) sample(.2);
assert.equal(sample(.2),true);
for(let i=0;i<30;i++) assert.equal(sample(i%2?.25:.8),true,'Single-sample release noise must not end a pinch');
for(let i=0;i<8;i++) sample(1);
assert.equal(sample(1),false,'A deliberate release must still be recognized');
for(let i=0;i<30;i++) assert.equal(sample(i%2?.9:.1),false,'Single-sample pinch noise must not start a pinch');
for(let i=0;i<8;i++) sample(.2);
assert.equal(sample(.2),true);
console.log('PASS: noisy pinch/release signals remain stable; deliberate changes still work');

// A deliberate pinch must not pay the EMA warmup cost after a wide-open hand.
for (const interval of [33,50,100]) {
  const detector=new GestureController();
  for(let i=0;i<10;i++) detector._analyzeHand(pose(1.5),'R',i*interval);
  const start=10*interval;
  let confirmedAt;
  for(let i=0;i<5;i++) {
    if(detector._analyzeHand(pose(.4),'R',start+i*interval).pinchActive) {
      confirmedAt=i*interval; break;
    }
  }
  assert.ok(confirmedAt<=Math.max(70,interval),'Natural pinch must confirm promptly after opening');
}
// Relaxing the other fingers must not prevent mode-3 pinch/return classification.
const relaxed=new GestureController();
relaxed._analyzeHand=(lm,label)=>({numberCount:3,gesture:'fist',pinchActive:label==='R',centroid:{x:lm[9].x}});
for(let i=0;i<CONFIG.gesture.modeCommit;i++) relaxed._consume({landmarks:[hand(.1),hand(.7)]},i*33);
assert.equal(relaxed.frame.mode,3);
assert.equal(relaxed.frame.rightGesture,'pinch');
console.log('PASS: prompt pinch entry at 10/20/30Hz and relaxed-finger pinch in mode 3');

const photo=Object.create(PhotoSphere.prototype);
const card={highlight:0,mat:{},glowMat:{},mesh:{scale:{setScalar(v){this.value=v;}}}};
Object.assign(photo,{selectedIndex:0,cards:[card],radiusScale:1,targetRadiusScale:1,
  opacity:1,targetOpacity:1,controlCards:true,spin:{x:.1,y:.1},group:{rotation:{x:0,y:0}}});
for(let i=0;i<120;i++)photo.update(STATE.SELECTING,false,1/120);
const scales=[];
for(let i=0;i<120;i++) {
  if(i%6===0)photo.setSelection(0); // 20Hz inference / 120Hz rendering
  photo.update(STATE.SELECTING,false,1/120); scales.push(card.mesh.scale.value);
}
assert.ok(Math.max(...scales)-Math.min(...scales)<.000001,'A held selection must not pulse at inference frequency');
assert.ok(Math.abs(scales.at(-1)-CONFIG.select.highlightScale)<.000001);
assert.equal(photo.group.rotation.y,0,'The sphere must remain still while choosing');
photo.setSelection(-1);photo.update(STATE.SELECTING,false,1/120);
assert.ok(card.mesh.scale.value<scales.at(-1) && card.mesh.scale.value>1,'Deselection should ease down');
console.log('PASS: selected-photo size stays constant between detections, selection freezes spin and deselection eases down');
`, { assert, console, performance });
