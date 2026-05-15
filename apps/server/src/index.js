import "dotenv/config";
import { createServer } from "node:http";
import { Server } from "socket.io";
import {
  commitTurn,
  createWaitingRoomState,
  drawAndPass,
  ensurePlayer,
  leaveRoom,
  moveTile,
  publicStateForPlayer,
  requestRematch,
  resetTurn,
  setPlayerConnected,
  setPlayerReady,
  startGame,
} from "@rummisphere/game-engine";
import { CLIENT_EVENTS, SERVER_EVENTS } from "@rummisphere/shared";
import {
  deleteRoomState,
  isPersistenceEnabled,
  loadRoomState,
  logMatchMove,
  saveRoomState,
} from "./lib/persistence.js";

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
        persistence: isPersistenceEnabled() ? "enabled" : "disabled",
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

  socket.on(CLIENT_EVENTS.CREATE_ROOM, async (payload = {}, ack) => {
    const identity = resolvePlayerIdentity(socket, payload);

    const roomId = await generateUniqueRoomCode();
    const room = createWaitingRoomState(roomId);
    const nextRoom = ensurePlayer(
      room,
      identity.playerId,
      identity.displayName,
    );

    rooms.set(roomId, nextRoom);
    joinSocketRoom(socket, roomId);

    await saveRoomState(nextRoom);
    await logMatchMove({
      roomId,
      playerId: identity.playerId,
      moveType: "room:create",
      payload: {
        displayName: identity.displayName,
      },
      resultingVersion: nextRoom.version,
    });

    emitRoomState(roomId, nextRoom);

    ack?.({
      ok: true,
      playerId: identity.playerId,
      roomId,
      state: publicStateForPlayer(nextRoom, identity.playerId),
    });
  });

  socket.on(CLIENT_EVENTS.JOIN_ROOM, async (payload = {}, ack) => {
    const identity = resolvePlayerIdentity(socket, payload);
    const roomId = normalizeRoomCode(payload.roomId);
    const room = await getRoomById(roomId);

    if (!room) {
      reject(socket, ack, "Room does not exist.");
      return;
    }

    const existingPlayer = room.players.find(
      (player) => player.id === identity.playerId,
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

    const nextRoom = ensurePlayer(
      room,
      identity.playerId,
      identity.displayName,
    );

    rooms.set(roomId, nextRoom);
    joinSocketRoom(socket, roomId);

    await saveRoomState(nextRoom);
    await logMatchMove({
      roomId,
      playerId: identity.playerId,
      moveType: "room:join",
      payload: {
        displayName: identity.displayName,
        existingPlayer: Boolean(existingPlayer),
      },
      resultingVersion: nextRoom.version,
    });

    emitRoomState(roomId, nextRoom);

    ack?.({
      ok: true,
      playerId: identity.playerId,
      roomId,
      state: publicStateForPlayer(nextRoom, identity.playerId),
    });
  });

  socket.on(CLIENT_EVENTS.SET_READY, async (payload = {}, ack) => {
    const roomId = getActiveRoomId(socket, payload);
    const room = await getRoomById(roomId);
    const playerId = getSocketPlayerId(socket);

    if (!room) {
      reject(socket, ack, "Room does not exist.");
      return;
    }

    const result = setPlayerReady(room, playerId, payload.ready);

    if (!result.ok) {
      reject(socket, ack, result.reason);
      return;
    }

    rooms.set(roomId, result.state);

    await saveRoomState(result.state);
    await logMatchMove({
      roomId,
      playerId,
      moveType: "room:set-ready",
      payload: {
        ready: Boolean(payload.ready),
      },
      resultingVersion: result.state.version,
    });

    emitRoomState(roomId, result.state);

    ack?.({
      ok: true,
      version: result.state.version,
    });
  });

  socket.on(CLIENT_EVENTS.START_GAME, async (payload = {}, ack) => {
    const roomId = getActiveRoomId(socket, payload);
    const room = await getRoomById(roomId);
    const playerId = getSocketPlayerId(socket);

    if (!room) {
      reject(socket, ack, "Room does not exist.");
      return;
    }

    const result = startGame(room, playerId);

    if (!result.ok) {
      reject(socket, ack, result.reason);
      return;
    }

    rooms.set(roomId, result.state);

    await saveRoomState(result.state);
    await logMatchMove({
      roomId,
      playerId,
      moveType: "game:start",
      payload: {},
      resultingVersion: result.state.version,
    });

    emitRoomState(roomId, result.state);

    ack?.({
      ok: true,
      version: result.state.version,
    });
  });

  socket.on(CLIENT_EVENTS.MOVE_TILE, async (payload = {}, ack) => {
    const roomId = getActiveRoomId(socket, payload);
    const room = await getRoomById(roomId);
    const playerId = getSocketPlayerId(socket);

    if (!room) {
      reject(socket, ack, "Room does not exist.");
      return;
    }

    const result = moveTile(room, playerId, payload);

    if (!result.ok) {
      reject(socket, ack, result.reason, {
        tileId: payload.tileId,
      });

      return;
    }

    rooms.set(roomId, result.state);

    await saveRoomState(result.state);
    await logMatchMove({
      roomId,
      playerId,
      moveType: "tile:move",
      payload: {
        tileId: payload.tileId,
        x: payload.x,
        y: payload.y,
        zone: payload.zone,
        acceptedMove: result.move,
      },
      resultingVersion: result.state.version,
    });

    emitRoomState(roomId, result.state);

    ack?.({
      ok: true,
      move: result.move,
      version: result.state.version,
    });
  });

  socket.on(CLIENT_EVENTS.COMMIT_TURN, async (payload = {}, ack) => {
    const roomId = getActiveRoomId(socket, payload);
    const room = await getRoomById(roomId);
    const playerId = getSocketPlayerId(socket);

    if (!room) {
      reject(socket, ack, "Room does not exist.");
      return;
    }

    const result = commitTurn(room, playerId);

    if (!result.ok) {
      reject(socket, ack, result.reason, {
        invalidGroups: result.invalidGroups || [],
      });

      return;
    }

    rooms.set(roomId, result.state);

    await saveRoomState(result.state);
    await logMatchMove({
      roomId,
      playerId,
      moveType: "turn:commit",
      payload: {},
      resultingVersion: result.state.version,
    });

    emitRoomState(roomId, result.state);

    ack?.({
      ok: true,
      version: result.state.version,
    });
  });

  socket.on(CLIENT_EVENTS.RESET_TURN, async (payload = {}, ack) => {
    const roomId = getActiveRoomId(socket, payload);
    const room = await getRoomById(roomId);
    const playerId = getSocketPlayerId(socket);

    if (!room) {
      reject(socket, ack, "Room does not exist.");
      return;
    }

    const result = resetTurn(room, playerId);

    if (!result.ok) {
      reject(socket, ack, result.reason);
      return;
    }

    rooms.set(roomId, result.state);

    await saveRoomState(result.state);
    await logMatchMove({
      roomId,
      playerId,
      moveType: "turn:reset",
      payload: {},
      resultingVersion: result.state.version,
    });

    emitRoomState(roomId, result.state);

    ack?.({
      ok: true,
      version: result.state.version,
    });
  });

  socket.on(CLIENT_EVENTS.DRAW_AND_PASS, async (payload = {}, ack) => {
    const roomId = getActiveRoomId(socket, payload);
    const room = await getRoomById(roomId);
    const playerId = getSocketPlayerId(socket);

    if (!room) {
      reject(socket, ack, "Room does not exist.");
      return;
    }

    const result = drawAndPass(room, playerId);

    if (!result.ok) {
      reject(socket, ack, result.reason);
      return;
    }

    rooms.set(roomId, result.state);

    await saveRoomState(result.state);
    await logMatchMove({
      roomId,
      playerId,
      moveType: "turn:draw-and-pass",
      payload: {
        drawnTileId: result.drawnTileId,
      },
      resultingVersion: result.state.version,
    });

    emitRoomState(roomId, result.state);

    ack?.({
      ok: true,
      drawnTileId: result.drawnTileId,
      version: result.state.version,
    });
  });

  socket.on(CLIENT_EVENTS.REQUEST_REMATCH, async (payload = {}, ack) => {
    const roomId = getActiveRoomId(socket, payload);
    const room = await getRoomById(roomId);
    const playerId = getSocketPlayerId(socket);

    if (!room) {
      reject(socket, ack, "Room does not exist.");
      return;
    }

    const result = requestRematch(room, playerId);

    if (!result.ok) {
      reject(socket, ack, result.reason);
      return;
    }

    rooms.set(roomId, result.state);

    await saveRoomState(result.state);
    await logMatchMove({
      roomId,
      playerId,
      moveType: "match:request-rematch",
      payload: {},
      resultingVersion: result.state.version,
    });

    emitRoomState(roomId, result.state);

    ack?.({
      ok: true,
      version: result.state.version,
    });
  });
  socket.on(CLIENT_EVENTS.LEAVE_ROOM, async (payload = {}, ack) => {
    const roomId = getActiveRoomId(socket, payload);
    const room = await getRoomById(roomId);
    const playerId = getSocketPlayerId(socket);

    if (!room) {
      reject(socket, ack, "Room does not exist.");
      return;
    }

    const result = leaveRoom(room, playerId);

    if (!result.ok) {
      reject(socket, ack, result.reason);
      return;
    }

    socket.leave(roomId);
    socket.data.roomId = null;

    if (result.shouldDeleteRoom) {
      rooms.delete(roomId);
      await deleteRoomState(roomId);

      await logMatchMove({
        roomId,
        playerId,
        moveType: "room:leave",
        payload: {},
        resultingVersion: result.state.version,
      });

      ack?.({ ok: true, roomDeleted: true });
      return;
    }

    rooms.set(roomId, result.state);

    await saveRoomState(result.state);
    await logMatchMove({
      roomId,
      playerId,
      moveType: room.phase === "waiting" ? "room:leave" : "player:leave",
      payload: {},
      resultingVersion: result.state.version,
    });

    emitRoomState(roomId, result.state);

    ack?.({ ok: true });
  });

  socket.on("disconnect", async () => {
    const playerId = getSocketPlayerId(socket);

    for (const [roomId, room] of rooms.entries()) {
      const wasInRoom = room.players.some((player) => player.id === playerId);

      if (!wasInRoom) continue;

      const stillConnectedElsewhere = isPlayerConnectedInRoom(
        roomId,
        playerId,
        socket.id,
      );

      if (stillConnectedElsewhere) continue;

      const nextState = setPlayerConnected(room, playerId, false);

      rooms.set(roomId, nextState);

      await saveRoomState(nextState);
      await logMatchMove({
        roomId,
        playerId,
        moveType: "player:disconnect",
        payload: {},
        resultingVersion: nextState.version,
      });

      emitRoomState(roomId, nextState);
    }

    console.log(`[socket] disconnected ${socket.id}`);
  });
});

