import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { CONFIG, STATE } from './config.js';
import { PhotoSphere } from './sphere.js?v=20261026-2';
import { fitImage } from './image-layout.js';
import { InputMode } from './input-mode.js';

// ---------- DOM ----------
const canvas = document.getElementById('scene');
const video = document.getElementById('cam');
const overlay = document.getElementById('overlay');
const octx = overlay.getContext('2d');
const reticle = document.getElementById('reticle');
const statusEl = document.getElementById('status');
const gestureEl = document.getElementById('gesture-name');
const bootEl = document.getElementById('boot');
const debugEl = document.getElementById('debug');
const zoomHint = document.getElementById('zoom-hint');

// ---------- Three 场景 ----------
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: true, powerPreference: 'high-performance' });
function renderPixelRatio() {
  return Math.min(devicePixelRatio, CONFIG.performance.maxPixelRatio,
    Math.sqrt(CONFIG.performance.maxRenderPixels / (innerWidth * innerHeight)));
}
renderer.setPixelRatio(renderPixelRatio());
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.setClearColor(0x000000, 1);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(CONFIG.camera.fov, innerWidth / innerHeight, 0.1, 100);
camera.position.set(0, 0, CONFIG.camera.distance);

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(
  new THREE.Vector2(innerWidth, innerHeight),
  CONFIG.fx.bloomStrength, CONFIG.fx.bloomRadius, CONFIG.fx.bloomThreshold
);
composer.addPass(bloom);
function resizePostprocessing() {
  const ratio = renderer.getPixelRatio();
  composer.setPixelRatio(ratio);
  composer.setSize(innerWidth, innerHeight);
  bloom.setSize(innerWidth * ratio * CONFIG.performance.bloomScale,
    innerHeight * ratio * CONFIG.performance.bloomScale);
}
resizePostprocessing();

const sphere = new PhotoSphere(scene, []);
sphere.group.position.x = 0.75;
sphere.group.scale.setScalar(0.82);

// Sparse, subdued points describe the volume without adding a glowing overlay.
const dustPositions=[];
for(let i=0;i<72;i++){
  const y=1-(i+.5)/36,angle=i*Math.PI*(3-Math.sqrt(5)),r=Math.sqrt(1-y*y)*5.1;
  dustPositions.push(Math.cos(angle)*r,y*5.1,Math.sin(angle)*r);
}
const dustGeometry=new THREE.BufferGeometry();dustGeometry.setAttribute('position',new THREE.Float32BufferAttribute(dustPositions,3));
const dust=new THREE.Points(dustGeometry,new THREE.PointsMaterial({color:0xd2c59d,size:.018,transparent:true,opacity:.32,depthWrite:false}));
sphere.group.add(dust);
let active = false;
let gestureActive = false;
let gestureStarting = false;
let cameraGeneration = 0;
let modelPromise = null;
const inputMode = new InputMode(window, () => exitGesture());

// 放大展示面：正对相机、居中、按原图比例铺大（独立于旋转的球）
const zoomMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, side: THREE.DoubleSide, depthTest: false });
const zoomPlane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), zoomMat);
zoomPlane.renderOrder = 999;
zoomPlane.visible = false;
scene.add(zoomPlane);

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(renderPixelRatio());
  renderer.setSize(innerWidth, innerHeight);
  resizePostprocessing();
  if (zoomPlane.visible) resizeZoom();
  overlay.width = video.clientWidth; overlay.height = video.clientHeight;
});

// ---------- 状态机 ----------
let state = STATE.IDLE;
let pick = -1;            // 选中的图片索引
let zoomCard = null;      // 放大中选中的卡片
let zoomLost = 0;         // 放大态双手离开画面的累计秒数
let rightPinchPrev = false; // 右手上一帧是否捏合（用于检测捏/松边沿）
let skipNextZoom = false;   // 从放大返回后，跳过紧接着的那次“松开”，避免立刻又放大
let prevMode = 0;           // 上一帧的模式（用于切入模式3时重置选择）
let selectionHeld = false;
let pointerPosition = null;
let pointerTarget = null;
let zoomReturnArmed = false;

