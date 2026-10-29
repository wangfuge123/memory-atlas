# 第三方资源与演示素材

项目自编代码及 `sample-photos` 中由 `scripts/generate-samples.py` 程序生成的风景插画使用根目录 MIT 许可证。插画用于功能演示，不代表真实照片、拍摄地点或用户经历。用户自行放入 `demo-photos` 和回忆库的照片不在此授权范围。

## Three.js 0.160.0

- 来源：https://www.npmjs.com/package/three/v/0.160.0
- 上游：https://github.com/mrdoob/three.js
- 许可证：MIT，完整文本保留在 `vendor/three/LICENSE`。

## MediaPipe Tasks Vision 0.10.14

- 来源：https://www.npmjs.com/package/@mediapipe/tasks-vision/v/0.10.14
- 上游：https://github.com/google-ai-edge/mediapipe
- 许可证：Apache-2.0，完整文本保留在 `vendor/mediapipe/LICENSE`。
- 手部模型来源：https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task
- 模型许可资料：https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker
- MediaPipe 的发布文件可能包含第三方组件声明，保留下载文件中的声明。

## CPython 3.13.12（Windows x64 便携环境）

- 官方下载：https://www.python.org/ftp/python/3.13.12/python-3.13.12-embed-amd64.zip
- 官方说明：https://docs.python.org/3.13/using/windows.html#the-embeddable-package
- 许可证与第三方声明：保留于完整包的 `runtime/python/LICENSE.txt`。
- 源码仓库不包含此二进制环境，首次需要时下载，完整包包含便携环境。

## 地图边界数据

- 来源：阿里云 DataV.GeoAtlas，https://datav.aliyun.com/portal/school/atlas/area_selector
- 接口：https://geo.datav.aliyun.com/areas_v3/bound/
- 下载快照时间：2026-10-27。
- 数据为边界示意，不包含导航、街道或测绘精度保证；行政区划依数据源。
- 地图数据未因项目的 MIT 许可证而获得重新授权。现有文件未附明确的再分发许可证，正式公开分发前需由维护者确认数据源的适用条款及地图发布要求。

所有下载项的固定地址和 SHA-256 见 `resources.lock.json`，本地浏览器资源逐文件校验值见 `vendor/checksums.json`。

## Mac 便携 CPython 3.13.18

- 构建来源：Astral 的 python-build-standalone 官方项目 https://github.com/astral-sh/python-build-standalone/releases/tag/20261026 。此为 CPython 的第三方独立构建，并非 python.org 的 macOS 安装包。
- 分别使用 aarch64-apple-darwin 和 x86_64-apple-darwin 的 install_only 构建。
- 固定下载地址、原项目提供的 SHA-256 摘要均锁定在 resources.lock.json。
- Mac 包保留上游完整运行环境、许可证与第三方声明；CPython 本身和其依赖分别遵循各自条款。
- 项目启动脚本不会安装全局软件、修改系统 Python 或自动清除 macOS 隔离标记。
