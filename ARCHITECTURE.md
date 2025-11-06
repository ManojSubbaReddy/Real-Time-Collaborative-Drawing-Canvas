# ARCHITECTURE

This document describes the architecture decisions, data flow, WebSocket protocol, undo/redo strategy, conflict resolution, and performance trade-offs used in this prototype.

1) Data flow (end-to-end)

- Client captures pointer events and buffers points in small batches while the user draws. Each partial update is emitted as a `stroke` message with a small set of recent points and `final:false` for live preview.
- The server forwards `stroke` messages to other clients for immediate visual feedback (live streaming).
- When the client completes a stroke (pointer up), it sends `stroke` with `final:true`. The server then commits the operation to its authoritative operation log and emits `op-added` containing the full committed op (including server-assigned op id and author attribution).
- Clients append `op-added` to their local op list and redraw.

2) WebSocket protocol (messages)

- `init` (server -> client): { ops: [op], users: {id->{name,color,cursor}} } — initial snapshot on connect.
- `stroke` (client -> server): { points:[{x,y}], tool, color, width, final: boolean } — used for live streaming; server broadcasts to others.
- `stroke` (server -> clients): same payload as above for live rendering.
- `op-added` (server -> clients): { id, author, tool, color, width, points } — authoritative committed op diff.
- `op-removed` (server -> clients): { id } — informs clients to remove an op (undo).
- `undo` / `redo` (client -> server): { scope:'self'|'global' } — request to undo/redo.
- `users` (server -> clients): current user registry with metadata.
- `presence` (client -> server): { name?, color? } — heartbeat to keep server-side user metadata up to date.
- `cursor` (client -> server): { x, y } (canvas-relative) and server rebroadcasts { id, cursor } to others.

3) Undo/Redo strategy

- The server maintains an append-only array `ops` for committed operations and a `redoStack` for undone operations.
- Each op has an `author` (socket id) assigned at commit time. This allows per-user undo by searching the ops array from the end for the last op authored by the requesting user (`undoBy(author)`).
- `undo` with `scope:'self'` removes the last op authored by the requester. `scope:'global'` removes the last committed op regardless of author.
- `redo` behavior mirrors undo: `redoBy(author)` tries to restore the most recent op on the redo stack belonging to that author.

Design rationale: per-user undo is easier to explain and implement and meets the assignment's global-undo requirement while giving safer semantics for multiple users.

4) Conflict resolution

- Live strokes are only visual until committed. The commit order defines authoritative history. This results in a simple last-write-wins model for commits.
- Because each operation is attributed, undo by author only removes operations the user created.

5) Performance decisions

- Throttling: clients throttle stroke events (50ms) and send small batches of the most recent points (e.g., last 10) so network usage is controlled while still feeling responsive.
- Diffs vs full rebuilds: the server emits `op-added` / `op-removed` diffs on commit/undo rather than full-state `rebuild`s. Clients maintain a local op list and redraw from it. For very large op histories, a snapshot + incremental diffs strategy is recommended.

6) Client-side canvas optimizations

- High-DPI support using devicePixelRatio and canvas resizing with transform.
- Simple quadratic smoothing for better-looking strokes.
- An overlay canvas is used for transient visuals (cursor rendering) so we avoid re-rendering the main drawing layer frequently for cursor updates.

7) Limitations and future work

- Persistence: in-memory state — add persistence (database or file snapshots) for session durability.
- Advanced undo: true collaborative undo (intention-preserving) would require CRDTs or operation transformation.
- Bandwidth: stroke data is raw coordinates; further compression or delta-encoding would help under heavy load.

8) Where to look in the code

- `server/server.js` — WebSocket event handlers and diff emission (`op-added`, `op-removed`).
- `server/drawing-state.js` — authoritative operation list and undo/redoBy implementation.
- `client/main.js` — pointer event handling, stroke batching/throttling, presence, cursors, and diff application.
- `client/canvas.js` — CanvasManager, redraw, overlay cursor rendering.
# ARCHITECTURE

Overview

This project implements a simple real-time collaborative canvas using Socket.io for event transport and an in-memory operation log on the server.

Data flow
- Client captures pointer events and emits `stroke` messages with small batches of points (throttled). Each `stroke` contains: { points: [{x,y}], tool, color, width, final }.
- Server broadcasts `stroke` messages to other clients for live rendering. When `final:true` is received, server commits the operation into the global operation list and broadcasts a `rebuild` (full ops list) to ensure consistency.

WebSocket protocol
- `init` (server -> client): { ops, users }
- `stroke` (client -> server): { points, tool, color, width, final }
- `stroke` (server -> clients): same payload for live rendering
- `rebuild` (server -> clients): full operations array for authoritative redraw
- `undo` / `redo` (client -> server): request global undo/redo
- `users` (server -> clients): registry of connected users
- `presence` (client -> server): { color } to annotate user metadata

Undo/Redo strategy
- Server maintains an ordered list of committed operations and a redo stack.
- `undo` pops the last committed operation (global) and pushes it on redo stack. `redo` reverses that.
- When undo/redo occur server broadcasts `rebuild` with the updated ops to force authoritative state across clients.

Conflict resolution
- This implementation uses a simple last-write-wins approach. Live strokes are only visually shown as they stream; only fully-committed strokes appear in history. Undo removes the most recent committed op regardless of origin.

Performance decisions
- Client throttles stroke updates (50ms) and sends small batches of recent points to reduce message rate.
- Server broadcasts deltas for live feedback and occasional full rebuilds when operations commit or undo/redo happens.

Limitations & next steps
- State is in-memory (no persistence). Add DB for session persistence.
- Undo/redo is global and coarse; a CRDT-based approach or operation attribution could allow per-user undo or more nuanced conflict-free merging.
- Rebuild currently sends full ops. For large histories, send diffs or snapshot + diffs.
