import { describe, expect, test } from "vitest";
import {
  commitTurn,
  createDemoGameState,
  drawAndPass,
  ensurePlayer,
  moveTile,
  resetTurn,
  validateTable,
} from "../src/index.js";
import { TILE_LOCATIONS } from "@rummisphere/shared";

function createTwoPlayerState() {
  let state = createDemoGameState();

  state = ensurePlayer(state, "p1");
  state = ensurePlayer(state, "p2");

  return state;
}

function getTile(state, ownerId, color, number) {
  const tile = state.tiles.find((candidate) => {
    return (
      candidate.ownerId === ownerId &&
      candidate.location === TILE_LOCATIONS.RACK &&
      candidate.color === color &&
      candidate.number === number
    );
  });

  if (!tile) {
    throw new Error(`Could not find ${ownerId} ${color} ${number}`);
  }

  return tile;
}

function playTile(state, playerId, tile, x, y) {
  const result = moveTile(state, playerId, {
    tileId: tile.id,
    x,
    y,
    zone: TILE_LOCATIONS.BOARD,
  });

  if (!result.ok) {
    throw new Error(result.reason);
  }

  return result.state;
}

function playP1OpeningMelds(state) {
  const red3 = getTile(state, "p1", "red", 3);
  const red4 = getTile(state, "p1", "red", 4);
  const red5 = getTile(state, "p1", "red", 5);

  const blue8 = getTile(state, "p1", "blue", 8);
  const black8 = getTile(state, "p1", "black", 8);
  const orange8 = getTile(state, "p1", "orange", 8);

  state = playTile(state, "p1", red3, 56, 78);
  state = playTile(state, "p1", red4, 112, 78);
  state = playTile(state, "p1", red5, 168, 78);

  state = playTile(state, "p1", blue8, 56, 156);
  state = playTile(state, "p1", black8, 112, 156);
  state = playTile(state, "p1", orange8, 168, 156);

  return state;
}

function stripP1RackToOnly(state, wantedTiles) {
  const wantedIds = new Set(wantedTiles.map((tile) => tile.id));

  return {
    ...state,
    players: state.players.map((player) =>
      player.id === "p1"
        ? {
            ...player,
            hasOpened: true,
          }
        : player,
    ),
    tiles: state.tiles.filter((tile) => {
      if (tile.ownerId !== "p1") return true;
      if (tile.location !== TILE_LOCATIONS.RACK) return true;
      return wantedIds.has(tile.id);
    }),
    turn: {
      ...state.turn,
      snapshotTiles: state.turn.snapshotTiles.filter((tile) => {
        if (tile.ownerId !== "p1") return true;
        if (tile.location !== TILE_LOCATIONS.RACK) return true;
        return wantedIds.has(tile.id);
      }),
    },
  };
}

