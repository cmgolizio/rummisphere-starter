import {
  BOARD,
  RACK,
  TILE_LOCATIONS,
  snapTilePosition,
} from "@rummisphere/shared";

export const COLORS = ["red", "blue", "black", "orange"];
export const INITIAL_MELD_MINIMUM = 30;

export function createTile({
  id,
  color,
  number,
  joker = false,
  x = 0,
  y = 0,
  location = TILE_LOCATIONS.BOARD,
  ownerId = null,
}) {
  return {
    id,
    color,
    number,
    joker,
    x,
    y,
    location,
    ownerId,
  };
}

export function createDemoGameState() {
  return {
    id: "demo-room",
    phase: "playing",
    version: 1,
    currentTurnPlayerId: null,
    players: [],
    tiles: [],
    tilePool: createDemoTilePool(),
    turn: {
      number: 1,
      startedAt: null,
      snapshotTiles: null,
    },
    lastError: null,
    updatedAt: Date.now(),
  };
}

export function ensurePlayer(state, playerId, name = "Player") {
  if (!playerId) return state;

  const existing = state.players.find((player) => player.id === playerId);

  if (existing) {
    return {
      ...state,
      players: state.players.map((player) =>
        player.id === playerId ? { ...player, connected: true } : player,
      ),
      updatedAt: Date.now(),
    };
  }

  const nextPlayer = {
    id: playerId,
    name: `${name} ${state.players.length + 1}`,
    connected: true,
    hasOpened: false,
  };

  const deal = dealRackTilesForPlayer(
    playerId,
    state.players.length,
    state.tilePool || [],
  );

  const nextTurn =
    state.turn?.snapshotTiles && state.currentTurnPlayerId
      ? {
          ...state.turn,
          snapshotTiles: [
            ...deepCloneTiles(state.turn.snapshotTiles),
            ...deepCloneTiles(deal.rackTiles),
          ],
        }
      : state.turn;

  const nextState = {
    ...state,
    players: [...state.players, nextPlayer],
    tiles: [...state.tiles, ...deal.rackTiles],
    tilePool: deal.remainingPool,
    turn: nextTurn,
    version: state.version + 1,
    updatedAt: Date.now(),
  };

  if (!state.currentTurnPlayerId) {
    return beginTurn(nextState, playerId, 1);
  }

  return nextState;
}

export function setPlayerConnected(state, playerId, connected) {
  return {
    ...state,
    players: state.players.map((player) =>
      player.id === playerId ? { ...player, connected } : player,
    ),
    version: state.version + 1,
    updatedAt: Date.now(),
  };
}

export function moveTile(state, playerId, input) {
  const player = getPlayer(state, playerId);

  if (!player) {
    return fail("Unknown player.");
  }

  if (state.currentTurnPlayerId !== playerId) {
    return fail("Not your turn.");
  }

  const tile = state.tiles.find((candidate) => candidate.id === input.tileId);

  if (!tile) {
    return fail("Tile does not exist.");
  }

  const snapshotTile = getSnapshotTile(state, tile.id);

  const targetZone =
    input.zone === TILE_LOCATIONS.RACK
      ? TILE_LOCATIONS.RACK
      : TILE_LOCATIONS.BOARD;

  if (tile.location === TILE_LOCATIONS.RACK && tile.ownerId !== playerId) {
    return fail("You cannot move another player's rack tile.");
  }

  if (
    targetZone === TILE_LOCATIONS.RACK &&
    tile.location === TILE_LOCATIONS.BOARD
  ) {
    return fail("Board tiles cannot be moved back into a rack.");
  }

  if (!player.hasOpened && snapshotTile?.location === TILE_LOCATIONS.BOARD) {
    return fail(
      "You must complete your initial 30-point meld before rearranging board tiles.",
    );
  }

  const rawX = Number(input.x);
  const rawY = Number(input.y);

  if (!Number.isFinite(rawX) || !Number.isFinite(rawY)) {
    return fail("Move coordinates must be real numbers.");
  }

  const finalPoint = snapTilePosition(rawX, rawY, targetZone);

  const blockedByTile = state.tiles.find((candidate) => {
    if (candidate.id === tile.id) return false;
    if (candidate.location !== targetZone) return false;

    if (targetZone === TILE_LOCATIONS.RACK && candidate.ownerId !== playerId) {
      return false;
    }

    return candidate.x === finalPoint.x && candidate.y === finalPoint.y;
  });

  if (blockedByTile) {
    return fail(`That cell is occupied by ${blockedByTile.id}.`);
  }

  return {
    ok: true,
    state: {
      ...state,
      tiles: state.tiles.map((candidate) =>
        candidate.id === tile.id
          ? {
              ...candidate,
              x: finalPoint.x,
              y: finalPoint.y,
              location: targetZone,
              ownerId: targetZone === TILE_LOCATIONS.RACK ? playerId : null,
            }
          : candidate,
      ),
      lastError: null,
      version: state.version + 1,
      updatedAt: Date.now(),
    },
    move: {
      tileId: tile.id,
      x: finalPoint.x,
      y: finalPoint.y,
      zone: targetZone,
    },
  };
}