function setStatus(s) {
  if (state !== s) statusEl.textContent = (typeof gestureActive !== 'undefined' && !gestureActive && s === STATE.IDLE) ? '键鼠浏览' : ZH[s] || s;
  state = s;
}
const ZH = {
  idle: '自由旋转', converged: '聚拢', spread: '散开', selecting: '选择中',
  zoomed: '放大查看',
};

// ---------- 手势控制器 ----------
let gc = { version:0, frame:{hands:[]}, update(){return this.frame;} };
function onSwipe() {
  if (!gestureActive) return;
  if (state === STATE.ZOOMED) return;
  sphere.swipeImpulse(1);   // 仅向右
  flashGesture('→ 右滑');
};

let lastGestureFlash = '';
let flashTimer = 0;
function flashGesture(name) { gestureEl.textContent = name; lastGestureFlash = name; flashTimer = 1.2; }

// ---------- 摄像头 / 模型 状态 ----------
let camStatus = '等待中';
let modelStatus = '等待中';

async function startCamera() {
  const generation = cameraGeneration;
  if (!navigator.mediaDevices?.getUserMedia) throw Error('请通过 localhost 使用支持摄像头的浏览器');
  camStatus='请求权限…';
  const stream=await navigator.mediaDevices.getUserMedia({video:{width:{ideal:640},height:{ideal:480},frameRate:{ideal:30,max:30}},audio:false});
  if(generation!==cameraGeneration){stream.getTracks().forEach(t=>t.stop());throw Error('启动已取消');}
  video.srcObject=stream;
  stream.getVideoTracks().forEach(t=>t.addEventListener('ended',()=>{if(gestureActive){exitGesture();report('摄像头断开，已恢复键鼠操作');}}));
  video.onloadedmetadata=()=>{overlay.width=video.clientWidth;overlay.height=video.clientHeight;};
  await video.play();
  if (!video.videoWidth) throw Error('摄像头没有输出画面');
  camStatus='已连接';
}
async function startModel() {
  modelStatus='下载中…';
  if(!modelPromise) modelPromise=import('./gestures.js?v=20261027-1').then(async ({GestureController})=>{
    gc=new GestureController();gc.onSwipe=onSwipe;await gc.init();
  }).catch(e=>{modelPromise=null;throw e;});
  await modelPromise;modelStatus='OK';
}

// ---------- 主循环 ----------
let prevT = performance.now();
let lastFrameVersion = -1;
let lastGestureTime = performance.now();
function updateSphereMotion(frame, dt) {
  // Keep the gesture branch identical: modes 1/2/3 retain their existing locks.
  const idle = gestureActive
    ? frame.hands.length > 0 && state === STATE.IDLE
    : state === STATE.IDLE && !drag && sphere.selectedIndex < 0 && !document.querySelector('dialog[open]');
  if (!gestureActive && !idle) sphere.spin.x = sphere.spin.y = 0;
  sphere.update(state, gestureActive ? idle : false, dt);
  if (!gestureActive && idle) sphere.group.rotation.y += CONFIG.sphere.desktopSpin * dt;
}
function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, (now - prevT) / 1000);
  prevT = now;
  if (!active) return;

  const frame = gestureActive ? gc.update(video, now) : {hands:[]};
  if (gestureActive && gc.version !== lastFrameVersion) {
    drawSkeleton(frame);
    handleGestures(frame, Math.min(0.25, (now - lastGestureTime) / 1000));
    lastGestureTime = now;
    lastFrameVersion = gc.version;
  }
  flashTimer = Math.max(0, flashTimer - dt);
  if (!gestureActive && flashTimer === 0) gestureEl.textContent = '';
  if (gestureActive) updateDebug(frame, now);

  updateSphereMotion(frame, dt);
  sphere.present(camera, dt);
  updateSelectionPointer(dt);
  updateZoom(dt);

  if (state === STATE.ZOOMED) renderer.render(scene, camera);
  else composer.render();
}

