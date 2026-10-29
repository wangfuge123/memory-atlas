import * as THREE from 'three';
import { CONFIG, STATE } from './config.js';
import { IMAGE_FILES } from '../images-manifest.js';
import { squareCrop } from './image-layout.js';

// 斐波那契球面：N 个点在球面均匀分布
function fibonacciSphere(n) {
  if (n === 1) return [new THREE.Vector3(0, 0, 1)];
  if (n > 1 && n <= 4) return Array.from({length:n},(_,i)=>{
    const angle=i/n*Math.PI*2;
    return new THREE.Vector3(Math.cos(angle)*.53,Math.sin(angle)*.53,.85).normalize();
  });
  const pts = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    // 用 (i + 0.5) 取点，避免第一张/最后一张正好落在南北极点（自转时会“卡住”）
    const y = 1 - ((i + 0.5) / n) * 2;       // 约 0.92 -> -0.92
    const r = Math.sqrt(1 - y * y);
    const theta = golden * i;
    pts.push(new THREE.Vector3(Math.cos(theta) * r, y, Math.sin(theta) * r));
  }
  return pts;
}

// 生成渐变占位贴图（图片缺失时使用）
function placeholderTexture(i, total) {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d');
  const hue = (i / total) * 360;
  const grad = g.createLinearGradient(0, 0, 512, 512);
  grad.addColorStop(0, `hsl(${hue}, 60%, 22%)`);
  grad.addColorStop(1, `hsl(${(hue + 40) % 360}, 70%, 10%)`);
  g.fillStyle = grad;
  g.fillRect(0, 0, 512, 512);
  g.fillStyle = 'rgba(255,255,255,0.85)';
  g.font = 'bold 180px system-ui';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(String(i + 1), 256, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class PhotoSphere {
  constructor(scene, files = IMAGE_FILES) {
    this.scene = scene;
    this.group = new THREE.Group();
    scene.add(this.group);

    this.cards = [];                 // { mesh, baseDir, glow }
    this.selectedIndex = -1;
    this.radiusScale = 1;            // 当前半径缩放（聚拢/散开）
    this.targetRadiusScale = 1;
    this.spin = { x: 0, y: 0 };      // 角速度
    this.opacity = 1;                // 整体淡入淡出（坍缩用）
    this.targetOpacity = 1;
    this.controlCards = true;        // false 时由外部接管卡片缩放/透明度（放大查看）

    this.files = files;
    this.generation = 0;
    this._build();
  }

  _build() {
    const { planeSize } = CONFIG.sphere;
    // 用上清单里的全部图片（count<=0 表示“全部”；否则取前 count 张）
    const generation = ++this.generation;
    const want = CONFIG.sphere.count > 0 ? CONFIG.sphere.count : this.files.length;
    const count = Math.min(want, this.files.length);
    const dirs = fibonacciSphere(count);
    const loader = new THREE.TextureLoader();

    for (let i = 0; i < count; i++) {
      const dir = dirs[i];

      // 玻璃质感外发光边框
      const glowGeo = new THREE.PlaneGeometry(planeSize * 1.08, planeSize * 1.08);
      const glowMat = new THREE.MeshBasicMaterial({
        color: 0xd3bd93, transparent: true, opacity: 0.0,
        blending: THREE.AdditiveBlending, depthWrite: false,
      });
      const glow = new THREE.Mesh(glowGeo, glowMat);
      glow.position.z = -0.01;

      const geo = new THREE.PlaneGeometry(planeSize, planeSize);
      const mat = new THREE.MeshBasicMaterial({
        color: 0x888888, transparent: true, opacity: 1, side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.add(glow);

      // 加载真实图片；失败则占位图
      const source = this.files[i];
      const file = typeof source === 'string' ? source : source.url;
      const applyTex = (tex) => {
        if (generation !== this.generation) { tex.dispose(); return; }
        tex.colorSpace = THREE.SRGBColorSpace;
        // 保持图片比例，裁切到方形显示区
        const image = tex.image;
        const aspect = image?.width && image?.height ? image.width / image.height : 1;
        const crop = squareCrop(aspect);
        const uv = geo.attributes.uv;
        for (let j = 0; j < uv.count; j++) {
          uv.setXY(j, crop.x + (j % 2) * crop.width,
            crop.y + (j < 2 ? crop.height : 0));
        }
        uv.needsUpdate = true;
        mat.map = tex;
        mat.color.set(0xffffff);
        mat.needsUpdate = true;
      };
      if (file) {
        loader.load(
          file.startsWith('blob:') || file.startsWith('data:') ? file : encodeURI(file),
          applyTex,
          undefined,
          () => applyTex(placeholderTexture(i, count))
        );
      } else {
        applyTex(placeholderTexture(i, count));
      }

      const card = new THREE.Group();
      // 朝向只取决于局部球面方向，父球旋转时不必每帧 lookAt。
      card.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
      card.add(mesh);
      this.group.add(card);
      this.cards.push({ card, mesh, glow, mat, glowMat, source, baseDir: dir.clone(), highlight: 0 });
    }
    this._layout();
  }

  // 根据当前 radiusScale 放置卡片，朝外
  _layout() {
    const R = CONFIG.sphere.radius * this.radiusScale;
    for (const c of this.cards) {
      c.card.position.copy(c.baseDir).multiplyScalar(R);
    }
  }

  // 给一个向右滑动冲量
  swipeImpulse(dir = 1) {
    this.spin.y += 0.09 * dir;
  }

  setTargetRadius(scale) { this.targetRadiusScale = scale; }
  setTargetOpacity(o) { this.targetOpacity = o; }

  // 拖拽旋转（选择/手动）
  addSpin(dx, dy) {
    this.spin.y += dx;
    this.spin.x += dy;
  }

  update(state, idle, dt = 1 / 60) {
    if (!this.controlCards) return; // 放大时球已隐藏，暂停其计算
    const S = CONFIG.sphere;
    const steps = dt * 60;
    if (state === STATE.SELECTING) { this.spin.x = 0; this.spin.y = 0; }
    // 半径过渡
    if (this.radiusScale !== this.targetRadiusScale) {
      this.radiusScale += (this.targetRadiusScale - this.radiusScale) * (1 - Math.pow(1 - S.lerp, steps));
      if (Math.abs(this.targetRadiusScale - this.radiusScale) < 0.0001) this.radiusScale = this.targetRadiusScale;
      this._layout();
    }
    this.opacity += (this.targetOpacity - this.opacity) * (1 - Math.pow(0.88, steps));

    // 自转 + 惯性
    const decay = Math.pow(S.damping, steps);
    const integral = (1 - decay) / (1 - S.damping);
    const acceleration = idle ? S.idleSpin * 0.4 : 0;
    const steady = acceleration * S.damping / (1 - S.damping);
    this.group.rotation.y += (this.spin.y - steady) * integral +
      (steady + acceleration + (idle ? S.idleSpin : 0)) * steps;
    this.group.rotation.x += this.spin.x * integral;
    this.spin.y = steady + (this.spin.y - steady) * decay;
    this.spin.x *= decay;

    // 透明度 + 高亮（放大查看时交给外部控制）
    if (this.controlCards) {
      // 聚拢时图片随半径同比例缩小，保持间距比例 → 一个精致的小球，而不是挤成一坨
      const baseScale = Math.min(1, this.radiusScale);
      for (let i = 0; i < this.cards.length; i++) {
        const c = this.cards[i];
        const target = i === this.selectedIndex ? 1 : 0;
        c.highlight += (target - c.highlight) * (1 - Math.pow(1 - CONFIG.select.highlightLerp, steps));
        c.mat.opacity = this.opacity;
        c.glowMat.opacity = c.highlight * 0.8 * this.opacity;
        const hs = baseScale * (1 + c.highlight * (CONFIG.select.highlightScale - 1));
        c.mesh.scale.setScalar(hs);
      }
    }
  }

  // 获取世界坐标，用于投影到屏幕做选择
  worldPositions() {
    this.group.updateWorldMatrix(true, true);
    return this.cards.map((c) => {
      if (!c.worldPosition) c.worldPosition = new THREE.Vector3();
      return c.worldPosition.setFromMatrixPosition(c.card.matrixWorld);
    });
  }

  setHighlight(index, v) {
    if (this.cards[index]) this.cards[index].highlight = Math.max(this.cards[index].highlight, v);
  }

  setSelection(index) { this.selectedIndex = index; }

  // Presentation only: billboard cards stay legible as their sphere rotates.
  present(camera, dt) {
    if (!this.controlCards) return;
    this.presentationTime=(this.presentationTime||0)+dt;
    const entrance=Math.min(1,this.presentationTime/1.1);
    this.group.updateWorldMatrix(true,false);
    this.facing ||= new THREE.Quaternion();
    this.cameraFacing ||= new THREE.Quaternion();
    this.depthPosition ||= new THREE.Vector3();
    this.group.getWorldQuaternion(this.facing).invert();
    camera.getWorldQuaternion(this.cameraFacing);
    this.facing.multiply(this.cameraFacing);
    const radius=CONFIG.sphere.radius*this.radiusScale*this.group.scale.x;
    for(const c of this.cards){
      c.card.quaternion.copy(this.facing);
      this.depthPosition.copy(c.card.position).applyMatrix4(this.group.matrixWorld);
      const depth=THREE.MathUtils.clamp((this.depthPosition.z/radius+1)/2,0,1);
      c.mat.opacity*= (.7+.3*depth)*entrance;
      c.mat.color.setScalar(1);
      c.glowMat.opacity*=entrance;
    }
  }

  setPhotos(files) {
    for (const c of this.cards) {
      c.disposed=true; c.originalTexture?.dispose();
      this.group.remove(c.card);
      c.mesh.geometry.dispose(); c.glow.geometry.dispose();
      c.mat.map?.dispose(); c.mat.dispose(); c.glowMat.dispose();
    }
    this.cards=[]; this.files=files; this.selectedIndex=-1;
    this.radiusScale=this.targetRadiusScale=1;
    this.spin={x:0,y:0}; this.group.rotation.set(0,0,0);
    this.presentationTime=0;
    this._build();
  }
}
