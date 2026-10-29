import { InputMode } from '../js/input-mode.js';
import { getAlbums, saveAlbums, deleteAlbum, makePhoto, exportBackup, readBackup } from '../js/memory-store.js';
import { AtlasMap } from '../js/atlas-map.js';
const output=document.getElementById('results'),lines=[];
function ok(condition,message){if(!condition)throw Error(message);lines.push('PASS '+message);output.textContent=lines.join('\n');}
const testID='atlas-regression-disposable';
try {
  const target=document.createElement('div');document.body.append(target);
  let exits=0,downstream=0;const gate=new InputMode(target,()=>exits++);
  const dispatch=(type,props={})=>{const event=type.startsWith('key')?new KeyboardEvent(type,{bubbles:true,cancelable:true,...props}):new Event(type,{bubbles:true,cancelable:true});target.dispatchEvent(event);return event;};
  for(const name of gate.events)target.addEventListener(name,()=>downstream++);
  gate.set(true);for(const type of gate.events.filter(t=>!t.startsWith('key')))ok(dispatch(type).defaultPrevented,`手势模式拦截 ${type}`);
  dispatch('keydown',{key:'ArrowRight'});ok(downstream===0,'手势模式不向应用传递鼠标、滚轮、方向键');
  dispatch('keydown',{key:'Escape'});ok(exits===1&&!gate.active,'Esc 退出互斥手势模式');
  dispatch('keydown',{key:'Escape',repeat:true});ok(downstream===0,'长按 Esc 不会继续关闭照片或返回地图');
  dispatch('keyup',{key:'Escape'});dispatch('click');ok(downstream===1,'退出后恢复键鼠操作');
  const canvas=document.createElement('canvas');canvas.width=1200;canvas.height=800;canvas.getContext('2d').fillRect(0,0,1200,800);
  const blob=await new Promise(r=>canvas.toBlob(r,'image/png'));
  const photo=await makePhoto(new File([blob],'regression.png',{type:'image/png'}));
  const thumb=await createImageBitmap(photo.thumb);ok(thumb.width===480&&thumb.height===320,'保持照片比例生成 480px 缩略图');thumb.close();
  const album={id:testID,title:'回归测试',place:'测试地点',date:'2026-10-27',note:'仅测试，不作为用户回忆',cityCode:'370200',countyCode:'370211',point:[120.18,35.96],photos:[photo]};
  await saveAlbums([album]);const stored=(await getAlbums()).find(a=>a.id===testID);ok((await (await fetch(stored.photos[0].original)).blob()).size===blob.size,'通过本地服务保存文件并按原始字节读取照片');
  const backup=await exportBackup([stored]),restored=await readBackup(backup);ok(restored[0].note===album.note&&restored[0].photos[0].blob.size===blob.size,'备份导出与恢复保留文字、位置及完整原图');
  const siblingID=testID+'-sibling';
  await saveAlbums([{...album,id:siblingID,title:'应保留的测试相册'}]);
  await deleteAlbum(testID);
  const afterDelete=await getAlbums();
  ok(!afterDelete.some(a=>a.id===testID),'删除后重新读取本地回忆库不再展示已移入回收站的相册');
  ok(afterDelete.some(a=>a.id===siblingID),'删除一段回忆不影响其他相册');
  const remaining=await exportBackup(afterDelete.filter(a=>a.id===testID||a.id===siblingID));
  ok((await readBackup(remaining)).every(a=>a.id!==testID),'新导出的备份不包含已经删除的回忆');
  await deleteAlbum(siblingID);
  await saveAlbums(restored);ok((await getAlbums()).some(a=>a.id===testID),'删除前导出的备份仍可恢复回忆');
  let rejected=false;try{await readBackup(new Blob(['{"format":"other","albums":[]}']));}catch{rejected=true;}ok(rejected,'拒绝无效备份');
  rejected=false;try{await readBackup(new Blob([JSON.stringify({format:'memory-atlas',version:1,albums:[{...album,point:[999,0]}]})]));}catch{rejected=true;}ok(rejected,'恢复前验证地点坐标与数据结构');
  const national=await (await fetch('../data/maps/100000.json')).json(),cities=await (await fetch('../data/maps/cities.json')).json();
  const valid=cities.filter(c=>c.name&&/^\d{6}$/.test(c.adcode));ok(valid.length>300,'全国城市索引可用，覆盖直辖市与普通地级区域');
  const missing=[];for(const c of valid){if(c.childrenNum===0)continue;const r=await fetch(`../data/maps/${c.adcode}.json`);if(!r.ok)missing.push(c.name);}
  ok(missing.length===0,'全部有下辖区域的城市均有本地地图数据：'+missing.join(','));
  const map=Object.create(AtlasMap.prototype);map.minX=73;map.maxY=map.merc(54);map.scale=8;map.offsetX=50;map.offsetY=50;map.view={x:33,y:-20,k:2};
  const point=[120.18,35.96],p=map.project(point),round=map.unproject({x:p[0]*2+33,y:p[1]*2-20});ok(Math.abs(point[0]-round[0])<1e-8&&Math.abs(point[1]-round[1])<1e-8,'缩放平移后地图选点坐标可正确还原');
  // Exercise the real application controls with a disposable, uniquely named album.
  const fixture={...album,title:'删除回忆自动测试-'+crypto.randomUUID()};
  await saveAlbums([fixture]);
  const frame=document.createElement('iframe');frame.style.cssText='width:1200px;height:850px;border:1px solid #608d79';frame.src='../index.html';document.body.append(frame);
  const wait=async fn=>{const end=Date.now()+20000;while(Date.now()<end){if(fn())return;await new Promise(r=>setTimeout(r,50));}throw Error('等待应用界面超时');};
  const doc=()=>frame.contentDocument;
  const row=title=>[...doc().querySelectorAll('#entries .entry')].find(b=>b.querySelector('strong')?.textContent===title);
  const openCounty=async()=>{
    await wait(()=>doc()?.querySelector('#entries .entry'));
    doc().getElementById('browse-places').click();
    ok(doc().body.classList.contains('search-open'),'全国首页通过寻找地点展开城市搜索');
    const search=doc().getElementById('search');search.value='青岛';search.dispatchEvent(new Event('input'));
    row('青岛市').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));
    await wait(()=>doc().body.dataset.level==='2');
    row('黄岛区').dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));
    await wait(()=>doc().body.dataset.level==='3');
  };
  await openCounty();row(fixture.title).click();
  const remove=doc().getElementById('delete-memory');ok(!remove.disabled,'第三层选中个人回忆后启用删除入口');
  doc().querySelector('#manage-menu summary').click();ok(doc().getElementById('manage-menu').open,'管理菜单可以展开备份、恢复和删除操作');
  remove.click();ok(doc().getElementById('delete-dialog').open&&doc().getElementById('delete-summary').textContent.includes(fixture.title),'删除前显示正确相册及照片数量的确认窗口');
  doc().getElementById('cancel-delete').click();
  ok((await getAlbums()).some(a=>a.id===testID)&&doc().body.dataset.level==='3','取消删除保留回忆并停留在当前地图');
  remove.click();doc().getElementById('delete-form').requestSubmit();
  await wait(()=>!doc().getElementById('delete-dialog').open&&!row(fixture.title));
  ok(!(await getAlbums()).some(a=>a.id===testID),'通过真实删除表单删除相册并刷新地图列表');
  const remainingCount=(await getAlbums()).filter(a=>a.countyCode===fixture.countyCode).length;
  ok(doc().querySelector('#stats b').textContent===String(remainingCount),'删除后地图回忆统计同步更新');
  row('拾光初见 · 演示相册').click();ok(remove.disabled&&!doc().querySelector('#selection .danger'),'演示相册没有个人回忆删除入口');
  await saveAlbums([fixture]);
  const previousDocument=doc();frame.src='../index.html?delete-test=second';await wait(()=>doc()!==previousDocument&&doc()?.readyState==='complete'&&doc().querySelector('#entries .entry'));
  await openCounty();row(fixture.title).dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));
  await wait(()=>doc().body.dataset.level==='4');
  doc().getElementById('delete-memory').click();doc().getElementById('delete-form').requestSubmit();
  await wait(()=>doc().body.dataset.level==='3'&&!doc().getElementById('delete-dialog').open);
  ok(!(await getAlbums()).some(a=>a.id===testID),'第四层删除当前相册后释放图片球并返回所属区县');
  frame.remove();
  output.textContent+='\n\n全部检查通过。';
}catch(e){output.textContent+='\nFAIL '+e.stack;document.title='FAIL · 拾光地图回归';}
finally{
  await deleteAlbum(testID);await deleteAlbum(testID+'-sibling');
}
