"use client";

import { create } from "zustand";
import { DEMO_ROOM_ID } from "@rummisphere/shared";

export const useGameStore = create((set) => ({
  socket: null,
  connected: false,
  playerId: null,
  roomId: DEMO_ROOM_ID,
  room: null,
  drag: null,
  error: null,

  setSocket: (socket) => set({ socket }),
  setConnected: (connected) => set({ connected }),
  setPlayerId: (playerId) => set({ playerId }),
  setRoom: (room) => set({ room }),
  setError: (error) => set({ error }),
  setDrag: (drag) => set({ drag }),

  clearError: () => set({ error: null }),
}));
