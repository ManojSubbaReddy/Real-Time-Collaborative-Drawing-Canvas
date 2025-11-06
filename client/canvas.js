// Minimal Canvas manager for drawing and replaying operations
(function(){
  class CanvasManager {
    constructor(canvasEl) {
      this.canvas = canvasEl;
      this.ctx = this.canvas.getContext('2d');
      this.overlay = null;
      this.overlayCtx = null;
      this.DPR = window.devicePixelRatio || 1;
      this.ops = [];
      this.resize();
      window.addEventListener('resize', ()=>this.resize());
      this.current = null; // live stroke
    }

    setOverlay(overlayEl){
      this.overlay = overlayEl;
      if(overlayEl) this.overlayCtx = overlayEl.getContext('2d');
      this.resize();
    }

    resize() {
      const rect = this.canvas.getBoundingClientRect();
      this.canvas.width = Math.round(rect.width * this.DPR);
      this.canvas.height = Math.round(rect.height * this.DPR);
      this.canvas.style.width = rect.width + 'px';
      this.canvas.style.height = rect.height + 'px';
      this.ctx.setTransform(this.DPR,0,0,this.DPR,0,0);

      if(this.overlay){
        this.overlay.width = Math.round(rect.width * this.DPR);
        this.overlay.height = Math.round(rect.height * this.DPR);
        this.overlay.style.width = rect.width + 'px';
        this.overlay.style.height = rect.height + 'px';
        this.overlayCtx && this.overlayCtx.setTransform(this.DPR,0,0,this.DPR,0,0);
      }

      this.redraw(this.ops);
    }

    clear() { this.ctx.clearRect(0,0,this.canvas.width,this.canvas.height); }
    clearOverlay(){ if(this.overlayCtx) this.overlayCtx.clearRect(0,0,this.overlay.width,this.overlay.height); }

    redraw(ops) {
      // store and redraw
      this.ops = ops ? ops.slice() : [];
      this.clear();
      if(!this.ops) return;
      for(const op of this.ops) this._drawOp(op);
    }

    _drawOp(op) {
      const ctx = this.ctx;
      ctx.save();
      if(op.tool === 'eraser') {
        ctx.globalCompositeOperation = 'destination-out';
      } else {
        ctx.globalCompositeOperation = 'source-over';
      }
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = op.color || '#000';
  ctx.lineWidth = op.width || 4;
      const pts = op.points || [];
      // if points contain pressure, adjust width by average pressure
      if(pts.length>0 && pts[0].pressure!==undefined){
        const avg = pts.reduce((s,p)=>s + (p.pressure||1),0)/pts.length;
        ctx.lineWidth = (op.width || 4) * Math.max(0.5, avg);
      }
      if(pts.length===0) return;
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for(let i=1;i<pts.length;i++){
        const p = pts[i];
        // simple smoothing: quadratic to mid-point
        const prev = pts[i-1];
        const midx = (prev.x + p.x)/2;
        const midy = (prev.y + p.y)/2;
        ctx.quadraticCurveTo(prev.x, prev.y, midx, midy);
      }
      ctx.stroke();
      ctx.restore();
    }

      // draw rectangles, text, image ops
    _drawOp(op) {
      // keep previous drawing logic block, but allow op.type
    }

    // Since we need to support shapes, override _drawOp by checking type
    _drawOp(op){
      const ctx = this.ctx;
      if(op.type === 'rect'){
        ctx.save();
        ctx.strokeStyle = op.color || '#000'; ctx.lineWidth = op.width || 2; ctx.strokeRect(op.x, op.y, op.w, op.h);
        ctx.restore();
        return;
      }
      if(op.type === 'text'){
        ctx.save(); ctx.fillStyle = op.color || '#000'; ctx.font = (op.size||14)+'px sans-serif'; ctx.fillText(op.text||'', op.x, op.y); ctx.restore(); return;
      }
      if(op.type === 'image'){
        // op.dataURL contains image; draw it (synchronously if image cached)
        const img = new Image(); img.onload = ()=>{ ctx.drawImage(img, op.x, op.y); };
        img.src = op.dataURL;
        return;
      }
      // default: path drawing
      ctx.save();
      if(op.tool === 'eraser') {
        ctx.globalCompositeOperation = 'destination-out';
      } else {
        ctx.globalCompositeOperation = 'source-over';
      }
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = op.color || '#000';
      ctx.lineWidth = op.width || 4;
      const pts = op.points || [];
      if(pts.length===0) { ctx.restore(); return; }
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for(let i=1;i<pts.length;i++){
        const p = pts[i];
        const prev = pts[i-1];
        const midx = (prev.x + p.x)/2;
        const midy = (prev.y + p.y)/2;
        ctx.quadraticCurveTo(prev.x, prev.y, midx, midy);
      }
      ctx.stroke();
      ctx.restore();
    }

    drawLive(op) {
      // draw live stroke on main canvas on top of existing ops (for simplicity we redraw all then overlay live)
      this.redraw(this.ops);
      this._drawOp(op);
    }

    // cursors: users is map id -> { color, cursor: {x,y} }
    drawCursors(users){
      if(!this.overlayCtx) return;
      const ctx = this.overlayCtx;
      ctx.clearRect(0,0,this.overlay.width,this.overlay.height);
      for(const [id,u] of Object.entries(users||{})){
        if(!u.cursor) continue;
        const c = u.cursor;
        ctx.save();
        ctx.fillStyle = u.color || '#666';
        ctx.beginPath();
        ctx.arc(c.x, c.y, 6, 0, Math.PI*2);
        ctx.fill();
        ctx.font = '12px sans-serif';
        ctx.fillStyle = '#000';
        ctx.fillText((u.name||id).toString(), c.x + 8, c.y + 4);
        ctx.restore();
      }
    }
  }

  window.CanvasManager = CanvasManager;
})();
