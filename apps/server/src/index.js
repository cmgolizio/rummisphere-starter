import "dotenv/config";
import { createServer } from "node:http";
import { Server } from "socket.io";
import {
  commitTurn,
  createWaitingRoomState,
  drawAndPass,
  ensurePlayer,
  moveTile,
  publicStateForPlayer,
  requestRematch,
  resetTurn,
  setPlayerConnected,
  setPlayerReady,
  startGame,
} from "@rummisphere/game-engine";
import { CLIENT_EVENTS, SERVER_EVENTS } from "@rummisphere/shared";

const PORT = Number(process.env.PORT || 4000);
const WEB_ORIGIN = process.env.WEB_ORIGIN || "http://localhost:3000";

const httpServer = createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, {
      "content-type": "application/json",
    });

    res.end(
      JSON.stringify({
        ok: true,
      }),
    );

    return;
  }

  res.writeHead(404, {
    "content-type": "application/json",
  });

  res.end(
    JSON.stringify({
      ok: false,
      error: "Not found",
    }),
  );
});

const io = new Server(httpServer, {
  cors: {
    origin: WEB_ORIGIN,
    methods: ["GET", "POST"],
  },
});

const rooms = new Map();

io.on("connection", (socket) => {
  console.log(`[socket] connected ${socket.id}`);

  socket.on(CLIENT_EVENTS.CREATE_ROOM, (_payload = {}, ack) => {
    const roomId = generateUniqueRoomCode();
    const room = createWaitingRoomState(roomId);
    const nextRoom = ensurePlayer(room, socket.id);

    rooms.set(roomId, nextRoom);
    joinSocketRoom(socket, roomId);

    emitRoomState(roomId, nextRoom);

    ack?.({
      ok: true,
      playerId: socket.id,
      roomId,
      state: publicStateForPlayer(nextRoom, socket.id),
    });
  });

  socket.on(CLIENT_EVENTS.JOIN_ROOM, (payload = {}, ack) => {
    const roomId = normalizeRoomCode(payload.roomId);
    const room = rooms.get(roomId);

    if (!room) {
      reject(socket, ack, "Room does not exist.");
      return;
    }

    const existingPlayer = room.players.find(
      (player) => player.id === socket.id,
    );

    if (!existingPlayer && room.phase !== "waiting") {
      reject(socket, ack, "Cannot join a game that has already started.");
      return;
    }

    const connectedPlayers = room.players.filter((player) => player.connected);

    if (!existingPlayer && connectedPlayers.length >= 4) {
      reject(socket, ack, "Room is full.");
      return;
    }

    const nextRoom = ensurePlayer(room, socket.id);

    rooms.set(roomId, nextRoom);
    joinSocketRoom(socket, roomId);

    emitRoomState(roomId, nextRoom);

    ack?.({
      ok: true,
      playerId: socket.id,
      roomId,
      state: publicStateForPlayer(nextRoom, socket.id),
    });
  });

  socket.on(CLIENT_EVENTS.SET_READY, (payload = {}, ack) => {
    const roomId = getActiveRoomId(socket, payload);
    const room = rooms.get(roomId);

    if (!room) {
      reject(socket, ack, "Room does not exist.");
      return;
    }

    const result = setPlayerReady(room, socket.id, payload.ready);

    if (!result.ok) {
      reject(socket, ack, result.reason);
      return;
    }

    rooms.set(roomId, result.state);
    emitRoomState(roomId, result.state);

    ack?.({
      ok: true,
      version: result.state.version,
    });
  });

  socket.on(CLIENT_EVENTS.START_GAME, (payload = {}, ack) => {
    const roomId = getActiveRoomId(socket, payload);
    const room = rooms.get(roomId);

    if (!room) {
      reject(socket, ack, "Room does not exist.");
      return;
    }

    const result = startGame(room, socket.id);

    if (!result.ok) {
      reject(socket, ack, result.reason);
      return;
    }

    rooms.set(roomId, result.state);
    emitRoomState(roomId, result.state);

    ack?.({
      ok: true,
      version: result.state.version,
    });
  });

  socket.on(CLIENT_EVENTS.MOVE_TILE, (payload = {}, ack) => {
    const roomId = getActiveRoomId(socket, payload);
    const room = rooms.get(roomId);

    if (!room) {
      reject(socket, ack, "Room does not exist.");
      return;
    }

    const result = moveTile(room, socket.id, payload);

    if (!result.ok) {
      reject(socket, ack, result.reason, {
        tileId: payload.tileId,
      });

      return;
    }

    rooms.set(roomId, result.state);
    emitRoomState(roomId, result.state);

    ack?.({
      ok: true,
      move: result.move,
      version: result.state.version,
    });
  });

  socket.on(CLIENT_EVENTS.COMMIT_TURN, (payload = {}, ack) => {
    const roomId = getActiveRoomId(socket, payload);
    const room = rooms.get(roomId);

    if (!room) {
      reject(socket, ack, "Room does not exist.");
      return;
    }

    const result = commitTurn(room, socket.id);

    if (!result.ok) {
      reject(socket, ack, result.reason, {
        invalidGroups: result.invalidGroups || [],
      });

      return;
    }

    rooms.set(roomId, result.state);
    emitRoomState(roomId, result.state);

    ack?.({
      ok: true,
      version: result.state.version,
    });
  });

  socket.on(CLIENT_EVENTS.RESET_TURN, (payload = {}, ack) => {
    const roomId = getActiveRoomId(socket, payload);
    const room = rooms.get(roomId);

    if (!room) {
      reject(socket, ack, "Room does not exist.");
      return;
    }

    const result = resetTurn(room, socket.id);

    if (!result.ok) {
      reject(socket, ack, result.reason);
      return;
    }

    rooms.set(roomId, result.state);
    emitRoomState(roomId, result.state);

    ack?.({
      ok: true,
      version: result.state.version,
    });
  });

  socket.on(CLIENT_EVENTS.DRAW_AND_PASS, (payload = {}, ack) => {
    const roomId = getActiveRoomId(socket, payload);
    const room = rooms.get(roomId);

    if (!room) {
      reject(socket, ack, "Room does not exist.");
      return;
    }

    const result = drawAndPass(room, socket.id);

    if (!result.ok) {
      reject(socket, ack, result.reason);
      return;
    }

    rooms.set(roomId, result.state);
    emitRoomState(roomId, result.state);

    ack?.({
      ok: true,
      drawnTileId: result.drawnTileId,
      version: result.state.version,
    });
  });

  socket.on(CLIENT_EVENTS.REQUEST_REMATCH, (payload = {}, ack) => {
    const roomId = getActiveRoomId(socket, payload);
    const room = rooms.get(roomId);

    if (!room) {
      reject(socket, ack, "Room does not exist.");
      return;
    }

    const result = requestRematch(room, socket.id);

    if (!result.ok) {
      reject(socket, ack, result.reason);
      return;
    }

    rooms.set(roomId, result.state);
    emitRoomState(roomId, result.state);

    ack?.({
      ok: true,
      version: result.state.version,
    });
  });

  socket.on("disconnect", () => {
    for (const [roomId, room] of rooms.entries()) {
      const wasInRoom = room.players.some((player) => player.id === socket.id);

      if (!wasInRoom) continue;

      const nextState = setPlayerConnected(room, socket.id, false);

      rooms.set(roomId, nextState);
      emitRoomState(roomId, nextState);
    }

    console.log(`[socket] disconnected ${socket.id}`);
  });
});

