const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

// Run the actual state-machine functions with simulated tracking frames.
const main = read('js/main.js');
const context = vm.createContext({ assert, console });
vm.runInContext(`
${read('js/config.js').replaceAll('export const', 'const')}
${read('js/image-layout.js').replaceAll('export function', 'function')}
const statusEl = {}, gestureEl = {};
let flashTimer = 0;
const classes = new Set();
const reticle = { style: {}, classList: {
  add(v) { classes.add(v); }, remove(v) { classes.delete(v); }
}};
const innerWidth = 1000, innerHeight = 1000;
const camera = { fov: 50, aspect: 1, position: {}, quaternion: {} };
const zoomMat = { map: null, opacity: 0 };
const zoomHint = { style: {} };
const zoomPlane = {
  visible: false,
  scale: { set(w,h) { this.x=w; this.y=h; } },
  position: { copy() { return this; }, add() {} },
  quaternion: { copy() {} }
};
const bloom = { strength: 0.9 };
const THREE = {
  Vector3: class { applyQuaternion() { return this; } multiplyScalar() { return this; } },
  MathUtils: { lerp: (a,b,t) => a+(b-a)*t }
};
const card = {
  highlight: 0, mat: { map: { image: { width: 1600, height: 900 } } },
  glowMat: {}, mesh: { scale: { setScalar(value) { this.value=value; } } }
};
const sphere = {
  cards: [card], group:{visible:true}, controlCards: true, radiusScale:1, targetRadiusScale:1,
  setTargetRadius(value) { this.targetRadiusScale=value; },
  setSelection(index) { this.selectedIndex=index; },
  setHighlight(i,v) { this.cards[i].highlight=v; },
  worldPositions() { return [{ clone() { return {
    x: 0, y: 0, z: 0.98, project() { return this; }
  }; } }]; }
};
function flashGesture() {}
${main.slice(main.indexOf('let state ='), main.indexOf('// ---------- 手势控制器'))}
${main.slice(main.indexOf('function handleGestures'), main.indexOf('// 角落手部骨架'))}
function reset() {
  state=STATE.IDLE; clearSelection(); zoomCard=null; zoomLost=0;
  rightPinchPrev=false; skipNextZoom=false; prevMode=0;
  zoomPlane.visible=false; sphere.controlCards=true;
  sphere.radiusScale=1; sphere.targetRadiusScale=1;
}
function frame(pinch, x=.5) {
  return { mode:3, leftHand:{}, rightGesture:pinch?'pinch':'open',
    rightHand:{ pinchActive:pinch,indexTip:{x,y:.5},thumbTip:{x,y:.5} } };
}
function send(f) { handleGestures(f, 1/60); updateSelectionPointer(1/30); }

reset(); send(frame(true)); assert.equal(pick,0);
// A 10Hz detector supplies targets; the reticle still moves on every render frame.
doSelect(frame(true,.8).rightHand,false,0);
const startX=pointerPosition.x;
const steps=[];
for(let i=0;i<6;i++) { updateSelectionPointer(1/60); steps.push(pointerPosition.x); }
assert.ok(steps.every((x,i)=>x>(i?steps[i-1]:startX)), 'Every render frame must advance toward the newest hand position');
assert.ok(Math.abs(pointerPosition.x-800)<1, 'Following must settle without an inference-frame EMA delay');
clearSelection(); updateSelectionPointer(1/60);
assert.equal(reticle.hidden,true,'Cleared tracking must not redraw an old target');
const endpoints=[];
for(const fps of [30,60,120,144]) {
  reset(); send(frame(true));
  doSelect(frame(true,.8).rightHand,false,0);
  for(let i=0;i<fps/6;i++) updateSelectionPointer(1/fps);
  endpoints.push(pointerPosition.x);
}
assert.ok(Math.max(...endpoints)-Math.min(...endpoints)<.000001,'Pointer smoothing must have the same speed at different render rates');
console.log('PASS: continuous reticle movement between detections, frame-rate independent smoothing and cleared-target cancellation');
reset(); send(frame(true));
send({mode:3,leftHand:null,rightHand:null,rightGesture:'pinch'});
assert.notEqual(state,STATE.ZOOMED); assert.equal(pick,-1);
send(frame(false)); assert.notEqual(state,STATE.ZOOMED);

reset(); send(frame(true));
send({mode:3,leftHand:null,rightHand:frame(true).rightHand,rightGesture:'pinch'});
assert.equal(pick,-1); assert.equal(rightPinchPrev,false);
send(frame(false)); assert.notEqual(state,STATE.ZOOMED);

reset(); send(frame(true)); send(frame(true,.95));
assert.equal(pick,-1); assert.equal(card.highlight,0); assert.equal(classes.has('locked'),false);
send(frame(false,.95)); assert.notEqual(state,STATE.ZOOMED);

// Moving out of range on the release frame must also cancel the selection.
reset(); send(frame(true)); send(frame(false,.95));
assert.notEqual(state,STATE.ZOOMED); assert.equal(pick,-1);

// Hold a selected photo through boundary noise and uncertain release signals.
reset(); send(frame(true));
for (let i=0;i<20;i++) { doSelect(frame(true,i%2?.59:.60).rightHand,true); assert.equal(pick,0); }
doSelect(frame(true,.65).rightHand,true); assert.equal(pick,-1);
reset(); send(frame(true));
for(let i=0;i<10;i++) {
  send({...frame(false),rightGesture:'none'});
  assert.equal(state,STATE.SELECTING);
  send(frame(true));
}
send(frame(false)); assert.equal(state,STATE.ZOOMED);
// A new pinch is accepted when its stable classification arrives later.
send({...frame(true),rightGesture:'open'}); assert.equal(state,STATE.ZOOMED);
send(frame(true)); assert.equal(state,STATE.IDLE);
send(frame(true)); assert.equal(pick,-1,'Holding the return pinch must not immediately select again');
send(frame(false)); send(frame(true)); send(frame(false)); assert.equal(state,STATE.ZOOMED);

reset(); send(frame(true)); send(frame(false));
assert.equal(state,STATE.ZOOMED); assert.equal(zoomPlane.visible,true);
assert.equal(reticle.style.display,'none'); assert.equal(zoomMat.map,card.mat.map);
assert.equal(reticle.hidden,true); assert.equal(classes.has('locked'),false);
assert.equal(sphere.group.visible,false); assert.equal(card.highlight,0); assert.equal(card.glowMat.opacity,0);
doSelect(frame(true).rightHand);
assert.equal(reticle.style.display,'none'); assert.equal(reticle.hidden,true);
// Neither subsequent frames nor mode jitter may redraw the selection box.
send(frame(false)); send({...frame(false),mode:2});
updateZoom(1/60);
assert.equal(state,STATE.ZOOMED); assert.equal(reticle.hidden,true);
send(frame(true)); assert.equal(state,STATE.IDLE); assert.equal(zoomPlane.visible,false);
assert.equal(sphere.group.visible,true);
send(frame(false)); assert.notEqual(state,STATE.ZOOMED);
send(frame(true)); send(frame(false)); assert.equal(state,STATE.ZOOMED);

reset(); send(frame(true)); send({ ...frame(true), mode:4 });
assert.equal(state,STATE.IDLE); assert.equal(pick,-1);
send({ ...frame(false), mode:5 }); assert.equal(state,STATE.IDLE);
// Releasing a pinch begun in another mode must not create a new selection.
reset(); send({ ...frame(true), mode:2 }); send(frame(false));
assert.notEqual(state,STATE.ZOOMED); assert.equal(pick,-1);

// Shape is persistent: mode switches, uncertain gestures and tracking gaps
// must not undo convergence/spread. Zoom return must restore that same shape.
for (const [gesture,scale] of [['fist',CONFIG.sphere.convergeScale],['open',CONFIG.sphere.spreadScale]]) {
  reset();
  send({...frame(false),mode:2,rightGesture:gesture});
  assert.equal(sphere.targetRadiusScale,scale);
  sphere.radiusScale=scale;
  send({...frame(false),mode:2,rightGesture:'none'});
  assert.equal(sphere.targetRadiusScale,scale);
  send({...frame(false),mode:0});
  send({mode:0,leftHand:null,rightHand:null,rightGesture:'none'});
  send({...frame(false),mode:4});
  send({...frame(false),mode:1});
  assert.equal(sphere.targetRadiusScale,scale,'Rotation must preserve the previous shape');
  send(frame(true));
  assert.equal(sphere.targetRadiusScale,scale,'Selection must preserve the previous shape');
  assert.equal(pick,0);
  send(frame(false)); assert.equal(state,STATE.ZOOMED);
  assert.equal(sphere.targetRadiusScale,scale);
  send(frame(true)); assert.equal(state,STATE.IDLE);
  assert.equal(sphere.targetRadiusScale,scale,'Returning from zoom must preserve the shape');
  assert.equal(card.mesh.scale.value,Math.min(1,scale),'Restored cards must not flash at their original size');
  send(frame(false)); send({...frame(false),mode:1});
  assert.equal(sphere.targetRadiusScale,scale);
}
reset();
send({...frame(false),mode:2,rightGesture:'fist'});
send({...frame(false),mode:1});
send({...frame(false),mode:2,rightGesture:'open'});
assert.equal(sphere.targetRadiusScale,CONFIG.sphere.spreadScale,'A new explicit shape gesture must still update the shape');
console.log('PASS: converged/spread shape persists through rotation, selection, tracking gaps and zoom return');

for (const viewport of [9/16,16/9,1,3,.3]) {
  camera.aspect=viewport;
  for (const aspect of [1,16/9,9/16,4,.25]) {
    zoomMat.map={image:{width:aspect*1000,height:1000}};
    resizeZoom();
    const visibleHeight=2*6.5*Math.tan(camera.fov*Math.PI/360);
    assert.ok(zoomPlane.scale.x <= visibleHeight*viewport*.9+1e-10);
    assert.ok(zoomPlane.scale.y <= visibleHeight*.9+1e-10);
    assert.ok(Math.abs(zoomPlane.scale.x/zoomPlane.scale.y-aspect)<1e-10);
    const crop=squareCrop(aspect);
    assert.ok(Math.abs(aspect*crop.width/crop.height-1)<1e-10);
    assert.ok(crop.x>=0 && crop.y>=0 && crop.x+crop.width<=1 && crop.y+crop.height<=1);
  }
}
console.log('PASS: tracking loss, selection cancellation, zoom/return, modes, viewport fit and crop');
`, context);

