import { AtlasMap } from './atlas-map.js';
import { getAlbums, saveAlbums, deleteAlbum, makePhoto, exportBackup, readBackup, getLibraryInfo } from './memory-store.js';
import { IMAGE_FILES } from '../images-manifest.js';
const $=id=>document.getElementById(id);
let activeAlbum=null,deleteTarget=null,deleting=false;
const deleteButton=document.createElement('button');
deleteButton.id='delete-memory';deleteButton.textContent='删除回忆';deleteButton.className='danger';deleteButton.disabled=true;
deleteButton.title='在区县地图选中一段个人回忆，或进入其图片球后删除';
document.querySelector('.header-actions').insertBefore(deleteButton,$('add'));
const manage=document.createElement('details');manage.id='manage-menu';
manage.innerHTML='<summary>管理 ···</summary><div class="manage-popover"></div>';
document.querySelector('.header-actions').insertBefore(manage,$('add'));
manage.querySelector('div').append($('export'),$('restore'),deleteButton);
manage.addEventListener('click',e=>{if(e.target.closest('button'))manage.open=false;});
const browse=document.createElement('button');browse.id='browse-places';browse.textContent='⌕ 寻找地点';browse.setAttribute('aria-expanded','false');
document.querySelector('.header-actions').insertBefore(browse,manage);
function showSearch(open=true){document.body.classList.toggle('search-open',open);browse.setAttribute('aria-expanded',String(open));if(open)$('search').focus();}
browse.onclick=()=>showSearch(!document.body.classList.contains('search-open'));
const closeLibrary=document.createElement('button');closeLibrary.className='library-close';closeLibrary.textContent='×';closeLibrary.setAttribute('aria-label','收起地点搜索');closeLibrary.onclick=()=>showSearch(false);document.querySelector('.library').prepend(closeLibrary);
const archiveIndex=document.createElement('div');archiveIndex.className='archive-index';archiveIndex.innerHTML='<strong id="archive-count">000</strong><span>段被珍藏的时光</span>';document.querySelector('.intro').append(archiveIndex);
const shelf=document.createElement('section');shelf.id='memory-shelf';shelf.setAttribute('aria-label','回忆预览');document.querySelector('.workspace').append(shelf);
const deleteDialog=document.createElement('dialog');
deleteDialog.id='delete-dialog';deleteDialog.setAttribute('aria-labelledby','delete-title');
deleteDialog.innerHTML='<form id="delete-form"><h2 id="delete-title">删除这段回忆？</h2><p id="delete-summary"></p><p>确认后会将该相册及全部照片、地点和文字移入回忆库的“回收站”文件夹。导入前的源照片和已导出的备份不会被删除。</p><div class="dialog-actions"><button type="button" id="cancel-delete" autofocus>取消</button><button type="submit" class="danger">确认删除</button></div></form>';
document.body.append(deleteDialog);
function requestDelete(album){
  if(!album||album.demo||!albums.some(a=>a.id===album.id))return;
  if(level===4)sphereAPI?.exitGesture();
  deleteTarget=album;$('delete-summary').textContent=`「${album.title}」 · ${album.photos.length} 张照片 · ${album.place}`;
  deleteDialog.showModal();$('cancel-delete').focus();
}
deleteButton.onclick=()=>requestDelete(level===4?activeAlbum:selected);
$('cancel-delete').onclick=()=>{if(!deleting)deleteDialog.close();};
deleteDialog.addEventListener('cancel',e=>{if(deleting)e.preventDefault();});
deleteDialog.addEventListener('close',()=>{deleteTarget=null;});
$('delete-form').onsubmit=async e=>{
  e.preventDefault();if(deleting||!deleteTarget)return;
  const album=deleteTarget,submit=e.currentTarget.querySelector('[type=submit]');
  deleting=true;submit.disabled=true;$('cancel-delete').disabled=true;submit.textContent='正在删除…';
  try{
    await deleteAlbum(album.id);
  }catch(err){toast('删除失败：'+err.message);return;}
  finally{deleting=false;submit.disabled=false;$('cancel-delete').disabled=false;submit.textContent='确认删除';}
  albums=albums.filter(a=>a.id!==album.id);
  if(activeAlbum?.id===album.id){sphereAPI?.setActive(false);sphereAPI?.setPhotos([]);objectURLs.forEach(URL.revokeObjectURL);objectURLs=[];activeAlbum=null;}
  deleteDialog.close();deleteButton.disabled=true;
  try{await show(level===4?3:level);toast(`已删除「${album.title}」及 ${album.photos.length} 张照片。`);}
  catch(err){toast('回忆已删除，界面刷新失败，请刷新页面：'+err.message);}
};
document.querySelector('.map-panel').append($('selection'));
let cities=[],national,albums=[],level=1,city=null,county=null,features=[],selected=null,provinceFilter='',sphereAPI=null,objectURLs=[],pendingPoint=null,renderVersion=0;
const demo={id:'demo',title:'拾光初见 · 演示相册',place:'演示地点',date:'',note:'这是演示影像；可在 demo-photos 文件夹放入自己的演示照片。地图位置仅用于体验四层导航，并非照片的真实拍摄地点。',cityCode:'370200',countyCode:'370211',point:[120.18,35.96],demo:true,photos:IMAGE_FILES};
let toastTimer;
function toast(message){$('toast').textContent=message;$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,6500);}
window.addEventListener('atlas-notice',e=>toast(e.detail));
window.addEventListener('atlas-back',()=>back());
const map=new AtlasMap($('atlas'),select,enter,p=>{pendingPoint=p;toast('已选择地图位置，点击“添加回忆”保存到这里。');});
const cache=new Map();
async function geo(code){
  const leaf=cities.find(c=>String(c.adcode)===String(code)&&c.childrenNum===0&&c.outline);
  if(leaf)return {type:'FeatureCollection',features:[leaf.outline]};
  if(!cache.has(String(code)))cache.set(String(code),fetch(`data/maps/${code}.json`).then(r=>{if(!r.ok)throw Error('该区域暂缺本地边界数据');return r.json();}).catch(e=>{cache.delete(String(code));throw e;}));return cache.get(String(code));
}
function textNode(tag,text,cls){const el=document.createElement(tag);el.textContent=text;if(cls)el.className=cls;return el;}
function cityAlbums(code){return albums.filter(a=>a.cityCode===String(code));}
function countyAlbums(code){return albums.filter(a=>a.countyCode===String(code));}
function cover(album){return album?.demo?IMAGE_FILES[0]:album?.photos?.[0]?.url;}
function coverImage(album,cls){const src=cover(album);if(!src)return null;const image=document.createElement('img');image.src=src;image.alt=album.title;image.className=cls;image.loading='lazy';return image;}
async function revisit(album){try{city=cities.find(c=>String(c.adcode)===album.cityCode);if(!city)throw Error('找不到这段回忆所属的城市');const data=await geo(city.adcode);const feature=data.features.find(f=>String(f.properties.adcode)===album.countyCode);if(!feature)throw Error('找不到回忆所属区县');county={...feature.properties,feature};await show(3);await openAlbum(album);}catch(e){toast(e.message);}}
function renderShelf(){
  shelf.replaceChildren();shelf.hidden=level!==1;
  $('archive-count').textContent=String(albums.length).padStart(3,'0');
  archiveIndex.hidden=albums.length===0;
  if(level!==1)return;
  const intro=textNode('div','','shelf-intro');intro.append(textNode('div',albums.length?'RECENT MEMORIES':'THE FIRST CHAPTER','eyebrow'),textNode('h2',albums.length?'最近，留下的时光':'你的故事，\n从一个地方开始。'),textNode('p',albums.length?'沿着熟悉的地名，重新走进那些日子。':'选择一座城市，安放第一段属于你的回忆。'));
  const locate=textNode('button','寻找一个地方  ↗');locate.onclick=()=>showSearch();intro.append(locate);shelf.append(intro);
  if(albums.length){[...albums].sort((a,b)=>(b.date||'').localeCompare(a.date||'')).slice(0,3).forEach(album=>{
    const button=textNode('button','','memory-preview');const image=coverImage(album,'');if(image)button.append(image);const caption=textNode('span','','preview-caption');caption.append(textNode('strong',album.title),textNode('small',`${album.place} · ${album.date||'未标注日期'}`));button.append(caption);button.onclick=()=>revisit(album);shelf.append(button);
  });}else if(IMAGE_FILES.length){
    const demoPreview=textNode('button','','demo-stack');demoPreview.setAttribute('aria-label','查看演示回忆，照片地点未核实');[...new Set([0,Math.min(5,IMAGE_FILES.length-1),Math.min(9,IMAGE_FILES.length-1)])].forEach(i=>{const image=document.createElement('img');image.src=IMAGE_FILES[i];image.alt='演示照片';demoPreview.append(image);});demoPreview.append(textNode('small','演示影像 · 查看体验 ↗'));demoPreview.onclick=()=>$('demo').click();shelf.append(demoPreview,textNode('p','把散落的照片，\n放回记忆发生的地方。','empty-annotation'));
  }
}
function items(){
  const q=$('search').value.trim();
  if(level===1)return cities.filter(c=>(!provinceFilter||c.province===provinceFilter)&&(`${c.name}${c.province}`).includes(q)).sort((a,b)=>cityAlbums(b.adcode).length-cityAlbums(a.adcode).length||a.name.localeCompare(b.name,'zh-CN'));
  if(level===2)return features.filter(f=>f.properties.name).map(f=>({...f.properties,feature:f,kind:'county'})).filter(c=>c.name.includes(q));
  return [...countyAlbums(county.adcode),...(IMAGE_FILES.length&&String(county.adcode)===demo.countyCode?[demo]:[])].filter(a=>(a.title+a.place).includes(q));
}
function renderList(){
  const list=$('entries');list.replaceChildren();
  if(provinceFilter&&level===1){const reset=textNode('button',provinceFilter+' · 显示全国城市 ×','entry');reset.onclick=()=>{provinceFilter='';renderList();};list.append(reset);}
  const rows=items();
  if(!rows.length)list.append(textNode('p',level===3?'这里还没有回忆。点击地图选择位置，再添加你的第一组照片。':'没有找到匹配地点。','empty'));
  rows.forEach(item=>{const b=textNode('button','','entry');const name=item.name||item.title;
    const sample=level===1?cityAlbums(item.adcode)[0]:level===2?countyAlbums(item.adcode)[0]:item;
    if(sample){const image=coverImage(sample,'entry-cover');if(image)b.append(image);}
    b.append(textNode('strong',name));let sub;
    if(level===1)sub=`${item.province} · ${cityAlbums(item.adcode).length} 段回忆`;
    else if(level===2)sub=`${countyAlbums(item.adcode).length} 段回忆 · 双击进入`;
    else sub=`${item.demo?'演示 · 地点未核实':item.date||'日期未填写'} · ${item.photos.length} 张照片`;
    b.append(textNode('small',sub));if(selected&&(selected.adcode===item.adcode&&item.adcode||selected.id===item.id&&item.id))b.classList.add('selected');
    b.onclick=()=>select(item);b.ondblclick=()=>enter(item);list.append(b);
  });
}
function select(item){
  if(!item)return;
  if(level===1&&item.kind==='province') {provinceFilter=item.name;selected=null;document.body.classList.remove('has-selection');$('selection').replaceChildren();showSearch();renderList();return;}
  selected=item;map.highlight(item);const box=$('selection');box.replaceChildren(textNode('strong',item.name||item.title));
  document.body.classList.add('has-selection');
  const sample=level===1?cityAlbums(item.adcode)[0]:level===2?countyAlbums(item.adcode)[0]:item;
  if(sample){const image=coverImage(sample,'selection-cover');if(image)box.prepend(image);}
  deleteButton.disabled=level!==3||!!item.demo;
  if(item.note)box.append(textNode('p',item.note.slice(0,90),'local-note'));
  const go=textNode('button',level===1?'进入城市 →':level===2?'探索这片区域 →':'进入回忆图片球 →','primary');go.onclick=()=>enter(item);box.append(go);
  if(level===3&&!item.demo){const remove=textNode('button','删除这段回忆','danger');remove.onclick=()=>requestDelete(item);box.append(remove);}
  document.querySelectorAll('#entries .entry').forEach(el=>el.classList.toggle('selected',el.querySelector('strong')?.textContent===(item.name||item.title)));
  document.querySelectorAll('.region').forEach(el=>el.classList.toggle('selected',item.adcode!=null&&String(map.items.get(el.dataset.key)?.adcode)===String(item.adcode)));
}
async function enter(item){
  try{
    if(level===1){if(item.kind==='province'){select(item);return;}city=item;county=null;await show(2);}
    else if(level===2){county=item;await show(3);}
    else if(level===3)await openAlbum(item);
  }catch(e){toast(e.message);}
}
function crumbs(){
  const nav=$('breadcrumbs');nav.replaceChildren();
  const add=(label,fn)=>{if(nav.children.length)nav.append(textNode('span','/'));const b=textNode('button',label);b.onclick=fn;nav.append(b);};
  add('中国',()=>show(1).catch(e=>toast(e.message)));if(level>=2&&city)add(city.name,()=>show(2).catch(e=>toast(e.message)));if(level>=3&&county)add(county.name,()=>show(3).catch(e=>toast(e.message)));if(level===4)add('回忆图片球',()=>{});
}
async function show(next){
  const version=++renderVersion;
  let data;
  try{if(next===1)data=national;else if(next===2)data=await geo(city.adcode);else {const cityData=await geo(city.adcode);const f=cityData.features.find(f=>String(f.properties.adcode)===String(county.adcode));if(!f)throw Error('未找到该区县边界');data={features:[f]};}}
  catch(e){throw e;}
  if(version!==renderVersion)return;
  sphereAPI?.setActive(false);level=next;document.body.dataset.level=String(level);$('map-screen').hidden=false;$('sphere-screen').hidden=true;$('scene').hidden=true;
  showSearch(false);manage.open=false;
  document.body.classList.remove('has-selection');
  selected=null;pendingPoint=null;$('selection').replaceChildren();$('search').value='';$('search').placeholder=level===1?'搜索城市名称…':level===2?'搜索区县名称…':'搜索回忆标题或地点…';
  deleteButton.disabled=true;
  features=data.features;$('back').disabled=level===1;
  $('page-title').textContent=level===1?'走过的地方，\n留下的时光。':level===2?`${city.name}，\n故事在这里发生。`:`${county.name}，\n记忆中的某一天。`;
  $('page-subtitle').textContent=level===1?'一座城，一些人，一段值得被珍藏的日子。':level===2?'循着熟悉的地名，靠近那些曾经的日子。':'让照片与文字，带你回到那个地方。';
  $('map-label').textContent=level===1?'CHINA · 中国':`${level===2?'CITY':'DISTRICT'} · ${level===2?city.name:county.name}`;
  $('side-step').textContent=['','01 / 探索城市','02 / 走进区县','03 / 寻找回忆'][level];$('side-title').textContent=['','你的下一站','熟悉的地方','留在这里的时光'][level];
  const relevant=level===1?albums:level===2?cityAlbums(city.adcode):countyAlbums(county.adcode);
  $('stats').replaceChildren(textNode('b',relevant.length),' 段回忆　',textNode('b',relevant.reduce((n,a)=>n+a.photos.length,0)),' 张照片');
  let markers=[];
  if(level===1){const ids=new Set(albums.map(a=>a.cityCode));markers=cities.filter(c=>ids.has(String(c.adcode))).map(c=>({...c,kind:'city'}));}
  if(level===2)markers=features.filter(f=>countyAlbums(f.properties.adcode).length).map(f=>({...f.properties,kind:'county',feature:f}));
  if(level===3)markers=[...relevant,...(IMAGE_FILES.length&&String(county.adcode)===demo.countyCode?[{...demo,title:'演示回忆 · 地点未核实'}]:[])];
  map.render(features,markers,`${level}-${city?.adcode||''}-${level===3?county.adcode:''}`,level);crumbs();renderList();renderShelf();
  const workspace=document.querySelector('.workspace');workspace.classList.remove('revealing');void workspace.offsetWidth;workspace.classList.add('revealing');
}
async function back(){try{if(level===4)await show(3);else if(level===3)await show(2);else if(level===2)await show(1);}catch(e){toast(e.message);}}
async function openAlbum(album){
  $('boot').style.display='grid';
  try{
    sphereAPI ||= await import('./main.js?v=atlas-1');
    const urls=[];const files=album.demo?IMAGE_FILES:album.photos.map(p=>{
      if(p.url&&p.original)return {url:p.url,original:p.original,name:p.name};
      const url=URL.createObjectURL(p.thumb),original=URL.createObjectURL(p.blob);urls.push(url,original);return {url,original,name:p.name};
    });
    sphereAPI.setPhotos(files);objectURLs.forEach(URL.revokeObjectURL);objectURLs=urls;
    activeAlbum=album;deleteButton.disabled=!!album.demo;
    level=4;document.body.dataset.level='4';$('map-screen').hidden=true;$('sphere-screen').hidden=false;
    showSearch(false);manage.open=false;
    $('album-title').textContent=album.title;$('album-meta').textContent=`${album.demo?'演示照片 · 地点未核实':`${album.place} · ${album.date||'日期未填写'}`} · ${album.photos.length} 张照片`;$('album-note').textContent=album.note;
    sphereAPI.setActive(true);crumbs();
  }catch(e){toast('图片球加载失败：'+e.message+'。请重新解压完整项目，确认 vendor 文件夹存在。');}
  finally{$('boot').style.display='none';}
}
$('search').oninput=renderList;$('back').onclick=back;$('sphere-back').onclick=back;
$('home').onclick=e=>{e.preventDefault();show(1).catch(e=>toast(e.message));};
$('gesture-toggle').onclick=()=>sphereAPI?.beginGesture();
$('demo').onclick=async()=>{if(!IMAGE_FILES.length){toast('演示照片文件夹为空，请将图片放入 demo-photos 后重新双击 start.bat。');return;}try{city=cities.find(c=>String(c.adcode)===demo.cityCode);const data=await geo(city.adcode);const f=data.features.find(f=>String(f.properties.adcode)===demo.countyCode);county={...f.properties,feature:f};await show(3);select(demo);}catch(e){toast(e.message);}};
addEventListener('keydown',e=>{if(level===4||document.querySelector('dialog[open]')||['INPUT','TEXTAREA'].includes(e.target.tagName))return;if(e.key==='Escape')back();if(e.key==='Enter'&&selected)enter(selected);});
$('add').onclick=()=>{
  if(level<3){toast('请先进入一个城市和区县，再添加回忆。');return;}
  const form=$('memory-form');form.reset();$('form-place').textContent=`${city.name} / ${county.name} · ${pendingPoint?'使用你在地图上选择的位置':'默认放在区县中心，可先点击地图选点'}`;$('memory-dialog').showModal();
};
$('cancel-add').onclick=()=>$('memory-dialog').close();
$('memory-form').elements.photos.onchange=e=>{$('file-count').textContent=`已选择 ${e.target.files.length} 张照片 · 原图将保存到电脑回忆库文件夹`;};
$('memory-form').onsubmit=async e=>{
  e.preventDefault();const form=e.currentTarget,b=form.querySelector('[type=submit]');b.disabled=true;
  try{
    const values=new FormData(form),files=[...form.elements.photos.files],photos=[];
    if(!values.get('title').trim()||!values.get('place').trim())throw Error('请填写标题和地点');
    for(let i=0;i<files.length;i++){b.textContent=`正在保存 ${i+1}/${files.length}`;photos.push(await makePhoto(files[i]));}
    const album={id:crypto.randomUUID(),title:values.get('title').trim(),place:values.get('place').trim(),date:values.get('date'),note:values.get('note'),cityCode:String(city.adcode),countyCode:String(county.adcode),point:pendingPoint||county.centroid||county.center||city.center,photos};
    await saveAlbums([album]);albums=await getAlbums();$('memory-dialog').close();await show(3);toast('回忆已保存到电脑回忆库文件夹。点击相册进入图片球。');
  }catch(err){toast('保存失败：'+err.message);}finally{b.disabled=false;b.textContent='保存回忆';}
};
$('export').onclick=async()=>{try{const blob=await exportBackup(albums),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`拾光地图备份-${new Date().toISOString().slice(0,10)}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);toast(`已生成 ${albums.length} 段回忆的备份，请保管下载文件。`);}catch(e){toast('备份失败：'+e.message);}};
$('restore').onclick=()=>$('backup-file').click();
$('backup-file').onchange=async e=>{const file=e.target.files[0];if(!file)return;try{toast('正在检查并恢复备份…');const restored=await readBackup(file);const known=new Set(albums.map(a=>a.id));const additions=restored.filter(a=>!known.has(a.id));await saveAlbums(additions);albums=await getAlbums();if(level<4)await show(level);toast(`已恢复 ${additions.length} 段回忆，跳过 ${restored.length-additions.length} 段已有回忆。`);}catch(err){toast('恢复失败：'+err.message);}finally{e.target.value='';}};
async function init(){try{
  const info=await getLibraryInfo();const note=document.querySelector('.library > .local-note');
  note.textContent=`本地回忆库：${info.path}。照片与文字直接保存在此文件夹，复制整个文件夹即可备份。`;note.title=info.path;
  [national,cities,albums]=await Promise.all([geo('100000'),fetch('data/maps/cities.json').then(r=>r.json()),getAlbums()]);cities=cities.filter(c=>c.name&&/^\d{6}$/.test(c.adcode));await show(1);
}catch(e){$('entries').replaceChildren(textNode('p','加载失败：'+e.message+'。请用 start.bat 启动本项目。','empty'));toast('初始化失败：'+e.message);}}
init();
