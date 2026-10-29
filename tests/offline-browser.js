import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { HandLandmarker, FilesetResolver } from '../vendor/mediapipe/vision_bundle.mjs';
const result=document.getElementById('results'),lines=[];
function ok(value,message){if(!value)throw Error(message);lines.push('PASS '+message);result.textContent=lines.join('\n');}
let worker,detector;
try{
  ok(THREE.REVISION==='160'&&EffectComposer&&UnrealBloomPass,'Three.js、后期处理及其传递依赖全部从本地加载');
  const vision=await FilesetResolver.forVisionTasks(new URL('../vendor/mediapipe/wasm',import.meta.url).href);
  detector=await HandLandmarker.createFromOptions(vision,{baseOptions:{modelAssetPath:new URL('../vendor/models/hand_landmarker.task',import.meta.url).href,delegate:'CPU'},runningMode:'IMAGE',numHands:2});
  const canvas=document.createElement('canvas');canvas.width=256;canvas.height=256;canvas.getContext('2d').fillRect(0,0,256,256);
  const detected=detector.detect(canvas);ok(Array.isArray(detected.landmarks),'主线程加载本地 WASM、模型并对空白图完成真实推理');
  detector.close();detector=null;
  worker=new Worker('../js/gesture-worker.js');
  const ready=new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Worker timeout')),60000);worker.onmessage=e=>{if(e.data.type==='ready'){clearTimeout(timer);resolve();}if(e.data.type==='error'){clearTimeout(timer);reject(Error(e.data.message));}};worker.onerror=e=>{clearTimeout(timer);reject(Error(e.message));};});
  worker.postMessage({type:'init'});await ready;
  ok(true,'生产版 Worker 从本地加载识别运行环境和模型');
  const inference=new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Inference timeout')),30000);worker.onmessage=e=>{clearTimeout(timer);e.data.type==='result'?resolve(e.data):reject(Error(e.data.message));};});
  const bitmap=await createImageBitmap(canvas);worker.postMessage({type:'frame',bitmap,timestamp:1000},[bitmap]);const detectedWorker=await inference;
  ok(Array.isArray(detectedWorker.landmarks),'生产版 Worker 完成真实空白帧推理，全程无需摄像头');
  const external=performance.getEntriesByType('resource').filter(e=>e.name.startsWith('http')&&new URL(e.name).origin!==location.origin);
  ok(!external.length,'页面不请求远程 CDN 或模型地址，CSP 禁止远程连接');
  result.textContent+='\n\n全部检查通过。';
}catch(error){result.textContent+='\nFAIL '+error.stack;document.title='FAIL · 本地依赖检查';}
finally{worker?.terminate();detector?.close();}