// 双手模式：左手数字(mode)选模式，右手执行动作
function handleGestures(frame, dt) {
  const mode = frame.mode;          // 左手数字 1~5（稳定后）
  const right = frame.rightHand;    // 右手（连续量：位置/捏合）
  const rg = frame.rightGesture;    // 右手稳定后手势

  if (gestureEl && flashTimer <= 0) {
    const gm = { fist: '握拳', open: '张掌', pinch: '捏合', none: '—' };
    gestureEl.textContent = mode ? `左手 ${mode} · 右手 ${gm[rg] || '—'}` : '举起双手 · 左手出数字';
  }

  const pinch = !!(right && right.pinchActive);

  // 放大态独立处理，任何模式变化都不会再显示选框。
  if (state === STATE.ZOOMED) {
    hideReticle();
    if (!pinch && rg === 'open') zoomReturnArmed = true;
    if (mode === 3 && pinch && rg === 'pinch' && zoomReturnArmed) restoreFromZoom();
    else if (mode !== 3 && right && rg === 'fist') restoreFromZoom();
    else if (!frame.leftHand && !right) { zoomLost += dt; if (zoomLost > 1.3) restoreFromZoom(); }
    else zoomLost = 0;
    rightPinchPrev = pinch; prevMode = mode;
    return;
  }

  // 跟踪丢失不是松开。单手时也无法可靠区分数字手与动作手，
  // 取消本次选择，恢复双手后需重新捏合选择。
  if (state !== STATE.ZOOMED && (!frame.leftHand || !right)) {
    clearSelection();
    leaveSelecting();
    rightPinchPrev = false;
    skipNextZoom = false;
    prevMode = 0;
    setStatus(STATE.IDLE);
    return;
  }

  switch (mode) {
    case 1: // 横扫（冲量由 onSwipe 给出），保持自由旋转
      leaveSelecting();
      setStatus(STATE.IDLE);
      break;

    case 2: // 右手握拳 → 聚拢；右手张掌 → 散开
      leaveSelecting();
      if (rg === 'fist') { setStatus(STATE.CONVERGED); sphere.setTargetRadius(CONFIG.sphere.convergeScale); }
      else if (rg === 'open') { setStatus(STATE.SPREAD); sphere.setTargetRadius(CONFIG.sphere.spreadScale); }
      else { setStatus(STATE.IDLE); }
      break;

    case 3: // 捏合选图 → 张开放大 → 再次捏合返回
      // 选图沿用模式2留下的半径，不恢复为初始球形。
      if (prevMode !== 3) { clearSelection(); skipNextZoom = false; } // 刚切入模式3：清空旧选择
      setStatus(STATE.SELECTING);
      if (skipNextZoom) {
        if (!pinch && rg === 'open') skipNextZoom = false;
        hideReticle();
        break;
      }
      if (pinch) {
        selectionHeld = true;
        doSelect(right, false, 0);               // 识别帧只更新目标，渲染帧连续跟随
      } else if (selectionHeld && rg === 'open') { // 稳定张掌后才确认放大
        selectionHeld = false;
        if (pick >= 0) {
          doSelect(right, true);                 // 用释放时的实际位置确认命中
          if (pick >= 0) enterZoom();            // 捏后张开 → 放大
        }
        if (state !== STATE.ZOOMED) hideReticle();
      } else if (!selectionHeld) {
        hideReticle();
      }
      break;

    default: // 0/4/5：双手未就位或未分配功能
      leaveSelecting();
      setStatus(STATE.IDLE);
  }

  rightPinchPrev = pinch;
  prevMode = mode;
}

function leaveSelecting() {
  if (state === STATE.SELECTING) { clearSelection(); setStatus(STATE.IDLE); }
}

function clearSelection() {
  sphere.setSelection(-1);
  pick = -1;
  selectionHeld = false;
  pointerPosition = null;
  pointerTarget = null;
  hideReticle();
}

function hideReticle() {
  reticle.hidden = true;
  reticle.style.display = 'none';
  reticle.classList.remove('locked');
}

