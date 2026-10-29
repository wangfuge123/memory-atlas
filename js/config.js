// ============================================================
//  全局配置 —— 所有可调参数集中在此，方便后期微调手感
// ============================================================

export const CONFIG = {
  performance: {
    maxPixelRatio: 1.25,   // 限制高分屏上的像素负担
    maxRenderPixels: 1600000,
    bloomScale: 0.6,       // 辉光以较低分辨率计算，照片保持清晰
    inferenceFps: 30,
    inferenceWidth: 640,
    debugInterval: 250,
  },
  // 照片球
  sphere: {
    count: 0,             // 使用的图片数量（0=用清单里的全部图片）
    radius: 4.4,          // 球半径
    planeSize: 1.35,      // 每张图最大边长（图多了适当缩小，保持间距）
    idleSpin: 0.0016,     // 空闲自转角速度 (rad/frame)
    desktopSpin: 0.12,    // 键鼠展示速度 (rad/second)，独立于手势冲量
    damping: 0.94,        // 拖拽/惯性阻尼
    spreadScale: 1.7,     // 张掌散开时的半径倍数
    convergeScale: 0.4,   // 握拳聚拢时的半径倍数（图片同比例缩小，成一个精致小球）
    lerp: 0.08,           // 半径/状态过渡插值速度
  },

  // 相机
  camera: {
    fov: 50,
    distance: 13,
  },

  // 手势灵敏度（基于手掌尺寸归一化，0~1）
  gesture: {
    pinchOn: 0.42,        // 捏合进入距离 / 手掌尺寸
    pinchOff: 0.60,       // 松开判定（带迟滞，防抖）
    fistCurl: 1.05,       // 握拳：所有指尖到掌心距离 / 手掌宽 小于此
    openExtend: 4,        // 张掌：至少几根手指伸直
    swipeVel: 0.30,       // 滑动触发的水平速度阈值（屏幕宽/秒）
    swipeMinTravel: 0.08, // 防止静止时的小幅抖动误触
    swipeWindow: 420,     // 容纳较低识别频率，不依赖至少3帧
    swipeMaxGap: 260,     // 超过此间隔，不把两段跟踪连成一次滑动
    swipeRearm: 0.15,
    swipeCooldown: 420,   // 滑动事件冷却 (ms)
    pinchConfirmMs: 45,   // 捏合至少两次观测，通常 50~70ms 内确认
    pinchReleaseMs: 75,  // 松开用更长确认时间，防止拖动中误释放
    smoothing: 0.5,       // 关键标量 EMA 平滑系数

    // —— 手指伸直判定（左手数字 / 右手张掌都用）——
    fingerMargin: 0.025,  // 手竖直时，指尖高于 PIP 关节多少算“伸直”（归一化纵坐标）
    thumbOut: 0.62,       // 拇指外展判定：拇指尖到食指根距离 / 手掌宽 大于此才算“伸直”（防止比1被读成2）

    // —— 稳定层 ——
    commitFrames: 3,      // 30fps 下约 0.1s，消除抖动同时减少等待
    modeCommit: 4,        // 30fps 下约 0.13s
  },

  // 选择 / 放大
  select: {
    pickRadius: 90,       // 准星命中半径 (px)
    releaseRadius: 120,   // 已选中时放宽退出边界，避免边缘跳进跳出
    switchMargin: 18,     // 另一张图片需明显更近才切换选择
    pointerSmoothing: 0.65, // 60fps 基准；每个渲染帧按时间平滑
    highlightLerp: 0.22,
    highlightScale: 1.35, // 高亮放大
    zoomScale: 3.4,       // 放大查看时的尺寸
  },

  // 辉光后期（用于高亮/放大的发光质感）
  fx: {
    bloomStrength: 0.18,
    bloomRadius: 0.5,
    bloomThreshold: 0.92,
  },
};

// 状态枚举
export const STATE = {
  IDLE: 'idle',           // 自由自转
  CONVERGED: 'converged', // 聚拢
  SPREAD: 'spread',       // 散开
  SELECTING: 'selecting', // 选择框
  ZOOMED: 'zoomed',       // 放大查看
};