httpServer.listen(PORT, () => {
  console.log(`[server] Socket.IO listening on http://localhost:${PORT}`);
  console.log(`[server] Allowing web origin: ${WEB_ORIGIN}`);
  console.log(
    `[server] Persistence: ${isPersistenceEnabled() ? "enabled" : "disabled"}`,
  );
});

async function getRoomById(roomId) {
  const normalizedRoomId = normalizeRoomCode(roomId);

  if (!normalizedRoomId) return null;

  const cachedRoom = rooms.get(normalizedRoomId);

  if (cachedRoom) return cachedRoom;

  const savedRoom = await loadRoomState(normalizedRoomId);

  if (!savedRoom) return null;

  rooms.set(normalizedRoomId, savedRoom);

  return savedRoom;
}

function emitRoomState(roomId, state) {
  const socketIds = io.sockets.adapter.rooms.get(roomId);

  if (!socketIds) return;

  for (const socketId of socketIds) {
    const targetSocket = io.sockets.sockets.get(socketId);

    if (!targetSocket) continue;

    const playerId = getSocketPlayerId(targetSocket);

    targetSocket.emit(
      SERVER_EVENTS.ROOM_STATE,
      publicStateForPlayer(state, playerId),
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

function getSocketPlayerId(socket) {
  return socket.data.playerId || socket.id;
}

function resolvePlayerIdentity(socket, payload = {}) {
  const playerId = sanitizePlayerId(payload.clientId) || socket.id;
  const displayName = sanitizeDisplayName(payload.displayName) || "Player";

  socket.data.playerId = playerId;
  socket.data.displayName = displayName;

  return {
    playerId,
    displayName,
  };
}

function sanitizePlayerId(value) {
  return String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .slice(0, 80);
}

function sanitizeDisplayName(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 24);
}

function normalizeRoomCode(roomId) {
  return String(roomId || "")
    .trim()
    .toUpperCase();
}

async function generateUniqueRoomCode() {
  let code = generateRoomCode();

  while (rooms.has(code) || (await loadRoomState(code))) {
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

function isPlayerConnectedInRoom(roomId, playerId, excludingSocketId) {
  const socketIds = io.sockets.adapter.rooms.get(roomId);

  if (!socketIds) return false;

  for (const socketId of socketIds) {
    if (socketId === excludingSocketId) continue;

    const socket = io.sockets.sockets.get(socketId);

    if (!socket) continue;
    if (!socket.connected) continue;

    if (getSocketPlayerId(socket) === playerId) {
      return true;
    }
  }

  return false;
}