// 捏合选择：准星跟手，命中最近的图
function doSelect(p, snap = false, dt = 1 / 60) {
  if (state === STATE.ZOOMED || zoomPlane.visible) { hideReticle(); return; }
  const mid = { x: (p.indexTip.x + p.thumbTip.x) / 2, y: (p.indexTip.y + p.thumbTip.y) / 2 };
  const rawX = mid.x * innerWidth, rawY = mid.y * innerHeight;
  pointerTarget = { x: rawX, y: rawY };
  if (!pointerPosition || snap) pointerPosition = { x: rawX, y: rawY };
  updateSelectionPointer(dt);
}

// 与识别频率解耦；不外推未知手部位置，低频识别时也能连续靠近最新目标。
function updateSelectionPointer(dt) {
  if (state !== STATE.SELECTING || !pointerTarget || !pointerPosition || zoomPlane.visible) return;
  const alpha = 1 - Math.pow(1 - CONFIG.select.pointerSmoothing, dt * 60);
  pointerPosition.x += (pointerTarget.x - pointerPosition.x) * alpha;
  pointerPosition.y += (pointerTarget.y - pointerPosition.y) * alpha;
  const sx = pointerPosition.x, sy = pointerPosition.y;
  reticle.hidden = false;
  reticle.style.display = 'block';
  reticle.style.transform = `translate3d(${sx}px, ${sy}px, 0)`;

  const positions = sphere.worldPositions();
  let best = -1, bestD = CONFIG.select.pickRadius, currentD = Infinity;
  positions.forEach((wp, i) => {
    const v = wp.clone().project(camera);
    if (v.z > 1) return; // 背面
    const px = (v.x * 0.5 + 0.5) * innerWidth;
    const py = (-v.y * 0.5 + 0.5) * innerHeight;
    const d = Math.hypot(px - sx, py - sy);
    if (i === pick) currentD = d;
    if (d < bestD) { bestD = d; best = i; }
  });
  if (pick >= 0 && currentD < CONFIG.select.releaseRadius &&
      (best < 0 || best === pick || bestD + CONFIG.select.switchMargin >= currentD)) best = pick;
  pick = best;
  sphere.setSelection(best);
  if (best >= 0) { reticle.classList.add('locked'); }
  else reticle.classList.remove('locked');
}

function resizeZoom() {
  const image = zoomMat.map?.image;
  const aspect = image?.width && image?.height ? image.width / image.height : 1;
  const visibleHeight = 2 * 6.5 * Math.tan(camera.fov * Math.PI / 360);
  const size = fitImage(aspect,
    Math.min(9.5, visibleHeight * camera.aspect * 0.9),
    Math.min(5.4, visibleHeight * 0.9));
  zoomPlane.scale.set(size.width, size.height, 1);
}

// 进入放大：把选中图放到相机正前方、按原比例铺大
function enterZoom() {
  if (pick < 0) { setStatus(STATE.IDLE); return; }
  zoomCard = sphere.cards[pick];
  if (!zoomCard?.mat.map) {
    if (typeof report === 'function') report('照片正在加载，请稍候再打开。');
    return;
  }
  zoomReturnArmed = true; // 只有稳定张掌才能进入放大，下一次稳定捏合可返回
  zoomLost = 0;
  bloom.strength = 0;   // 放大时关闭辉光，避免图片过曝
  const tex = zoomCard.mat.map;
  zoomMat.map = tex || null; zoomMat.needsUpdate = true;
  // Sphere uses thumbnails; open the preserved full-resolution original on demand.
  const fullSource = zoomCard.source?.original;
  if (fullSource) {
    const card = zoomCard;
    if (card.originalTexture) zoomMat.map = card.originalTexture;
    else if (!card.originalLoading) {
      card.originalLoading = true;
      new THREE.TextureLoader().load(fullSource, texture => {
        if (card.disposed) { texture.dispose(); return; }
        texture.colorSpace = THREE.SRGBColorSpace; card.originalTexture = texture;
        if (zoomCard === card && zoomPlane.visible) { zoomMat.map = texture; zoomMat.needsUpdate = true; resizeZoom(); }
      }, undefined, () => { card.originalLoading = false; });
    }
  }

  resizeZoom();
  hideReticle();
  sphere.group.visible = false;
  sphere.setSelection(-1);
  for (const c of sphere.cards) { c.highlight = 0; c.glowMat.opacity = 0; }

  // 放到相机前方并正对相机
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
  zoomPlane.position.copy(camera.position).add(fwd.multiplyScalar(6.5));
  zoomPlane.quaternion.copy(camera.quaternion);
  zoomMat.opacity = 0;
  zoomPlane.visible = true;
  if (typeof document !== 'undefined') document.body.classList.add('photo-open');

  sphere.controlCards = false;       // 由 updateZoom 接管整球淡出
  zoomHint.style.display = 'block';
  zoomHint.textContent = (typeof gestureActive !== 'undefined' && gestureActive) ? '再次捏合返回 · Esc 退出手势操作' : '← → 切换照片 · Esc 关闭照片';
  setStatus(STATE.ZOOMED);
  flashGesture('放大查看');
}

