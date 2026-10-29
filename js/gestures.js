import { HandLandmarker, FilesetResolver } from '../vendor/mediapipe/vision_bundle.mjs';
import { CONFIG } from './config.js';

// ---- 向量工具（landmark: {x,y,z}） ----
const dist2d = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const TIP = { thumb: 4, index: 8, middle: 12, ring: 16, pinky: 20 };
const PIP = { thumb: 2, index: 6, middle: 10, ring: 14, pinky: 18 };
const FINGER_MCP = { index: 5, middle: 9, ring: 13, pinky: 17 };
const MCP = [5, 9, 13, 17];

export class GestureController {
  constructor() {
    this.landmarker = null;
    this.ready = false;
    this.lastVideoTime = -1;
    this.worker = null;
    this.busy = false;
    this.lastInference = -Infinity;
    this.version = 0;
    this.backend = '加载中';
    this.inferenceMs = 0;

    // 每只手的持久状态（按 handedness 标签存）
    this.persist = { Left: this._blank(), Right: this._blank() };

    // 滑动历史
    this.swipeHist = [];
    this.lastSwipe = -Infinity;
    this.swipeArmed = true;   // 需手速降下来后才再次允许触发

    // 稳定器：左手数字(mode)、右手手势各自需连续稳定若干帧才提交，消除抖动
    this.modeStable = { val: 0, cand: 0, count: 0 };
    this.rightStable = { val: 'none', cand: 'none', count: 0 };

    // 对外事件回调
    this.onSwipe = null;   // (dir) => {}

    // 对外每帧状态
    this.frame = this._emptyFrame();
  }

  _blank() { return { pinchActive: false, pinchSmoothed: 0.5,
    pinchCandidate: false, pinchSince: 0, pinchSamples: 0 }; }

  _emptyFrame() {
    return {
      hands: [],            // 用于画骨架
      leftHand: null,       // 画面左侧手（出数字）
      rightHand: null,      // 画面右侧手（执行动作）——位置等连续量用它
      mode: 0,              // 左手数字 1~5（稳定后），0=无
      rightGesture: 'none', // 右手稳定后的手势
    };
  }

  // 通用稳定层：候选值需连续达到 need 帧才提交
  _commit(store, raw, need) {
    if (raw === store.cand) store.count++;
    else { store.cand = raw; store.count = 1; }
    if (store.count >= need) store.val = raw;
    return store.val;
  }

  async init() {
    if (typeof Worker !== 'undefined' && typeof createImageBitmap === 'function') {
      try {
        await this._initWorker();
        this.ready = true;
        this.backend = '后台线程';
        return;
      } catch (error) {
        console.warn('Worker unavailable; using throttled main-thread inference.', error);
        this.worker?.terminate(); this.worker = null;
      }
    }
    await this._initMainThread();
  }

  _initWorker() {
    return new Promise((resolve, reject) => {
      const worker = new Worker(new URL('./gesture-worker.js?v=20261026-1', import.meta.url));
      this.worker = worker;
      const timer = setTimeout(() => reject(new Error('Worker initialization timed out')), 30000);
      const fail = (error) => {
        clearTimeout(timer);
        if (!this.ready) { reject(error); return; }
        worker.terminate(); this.worker = null; this.busy = false; this.ready = false;
        this._consume({ landmarks: [] }, performance.now());
        this._initMainThread().catch(e => { this.backend = '识别失败'; console.error(e); });
      };
      worker.onerror = (event) => { event.preventDefault(); fail(new Error(event.message)); };
      worker.onmessage = ({ data }) => {
        if (data.type === 'ready') { clearTimeout(timer); resolve(); }
        else if (data.type === 'error') fail(new Error(data.message));
        else if (data.type === 'result') {
          this.busy = false;
          this.inferenceMs = data.elapsed;
          this._consume(data, data.timestamp);
        }
      };
      worker.postMessage({ type: 'init' });
    });
  }

