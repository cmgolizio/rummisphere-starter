import {
  BOARD,
  RACK,
  TILE_LOCATIONS,
  snapTilePosition,
} from "@rummisphere/shared";

export const COLORS = ["red", "blue", "black", "orange"];

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
  const tiles = [
    createTile({ id: "board-r-3", color: "red", number: 3, x: 56, y: 78 }),
    createTile({ id: "board-r-4", color: "red", number: 4, x: 112, y: 78 }),
    createTile({ id: "board-r-5", color: "red", number: 5, x: 168, y: 78 }),

    createTile({ id: "board-b-7", color: "blue", number: 7, x: 56, y: 234 }),
    createTile({ id: "board-k-7", color: "black", number: 7, x: 112, y: 234 }),
    createTile({
      id: "board-o-7",
      color: "orange",
      number: 7,
      x: 168,
      y: 234,
    }),

    createTile({
      id: "board-b-10",
      color: "blue",
      number: 10,
      x: 392,
      y: 78,
    }),
    createTile({
      id: "board-b-11",
      color: "blue",
      number: 11,
      x: 448,
      y: 78,
    }),
    createTile({
      id: "board-b-12",
      color: "blue",
      number: 12,
      x: 504,
      y: 78,
    }),
  ];

  return {
    id: "demo-room",
    phase: "playing",
    version: 1,
    currentTurnPlayerId: null,
    players: [],
    tiles,
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
  };

  const rackTiles = createRackTilesForPlayer(playerId, state.players.length);

  const nextTurn =
    state.turn?.snapshotTiles && state.currentTurnPlayerId
      ? {
          ...state.turn,
          snapshotTiles: [
            ...deepCloneTiles(state.turn.snapshotTiles),
            ...deepCloneTiles(rackTiles),
          ],
        }
      : state.turn;

  const nextState = {
    ...state,
    players: [...state.players, nextPlayer],
    tiles: [...state.tiles, ...rackTiles],
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
  if (!state.players.some((player) => player.id === playerId)) {
    return fail("Unknown player.");
  }

  if (state.currentTurnPlayerId !== playerId) {
    return fail("Not your turn.");
  }

  const tile = state.tiles.find((candidate) => candidate.id === input.tileId);

  if (!tile) {
    return fail("Tile does not exist.");
  }

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

  const nextPlayerId = getNextTurnPlayerId(state.players, playerId);

  const committedState = {
    ...state,
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

function createRackTilesForPlayer(playerId, playerIndex) {
  const rackSets = [
    [
      { color: "red", number: 1 },
      { color: "blue", number: 2 },
      { color: "black", number: 3 },
      { color: "orange", number: 4 },
      { color: "red", number: 8 },
      { color: "blue", number: 8 },
      { color: "black", number: 11 },
    ],
    [
      { color: "orange", number: 1 },
      { color: "black", number: 2 },
      { color: "red", number: 6 },
      { color: "blue", number: 6 },
      { color: "orange", number: 9 },
      { color: "black", number: 10 },
      { color: "red", number: 13 },
    ],
  ];

  const selectedSet = rackSets[playerIndex % rackSets.length];

  return selectedSet.map((tile, index) => {
    const x = BOARD.cellWidth * (index + 1);
    const y = 624;

    return createTile({
      id: `${playerId}-rack-${index}`,
      color: tile.color,
      number: tile.number,
      x: Math.min(x, RACK.x + RACK.width - BOARD.tileWidth),
      y,
      location: TILE_LOCATIONS.RACK,
      ownerId: playerId,
    });
  });
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

function fail(reason) {
  return {
    ok: false,
    reason,
  };
}