function restoreFromZoom() {
  zoomReturnArmed = false;
  selectionHeld = false;
  pointerPosition = null;
  pointerTarget = null;
  sphere.setSelection(-1);
  hideReticle();
  sphere.group.visible = true;
  zoomPlane.visible = false; zoomMat.map = null;
  if (typeof document !== 'undefined') document.body.classList.remove('photo-open');
  zoomHint.style.display = 'none';
  sphere.controlCards = true;        // 交还给球，update 会把透明度恢复
  const baseScale = Math.min(1, sphere.radiusScale);
  sphere.cards.forEach((c) => { c.mesh.scale.setScalar(baseScale); c.highlight = 0; });
  zoomCard = null; pick = -1; zoomLost = 0;
  skipNextZoom = true;   // 返回后跳过紧接着的一次松开，避免立刻又放大
  bloom.strength = CONFIG.fx.bloomStrength;   // 恢复辉光
  setStatus(STATE.IDLE);
}

// 放大动画：展示面淡入，背景整球淡出
function updateZoom(dt) {
  if (state !== STATE.ZOOMED) return;
  hideReticle();
  zoomMat.opacity = THREE.MathUtils.lerp(zoomMat.opacity, 1, 1 - Math.pow(0.82, dt * 60));
}

// 角落手部骨架
const CONNECTIONS = [
  [0,1],[1,2],[2,3],[3,4],[0,5],[5,6],[6,7],[7,8],[5,9],[9,10],[10,11],[11,12],
  [9,13],[13,14],[14,15],[15,16],[13,17],[17,18],[18,19],[19,20],[0,17],
];
function drawSkeleton(frame) {
  const w = overlay.width, h = overlay.height;
  octx.clearRect(0, 0, w, h);
  for (const hand of frame.hands) {
    const lm = hand.landmarks;
    const isLeft = hand.label === 'L';                 // 左手(出数字)=绿，右手(动作)=蓝
    octx.strokeStyle = isLeft ? 'rgba(120,255,180,0.9)' : 'rgba(90,200,255,0.95)';
    octx.lineWidth = 2;
    for (const [a, b] of CONNECTIONS) {
      octx.beginPath();
      octx.moveTo(lm[a].x * w, lm[a].y * h);
      octx.lineTo(lm[b].x * w, lm[b].y * h);
      octx.stroke();
    }
    octx.fillStyle = isLeft ? 'rgba(190,255,220,0.95)' : 'rgba(180,230,255,0.95)';
    for (const p of lm) {
      octx.beginPath(); octx.arc(p.x * w, p.y * h, 2.5, 0, 7); octx.fill();
    }
  }
}

// ---------- 诊断 ----------
const probeCanvas = document.createElement('canvas');
probeCanvas.width = 32; probeCanvas.height = 24;
const probeCtx = probeCanvas.getContext('2d', { willReadFrequently: true });
let fps = 0, fpsT = performance.now(), fpsN = 0, lastBright = -1, brightT = 0;
let lastDebugTime = -Infinity;

