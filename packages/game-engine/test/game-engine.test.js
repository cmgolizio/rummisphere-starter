import { describe, expect, test } from "vitest";
import {
  commitTurn,
  createDemoGameState,
  createWaitingRoomState,
  drawAndPass,
  ensurePlayer,
  leaveRoom,
  moveTile,
  requestRematch,
  resetTurn,
  setPlayerReady,
  startGame,
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

function setPlayerRackToSpecs(state, playerId, specs) {
  const rackTiles = state.tiles.filter(
    (tile) =>
      tile.ownerId === playerId && tile.location === TILE_LOCATIONS.RACK,
  );

  return {
    ...state,
    tiles: state.tiles.map((tile) => {
      const rackIndex = rackTiles.findIndex(
        (rackTile) => rackTile.id === tile.id,
      );

      if (rackIndex === -1 || !specs[rackIndex]) return tile;

      return {
        ...tile,
        color: specs[rackIndex].color,
        number: specs[rackIndex].number,
        joker: Boolean(specs[rackIndex].joker),
      };
    }),
    turn: state.turn?.snapshotTiles
      ? {
          ...state.turn,
          snapshotTiles: state.turn.snapshotTiles.map((tile) => {
            const rackIndex = rackTiles.findIndex(
              (rackTile) => rackTile.id === tile.id,
            );
            if (rackIndex === -1 || !specs[rackIndex]) return tile;

            return {
              ...tile,
              color: specs[rackIndex].color,
              number: specs[rackIndex].number,
              joker: Boolean(specs[rackIndex].joker),
            };
          }),
        }
      : state.turn,
  };
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

    state = setPlayerRackToSpecs(state, "p1", [
      { color: "red", number: 3 },
      { color: "red", number: 4 },
      { color: "red", number: 5 },
      { color: "blue", number: 8 },
      { color: "black", number: 8 },
      { color: "orange", number: 8 },
    ]);
    state = setPlayerRackToSpecs(state, "p2", [
      { color: "blue", number: 10 },
      { color: "blue", number: 11 },
      { color: "blue", number: 12 },
    ]);

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

    state = setPlayerRackToSpecs(state, "p1", [
      { color: "red", number: 3 },
      { color: "red", number: 4 },
      { color: "red", number: 5 },
      { color: "blue", number: 8 },
      { color: "black", number: 8 },
      { color: "orange", number: 8 },
    ]);
    state = setPlayerRackToSpecs(state, "p2", [
      { color: "blue", number: 10 },
      { color: "blue", number: 11 },
      { color: "blue", number: 12 },
    ]);

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

    state = setPlayerRackToSpecs(state, "p1", [
      { color: "red", number: 3 },
      { color: "red", number: 4 },
      { color: "red", number: 5 },
      { color: "blue", number: 8 },
      { color: "black", number: 8 },
      { color: "orange", number: 8 },
    ]);
    state = setPlayerRackToSpecs(state, "p2", [
      { color: "blue", number: 10 },
      { color: "blue", number: 11 },
      { color: "blue", number: 12 },
    ]);

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

    state = setPlayerRackToSpecs(state, "p1", [
      { color: "red", number: 3 },
      { color: "red", number: 4 },
      { color: "red", number: 5 },
      { color: "blue", number: 8 },
      { color: "black", number: 8 },
      { color: "orange", number: 8 },
    ]);
    state = setPlayerRackToSpecs(state, "p2", [
      { color: "blue", number: 10 },
      { color: "blue", number: 11 },
      { color: "blue", number: 12 },
    ]);
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

    state = setPlayerRackToSpecs(state, "p1", [
      { color: "red", number: 3 },
      { color: "red", number: 4 },
      { color: "red", number: 5 },
      { color: "blue", number: 8 },
      { color: "black", number: 8 },
      { color: "orange", number: 8 },
    ]);
    state = setPlayerRackToSpecs(state, "p2", [
      { color: "blue", number: 10 },
      { color: "blue", number: 11 },
      { color: "blue", number: 12 },
    ]);
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

    state = setPlayerRackToSpecs(state, "p1", [
      { color: "red", number: 3 },
      { color: "red", number: 4 },
      { color: "red", number: 5 },
      { color: "blue", number: 8 },
      { color: "black", number: 8 },
      { color: "orange", number: 8 },
    ]);
    state = setPlayerRackToSpecs(state, "p2", [
      { color: "blue", number: 10 },
      { color: "blue", number: 11 },
      { color: "blue", number: 12 },
    ]);
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
    // expect(moveResult.reason).toMatch(/game is already over/i);
    expect(moveResult.reason).toMatch(/not currently playing/i);
  });
  test("rematch is rejected before the game is finished", () => {
    const state = createTwoPlayerState();

    const result = requestRematch(state, "p1");

    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/only start after the game is finished/i);
  });

  test("rematch after finished game resets the room with same connected players", () => {
    let state = createTwoPlayerState();
    state = setPlayerRackToSpecs(state, "p1", [
      { color: "red", number: 3 },
      { color: "red", number: 4 },
      { color: "red", number: 5 },
    ]);
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

    const rematch = requestRematch(commit.state, "p2");

    expect(rematch.ok).toBe(true);
    expect(rematch.state.phase).toBe("playing");
    expect(rematch.state.winnerId).toBe(null);
    expect(rematch.state.finalScores).toBe(null);
    expect(rematch.state.currentTurnPlayerId).toBe("p2");

    const p1 = rematch.state.players.find((player) => player.id === "p1");
    const p2 = rematch.state.players.find((player) => player.id === "p2");

    expect(p1.hasOpened).toBe(false);
    expect(p2.hasOpened).toBe(false);

    const boardTiles = rematch.state.tiles.filter(
      (tile) => tile.location === TILE_LOCATIONS.BOARD,
    );

    const p1Rack = rematch.state.tiles.filter(
      (tile) => tile.ownerId === "p1" && tile.location === TILE_LOCATIONS.RACK,
    );

    const p2Rack = rematch.state.tiles.filter(
      (tile) => tile.ownerId === "p2" && tile.location === TILE_LOCATIONS.RACK,
    );

    expect(boardTiles).toHaveLength(0);
    expect(p1Rack).toHaveLength(14);
    expect(p2Rack).toHaveLength(14);
  });
  test("waiting room adds players without dealing rack tiles", () => {
    let state = createWaitingRoomState("ABCDE");

    state = ensurePlayer(state, "p1");
    state = ensurePlayer(state, "p2");

    expect(state.phase).toBe("waiting");
    expect(state.hostPlayerId).toBe("p1");
    expect(state.players).toHaveLength(2);
    expect(state.tiles).toHaveLength(0);
    expect(state.tilePool).toHaveLength(0);
  });

  test("host cannot start waiting room with fewer than two players", () => {
    let state = createWaitingRoomState("ABCDE");

    state = ensurePlayer(state, "p1");

    const ready = setPlayerReady(state, "p1", true);

    expect(ready.ok).toBe(true);

    const result = startGame(ready.state, "p1");

    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/at least 2 players/i);
  });

  test("non-host cannot start the game", () => {
    let state = createWaitingRoomState("ABCDE");

    state = ensurePlayer(state, "p1");
    state = ensurePlayer(state, "p2");

    let ready = setPlayerReady(state, "p1", true);
    expect(ready.ok).toBe(true);

    ready = setPlayerReady(ready.state, "p2", true);
    expect(ready.ok).toBe(true);

    const result = startGame(ready.state, "p2");

    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/only the host/i);
  });

  test("host can start game when two connected players are ready", () => {
    let state = createWaitingRoomState("ABCDE");

    state = ensurePlayer(state, "p1");
    state = ensurePlayer(state, "p2");

    let ready = setPlayerReady(state, "p1", true);
    expect(ready.ok).toBe(true);

    ready = setPlayerReady(ready.state, "p2", true);
    expect(ready.ok).toBe(true);

    const result = startGame(ready.state, "p1");

    expect(result.ok).toBe(true);
    expect(result.state.phase).toBe("playing");
    expect(result.state.currentTurnPlayerId).toBe("p1");

    const p1Rack = result.state.tiles.filter(
      (tile) => tile.ownerId === "p1" && tile.location === TILE_LOCATIONS.RACK,
    );

    const p2Rack = result.state.tiles.filter(
      (tile) => tile.ownerId === "p2" && tile.location === TILE_LOCATIONS.RACK,
    );

    const boardTiles = result.state.tiles.filter(
      (tile) => tile.location === TILE_LOCATIONS.BOARD,
    );

    expect(p1Rack).toHaveLength(14);
    expect(p2Rack).toHaveLength(14);
    expect(boardTiles).toHaveLength(0);
  });
  test("waiting-room leave removes player and migrates host", () => {
    let state = createWaitingRoomState("ABCDE");

    state = ensurePlayer(state, "p1");
    state = ensurePlayer(state, "p2");

    const result = leaveRoom(state, "p1");

    expect(result.ok).toBe(true);
    expect(result.shouldDeleteRoom).toBe(false);
    expect(result.state.players).toHaveLength(1);
    expect(result.state.players[0].id).toBe("p2");
    expect(result.state.hostPlayerId).toBe("p2");
  });

  test("waiting-room last player leaving marks room for deletion", () => {
    let state = createWaitingRoomState("ABCDE");

    state = ensurePlayer(state, "p1");

    const result = leaveRoom(state, "p1");

    expect(result.ok).toBe(true);
    expect(result.shouldDeleteRoom).toBe(true);
    expect(result.state.players).toHaveLength(0);
    expect(result.state.hostPlayerId).toBe(null);
  });

  test("active-game leave marks disconnected without removing rack and reconnects on ensure", () => {
    let state = createWaitingRoomState("ABCDE");

    state = ensurePlayer(state, "p1");
    state = ensurePlayer(state, "p2");

    let ready = setPlayerReady(state, "p1", true);
    ready = setPlayerReady(ready.state, "p2", true);

    const started = startGame(ready.state, "p1");
    expect(started.ok).toBe(true);

    state = started.state;

    const p2RackBefore = state.tiles.filter(
      (tile) => tile.ownerId === "p2" && tile.location === TILE_LOCATIONS.RACK,
    );

    const left = leaveRoom(state, "p2");

    expect(left.ok).toBe(true);
    expect(left.shouldDeleteRoom).toBe(false);

    const p2AfterLeave = left.state.players.find(
      (player) => player.id === "p2",
    );
    const p2RackAfterLeave = left.state.tiles.filter(
      (tile) => tile.ownerId === "p2" && tile.location === TILE_LOCATIONS.RACK,
    );

    expect(p2AfterLeave.connected).toBe(false);
    expect(p2AfterLeave.ready).toBe(false);
    expect(p2RackAfterLeave).toHaveLength(p2RackBefore.length);

    const rejoined = ensurePlayer(left.state, "p2");
    const p2AfterRejoin = rejoined.players.find((player) => player.id === "p2");

    expect(p2AfterRejoin.connected).toBe(true);
    expect(
      rejoined.players.filter((player) => player.id === "p2"),
    ).toHaveLength(1);
  });

  test("finished-game leave marks disconnected and preserves finalScores", () => {
    let state = createTwoPlayerState();

    state = setPlayerRackToSpecs(state, "p1", [
      { color: "red", number: 3 },
      { color: "red", number: 4 },
      { color: "red", number: 5 },
    ]);

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

    const finalScores = commit.state.finalScores;
    const left = leaveRoom(commit.state, "p2");

    expect(left.ok).toBe(true);
    expect(left.state.phase).toBe("finished");
    expect(left.state.finalScores).toEqual(finalScores);

    const p2 = left.state.players.find((player) => player.id === "p2");
    expect(p2.connected).toBe(false);
  });
});
