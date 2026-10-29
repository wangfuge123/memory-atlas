const NS='http://www.w3.org/2000/svg';
const svgEl=(tag,attrs)=>{const el=document.createElementNS(NS,tag);for(const [k,v] of Object.entries(attrs))el.setAttribute(k,v);return el;};
export class AtlasMap {
  constructor(svg,onSelect,onEnter,onPlace) {
    this.svg=svg;this.onSelect=onSelect;this.onEnter=onEnter;this.onPlace=onPlace;this.view={x:0,y:0,k:1};this.views=new Map();
    this.resizeObserver=new ResizeObserver(()=>this.sizeMarkers());this.resizeObserver.observe(svg);
    svg.addEventListener('wheel',e=>{e.preventDefault();this.zoom(e.deltaY<0?1.12:1/1.12,this.pos(e));},{passive:false});
    svg.addEventListener('pointerdown',e=>{if(e.button!==0)return;const p=this.pos(e);this.drag={id:e.pointerId,x:p.x,y:p.y,ox:this.view.x,oy:this.view.y,moved:false};svg.setPointerCapture(e.pointerId);});
    svg.addEventListener('pointermove',e=>{if(!this.drag)return;const p=this.pos(e),d=this.drag;if(Math.hypot(p.x-d.x,p.y-d.y)>4)d.moved=true;if(d.moved){this.view.x=d.ox+p.x-d.x;this.view.y=d.oy+p.y-d.y;this.apply();}});
    svg.addEventListener('pointerup',e=>{const d=this.drag;if(!d)return;this.drag=null;this.suppressClick=d.moved;svg.releasePointerCapture(e.pointerId);if(!d.moved){const element=document.elementFromPoint(e.clientX,e.clientY),target=element?.closest('[data-key]');this.lastClickItem=target?this.items.get(target.dataset.key):null;if(target)this.onSelect(this.lastClickItem);else if(this.onPlace&&this.level===3&&element?.closest('.region'))this.onPlace(this.unproject(this.pos(e)));}});
    svg.addEventListener('pointercancel',()=>{this.drag=null;});
    svg.addEventListener('dblclick',e=>{if(this.suppressClick)return;const target=e.target.closest('[data-key]'),item=target?this.items.get(target.dataset.key):this.lastClickItem;if(item)this.onEnter(item);});
    svg.addEventListener('pointerover',e=>{const t=e.target.closest('[data-key]');if(!t)return;const item=this.items.get(t.dataset.key);const tip=document.getElementById('map-tip');tip.textContent=item.name||item.title;tip.style.left=`${e.clientX+15}px`;tip.style.top=`${e.clientY+15}px`;tip.hidden=false;});
    svg.addEventListener('pointerout',()=>document.getElementById('map-tip').hidden=true);
  }
  pos(e){return new DOMPoint(e.clientX,e.clientY).matrixTransform(this.svg.getScreenCTM().inverse());}
  apply(){document.getElementById('map-transform').setAttribute('transform',`translate(${this.view.x} ${this.view.y}) scale(${this.view.k})`);if(this.key)this.views.set(this.key,{...this.view});this.sizeMarkers();}
  sizeMarkers(){
    const matrix=this.svg.getScreenCTM();if(!matrix)return;
    const size=1/(Math.hypot(matrix.a,matrix.b)*this.view.k||1);
    this.svg.querySelectorAll('.marker-light').forEach(el=>el.setAttribute('transform',`scale(${size})`));
  }
  highlight(item){
    this.svg.querySelectorAll('.marker').forEach(el=>{
      const m=this.items.get(el.dataset.key),active=!!m&&(item.id?m.id===item.id:item.adcode!=null&&String(m.adcode)===String(item.adcode));
      el.classList.toggle('selected',active);el.classList.remove('pulsing');
      if(active){void el.getBoundingClientRect();el.classList.add('pulsing');}
    });
  }
  zoom(f,p={x:500,y:350}){const old=this.view.k,k=Math.max(.7,Math.min(9,old*f));this.view.x=p.x-(p.x-this.view.x)*k/old;this.view.y=p.y-(p.y-this.view.y)*k/old;this.view.k=k;this.apply();}
  reset(){this.view={x:0,y:0,k:1};this.apply();}
  project(p){return [this.offsetX+(p[0]-this.minX)*this.scale,this.offsetY+(this.maxY-this.merc(p[1]))*this.scale];}
  merc(y){return Math.log(Math.tan(Math.PI/4+y*Math.PI/360))*180/Math.PI;}
  unproject(p){const x=(p.x-this.view.x)/this.view.k,y=(p.y-this.view.y)/this.view.k;return [(x-this.offsetX)/this.scale+this.minX,(2*Math.atan(Math.exp((this.maxY-(y-this.offsetY)/this.scale)*Math.PI/180))-Math.PI/2)*180/Math.PI];}
  rings(f){return f.geometry.type==='Polygon'?f.geometry.coordinates:f.geometry.type==='MultiPolygon'?f.geometry.coordinates.flat():[];}
  render(features,markers,key,level){
    this.key=key;this.level=level;this.view={...(this.views.get(key)||{x:0,y:0,k:1})};this.items=new Map();
    const points=features.flatMap(f=>this.rings(f).flat());
    if(!points.length)throw Error('此区域暂无可用地图边界');
    this.minX=Math.min(...points.map(p=>p[0]));const maxX=Math.max(...points.map(p=>p[0]));const minY=Math.min(...points.map(p=>this.merc(p[1])));this.maxY=Math.max(...points.map(p=>this.merc(p[1])));
    this.scale=Math.min(860/(maxX-this.minX||1),520/(this.maxY-minY||1));this.offsetX=(1000-(maxX-this.minX)*this.scale)/2;this.offsetY=(700-(this.maxY-minY)*this.scale)/2;
    const regions=document.getElementById('regions'),marks=document.getElementById('markers');regions.replaceChildren();marks.replaceChildren();
    features.forEach((f,i)=>{const id=`region-${i}`,p=f.properties;const item={...p,feature:f,kind:level===1?'province':'county'};this.items.set(id,item);const d=this.rings(f).map(r=>r.map((p,j)=>`${j?'L':'M'}${this.project(p).map(n=>n.toFixed(2)).join(',')}`).join('')+'Z').join('');regions.append(svgEl('path',{d,class:'region',...(level===3?{}:{'data-key':id}),'fill-rule':'evenodd'}));if(level!==1&&p.name&&(p.centroid||p.center)){const [x,y]=this.project(p.centroid||p.center),t=svgEl('text',{x,y,class:'region-label'});t.textContent=p.name;regions.append(t);}});
    markers.forEach((m,i)=>{
      const id=`marker-${i}`;this.items.set(id,m);const [x,y]=this.project(m.point||m.center||m.centroid);
      const g=svgEl('g',{class:'marker','data-key':id,transform:`translate(${x},${y})`});
      const light=svgEl('g',{class:'marker-light','aria-hidden':'true'});
      light.append(svgEl('circle',{r:18,class:'marker-hit'}),svgEl('circle',{r:11,class:'marker-aura'}));
      for(let n=0;n<14;n++){
        const angle=n*2.39996323,particle=svgEl('circle',{r:.5+(n%3)*.15,class:'marker-dust'});
        particle.style.cssText=`--sx:${(Math.cos(angle)*4).toFixed(2)}px;--sy:${(Math.sin(angle)*4).toFixed(2)}px;--ex:${(Math.cos(angle)*27).toFixed(2)}px;--ey:${(Math.sin(angle)*27).toFixed(2)}px;animation-delay:-${(n*0.317+i*.23).toFixed(2)}s;animation-duration:${(3.8+n%3*.4).toFixed(1)}s`;
        light.append(particle);
      }
      const pulse=svgEl('g',{class:'marker-click-wave'});
      for(let n=0;n<12;n++){
        const angle=n*Math.PI/6,p=svgEl('circle',{r:.65});
        p.style.cssText=`--ex:${(Math.cos(angle)*34).toFixed(2)}px;--ey:${(Math.sin(angle)*34).toFixed(2)}px`;pulse.append(p);
      }
      light.append(pulse,svgEl('circle',{r:2.6,class:'marker-core'}));g.append(light);
      const t=svgEl('text',{x:15,y:4});t.textContent=m.name||m.title;g.append(t);marks.append(g);
    });this.apply();
  }
}