function updateDebug(frame, now) {
  fpsN++;
  if (now - fpsT > 500) { fps = Math.round(fpsN * 1000 / (now - fpsT)); fpsN = 0; fpsT = now; }
  if (now - lastDebugTime < CONFIG.performance.debugInterval) return;
  lastDebugTime = now;

  // 每 ~300ms 采样一次视频亮度，判断是否黑屏
  if (now - brightT > 300 && video.videoWidth > 0) {
    brightT = now;
    try {
      probeCtx.drawImage(video, 0, 0, 32, 24);
      const d = probeCtx.getImageData(0, 0, 32, 24).data;
      let s = 0; for (let i = 0; i < d.length; i += 4) s += d[i] + d[i + 1] + d[i + 2];
      lastBright = Math.round(s / (32 * 24 * 3));
    } catch (e) { lastBright = -2; }
  }

  const vw = video.videoWidth, vh = video.videoHeight;
  const camTxt = vw ? `${vw}x${vh}` : '无信号';
  const brightTxt = lastBright < 0 ? '—' : lastBright;
  const blackFrame = vw && lastBright >= 0 && lastBright < 4;

  let cls = '';
  if (modelStatus.startsWith('失败') || camStatus.startsWith('失败')) cls = 'err';
  else if (modelStatus !== 'OK' || camStatus !== '已连接' || blackFrame) cls = 'warn';

  let hint = '';
  if (camStatus.includes('NotAllowed')) hint = '\n⚠ 权限被拒：点地址栏摄像头图标→允许，再刷新';
  else if (camStatus.includes('NotFound') || camStatus.includes('Devices')) hint = '\n⚠ 没找到摄像头设备';
  else if (camStatus.includes('NotReadable') || camStatus.includes('TrackStart')) hint = '\n⚠ 摄像头被其他程序占用，先关掉它们';
  else if (camStatus === '已授权但无画面' || blackFrame) hint = '\n⚠ 有权限但画面黑：镜头遮挡/隐私开关/被占用';
  else if (modelStatus.startsWith('失败')) hint = '\n⚠ 本地手势资源加载失败，请完整解压项目后重试';

  const gmap = { fist: '握拳', open: '张掌', pinch: '捏合', none: '—' };
  const handN = frame.hands?.length || 0;
  const rg = gmap[frame.rightGesture] || '—';
  if (handN === 1 && !hint) hint = '\n⚠ 只看到一只手：需左手出数字 + 右手动作';

  debugEl.className = cls;
  debugEl.textContent =
    `模型 ${modelStatus}   fps ${fps}\n` +
    `识别 ${gc.backend}  ${Math.round(gc.inferenceMs)}ms\n` +
    `摄像头 ${camStatus}\n` +
    `画面 ${camTxt}  亮度 ${brightTxt}\n` +
    `识别到的手 ${handN}\n` +
    `左手数字 ${frame.mode}   右手 ${rg}` + hint;
}

