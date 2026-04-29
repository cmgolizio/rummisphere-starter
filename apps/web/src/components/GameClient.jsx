"use client";

import { useEffect, useMemo } from "react";
import { io } from "socket.io-client";
import {
  CLIENT_EVENTS,
  DEMO_ROOM_ID,
  SERVER_EVENTS,
} from "@rummisphere/shared";
import { useGameStore } from "../lib/useGameStore";
import GameBoard from "./GameBoard";

const SOCKET_URL =
  process.env.NEXT_PUBLIC_SOCKET_URL || "http://localhost:4000";

export default function GameClient() {
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

      nextSocket.emit(
        CLIENT_EVENTS.JOIN_ROOM,
        { roomId: DEMO_ROOM_ID },
        (response) => {
          if (!response?.ok) {
            setError(response?.reason || "Failed to join room.");
            return;
          }

          setPlayerId(response.playerId);
          setRoom(response.state);
        },
      );
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
  }, [setConnected, setError, setPlayerId, setRoom, setSocket]);

  const currentPlayer = useMemo(() => {
    return room?.players?.find((player) => player.id === playerId) || null;
  }, [playerId, room]);

  const currentTurnPlayer = useMemo(() => {
    return (
      room?.players?.find((player) => player.id === room.currentTurnPlayerId) ||
      null
    );
  }, [room]);

  const isYourTurn = room?.currentTurnPlayerId === playerId;

  function handleEndTurn() {
    clearError();

    socket?.emit(
      CLIENT_EVENTS.COMMIT_TURN,
      {
        roomId: DEMO_ROOM_ID,
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
        roomId: DEMO_ROOM_ID,
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
        roomId: DEMO_ROOM_ID,
      },
      (response) => {
        if (!response?.ok) {
          setError(response?.reason || "Could not draw tile.");
        }
      },
    );
  }

  return (
    <main className='min-h-screen bg-slate-950 px-4 py-6 text-slate-100 sm:px-6 lg:px-8'>
      <div className='mx-auto flex max-w-7xl flex-col gap-5'>
        <header className='flex flex-col gap-4 rounded-3xl border border-white/10 bg-white/[0.04] p-5 shadow-2xl shadow-black/30 lg:flex-row lg:items-end lg:justify-between'>
          <div>
            <p className='text-sm uppercase tracking-[0.35em] text-cyan-300'>
              Rummisphere
            </p>

            <h1 className='mt-2 text-3xl font-black tracking-tight sm:text-5xl'>
              Real-time Rummikub demo room
            </h1>

            <p className='mt-2 max-w-2xl text-sm text-slate-300 sm:text-base'>
              Drag tiles during your turn. End turn only succeeds if the server
              can validate every horizontal meld on the table. If you cannot
              play, draw and pass.
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
                Current turn:{" "}
                <span className={isYourTurn ? "text-emerald-300" : ""}>
                  {isYourTurn ? "You" : currentTurnPlayer?.name || "waiting..."}
                </span>
              </div>
            </div>

            <div className='flex flex-wrap gap-2 sm:col-span-2'>
              <button
                type='button'
                disabled={!connected || !isYourTurn}
                onClick={handleEndTurn}
                className='rounded-xl bg-emerald-400 px-4 py-2 font-bold text-slate-950 shadow-lg shadow-emerald-950/30 disabled:cursor-not-allowed disabled:opacity-40'
              >
                End Turn
              </button>

              <button
                type='button'
                disabled={!connected || !isYourTurn}
                onClick={handleDrawAndPass}
                className='rounded-xl bg-cyan-300 px-4 py-2 font-bold text-slate-950 shadow-lg shadow-cyan-950/30 disabled:cursor-not-allowed disabled:opacity-40'
              >
                Draw & Pass
              </button>

              <button
                type='button'
                disabled={!connected || !isYourTurn}
                onClick={handleResetTurn}
                className='rounded-xl border border-white/10 bg-white/10 px-4 py-2 font-bold text-white hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-40'
              >
                Reset Turn
              </button>
            </div>
          </div>
        </header>

        {error ? (
          <div className='flex items-center justify-between gap-4 rounded-2xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100'>
            <span>{error}</span>

            <button
              className='rounded-xl bg-white/10 px-3 py-1 hover:bg-white/20'
              onClick={clearError}
            >
              Dismiss
            </button>
          </div>
        ) : null}

        <GameBoard />
      </div>
    </main>
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