export function commitTurn(state, playerId) {
  const player = getPlayer(state, playerId);

  if (!player) {
    return fail("Unknown player.");
  }

  if (state.currentTurnPlayerId !== playerId) {
    return fail("Not your turn.");
  }

  const playedTiles = getTilesPlayedFromRackThisTurn(state, playerId);

  if (playedTiles.length === 0) {
    return fail(
      "You must play at least one tile from your rack before ending your turn.",
    );
  }

  const validation = validateTable(state.tiles);

  if (!validation.ok) {
    return {
      ok: false,
      reason: "The table contains invalid melds.",
      invalidGroups: validation.invalidGroups,
    };
  }

  if (!player.hasOpened) {
    const openingValidation = validateInitialMeld(state, playerId, playedTiles);

    if (!openingValidation.ok) {
      return {
        ok: false,
        reason: openingValidation.reason,
        openingPoints: openingValidation.points,
        requiredPoints: INITIAL_MELD_MINIMUM,
      };
    }
  }

  const nextPlayerId = getNextTurnPlayerId(state.players, playerId);

  const committedState = {
    ...state,
    players: state.players.map((candidate) =>
      candidate.id === playerId
        ? {
            ...candidate,
            hasOpened: true,
          }
        : candidate,
    ),
    lastError: null,
    version: state.version + 1,
    updatedAt: Date.now(),
  };

  return {
    ok: true,
    state: beginTurn(
      committedState,
      nextPlayerId,
      (state.turn?.number || 1) + 1,
    ),
  };
}

export function resetTurn(state, playerId) {
  if (state.currentTurnPlayerId !== playerId) {
    return fail("Not your turn.");
  }

  if (!state.turn?.snapshotTiles) {
    return fail("No turn snapshot exists.");
  }

  const resetState = {
    ...state,
    tiles: deepCloneTiles(state.turn.snapshotTiles),
    lastError: null,
    version: state.version + 1,
    updatedAt: Date.now(),
  };

  return {
    ok: true,
    state: beginTurn(resetState, playerId, state.turn.number),
  };
}

export function drawAndPass(state, playerId) {
  if (state.currentTurnPlayerId !== playerId) {
    return fail("Not your turn.");
  }

  if (!Array.isArray(state.tilePool) || state.tilePool.length === 0) {
    return fail("No tiles left to draw.");
  }

  const baseTiles = state.turn?.snapshotTiles
    ? deepCloneTiles(state.turn.snapshotTiles)
    : deepCloneTiles(state.tiles);

  const [drawnTemplate, ...remainingPool] = state.tilePool;
  const rackPosition = getNextRackPosition(baseTiles, playerId);

  const drawnTile = createTile({
    id: drawnTemplate.id,
    color: drawnTemplate.color,
    number: drawnTemplate.number,
    joker: drawnTemplate.joker || false,
    x: rackPosition.x,
    y: rackPosition.y,
    location: TILE_LOCATIONS.RACK,
    ownerId: playerId,
  });

  const nextPlayerId = getNextTurnPlayerId(state.players, playerId);

  const nextState = {
    ...state,
    tiles: [...baseTiles, drawnTile],
    tilePool: remainingPool,
    lastError: null,
    version: state.version + 1,
    updatedAt: Date.now(),
  };

  return {
    ok: true,
    state: beginTurn(nextState, nextPlayerId, (state.turn?.number || 1) + 1),
    drawnTileId: drawnTile.id,
  };
}

