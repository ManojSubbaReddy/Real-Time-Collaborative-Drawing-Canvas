// WebSocket wrapper using socket.io client
(function(){
  const socket = io();

  function on(event, cb){ socket.on(event, cb); }
  function emit(event, data){ socket.emit(event, data); }
  function id(){ return socket.id; }

  window.WS = { on, emit, id };
})();
