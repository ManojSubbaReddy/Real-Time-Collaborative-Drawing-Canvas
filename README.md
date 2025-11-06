
# Collaborative Canvas

This repository contains a minimal real-time collaborative drawing application built with Node.js + Socket.io for the backend and vanilla JavaScript + HTML5 Canvas on the frontend. It demonstrates key ideas required by the assignment: real-time stroke streaming, user presence, per-user undo/redo attribution, cursor indicators, and a simple protocol for synchronizing drawing operations.

Repository layout

```
collaborative-canvas/
├── client/
│   ├── index.html        # UI + canvas and modal for name entry
│   ├── style.css         # styling and modal styles
│   ├── canvas.js         # CanvasManager: drawing, overlay, cursor rendering
│   ├── websocket.js      # small wrapper over socket.io client
│   └── main.js           # app glue: pointer handling, UI, op diffs, presence
├── server/
│   ├── server.js         # Express + Socket.io server, event routing
│   └── drawing-state.js  # in-memory op log with per-user undo/redo
├── package.json
├── README.md
├── ARCHITECTURE.md
└── SELF_CHECK.md         # mapping of assignment requirements to implementation
```

Quick start

1. Install dependencies

```pwsh
npm install
```

2. Start server

```pwsh
npm start
```

3. Open http://localhost:3000 in two or more browser windows to test real-time collaboration.

Testing notes

- Draw with the brush tool: live strokes are broadcast (throttled) as you draw and committed when the pointer is released.
- The server emits `op-added` diffs on commit; clients append and redraw.
- Undo/Redo default to per-user scope when using the UI buttons (they call `undo { scope: 'self' }` / `redo { scope: 'self' }`). Global undo/redo is available by sending `scope:'global'` to the server (API-level).
- The app prompts for a display name on load; that name is sent to the server in `presence` heartbeats and shown in the online users list.

Known limitations

- In-memory state: the server keeps the operation history in memory. Restarting the server clears the canvas. Persistence (DB or snapshots) is not implemented.
- Conflict model: this implementation uses a last-write-wins / attribution-based undo model. It does not implement CRDT/OT for conflict-free merging or fine-grained per-stroke merging beyond attribution. For interview-level discussion, see ARCHITECTURE.md.
- Performance: for long histories the client redraws from the full op list. The server sends diffs (add/remove) but no snapshotting or compressed diffs are implemented. Improvements are listed in ARCHITECTURE.md.

Files to review for core behavior

- `server/server.js` — WebSocket routes and user registry
- `server/drawing-state.js` — operation history and per-user undo/redo logic
- `client/canvas.js` — canvas drawing and overlay cursor rendering
- `client/main.js` — pointer capture, stroke batching, presence, op diffs handling

Time spent

- Approximate time spent implementing this prototype: 3.5 hours. The focus was on correctness of real-time streaming and a clear, auditable undo/redo strategy rather than production-hardening.

Next steps / recommended enhancements

- Persist operation history to disk or database to allow session restoration.
- Use snapshots + diffs for efficient rebuilds when histories grow large.
- Implement CRDT or operation transformation for conflict-free merges and more robust global undo semantics.
- Improve stroke compression (delta encoding), network batching, and predictive smoothing on the client.

If you want, I can implement any of the above next — tell me which one to prioritize.