export function publicStateForPlayer(state, playerId) {
  const currentPlayer = state.players.find(
    (player) => player.id === state.currentTurnPlayerId,
  );

  return {
    id: state.id,
    phase: state.phase,
    version: state.version,
    currentTurnPlayerId: state.currentTurnPlayerId,
    currentTurnPlayerName: currentPlayer?.name || null,
    isYourTurn: state.currentTurnPlayerId === playerId,
    turnNumber: state.turn?.number || 1,
    players: state.players,
    tiles: state.tiles.filter((tile) => {
      if (tile.location === TILE_LOCATIONS.BOARD) return true;
      return tile.ownerId === playerId;
    }),
    rackCounts: state.players.map((player) => ({
      playerId: player.id,
      count: state.tiles.filter(
        (tile) =>
          tile.location === TILE_LOCATIONS.RACK && tile.ownerId === player.id,
      ).length,
    })),
    tilePoolCount: state.tilePool?.length || 0,
    lastError: state.lastError,
    updatedAt: state.updatedAt,
  };
}

export function validateTable(tiles) {
  const boardTiles = tiles.filter(
    (tile) => tile.location === TILE_LOCATIONS.BOARD,
  );

  const melds = extractHorizontalMeldCandidates(boardTiles);
  const invalidGroups = [];

  for (const meld of melds) {
    if (!isValidMeld(meld.tiles)) {
      invalidGroups.push({
        reason: "Invalid meld.",
        tileIds: meld.tiles.map((tile) => tile.id),
        tiles: meld.tiles.map((tile) => ({
          color: tile.color,
          number: tile.number,
          joker: tile.joker,
          x: tile.x,
          y: tile.y,
        })),
      });
    }
  }

  return {
    ok: invalidGroups.length === 0,
    melds,
    invalidGroups,
  };
}

export function extractHorizontalMeldCandidates(boardTiles) {
  const rows = new Map();

  for (const tile of boardTiles) {
    const y = tile.y;

    if (!rows.has(y)) {
      rows.set(y, []);
    }

    rows.get(y).push(tile);
  }

  const melds = [];

  for (const [y, rowTiles] of rows.entries()) {
    const sorted = [...rowTiles].sort((a, b) => a.x - b.x);

    let currentGroup = [];

    for (const tile of sorted) {
      const previous = currentGroup[currentGroup.length - 1];

      if (!previous) {
        currentGroup.push(tile);
        continue;
      }

      const isAdjacent = tile.x - previous.x === BOARD.cellWidth;

      if (isAdjacent) {
        currentGroup.push(tile);
      } else {
        pushMeldCandidate(melds, currentGroup, y);
        currentGroup = [tile];
      }
    }

    pushMeldCandidate(melds, currentGroup, y);
  }

  return melds;
}

export function isValidMeld(tiles) {
  if (!Array.isArray(tiles) || tiles.length < 3) return false;

  return isValidGroup(tiles) || isValidRun(tiles);
}

export function isValidGroup(tiles) {
  const nonJokers = tiles.filter((tile) => !tile.joker);

  if (tiles.length < 3 || tiles.length > 4) return false;
  if (nonJokers.length === 0) return true;

  const number = nonJokers[0].number;
  const allSameNumber = nonJokers.every((tile) => tile.number === number);
  const uniqueColors = new Set(nonJokers.map((tile) => tile.color));

  return allSameNumber && uniqueColors.size === nonJokers.length;
}

export function isValidRun(tiles) {
  const nonJokers = tiles.filter((tile) => !tile.joker);

  if (tiles.length < 3) return false;
  if (nonJokers.length === 0) return true;

  const color = nonJokers[0].color;

  if (!nonJokers.every((tile) => tile.color === color)) {
    return false;
  }

  const sorted = [...nonJokers].sort((a, b) => a.number - b.number);
  const seen = new Set();

  for (const tile of sorted) {
    if (seen.has(tile.number)) return false;
    seen.add(tile.number);
  }

  const min = sorted[0].number;
  const max = sorted[sorted.length - 1].number;
  const gaps = max - min + 1 - sorted.length;
  const jokerCount = tiles.length - nonJokers.length;

  return gaps <= jokerCount;
}

