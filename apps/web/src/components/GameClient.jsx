"use client";

import { useEffect, useMemo, useRef } from "react";
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
  const socketRef = useRef(null);

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
    const socket = io(SOCKET_URL, {
      transports: ["websocket", "polling"],
    });

    socketRef.current = socket;
    setSocket(socket);

    socket.on("connect", () => {
      setConnected(true);

      socket.emit(
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

    socket.on("disconnect", () => {
      setConnected(false);
    });

    socket.on(SERVER_EVENTS.ROOM_STATE, (nextRoom) => {
      setRoom(nextRoom);
    });

    socket.on(SERVER_EVENTS.MOVE_REJECTED, (payload) => {
      setError(payload.reason || "Move rejected.");
    });

    socket.on(SERVER_EVENTS.SERVER_ERROR, (payload) => {
      setError(payload.reason || "Server error.");
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
      setSocket(null);
    };
  }, [setConnected, setError, setPlayerId, setRoom, setSocket]);

  const currentPlayer = useMemo(() => {
    return room?.players?.find((player) => player.id === playerId) || null;
  }, [playerId, room]);

  return (
    <main className='min-h-screen bg-slate-950 px-4 py-6 text-slate-100 sm:px-6 lg:px-8'>
      <div className='mx-auto flex max-w-7xl flex-col gap-5'>
        <header className='flex flex-col gap-3 rounded-3xl border border-white/10 bg-white/[0.04] p-5 shadow-2xl shadow-black/30 sm:flex-row sm:items-end sm:justify-between'>
          <div>
            <p className='text-sm uppercase tracking-[0.35em] text-cyan-300'>
              Rummisphere
            </p>

            <h1 className='mt-2 text-3xl font-black tracking-tight sm:text-5xl'>
              Real-time Rummikub demo room
            </h1>

            <p className='mt-2 max-w-2xl text-sm text-slate-300 sm:text-base'>
              Custom pointer events, absolute-positioned tiles, grid snapping,
              Socket.IO broadcasts, and server-validated moves.
            </p>
          </div>

          <div className='rounded-2xl border border-white/10 bg-slate-900/80 p-4 text-sm text-slate-300'>
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
        </header>

        {error ? (
          <div className='flex items-center justify-between rounded-2xl border border-rose-400/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100'>
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