assert.ok(main.includes('if (zoomPlane.visible) resizeZoom();'));
assert.ok(read('js/sphere.js').includes('const crop = squareCrop(aspect);'));

for (const file of ['js/main.js','js/gestures.js','js/gesture-worker.js','js/sphere.js','js/config.js','js/image-layout.js','images-manifest.js']) {
  const result = spawnSync(process.execPath, ['--input-type=module','--check'], {
    input:read(file), encoding:'utf8'
  });
  assert.equal(result.status,0,`${file}: ${result.stderr}`);
}
console.log('PASS: all JavaScript module syntax checks');

assert.equal(process.platform,'win32','Manifest integration checks require Windows PowerShell.');
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(),'sphere-regressions-'));
for (const [label,names] of [
  ['empty',[]],
  ['single',["单张 & sample's.jpg"]],
  ['multiple',['wide.jpg','portrait.PNG','photo.jpeg','image.webp','ignored.txt']]
]) {
  const directory=path.join(temporaryRoot,label);
  fs.mkdirSync(directory);
  for (const file of ['gen-manifest.bat','gen-manifest.ps1']) {
    fs.copyFileSync(path.join(root,file),path.join(directory,file));
  }
  fs.mkdirSync(path.join(directory,'demo-photos'));
  fs.writeFileSync(path.join(directory,'unrelated.jpg'),'must not be listed');
  for(const name of names) fs.writeFileSync(path.join(directory,'demo-photos',name),'fixture');
  const result=spawnSync('cmd.exe',['/d','/c','gen-manifest.bat --no-pause'], {
    cwd:directory,encoding:'utf8',timeout:15000
  });
  assert.equal(result.status,0,result.stdout+result.stderr);
  const output=fs.readFileSync(path.join(directory,'images-manifest.js'),'utf8');
  const parsed=JSON.parse(output.match(/export const IMAGE_FILES = (.*);/)[1]);
  assert.ok(Array.isArray(parsed));
  assert.deepEqual(parsed.map(url=>decodeURIComponent(url)).sort(),names.filter(name=>/\.(jpg|jpeg|png|webp)$/i.test(name)).map(name=>'demo-photos/'+name).sort());
  new vm.Script(output.replace('export const','const'));
  // Invoke the same script from an unrelated working directory as well.
  const direct=spawnSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(directory,'gen-manifest.ps1')], {
    cwd:os.tmpdir(),encoding:'utf8',timeout:15000
  });
  assert.equal(direct.status,0,direct.stdout+direct.stderr);
}
console.log('PASS: actual batch/PowerShell generation for zero, one and multiple images, Unicode filenames and unrelated working directory');
console.log(`Temporary fixtures: ${temporaryRoot}`);