httpServer.listen(PORT, () => {
  console.log(`[server] Socket.IO listening on http://localhost:${PORT}`);
  console.log(`[server] Allowing web origin: ${WEB_ORIGIN}`);
});

function emitRoomState(roomId, state) {
  const socketIds = io.sockets.adapter.rooms.get(roomId);

  if (!socketIds) return;

  for (const socketId of socketIds) {
    const targetSocket = io.sockets.sockets.get(socketId);

    if (!targetSocket) continue;

    targetSocket.emit(
      SERVER_EVENTS.ROOM_STATE,
      publicStateForPlayer(state, socketId),
    );
  }
}

function reject(socket, ack, reason, extra = {}) {
  const payload = {
    ok: false,
    reason,
    ...extra,
  };

  socket.emit(SERVER_EVENTS.MOVE_REJECTED, payload);
  ack?.(payload);
}

function joinSocketRoom(socket, roomId) {
  const previousRoomId = socket.data.roomId;

  if (previousRoomId && previousRoomId !== roomId) {
    socket.leave(previousRoomId);
  }

  socket.join(roomId);
  socket.data.roomId = roomId;
}

function getActiveRoomId(socket, payload = {}) {
  return normalizeRoomCode(payload.roomId || socket.data.roomId);
}

function normalizeRoomCode(roomId) {
  return String(roomId || "")
    .trim()
    .toUpperCase();
}

function generateUniqueRoomCode() {
  let code = generateRoomCode();

  while (rooms.has(code)) {
    code = generateRoomCode();
  }

  return code;
}

function generateRoomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";

  for (let index = 0; index < 5; index += 1) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)];
  }

  return code;
}
