const express = require('express');
const http = require('http');
const path = require('path');
const socketio = require('socket.io');
const dsModule = require('./drawing-state');
const { createState } = dsModule;
const fs = require('fs');
const DATA_DIR = path.join(__dirname, '..', 'data');
if(!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive:true });

// rooms: roomId -> { state, users }
const rooms = {};

function ensureRoom(roomId){
  if(!roomId) roomId = 'main';
  if(!rooms[roomId]){
    const state = createState();
    // try load snapshot
    const f = path.join(DATA_DIR, roomId + '.json');
    if(fs.existsSync(f)){
      try{
        const json = JSON.parse(fs.readFileSync(f,'utf8'));
        if(Array.isArray(json.ops)){
          state.ops = json.ops;
          state.nextId = json.nextId || (state.ops.length+1);
        }
      }catch(e){ console.error('load snapshot failed', e); }
    }
    rooms[roomId] = { state, users: {} };
  }
  return rooms[roomId];
}

function saveRoomSnapshot(roomId){
  try{
    const room = rooms[roomId];
    if(!room) return;
    const f = path.join(DATA_DIR, roomId + '.json');
    const payload = { ops: room.state.getOps(), nextId: room.state.nextId };
    fs.writeFileSync(f, JSON.stringify(payload));
  }catch(e){ console.error('save snapshot failed', e); }
}

const app = express();
const server = http.createServer(app);
const io = socketio(server);

const CLIENT_DIR = path.join(__dirname, '..', 'client');
app.use(express.static(CLIENT_DIR));

const PORT = process.env.PORT || 3000;

// Global users registry is per-room in `rooms` map

io.on('connection', (socket)=>{
  console.log('conn', socket.id);
  // socket will join a room after client emits 'join-room'

  socket.on('presence', (data)=>{
    const roomId = socket.room || 'main';
    const room = ensureRoom(roomId);
    room.users[socket.id] = Object.assign(room.users[socket.id]||{}, data, { lastSeen: Date.now() });
    io.to(roomId).emit('users', room.users);
  });

  // live stroke (partial or final)
  socket.on('stroke', (data)=>{
    // room-scoped handling
    const roomId = socket.room || 'main';
    // broadcast to others in room for live rendering
    socket.to(roomId).emit('stroke', data);
    if(data.final){
      const room = ensureRoom(roomId);
      const op = room.state.addOp(Object.assign({}, data), socket.id);
      io.to(roomId).emit('op-added', op);
      saveRoomSnapshot(roomId);
    }
  });

  socket.on('cursor', (c)=>{
    const roomId = socket.room || 'main';
    const room = ensureRoom(roomId);
    room.users[socket.id] = Object.assign(room.users[socket.id]||{}, { cursor: c, lastSeen: Date.now() });
    const payload = { id: socket.id, cursor: c, name: room.users[socket.id].name, color: room.users[socket.id].color };
    socket.to(roomId).emit('cursor', payload);
  });

  // undo/redo: support per-user scope. payload = { scope: 'self'|'global' }
  socket.on('undo', (payload = {})=>{
    const roomId = socket.room || 'main';
    const room = ensureRoom(roomId);
    const scope = payload.scope || 'self';
    let op = null;
    if(scope === 'self') op = room.state.undoBy(socket.id);
    else op = room.state.undo();
    if(op){ io.to(roomId).emit('op-removed', { id: op.id }); saveRoomSnapshot(roomId); }
  });

  socket.on('redo', (payload = {})=>{
    const roomId = socket.room || 'main';
    const room = ensureRoom(roomId);
    const scope = payload.scope || 'self';
    let op = null;
    if(scope === 'self') op = room.state.redoBy(socket.id);
    else op = room.state.redo();
    if(op){ io.to(roomId).emit('op-added', op); saveRoomSnapshot(roomId); }
  });

  socket.on('disconnect', ()=>{
    const roomId = socket.room || 'main';
    const room = rooms[roomId];
    if(room){
      socket.to(roomId).emit('user-left', { id: socket.id, name: room.users[socket.id] && room.users[socket.id].name });
      delete room.users[socket.id];
      io.to(roomId).emit('users', room.users);
    }
  });

  // join room request from client
  socket.on('join-room', (payload = 'main')=>{
    // payload can be a string roomId or an object { roomId, name, color }
    let roomId = 'main'; let name = null; let color = '#000';
    if(typeof payload === 'string') roomId = payload || 'main';
    else if(payload && typeof payload === 'object'){
      roomId = payload.roomId || 'main';
      name = payload.name || null;
      color = payload.color || '#000';
    }
    // leave previous
    if(socket.room) socket.leave(socket.room);
    socket.join(roomId);
    socket.room = roomId;
    const room = ensureRoom(roomId);
    // register user in room with provided metadata
    room.users[socket.id] = Object.assign(room.users[socket.id]||{}, { color: color, name: name || room.users[socket.id] && room.users[socket.id].name || socket.id.slice(-4), lastSeen: Date.now() });
    // send room init to this socket
    socket.emit('init', { ops: room.state.getOps(), users: room.users });
    // notify others
    socket.to(roomId).emit('user-joined', { id: socket.id, name: room.users[socket.id].name, color: room.users[socket.id].color });
    io.to(roomId).emit('users', room.users);
  });

  // ping/pong for latency measurement
  socket.on('ping', (t)=>{ socket.emit('pong', t); });
});

// Sweep stale users who haven't sent presence recently
const PRESENCE_TIMEOUT = 10 * 1000; // 10s
setInterval(()=>{
  const now = Date.now();
  let removed = false;
  // sweep per-room users
  for(const [roomId,room] of Object.entries(rooms)){
    for(const [id,u] of Object.entries(room.users)){
      if(u.lastSeen && (now - u.lastSeen) > PRESENCE_TIMEOUT){
        room && io.to(roomId).emit('user-left', { id, name: u.name });
        delete room.users[id];
        removed = true;
      }
    }
    if(removed){ io.to(roomId).emit('users', room.users); }
    removed = false;
  }
}, 5000);

// periodic autosave of room snapshots
setInterval(()=>{
  for(const roomId of Object.keys(rooms)) saveRoomSnapshot(roomId);
}, 15_000);

server.listen(PORT, ()=> console.log('Server listening on', PORT));