function validateInitialMeld(state, playerId, playedTiles) {
  const playedTileIds = new Set(playedTiles.map((tile) => tile.id));
  const boardTiles = state.tiles.filter(
    (tile) => tile.location === TILE_LOCATIONS.BOARD,
  );
  const melds = extractHorizontalMeldCandidates(boardTiles);

  for (const meld of melds) {
    const containsPlayedTile = meld.tiles.some((tile) =>
      playedTileIds.has(tile.id),
    );

    if (!containsPlayedTile) continue;

    const allTilesInMeldCameFromRackThisTurn = meld.tiles.every((tile) =>
      playedTileIds.has(tile.id),
    );

    if (!allTilesInMeldCameFromRackThisTurn) {
      return {
        ok: false,
        points: getTilesPointTotal(playedTiles),
        reason:
          "Your initial meld cannot use tiles that were already on the table.",
      };
    }
  }

  const points = getTilesPointTotal(playedTiles);

  if (points < INITIAL_MELD_MINIMUM) {
    return {
      ok: false,
      points,
      reason: `Your initial meld must total at least ${INITIAL_MELD_MINIMUM} points. You played ${points}.`,
    };
  }

  return {
    ok: true,
    points,
  };
}

function getTilesPointTotal(tiles) {
  return tiles.reduce((total, tile) => {
    if (tile.joker) return total;
    return total + Number(tile.number || 0);
  }, 0);
}

function beginTurn(state, playerId, turnNumber) {
  return {
    ...state,
    currentTurnPlayerId: playerId,
    turn: {
      number: turnNumber,
      startedAt: Date.now(),
      snapshotTiles: deepCloneTiles(state.tiles),
    },
    updatedAt: Date.now(),
  };
}

function getPlayer(state, playerId) {
  return state.players.find((player) => player.id === playerId) || null;
}

function getSnapshotTile(state, tileId) {
  return state.turn?.snapshotTiles?.find((tile) => tile.id === tileId) || null;
}

function getNextTurnPlayerId(players, currentPlayerId) {
  const connectedPlayers = players.filter((player) => player.connected);

  if (connectedPlayers.length === 0) {
    return currentPlayerId;
  }

  const currentIndex = connectedPlayers.findIndex(
    (player) => player.id === currentPlayerId,
  );

  if (currentIndex === -1) {
    return connectedPlayers[0].id;
  }

  const nextIndex = (currentIndex + 1) % connectedPlayers.length;

  return connectedPlayers[nextIndex].id;
}

function getTilesPlayedFromRackThisTurn(state, playerId) {
  const snapshotTiles = state.turn?.snapshotTiles || [];

  const snapshotById = new Map(snapshotTiles.map((tile) => [tile.id, tile]));

  return state.tiles.filter((tile) => {
    const snapshotTile = snapshotById.get(tile.id);

    if (!snapshotTile) return false;

    const startedInCurrentPlayerRack =
      snapshotTile.location === TILE_LOCATIONS.RACK &&
      snapshotTile.ownerId === playerId;

    const isNowOnBoard = tile.location === TILE_LOCATIONS.BOARD;

    return startedInCurrentPlayerRack && isNowOnBoard;
  });
}

function createDemoTilePool() {
  const pool = createFullTilePool();

  return shuffleTilePool(pool, "rummisphere-demo-room");
}

function createFullTilePool() {
  const pool = [];

  for (const color of COLORS) {
    for (let number = 1; number <= 13; number += 1) {
      pool.push({
        id: `${color}-${number}-a`,
        color,
        number,
        joker: false,
      });

      pool.push({
        id: `${color}-${number}-b`,
        color,
        number,
        joker: false,
      });
    }
  }

  pool.push({
    id: "joker-a",
    color: "black",
    number: null,
    joker: true,
  });

  pool.push({
    id: "joker-b",
    color: "red",
    number: null,
    joker: true,
  });

  return pool;
}

