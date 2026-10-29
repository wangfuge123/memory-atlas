// Capture before application handlers. Browser/OS shortcuts remain browser-owned.
export class InputMode {
  constructor(target,onExit) {
    this.active=false;this.escapeHeld=false;
    this.handler=e=>{
      if(this.escapeHeld&&e.key==='Escape'){
        e.preventDefault();e.stopImmediatePropagation();
        if(e.type==='keyup')this.escapeHeld=false;
        return;
      }
      if(!this.active)return;
      e.preventDefault();e.stopImmediatePropagation();
      if(e.type==='keydown'&&e.key==='Escape'&&!e.repeat){this.escapeHeld=true;this.active=false;onExit();}
    };
    this.events=['keydown','keyup','keypress','pointerdown','pointerup','pointermove','pointercancel','mousedown','mouseup','mousemove','click','dblclick','auxclick','contextmenu','wheel','dragstart','drop','input','beforeinput'];
    for(const name of this.events)target.addEventListener(name,this.handler,{capture:true,passive:false});
  }
  set(active){this.active=active;}
}
