export const DEMO_ROOM_ID = "demo-room";

export const BOARD = Object.freeze({
  width: 1200,
  height: 720,
  cellWidth: 56,
  cellHeight: 78,
  tileWidth: 48,
  tileHeight: 68,
});

export const TABLE = Object.freeze({
  x: 0,
  y: 0,
  width: 1200,
  height: 536,
});

export const RACK = Object.freeze({
  x: 28,
  y: 600,
  width: 1144,
  height: 96,
});

export const TILE_LOCATIONS = Object.freeze({
  BOARD: "board",
  RACK: "rack",
});

export const CLIENT_EVENTS = Object.freeze({
  JOIN_ROOM: "room:join",
  MOVE_TILE: "tile:move",
  COMMIT_TURN: "turn:commit",
  RESET_TURN: "turn:reset",
});

export const SERVER_EVENTS = Object.freeze({
  ROOM_STATE: "room:state",
  MOVE_REJECTED: "tile:move-rejected",
  SERVER_ERROR: "server:error",
});

export function snapPoint(x, y) {
  return {
    x: Math.round(x / BOARD.cellWidth) * BOARD.cellWidth,
    y: Math.round(y / BOARD.cellHeight) * BOARD.cellHeight,
  };
}

export function getTileZoneFromPoint(x, y) {
  if (isInsideRect(x, y, RACK)) {
    return TILE_LOCATIONS.RACK;
  }

  return TILE_LOCATIONS.BOARD;
}

export function snapTilePosition(x, y, zone = TILE_LOCATIONS.BOARD) {
  const snapped = snapPoint(x, y);
  const bounds = zone === TILE_LOCATIONS.RACK ? RACK : TABLE;

  return clampTileToRect(snapped.x, snapped.y, bounds);
}

export function clampTileToBoard(x, y) {
  return clampTileToRect(x, y, {
    x: 0,
    y: 0,
    width: BOARD.width,
    height: BOARD.height,
  });
}

export function clampTileToRect(x, y, rect) {
  return {
    x: Math.max(rect.x, Math.min(x, rect.x + rect.width - BOARD.tileWidth)),
    y: Math.max(rect.y, Math.min(y, rect.y + rect.height - BOARD.tileHeight)),
  };
}

export function isInsideRect(x, y, rect) {
  return (
    x >= rect.x &&
    x <= rect.x + rect.width &&
    y >= rect.y &&
    y <= rect.y + rect.height
  );
}
