"use client";

import { useEffect, useMemo, useState } from "react";
import { io } from "socket.io-client";
import { CLIENT_EVENTS, SERVER_EVENTS } from "@rummisphere/shared";
import { useGameStore } from "../lib/useGameStore";
import GameBoard from "./GameBoard";

const SOCKET_URL =
  process.env.NEXT_PUBLIC_SOCKET_URL || "http://localhost:4000";

export default function GameClient() {
  const [joinCode, setJoinCode] = useState("");

  const socket = useGameStore((state) => state.socket);
  const connected = useGameStore((state) => state.connected);
  const playerId = useGameStore((state) => state.playerId);
  const room = useGameStore((state) => state.room);
  const error = useGameStore((state) => state.error);

  const setSocket = useGameStore((state) => state.setSocket);
  const setConnected = useGameStore((state) => state.setConnected);
  const setPlayerId = useGameStore((state) => state.setPlayerId);
  const setRoom = useGameStore((state) => state.setRoom);
  const setError = useGameStore((state) => state.setError);
  const clearError = useGameStore((state) => state.clearError);

  useEffect(() => {
    const nextSocket = io(SOCKET_URL, {
      transports: ["websocket", "polling"],
    });

    setSocket(nextSocket);

    nextSocket.on("connect", () => {
      setConnected(true);
    });

    nextSocket.on("disconnect", () => {
      setConnected(false);
    });

    nextSocket.on(SERVER_EVENTS.ROOM_STATE, (nextRoom) => {
      setRoom(nextRoom);
    });

    nextSocket.on(SERVER_EVENTS.MOVE_REJECTED, (payload) => {
      setError(formatServerError(payload));
    });

    nextSocket.on(SERVER_EVENTS.SERVER_ERROR, (payload) => {
      setError(payload.reason || "Server error.");
    });

    return () => {
      nextSocket.disconnect();
      setSocket(null);
    };
  }, [setConnected, setError, setRoom, setSocket]);

  const currentPlayer = useMemo(() => {
    return room?.players?.find((player) => player.id === playerId) || null;
  }, [playerId, room]);

  const currentTurnPlayer = useMemo(() => {
    return (
      room?.players?.find((player) => player.id === room.currentTurnPlayerId) ||
      null
    );
  }, [room]);

  const isHost = room?.hostPlayerId === playerId;
  const isYourTurn = room?.currentTurnPlayerId === playerId;
  const isGameOver = room?.phase === "finished";
  const hasOpened = Boolean(currentPlayer?.hasOpened);
  const connectedPlayers =
    room?.players?.filter((player) => player.connected) || [];
  const canStartGame =
    room?.phase === "waiting" &&
    isHost &&
    connectedPlayers.length >= 2 &&
    connectedPlayers.length <= 4 &&
    connectedPlayers.every((player) => player.ready);

  function handleCreateRoom() {
    clearError();

    socket?.emit(CLIENT_EVENTS.CREATE_ROOM, {}, (response) => {
      if (!response?.ok) {
        setError(response?.reason || "Could not create room.");
        return;
      }

      setPlayerId(response.playerId);
      setRoom(response.state);
      setJoinCode(response.roomId);
    });
  }

  function handleJoinRoom(event) {
    event?.preventDefault();
    clearError();

    const roomId = joinCode.trim().toUpperCase();

    if (!roomId) {
      setError("Enter a room code.");
      return;
    }

    socket?.emit(CLIENT_EVENTS.JOIN_ROOM, { roomId }, (response) => {
      if (!response?.ok) {
        setError(response?.reason || "Could not join room.");
        return;
      }

      setPlayerId(response.playerId);
      setRoom(response.state);
      setJoinCode(response.roomId);
    });
  }

  function handleReadyToggle() {
    clearError();

    socket?.emit(
      CLIENT_EVENTS.SET_READY,
      {
        roomId: room?.id,
        ready: !currentPlayer?.ready,
      },
      (response) => {
        if (!response?.ok) {
          setError(response?.reason || "Could not update ready state.");
        }
      },
    );
  }

  function handleStartGame() {
    clearError();

    socket?.emit(
      CLIENT_EVENTS.START_GAME,
      {
        roomId: room?.id,
      },
      (response) => {
        if (!response?.ok) {
          setError(response?.reason || "Could not start game.");
        }
      },
    );
  }

  function handleEndTurn() {
    clearError();

    socket?.emit(
      CLIENT_EVENTS.COMMIT_TURN,
      {
        roomId: room?.id,
      },
      (response) => {
        if (!response?.ok) {
          setError(formatServerError(response));
        }
      },
    );
  }

  function handleResetTurn() {
    clearError();

    socket?.emit(
      CLIENT_EVENTS.RESET_TURN,
      {
        roomId: room?.id,
      },
      (response) => {
        if (!response?.ok) {
          setError(response?.reason || "Could not reset turn.");
        }
      },
    );
  }

  function handleDrawAndPass() {
    clearError();

    socket?.emit(
      CLIENT_EVENTS.DRAW_AND_PASS,
      {
        roomId: room?.id,
      },
      (response) => {
        if (!response?.ok) {
          setError(response?.reason || "Could not draw tile.");
        }
      },
    );
  }

  function handleRematch() {
    clearError();

    socket?.emit(
      CLIENT_EVENTS.REQUEST_REMATCH,
      {
        roomId: room?.id,
      },
      (response) => {
        if (!response?.ok) {
          setError(response?.reason || "Could not start rematch.");
        }
      },
    );
  }

  if (!room) {
    return (
      <main className='min-h-screen bg-slate-950 px-4 py-6 text-slate-100 sm:px-6 lg:px-8'>
        <div className='mx-auto flex max-w-3xl flex-col gap-5'>
          <header className='rounded-3xl border border-white/10 bg-white/[0.04] p-6 shadow-2xl shadow-black/30'>
            <p className='text-sm uppercase tracking-[0.35em] text-cyan-300'>
              Rummisphere
            </p>

            <h1 className='mt-2 text-4xl font-black tracking-tight sm:text-6xl'>
              Multiplayer Rummikub
            </h1>

            <p className='mt-3 text-slate-300'>
              Create a room, share the code, ready up, and start the game.
            </p>

            <p className='mt-3 text-sm text-slate-400'>
              Socket status:{" "}
              {connected ? (
                <span className='text-emerald-300'>connected</span>
              ) : (
                <span className='text-rose-300'>offline</span>
              )}
            </p>
          </header>

          {error ? <ErrorBox error={error} onDismiss={clearError} /> : null}

          <section className='grid gap-4 rounded-3xl border border-white/10 bg-slate-900/80 p-5 shadow-2xl shadow-black/30 sm:grid-cols-2'>
            <div className='rounded-2xl border border-white/10 bg-white/[0.04] p-5'>
              <h2 className='text-xl font-black'>Create room</h2>

              <p className='mt-2 text-sm text-slate-300'>
                Start a fresh waiting room and invite other players with a room
                code.
              </p>

              <button
                type='button'
                disabled={!connected}
                onClick={handleCreateRoom}
                className='mt-5 rounded-xl bg-cyan-300 px-4 py-2 font-bold text-slate-950 shadow-lg shadow-black/20 disabled:cursor-not-allowed disabled:opacity-40'
              >
                Create Room
              </button>
            </div>

            <form
              onSubmit={handleJoinRoom}
              className='rounded-2xl border border-white/10 bg-white/[0.04] p-5'
            >
              <h2 className='text-xl font-black'>Join room</h2>

              <p className='mt-2 text-sm text-slate-300'>
                Enter the five-character room code from the host.
              </p>

              <input
                value={joinCode}
                onChange={(event) => setJoinCode(event.target.value)}
                placeholder='ABCDE'
                maxLength={5}
                className='mt-5 w-full rounded-xl border border-white/10 bg-slate-950 px-4 py-3 text-lg font-black uppercase tracking-[0.25em] text-white outline-none focus:border-cyan-300'
              />

              <button
                type='submit'
                disabled={!connected}
                className='mt-3 rounded-xl bg-emerald-400 px-4 py-2 font-bold text-slate-950 shadow-lg shadow-black/20 disabled:cursor-not-allowed disabled:opacity-40'
              >
                Join Room
              </button>
            </form>
          </section>
        </div>
      </main>
    );
  }

  if (room.phase === "waiting") {
    return (
      <main className='min-h-screen bg-slate-950 px-4 py-6 text-slate-100 sm:px-6 lg:px-8'>
        <div className='mx-auto flex max-w-4xl flex-col gap-5'>
          <header className='rounded-3xl border border-white/10 bg-white/[0.04] p-6 shadow-2xl shadow-black/30'>
            <p className='text-sm uppercase tracking-[0.35em] text-cyan-300'>
              Waiting Room
            </p>

            <div className='mt-2 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between'>
              <div>
                <h1 className='text-4xl font-black tracking-tight sm:text-6xl'>
                  Room {room.id}
                </h1>

                <p className='mt-2 text-slate-300'>
                  Share this code. The host can start once 2–4 connected players
                  are ready.
                </p>
              </div>

              <div className='rounded-2xl border border-white/10 bg-slate-900 px-4 py-3 text-sm text-slate-300'>
                <div>
                  You are: {currentPlayer?.name || "joining..."}{" "}
                  {isHost ? (
                    <span className='text-amber-300'>(host)</span>
                  ) : null}
                </div>
                <div>
                  Status:{" "}
                  {connected ? (
                    <span className='text-emerald-300'>connected</span>
                  ) : (
                    <span className='text-rose-300'>offline</span>
                  )}
                </div>
              </div>
            </div>
          </header>

          {error ? <ErrorBox error={error} onDismiss={clearError} /> : null}

          <section className='rounded-3xl border border-white/10 bg-slate-900/80 p-5 shadow-2xl shadow-black/30'>
            <div className='flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between'>
              <h2 className='text-2xl font-black'>Players</h2>

              <div className='flex flex-wrap gap-2'>
                <button
                  type='button'
                  disabled={!connected}
                  onClick={handleReadyToggle}
                  className={`rounded-xl px-4 py-2 font-bold text-slate-950 shadow-lg shadow-black/20 disabled:cursor-not-allowed disabled:opacity-40 ${
                    currentPlayer?.ready ? "bg-amber-300" : "bg-emerald-400"
                  }`}
                >
                  {currentPlayer?.ready ? "Unready" : "Ready Up"}
                </button>

                <button
                  type='button'
                  disabled={!connected || !canStartGame}
                  onClick={handleStartGame}
                  className='rounded-xl bg-cyan-300 px-4 py-2 font-bold text-slate-950 shadow-lg shadow-black/20 disabled:cursor-not-allowed disabled:opacity-40'
                >
                  Start Game
                </button>
              </div>
            </div>

            <div className='mt-5 grid gap-3'>
              {room.players.map((player) => (
                <div
                  key={player.id}
                  className='flex items-center justify-between rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3'
                >
                  <div>
                    <div className='font-bold'>
                      {player.name}
                      {player.id === room.hostPlayerId ? (
                        <span className='ml-2 rounded-full bg-amber-300 px-2 py-0.5 text-xs text-slate-950'>
                          host
                        </span>
                      ) : null}
                      {player.id === playerId ? (
                        <span className='ml-2 rounded-full bg-cyan-300 px-2 py-0.5 text-xs text-slate-950'>
                          you
                        </span>
                      ) : null}
                    </div>

                    <div className='text-sm text-slate-400'>
                      {player.connected ? "connected" : "disconnected"}
                    </div>
                  </div>

                  <div
                    className={`rounded-full px-3 py-1 text-sm font-bold ${
                      player.ready
                        ? "bg-emerald-400 text-slate-950"
                        : "bg-white/10 text-slate-300"
                    }`}
                  >
                    {player.ready ? "ready" : "not ready"}
                  </div>
                </div>
              ))}
            </div>

            {!isHost ? (
              <p className='mt-4 text-sm text-slate-400'>
                Waiting for the host to start the game.
              </p>
            ) : null}

            {isHost && !canStartGame ? (
              <p className='mt-4 text-sm text-slate-400'>
                Need 2–4 connected players and everyone must be ready.
              </p>
            ) : null}
          </section>
        </div>
      </main>
    );
  }

  return (
    <main className='min-h-screen bg-slate-950 px-4 py-6 text-slate-100 sm:px-6 lg:px-8'>
      <div className='mx-auto flex max-w-7xl flex-col gap-5'>
        <header className='flex flex-col gap-4 rounded-3xl border border-white/10 bg-white/[0.04] p-5 shadow-2xl shadow-black/30 lg:flex-row lg:items-end lg:justify-between'>
          <div>
            <p className='text-sm uppercase tracking-[0.35em] text-cyan-300'>
              Rummisphere · Room {room.id}
            </p>

            <h1 className='mt-2 text-3xl font-black tracking-tight sm:text-5xl'>
              Real-time Rummikub
            </h1>

            <p className='mt-2 max-w-2xl text-sm text-slate-300 sm:text-base'>
              Drag tiles during your turn. End turn only succeeds if the server
              validates the table and your opening meld rules.
            </p>
          </div>

          <div className='grid gap-3 rounded-2xl border border-white/10 bg-slate-900/80 p-4 text-sm text-slate-300 sm:grid-cols-2 lg:min-w-[460px]'>
            <div>
              <div>
                Status:{" "}
                {connected ? (
                  <span className='text-emerald-300'>connected</span>
                ) : (
                  <span className='text-rose-300'>offline</span>
                )}
              </div>

              <div>Player: {currentPlayer?.name || "joining..."}</div>
              <div>Room version: {room?.version || "—"}</div>
            </div>

            <div>
              <div>Turn: {room?.turnNumber || 1}</div>
              <div>Pool: {room?.tilePoolCount ?? "—"} tiles</div>

              <div>
                Opened:{" "}
                {hasOpened ? (
                  <span className='text-emerald-300'>yes</span>
                ) : (
                  <span className='text-amber-300'>needs 30+</span>
                )}
              </div>

              <div>
                Current turn:{" "}
                <span className={isYourTurn ? "text-emerald-300" : ""}>
                  {isYourTurn ? "You" : currentTurnPlayer?.name || "waiting..."}
                </span>
              </div>
            </div>

            <div className='flex flex-wrap gap-2 sm:col-span-2'>
              <button
                type='button'
                disabled={!connected || !isYourTurn || isGameOver}
                onClick={handleEndTurn}
                className='rounded-xl bg-emerald-400 px-4 py-2 font-bold text-slate-950 shadow-lg shadow-emerald-950/30 disabled:cursor-not-allowed disabled:opacity-40'
              >
                End Turn
              </button>

              <button
                type='button'
                disabled={!connected || !isYourTurn || isGameOver}
                onClick={handleDrawAndPass}
                className='rounded-xl bg-cyan-300 px-4 py-2 font-bold text-slate-950 shadow-lg shadow-cyan-950/30 disabled:cursor-not-allowed disabled:opacity-40'
              >
                Draw & Pass
              </button>

              <button
                type='button'
                disabled={!connected || !isYourTurn || isGameOver}
                onClick={handleResetTurn}
                className='rounded-xl border border-white/10 bg-white/10 px-4 py-2 font-bold text-white hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-40'
              >
                Reset Turn
              </button>
            </div>
          </div>
        </header>

        {error ? <ErrorBox error={error} onDismiss={clearError} /> : null}

        {isGameOver ? (
          <section className='rounded-3xl border border-amber-300/30 bg-amber-300/10 p-5 shadow-2xl shadow-black/30'>
            <div className='flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between'>
              <h2 className='text-2xl font-black text-amber-100'>
                Game over — {room?.winnerName || "Unknown player"} wins
              </h2>

              <button
                type='button'
                disabled={!connected}
                onClick={handleRematch}
                className='rounded-xl bg-amber-300 px-4 py-2 font-bold text-slate-950 shadow-lg shadow-black/20 disabled:cursor-not-allowed disabled:opacity-40'
              >
                Rematch
              </button>
            </div>

            <div className='mt-4 overflow-hidden rounded-2xl border border-white/10'>
              <table className='w-full text-left text-sm'>
                <thead className='bg-white/10 text-slate-300'>
                  <tr>
                    <th className='px-4 py-3'>Player</th>
                    <th className='px-4 py-3'>Rack Points</th>
                    <th className='px-4 py-3'>Score</th>
                  </tr>
                </thead>

                <tbody>
                  {(room?.finalScores || []).map((entry) => (
                    <tr
                      key={entry.playerId}
                      className='border-t border-white/10'
                    >
                      <td className='px-4 py-3'>
                        {entry.playerName}
                        {entry.isWinner ? (
                          <span className='ml-2 rounded-full bg-emerald-400 px-2 py-0.5 text-xs font-bold text-slate-950'>
                            winner
                          </span>
                        ) : null}
                      </td>

                      <td className='px-4 py-3'>{entry.rackPoints}</td>

                      <td
                        className={`px-4 py-3 font-bold ${
                          entry.score >= 0
                            ? "text-emerald-300"
                            : "text-rose-300"
                        }`}
                      >
                        {entry.score}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}

        <GameBoard />
      </div>
    </main>
  );
}

function ErrorBox({ error, onDismiss }) {
  return (
    <div className='flex items-center justify-between gap-4 rounded-2xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100'>
      <span>{error}</span>

      <button
        className='rounded-xl bg-white/10 px-3 py-1 hover:bg-white/20'
        onClick={onDismiss}
      >
        Dismiss
      </button>
    </div>
  );
}

function formatServerError(payload) {
  if (!payload) return "Server rejected the action.";

  if (
    Array.isArray(payload.invalidGroups) &&
    payload.invalidGroups.length > 0
  ) {
    const groups = payload.invalidGroups
      .map((group) => {
        return group.tiles
          .map((tile) => `${tile.color} ${tile.joker ? "joker" : tile.number}`)
          .join(", ");
      })
      .join(" | ");

    return `${payload.reason || "Invalid table."} Problem group(s): ${groups}`;
  }

  return payload.reason || "Server rejected the action.";
}
