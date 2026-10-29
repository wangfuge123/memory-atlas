async function request(path, payload) {
  const response = await fetch(path, payload === undefined ? {} : {
    method:'POST', headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),
  });
  let data;
  try { data=await response.json(); }
  catch { throw Error('本地回忆库服务尚未启动或仍为旧版，请关闭旧服务并重新运行 start.bat'); }
  if(!response.ok)throw Error(data.error || '本地回忆库读写失败');
  return data;
}
export function getLibraryInfo(){return request('/api/library');}
export function getAlbums() {return request('/api/albums');}
async function photoBlob(photo, kind='original') {
  const existing=kind==='original'?photo.blob:photo.thumb;
  if(existing)return existing;
  const url=kind==='original'?photo.original:photo.url;
  if(!url)throw Error('照片缺少文件地址');
  const response=await fetch(url);if(!response.ok)throw Error('读取照片失败：'+photo.name);
  return response.blob();
}
export async function saveAlbums(albums) {
  const payload=[];
  for(const album of albums){
    const photos=[];
    for(const p of album.photos)photos.push({id:p.id,name:p.name,data:await dataURL(await photoBlob(p)),thumbnail:await dataURL(await photoBlob(p,'thumb'))});
    payload.push({...album,photos});
  }
  await request('/api/albums',{albums:payload});
}
export async function deleteAlbum(id) {
  if (typeof id !== 'string' || !id) throw Error('未指定要删除的回忆');
  await request('/api/albums/delete',{id});
}
export async function makePhoto(file) {
  if (!['image/jpeg','image/png','image/webp'].includes(file.type)) throw Error('请选择 JPG、PNG 或 WebP 照片');
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 480 / Math.max(bitmap.width,bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width=Math.max(1,Math.round(bitmap.width*scale)); canvas.height=Math.max(1,Math.round(bitmap.height*scale));
  canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height); bitmap.close();
  const thumb = await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',.85));
  if (!thumb) throw Error('缩略图生成失败');
  return {id:crypto.randomUUID(),name:file.name,blob:file,thumb};
}
const dataURL = blob => new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=()=>reject(r.error);r.readAsDataURL(blob);});
export async function exportBackup(albums) {
  const result=[];
  for(const a of albums){ const photos=[];for(const p of a.photos) photos.push({id:p.id,name:p.name,data:await dataURL(await photoBlob(p))});result.push({...a,photos}); }
  return new Blob([JSON.stringify({format:'memory-atlas',version:1,exportedAt:new Date().toISOString(),albums:result})],{type:'application/json'});
}
export async function readBackup(file) {
  const data=JSON.parse(await file.text());
  if(data.format!=='memory-atlas'||data.version!==1||!Array.isArray(data.albums)) throw Error('不是有效的拾光地图备份');
  const albums=[]; const ids=new Set();
  for(const a of data.albums){
    if(typeof a.id!=='string'||ids.has(a.id)||typeof a.title!=='string'||typeof a.place!=='string'||typeof a.note!=='string'||typeof a.date!=='string'||!/^\d{6}$/.test(a.cityCode)||!/^\d{6}$/.test(a.countyCode)||!Array.isArray(a.point)||a.point.length!==2||!a.point.every(Number.isFinite)||Math.abs(a.point[0])>180||Math.abs(a.point[1])>90||!Array.isArray(a.photos)||!a.photos.length)throw Error('备份中有不完整的相册');
    ids.add(a.id); const photos=[];
    for(const p of a.photos){
      if(typeof p.name!=='string'||typeof p.data!=='string'||!/^data:image\/(jpeg|png|webp);base64,/.test(p.data)) throw Error('备份图片格式无效');
      const blob=await (await fetch(p.data)).blob();
      photos.push(await makePhoto(new File([blob],p.name,{type:blob.type})));
    }
    albums.push({id:a.id,title:a.title.slice(0,80),date:a.date,place:a.place.slice(0,80),note:a.note.slice(0,2000),cityCode:a.cityCode,countyCode:a.countyCode,point:a.point,photos});
  }
  return albums;
}