function dealRackTilesForPlayer(playerId, playerIndex, tilePool) {
  const remainingPool = [...tilePool];
  const selectedTemplates = [];

  const starterPlan = getStarterRackPlan(playerIndex);

  for (const wantedTile of starterPlan) {
    const template = takeTileFromPool(remainingPool, wantedTile);

    if (template) {
      selectedTemplates.push(template);
    }
  }

  while (selectedTemplates.length < 14 && remainingPool.length > 0) {
    selectedTemplates.push(remainingPool.shift());
  }

  const rackTiles = selectedTemplates.map((template, index) => {
    const position = getRackPositionByIndex(index);

    return createTile({
      id: template.id,
      color: template.color,
      number: template.number,
      joker: template.joker || false,
      x: position.x,
      y: position.y,
      location: TILE_LOCATIONS.RACK,
      ownerId: playerId,
    });
  });

  return {
    rackTiles,
    remainingPool,
  };
}

function getStarterRackPlan(playerIndex) {
  const starterPlans = [
    [
      { color: "red", number: 3 },
      { color: "red", number: 4 },
      { color: "red", number: 5 },
      { color: "blue", number: 8 },
      { color: "black", number: 8 },
      { color: "orange", number: 8 },
    ],
    [
      { color: "blue", number: 10 },
      { color: "blue", number: 11 },
      { color: "blue", number: 12 },
      { color: "red", number: 7 },
      { color: "black", number: 7 },
      { color: "orange", number: 7 },
    ],
  ];

  return starterPlans[playerIndex % starterPlans.length];
}

function takeTileFromPool(pool, wantedTile) {
  const index = pool.findIndex((tile) => {
    if (wantedTile.joker) return tile.joker;

    return (
      !tile.joker &&
      tile.color === wantedTile.color &&
      tile.number === wantedTile.number
    );
  });

  if (index === -1) return null;

  const [template] = pool.splice(index, 1);

  return template;
}

function getNextRackPosition(tiles, playerId) {
  const occupied = new Set(
    tiles
      .filter(
        (tile) =>
          tile.location === TILE_LOCATIONS.RACK && tile.ownerId === playerId,
      )
      .map((tile) => `${tile.x}:${tile.y}`),
  );

  const maxSlots = getRackColumnCount() * 2;

  for (let index = 0; index < maxSlots; index += 1) {
    const position = getRackPositionByIndex(index);
    const key = `${position.x}:${position.y}`;

    if (!occupied.has(key)) {
      return position;
    }
  }

  return getRackPositionByIndex(maxSlots - 1);
}

function getRackPositionByIndex(index) {
  const columnCount = getRackColumnCount();
  const column = index % columnCount;
  const row = Math.floor(index / columnCount);

  return {
    x: BOARD.cellWidth * (column + 1),
    y: RACK.y + row * BOARD.cellHeight,
  };
}

function getRackColumnCount() {
  return Math.floor((RACK.width - BOARD.tileWidth) / BOARD.cellWidth);
}

function pushMeldCandidate(melds, tiles, y) {
  if (!tiles.length) return;

  melds.push({
    y,
    tiles,
  });
}

function deepCloneTiles(tiles) {
  return tiles.map((tile) => ({ ...tile }));
}

function shuffleTilePool(pool, seedText) {
  const shuffled = [...pool];
  const random = seededRandom(seedText);

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    const temp = shuffled[index];

    shuffled[index] = shuffled[swapIndex];
    shuffled[swapIndex] = temp;
  }

  return shuffled;
}

function seededRandom(seedText) {
  let seed = 0;

  for (let index = 0; index < seedText.length; index += 1) {
    seed = Math.imul(31, seed) + seedText.charCodeAt(index);
    seed |= 0;
  }

  return function random() {
    seed = Math.imul(seed + 0x6d2b79f5, 1);
    let value = seed;

    value ^= value >>> 15;
    value = Math.imul(value, value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);

    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function fail(reason) {
  return {
    ok: false,
    reason,
  };
}