describe("game engine", () => {
  test("new players receive 14 rack tiles each", () => {
    const state = createTwoPlayerState();

    const p1Rack = state.tiles.filter(
      (tile) => tile.ownerId === "p1" && tile.location === TILE_LOCATIONS.RACK,
    );

    const p2Rack = state.tiles.filter(
      (tile) => tile.ownerId === "p2" && tile.location === TILE_LOCATIONS.RACK,
    );

    expect(p1Rack).toHaveLength(14);
    expect(p2Rack).toHaveLength(14);
    expect(state.currentTurnPlayerId).toBe("p1");
  });

  test("player cannot end turn without playing a tile", () => {
    const state = createTwoPlayerState();

    const result = commitTurn(state, "p1");

    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/must play at least one tile/i);
  });

  test("initial meld under 30 points is rejected", () => {
    let state = createTwoPlayerState();

    const red3 = getTile(state, "p1", "red", 3);
    const red4 = getTile(state, "p1", "red", 4);
    const red5 = getTile(state, "p1", "red", 5);

    state = playTile(state, "p1", red3, 56, 78);
    state = playTile(state, "p1", red4, 112, 78);
    state = playTile(state, "p1", red5, 168, 78);

    const result = commitTurn(state, "p1");

    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/at least 30/i);
    expect(result.openingPoints).toBe(12);
  });

  test("valid initial meld totaling at least 30 points opens player", () => {
    let state = createTwoPlayerState();

    state = playP1OpeningMelds(state);

    const validation = validateTable(state.tiles);

    expect(validation.ok).toBe(true);

    const result = commitTurn(state, "p1");

    expect(result.ok).toBe(true);
    expect(result.state.currentTurnPlayerId).toBe("p2");

    const p1 = result.state.players.find((player) => player.id === "p1");

    expect(p1.hasOpened).toBe(true);
  });

  test("player who has not opened cannot move existing board tiles", () => {
    let state = createTwoPlayerState();

    state = playP1OpeningMelds(state);

    const p1Commit = commitTurn(state, "p1");

    expect(p1Commit.ok).toBe(true);

    state = p1Commit.state;

    const existingBoardTile = state.tiles.find(
      (tile) => tile.location === TILE_LOCATIONS.BOARD,
    );

    const result = moveTile(state, "p2", {
      tileId: existingBoardTile.id,
      x: existingBoardTile.x + 56,
      y: existingBoardTile.y,
      zone: TILE_LOCATIONS.BOARD,
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/initial 30-point meld/i);
  });

  test("draw and pass adds one tile to current player's rack and advances turn", () => {
    const state = createTwoPlayerState();

    const p1RackBefore = state.tiles.filter(
      (tile) => tile.ownerId === "p1" && tile.location === TILE_LOCATIONS.RACK,
    );

    const poolBefore = state.tilePool.length;

    const result = drawAndPass(state, "p1");

    expect(result.ok).toBe(true);
    expect(result.state.currentTurnPlayerId).toBe("p2");
    expect(result.state.tilePool.length).toBe(poolBefore - 1);

    const p1RackAfter = result.state.tiles.filter(
      (tile) => tile.ownerId === "p1" && tile.location === TILE_LOCATIONS.RACK,
    );

    expect(p1RackAfter.length).toBe(p1RackBefore.length + 1);
  });

  test("reset turn restores the turn-start tile snapshot", () => {
    let state = createTwoPlayerState();

    const red3 = getTile(state, "p1", "red", 3);

    state = playTile(state, "p1", red3, 56, 78);

    const movedTile = state.tiles.find((tile) => tile.id === red3.id);

    expect(movedTile.location).toBe(TILE_LOCATIONS.BOARD);

    const result = resetTurn(state, "p1");

    expect(result.ok).toBe(true);

    const resetTile = result.state.tiles.find((tile) => tile.id === red3.id);

    expect(resetTile.location).toBe(TILE_LOCATIONS.RACK);
    expect(resetTile.ownerId).toBe("p1");
  });
  test("emptying rack on a valid commit finishes the game", () => {
    let state = createTwoPlayerState();

    const red3 = getTile(state, "p1", "red", 3);
    const red4 = getTile(state, "p1", "red", 4);
    const red5 = getTile(state, "p1", "red", 5);

    state = stripP1RackToOnly(state, [red3, red4, red5]);

    state = playTile(state, "p1", red3, 56, 78);
    state = playTile(state, "p1", red4, 112, 78);
    state = playTile(state, "p1", red5, 168, 78);

    const result = commitTurn(state, "p1");

    expect(result.ok).toBe(true);
    expect(result.state.phase).toBe("finished");
    expect(result.state.winnerId).toBe("p1");
    expect(result.state.currentTurnPlayerId).toBe(null);
    expect(result.state.finalScores).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          playerId: "p1",
          isWinner: true,
        }),
        expect.objectContaining({
          playerId: "p2",
          isWinner: false,
        }),
      ]),
    );
  });

  test("game-over state rejects further moves", () => {
    let state = createTwoPlayerState();

    const red3 = getTile(state, "p1", "red", 3);
    const red4 = getTile(state, "p1", "red", 4);
    const red5 = getTile(state, "p1", "red", 5);

    state = stripP1RackToOnly(state, [red3, red4, red5]);

    state = playTile(state, "p1", red3, 56, 78);
    state = playTile(state, "p1", red4, 112, 78);
    state = playTile(state, "p1", red5, 168, 78);

    const commit = commitTurn(state, "p1");

    expect(commit.ok).toBe(true);
    expect(commit.state.phase).toBe("finished");

    const p2Tile = getTile(commit.state, "p2", "blue", 10);

    const moveResult = moveTile(commit.state, "p2", {
      tileId: p2Tile.id,
      x: 56,
      y: 234,
      zone: TILE_LOCATIONS.BOARD,
    });

    expect(moveResult.ok).toBe(false);
    expect(moveResult.reason).toMatch(/game is already over/i);
  });
});
