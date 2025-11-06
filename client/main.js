// Main app glue: UI, canvas, and websocket
(function(){
  const canvasEl = document.getElementById('canvas');
  const overlayEl = document.getElementById('overlay');
  const canvasMgr = new CanvasManager(canvasEl);
  canvasMgr.setOverlay(overlayEl);

  // fit canvas container
  function fit() {
    const board = document.getElementById('board');
    canvasEl.style.width = board.clientWidth + 'px';
    canvasEl.style.height = board.clientHeight + 'px';
    canvasMgr.resize();
  }
  fit();

  const toolEl = document.getElementById('tool');
  const colorEl = document.getElementById('color');
  const widthEl = document.getElementById('width');
  const undoBtn = document.getElementById('undo');
  const redoBtn = document.getElementById('redo');
  const usersEl = document.getElementById('users');
  const nameModal = document.getElementById('nameModal');
  const nameInput = document.getElementById('nameInput');
  const nameSubmit = document.getElementById('nameSubmit');
  const nameRoomInput = document.getElementById('nameRoomInput');
  const nameColorInput = document.getElementById('nameColorInput');
  const roomInput = document.getElementById('roomInput');
  const roomJoin = document.getElementById('roomJoin');

  let drawing = false;
  let points = [];
  let lastSent = 0;
  const ops = []; // local authoritative ops list maintained from server diffs
  let cursors = {}; // id -> { color,name,cursor }
  let currentRect = null;

  function pointerPos(ev){
    const rect = canvasEl.getBoundingClientRect();
    return { x: ev.clientX - rect.left, y: ev.clientY - rect.top, pressure: (ev.pressure || 0.5) };
  }

  canvasEl.addEventListener('pointerdown', (e)=>{
    drawing = true;
    canvasEl.setPointerCapture(e.pointerId);
    const t = toolEl.value;
    if(t === 'rect'){
      currentRect = { start: pointerPos(e), end: null };
    } else if(t === 'text'){
      // place text at click
      const pos = pointerPos(e);
      const txt = prompt('Enter text');
      if(txt){ WS.emit('stroke', { type:'text', x: pos.x, y: pos.y, text: txt, color: colorEl.value, width:+widthEl.value, final:true }); }
      drawing = false;
      return;
    } else if(t === 'image'){
      // open file chooser
      const input = document.createElement('input'); input.type='file'; input.accept='image/*';
      input.onchange = ()=>{
        const f = input.files[0];
        const r = new FileReader();
        r.onload = ()=>{
          WS.emit('stroke', { type:'image', dataURL: r.result, x: pointerPos(e).x, y: pointerPos(e).y, final:true });
        };
        if(f) r.readAsDataURL(f);
      };
      input.click();
      drawing = false;
      return;
    } else {
      points = [pointerPos(e)];
      // send initial
      WS.emit('stroke', { points:[points[0]], tool: toolEl.value, color: colorEl.value, width: +widthEl.value, final:false });
    }
  });

  canvasEl.addEventListener('pointermove', (e)=>{
    // update cursor for remote users (send canvas-relative coords)
    const rect = canvasEl.getBoundingClientRect();
    const rel = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    WS.emit('cursor', rel);
    if(!drawing) return;
    if(toolEl.value === 'rect' && currentRect){
      currentRect.end = pointerPos(e);
      // draw preview on overlay
      canvasMgr.clearOverlay();
      const octx = canvasMgr.overlayCtx;
      if(octx){
        octx.save(); octx.strokeStyle = colorEl.value; octx.lineWidth = +widthEl.value; octx.setLineDash([6,4]);
        const s = currentRect.start, en = currentRect.end; octx.strokeRect(s.x, s.y, en.x - s.x, en.y - s.y);
        octx.restore();
      }
      return;
    }
    points.push(pointerPos(e));
    // draw locally as live
    canvasMgr.drawLive({ points, tool: toolEl.value, color: colorEl.value, width:+widthEl.value });
    // throttle send
    const now = Date.now();
    if(now - lastSent > 50){
      WS.emit('stroke', { points: points.slice(-10), tool: toolEl.value, color: colorEl.value, width:+widthEl.value, final:false });
      lastSent = now;
    }
  });

  canvasEl.addEventListener('pointerup', (e)=>{
    if(!drawing) return;
    drawing = false;
    canvasEl.releasePointerCapture(e.pointerId);
    if(toolEl.value === 'rect' && currentRect){
      const s = currentRect.start, en = currentRect.end || pointerPos(e);
      WS.emit('stroke', { type:'rect', x: s.x, y: s.y, w: en.x - s.x, h: en.y - s.y, color: colorEl.value, width:+widthEl.value, final:true });
      canvasMgr.clearOverlay(); currentRect = null; return;
    }
    WS.emit('stroke', { points, tool: toolEl.value, color: colorEl.value, width:+widthEl.value, final:true });
    points = [];
  });

  undoBtn.addEventListener('click', ()=> WS.emit('undo', { scope: 'self' }));
  redoBtn.addEventListener('click', ()=> WS.emit('redo', { scope: 'self' }));

  roomJoin.addEventListener('click', ()=>{
    const r = (roomInput.value||'main').trim() || 'main';
    if(myName){ WS.emit('join-room', { roomId: r, name: myName, color: colorEl.value }); }
    else { WS.emit('join-room', r); }
    setTimeout(sendPresence, 50);
  });

  // socket events
  WS.on('init', (data)=>{
    ops.length = 0;
    (data.ops||[]).forEach(o=>ops.push(o));
    canvasMgr.redraw(ops);
    renderUsers(data.users || {});
  });

  WS.on('stroke', (op)=>{
    // live stroke from other user; draw it on top
    canvasMgr.drawLive(op);
  });

  // diffs: op-added / op-removed
  WS.on('op-added', (op)=>{
    ops.push(op);
    canvasMgr.redraw(ops);
  });

  WS.on('op-removed', ({id})=>{
    const idx = ops.findIndex(o=>o.id===id);
    if(idx!==-1) ops.splice(idx,1);
    canvasMgr.redraw(ops);
  });

  WS.on('users', (users)=>{
    renderUsers(users);
    // replace local cursors map with authoritative user registry (removes stale entries)
    const newMap = {};
    Object.entries(users||{}).forEach(([id,u])=>{
      newMap[id] = { color: u.color, name: u.name, cursor: u.cursor };
    });
    cursors = newMap;
    canvasMgr.drawCursors(cursors);
  });

  WS.on('cursor', (payload)=>{
    // payload: { id, cursor, name, color }
    const { id, cursor, name, color } = payload || {};
    cursors[id] = cursors[id] || {};
    cursors[id].cursor = cursor;
    if(name) cursors[id].name = name;
    if(color) cursors[id].color = color;
    canvasMgr.drawCursors(cursors);
  });

  // notifications for join/leave
  const toastEl = document.getElementById('toast');
  function showToast(text, ms=3000){
    toastEl.textContent = text;
    toastEl.classList.remove('hidden');
    clearTimeout(showToast._t);
    showToast._t = setTimeout(()=> toastEl.classList.add('hidden'), ms);
  }

  WS.on('user-joined', (u)=>{
    // add to cursors/users quickly for immediate presence
    const id = u.id;
    cursors[id] = cursors[id] || {};
    cursors[id].name = u.name;
    cursors[id].color = u.color;
    canvasMgr.drawCursors(cursors);
    showToast((u.name || id) + ' joined');
  });

  WS.on('user-left', ({id})=>{
    const name = (cursors[id] && cursors[id].name) ? cursors[id].name : id;
    if(cursors[id]) delete cursors[id];
    canvasMgr.drawCursors(cursors);
    showToast('User left: ' + name);
  });

  // Metrics UI (FPS + ping RTT)
  const metrics = document.createElement('div'); metrics.id = 'metrics'; metrics.innerHTML = 'FPS: - &nbsp; Ping: -ms'; document.body.appendChild(metrics);
  let lastFrame = performance.now(); let frames = 0; let fps = 0;
  function frameTick(t){
    frames++;
    if(t - lastFrame >= 1000){ fps = frames; frames = 0; lastFrame = t; metrics.innerHTML = 'FPS: ' + fps + ' &nbsp; Ping: ' + (window._pingRtt || '-') + 'ms'; }
    requestAnimationFrame(frameTick);
  }
  requestAnimationFrame(frameTick);

  // ping RTT measurement
  setInterval(()=>{ const now = Date.now(); WS.emit('ping', now); }, 3000);
  WS.on('pong', (t)=>{ window._pingRtt = Date.now() - t; });

  function renderUsers(users){
    usersEl.innerHTML = '';
    Object.entries(users).forEach(([id,u])=>{
      const div = document.createElement('span');
      div.className = 'user-entry';
      const dot = document.createElement('i'); dot.className = 'user-dot'; dot.style.background = u.color || '#666';
      const name = document.createElement('span'); name.textContent = (u.name||id) + (id===WS.id()? ' (you)':'');
      div.appendChild(dot); div.appendChild(name); usersEl.appendChild(div);
    });
    // redraw cursors whenever user palette changes
    canvasMgr.drawCursors(cursors);
  }

  // send a heartbeat with color so server can keep user info
  let myName = null;
  function sendPresence(){ WS.emit('presence', { color: colorEl.value, name: myName }); }
  setInterval(sendPresence, 3000);

  // name modal flow
  function hideModal(){ nameModal.classList.add('hidden'); }
  function showModal(){ nameModal.classList.remove('hidden'); nameInput.focus(); }
  nameSubmit.addEventListener('click', ()=>{
    const v = nameInput.value && nameInput.value.trim();
    myName = v || ('User-' + Math.floor(Math.random()*9000+1000));
    const chosenRoom = (nameRoomInput && nameRoomInput.value && nameRoomInput.value.trim()) || (new URLSearchParams(window.location.search).get('room')) || 'main';
    const chosenColor = (nameColorInput && nameColorInput.value) || colorEl.value;
    // set toolbar color to chosen color
    colorEl.value = chosenColor;
    // join-room with metadata
    WS.emit('join-room', { roomId: chosenRoom, name: myName, color: chosenColor });
    // send presence after join so server records lastSeen in correct room
    setTimeout(sendPresence, 50);
    roomInput.value = chosenRoom;
    hideModal();
  });
  nameInput.addEventListener('keydown', (e)=>{ if(e.key==='Enter') nameSubmit.click(); });
  // show modal on load
  showModal();

  window.addEventListener('resize', fit);
})();