// ---------- Desktop input and exclusive gesture mode ----------
function report(message){window.dispatchEvent(new CustomEvent('atlas-notice',{detail:message}));}
function resetTracking(){
  clearSelection();rightPinchPrev=false;skipNextZoom=false;prevMode=0;zoomLost=0;
  sphere.spin.x=sphere.spin.y=0;
  if(state!==STATE.ZOOMED)setStatus(STATE.IDLE);
  if(gc._emptyFrame){gc.frame=gc._emptyFrame();gc.persist={Left:gc._blank(),Right:gc._blank()};gc.modeStable={val:0,cand:0,count:0};gc.rightStable={val:'none',cand:'none',count:0};gc.swipeHist=[];gc.lastVideoTime=-1;gc.version++;}
  lastFrameVersion=-1;lastGestureTime=performance.now();
}
function stopCamera(){cameraGeneration++;video.srcObject?.getTracks().forEach(t=>t.stop());video.srcObject=null;camStatus='已关闭';}
export function exitGesture(){
  gestureActive=false;gestureStarting=false;inputMode.set(false);stopCamera();resetTracking();
  document.body.classList.remove('gesture-active');document.getElementById('gesture-banner').hidden=true;
  const b=document.getElementById('gesture-toggle');b.disabled=false;b.textContent='◎ 手势操作';
  gestureEl.textContent='';statusEl.textContent='键鼠浏览';
  if(zoomPlane.visible)zoomHint.textContent='← → 切换照片 · Esc 关闭照片';
}
export async function beginGesture(){
  if(!active||gestureStarting||gestureActive)return;
  gestureStarting=true;const generation=++cameraGeneration;
  const b=document.getElementById('gesture-toggle');b.disabled=true;b.textContent='正在准备摄像头与模型…';
  try{
    await Promise.all([startCamera(),startModel()]);
    if(generation!==cameraGeneration||!active)return;
    resetTracking();drag=null;gestureStarting=false;gestureActive=true;inputMode.set(true);
    if(document.activeElement instanceof HTMLElement)document.activeElement.blur();
    document.body.classList.add('gesture-active');document.getElementById('gesture-banner').hidden=false;
    b.textContent='手势操作中 · Esc 退出';statusEl.textContent='手势操作';
    overlay.width=video.clientWidth;overlay.height=video.clientHeight;
    if(zoomPlane.visible)zoomHint.textContent='再次捏合返回 · Esc 退出手势操作';
  }catch(e){if(generation===cameraGeneration){exitGesture();report('手势启动失败：'+e.message+'。可继续使用键鼠。');}}
}
export function setActive(value){active=value;canvas.hidden=!value;if(!value)exitGesture();}
export function setPhotos(files){if(zoomPlane.visible)restoreFromZoom();clearSelection();sphere.setPhotos(files);camera.position.z=CONFIG.camera.distance;}
const raycaster=new THREE.Raycaster();
function hit(e){
  raycaster.setFromCamera(new THREE.Vector2(e.clientX/innerWidth*2-1,1-e.clientY/innerHeight*2),camera);
  sphere.group.updateWorldMatrix(true,true);
  const hits=raycaster.intersectObjects(sphere.cards.map(c=>c.mesh),false);
  return hits.length?sphere.cards.findIndex(c=>c.mesh===hits[0].object):-1;
}
let drag=null;
canvas.addEventListener('pointerdown',e=>{if(!active||gestureActive||e.button!==0||zoomPlane.visible)return;sphere.setSelection(-1);drag={id:e.pointerId,x:e.clientX,y:e.clientY,startX:e.clientX,startY:e.clientY,moved:false};canvas.setPointerCapture(e.pointerId);});
canvas.addEventListener('pointermove',e=>{
  if(!active||gestureActive||zoomPlane.visible)return;
  if(drag){const dx=e.clientX-drag.x,dy=e.clientY-drag.y;if(Math.hypot(e.clientX-drag.startX,e.clientY-drag.startY)>5)drag.moved=true;if(drag.moved){sphere.group.rotation.y+=dx*.006;sphere.group.rotation.x+=dy*.006;sphere.spin.x=sphere.spin.y=0;}drag.x=e.clientX;drag.y=e.clientY;}
  else sphere.setSelection(hit(e));
});
canvas.addEventListener('pointerup',e=>{if(!drag)return;const d=drag;drag=null;canvas.releasePointerCapture(e.pointerId);if(!d.moved){pick=hit(e);if(pick>=0)enterZoom();}});
canvas.addEventListener('pointercancel',()=>{drag=null;});
canvas.addEventListener('pointerleave',()=>{if(!drag)sphere.setSelection(-1);});
canvas.addEventListener('wheel',e=>{if(!active||gestureActive)return;e.preventDefault();if(zoomPlane.visible)return;camera.position.z=THREE.MathUtils.clamp(camera.position.z+e.deltaY*.012,7,24);},{passive:false});
addEventListener('keydown',e=>{
  if(!active||gestureActive||document.querySelector('dialog[open]')||['INPUT','TEXTAREA'].includes(e.target.tagName))return;
  if(e.key==='Escape'){e.preventDefault();if(gestureStarting){exitGesture();return;}if(zoomPlane.visible)restoreFromZoom();else window.dispatchEvent(new Event('atlas-back'));}
  if(zoomPlane.visible&&['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();pick=(pick+(e.key==='ArrowRight'?1:-1)+sphere.cards.length)%sphere.cards.length;enterZoom();}
});
bootEl.style.display='none';requestAnimationFrame(loop);
