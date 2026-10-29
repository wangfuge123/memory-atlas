// Classic worker: the WASM runtime may use importScripts internally.
let landmarker;
self.onmessage = async ({ data }) => {
  if (data.type === 'init') {
    try {
      const { HandLandmarker, FilesetResolver } = await import(
        '../vendor/mediapipe/vision_bundle.mjs');
      const vision = await FilesetResolver.forVisionTasks(
        new URL('../vendor/mediapipe/wasm', self.location.href).href);
      landmarker = await HandLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: new URL('../vendor/models/hand_landmarker.task', self.location.href).href,
          delegate: 'CPU',
        },
        runningMode: 'VIDEO', numHands: 2,
      });
      self.postMessage({ type: 'ready' });
    } catch (error) {
      self.postMessage({ type: 'error', message: String(error) });
    }
    return;
  }
  if (data.type === 'frame') {
    try {
      const start = performance.now();
      const result = landmarker.detectForVideo(data.bitmap, data.timestamp);
      self.postMessage({ type: 'result', landmarks: result.landmarks,
        timestamp: data.timestamp, elapsed: performance.now() - start });
    } catch (error) {
      self.postMessage({ type: 'error', message: String(error) });
    } finally {
      data.bitmap.close();
    }
  }
};