  async _initMainThread() {
    const vision = await FilesetResolver.forVisionTasks(
      new URL('../vendor/mediapipe/wasm', import.meta.url).href
    );
    this.landmarker = await HandLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath:
          new URL('../vendor/models/hand_landmarker.task', import.meta.url).href,
        delegate: 'GPU',
      },
      runningMode: 'VIDEO',
      numHands: 2,
    });
    this.ready = true;
    this.backend = '兼容模式';
  }

  // 每帧调用：处理视频，更新 this.frame，触发事件
  update(video, nowMs) {
    if (!this.ready || video.readyState < 2) return this.frame;
    if (video.currentTime === this.lastVideoTime) return this.frame;
    const interval = 1000 / (this.worker ? CONFIG.performance.inferenceFps : 20);
    if (this.busy || nowMs - this.lastInference < interval) return this.frame;
    this.lastVideoTime = video.currentTime;
    this.lastInference = nowMs;

    if (this.worker) {
      this.busy = true;
      const worker = this.worker;
      const width = Math.min(video.videoWidth, CONFIG.performance.inferenceWidth);
      const height = Math.max(1, Math.round(video.videoHeight * width / video.videoWidth));
      createImageBitmap(video, { resizeWidth: width, resizeHeight: height }).then(bitmap => {
        if (this.worker !== worker) { bitmap.close(); this.busy = false; return; }
        try { worker.postMessage({ type: 'frame', bitmap, timestamp: nowMs }, [bitmap]); }
        catch (error) { bitmap.close(); this.busy = false; console.warn(error); }
      }).catch(error => { this.busy = false; console.warn('Camera frame capture:', error); });
      return this.frame;
    }

    let res;
    const start = performance.now();
    try { res = this.landmarker.detectForVideo(video, nowMs); }
    catch (e) { return this.frame; }
    this.inferenceMs = performance.now() - start;
    this._consume(res, nowMs);
    return this.frame;
  }

  _consume(res, nowMs) {
    // 镜像 x（自拍视角），按 9 号关节的 x 作为手中心
    const raws = [];
    if (res && res.landmarks) {
      for (const r of res.landmarks) {
        const lm = r.map((p) => ({ x: 1 - p.x, y: p.y, z: p.z }));
        raws.push({ lm, cx: lm[9].x });
      }
    }
    // 按屏幕 x 排序：最左 = 左手(出数字)，最右 = 右手(执行动作)
    raws.sort((a, b) => a.cx - b.cx);

    let left = null, right = null;
    if (raws.length >= 2) {
      left = this._analyzeHand(raws[0].lm, 'L', nowMs);
      right = this._analyzeHand(raws[raws.length - 1].lm, 'R', nowMs);
    } else if (raws.length === 1) {
      // 只有一只手：无法构成「数字+动作」，仅作右手记录，mode 保持 0
      right = this._analyzeHand(raws[0].lm, 'R', nowMs);
    }

    this.frame.hands = [left, right].filter(Boolean);
    this.frame.leftHand = left;
    this.frame.rightHand = right;

    // 左手数字 = 左手四指计数（拇指仅区分4/5），用更长的提交帧防乱跳
    const rawMode = left ? left.numberCount : 0;
    this.frame.mode = this._commit(this.modeStable, rawMode, rawMode === 1 ? 2 : CONFIG.gesture.modeCommit);
    // 右手手势经稳定层
    // 模式3直接使用已确认的捏合，不要求另外三指伸直，也不再重复等待稳定帧。
    const selectionPinch = this.frame.mode === 3 && right?.pinchActive;
    this.frame.rightGesture = selectionPinch ? 'pinch' :
      this._commit(this.rightStable, right ? right.gesture : 'none', CONFIG.gesture.commitFrames);

    // 横扫只在 模式1 下、对右手生效
    // 模式1确认期间就开始记录轨迹，避免丢掉横扫的起始段。
    this._detectSwipe(nowMs, left && (rawMode === 1 || this.frame.mode === 1) ? right : null,
      this.frame.mode === 1);
    this.version++;

    return this.frame;
  }

  _analyzeHand(lm, label, nowMs = performance.now()) {
    const handSize = dist2d(lm[0], lm[9]) || 0.0001;
    const G = CONFIG.gesture;

    // 手是否大致竖直（数字手通常竖着比）：腕(0)在中指根(9)下方
    const upright = lm[0].y > lm[9].y;
    // 四指伸直判定：指尖不仅要远离手腕，还要沿 MCP→PIP 的方向继续延伸。
    // 旧算法只比较 y 坐标，弯曲的小拇指仍可能位于 PIP 上方，容易把“3”误读成“4”。
    const ext = (name) => {
      const tip = TIP[name], pip = PIP[name], mcp = FINGER_MCP[name];
      const ax = lm[pip].x - lm[mcp].x;
      const ay = lm[pip].y - lm[mcp].y;
      const bx = lm[tip].x - lm[pip].x;
      const by = lm[tip].y - lm[pip].y;
      const denom = Math.hypot(ax, ay) * Math.hypot(bx, by) || 0.0001;
      const alignment = (ax * bx + ay * by) / denom;
      const fartherFromWrist = dist2d(lm[tip], lm[0]) > dist2d(lm[pip], lm[0]) * 1.06;
      return alignment > 0.45 && fartherFromWrist;
    };
    // 拇指：必须明显外展（指尖远离食指根）才算伸直，避免比“1”被读成“2”
    const thumbOut = dist2d(lm[4], lm[5]) > handSize * G.thumbOut;
    const fingers = {
      thumb: thumbOut,
      index: ext('index'),
      middle: ext('middle'),
      ring: ext('ring'),
      pinky: ext('pinky'),
    };
    const openCount = Object.values(fingers).filter(Boolean).length;

    // 数字手势计数：只数四指；拇指仅用于区分 4 / 5（比 1~3 时拇指张开不会多算）
    const f4 = (fingers.index ? 1 : 0) + (fingers.middle ? 1 : 0) + (fingers.ring ? 1 : 0) + (fingers.pinky ? 1 : 0);
    const numberCount = f4 === 4 ? (fingers.thumb ? 5 : 4) : f4;

    // 掌心 = 关节平均
    const palm = { x: 0, y: 0 };
    for (const m of [0, ...MCP]) { palm.x += lm[m].x; palm.y += lm[m].y; }
    palm.x /= 5; palm.y /= 5;
    const curl =
      ([8, 12, 16, 20].reduce((s, t) => s + dist2d(lm[t], palm), 0) / 4) / handSize;

    // 捏合（带迟滞防抖）
    const pinchRaw = dist2d(lm[4], lm[8]) / handSize;
    const st = this.persist[label] || (this.persist[label] = this._blank());
    st.pinchSmoothed += (pinchRaw - st.pinchSmoothed) * G.smoothing;
    // 距离证据直接进入确认器，避免 EMA 延迟再叠加确认延迟。
    const nextPinch = st.pinchActive ? pinchRaw <= G.pinchOff : pinchRaw < G.pinchOn;
    if (nextPinch !== st.pinchCandidate) {
      st.pinchCandidate = nextPinch; st.pinchSince = nowMs; st.pinchSamples = 1;
    } else st.pinchSamples++;
    if (nextPinch !== st.pinchActive && st.pinchSamples >= 2 &&
        nowMs - st.pinchSince >= (nextPinch ? G.pinchConfirmMs : G.pinchReleaseMs)) st.pinchActive = nextPinch;

    // 中/无名/小指伸直的数量 —— 用来区分「握拳」和「捏合」
    const otherCount = (fingers.middle ? 1 : 0) + (fingers.ring ? 1 : 0) + (fingers.pinky ? 1 : 0);

    // 离散手势优先级：握拳 > 捏合 > 张掌
    // 握拳：所有手指蜷起；捏合：拇指食指捏住但其余手指仍伸着（避免握拳误判成捏合）
    let gesture = 'none';
    if (curl < G.fistCurl && otherCount <= 1) gesture = 'fist';
    else if (st.pinchActive && otherCount >= 2) gesture = 'pinch';
    else if (openCount >= G.openExtend) gesture = 'open';

    // 手中心（用于滑动/坍缩/选择准星）
    const centroid = { x: lm[9].x, y: lm[9].y };

    return {
      label, landmarks: lm, gesture, fingers, openCount, numberCount,
      pinch: st.pinchSmoothed, pinchActive: st.pinchActive,
      thumbMiddle: dist2d(lm[4], lm[12]) / handSize,
      curl, centroid, palmWidth: handSize,
      indexTip: lm[8], thumbTip: lm[4],
      score: openCount + (st.pinchActive ? 0.5 : 0), // 简单"主手"权重
    };
  }

  // —— 右手快速水平横扫（仅模式1调用，传入右手）——
  _detectSwipe(now, p, enabled = true) {
    if (!p) { this.swipeHist.length = 0; this.swipeArmed = true; return; }
    const G = CONFIG.gesture;
    const previous = this.swipeHist[this.swipeHist.length - 1];
    if (previous && now - previous.t > G.swipeMaxGap) {
      this.swipeHist.length = 0; this.swipeArmed = true;
    }
    this.swipeHist.push({ x: p.centroid.x, t: now });
    while (this.swipeHist.length && now - this.swipeHist[0].t > G.swipeWindow) this.swipeHist.shift();
    if (this.swipeHist.length < 2) return;
    const b = this.swipeHist[this.swipeHist.length - 1];
    // 用最近的最低点作为向右运动起点，回手不会稀释下一次右滑。
    let a = this.swipeHist[0];
    for (const sample of this.swipeHist.slice(0, -1)) if (sample.x < a.x) a = sample;
    const dt = (b.t - a.t) / 1000;
    if (dt <= 0) return;
    const travel = b.x - a.x;        // 累计水平位移（已镜像：右为正）
    const vx = travel / dt;          // 屏幕宽/秒
    // 只识别「向右」滑动。再武装：触发后需向右速度降下来才允许下一次（回手向左不触发）
    if (!this.swipeArmed) {
      const recent = this.swipeHist[this.swipeHist.length - 2];
      const recentV = (b.x - recent.x) / ((b.t - recent.t) / 1000 || 1);
      if (recentV < G.swipeRearm) {
        this.swipeArmed = true;
        this.swipeHist = [b];
      }
      return;
    }
    if (enabled && vx > G.swipeVel && travel >= G.swipeMinTravel &&
        now - this.lastSwipe > G.swipeCooldown) {
      this.lastSwipe = now;
      this.swipeArmed = false;
      this.swipeHist.length = 0;
      this.onSwipe?.(1);             // 固定向右
    }
  }
}
