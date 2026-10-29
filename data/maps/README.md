# 地图数据快照

来源：阿里云 DataV.GeoAtlas，`https://geo.datav.aliyun.com/areas_v3/bound/{adcode}_full.json`。

下载日期：2026-10-27。下载日期不代表源数据的行政区划更新日期。

全国与省级边界用于生成城市索引，城市文件用于区县导航。原数据中的南海诸岛线状要素保留在全国地图内，但不作为可进入的城市。没有下辖区县数据的区域使用城市索引中的已有边界，不生成虚构区县。

运行 `node scripts/download-maps.cjs` 可补齐缺失数据。所有数据以数据源为准。
