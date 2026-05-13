"use client";

const CLIENT_ID_KEY = "rummisphere.clientId";
const DISPLAY_NAME_KEY = "rummisphere.displayName";
const LAST_ROOM_ID_KEY = "rummisphere.lastRoomId";

export function getOrCreateClientIdentity(displayNameOverride = null) {
  if (typeof window === "undefined") {
    return {
      clientId: null,
      displayName: "Player",
    };
  }

  let clientId = window.localStorage.getItem(CLIENT_ID_KEY);

  if (!clientId) {
    clientId = createClientId();
    window.localStorage.setItem(CLIENT_ID_KEY, clientId);
  }

  const savedDisplayName = window.localStorage.getItem(DISPLAY_NAME_KEY);
  const cleanDisplayName = cleanName(displayNameOverride || savedDisplayName);

  if (cleanDisplayName) {
    window.localStorage.setItem(DISPLAY_NAME_KEY, cleanDisplayName);
  }

  return {
    clientId,
    displayName: cleanDisplayName || "Player",
  };
}

export function saveClientDisplayName(displayName) {
  if (typeof window === "undefined") return;

  const cleanDisplayName = cleanName(displayName);

  if (!cleanDisplayName) return;

  window.localStorage.setItem(DISPLAY_NAME_KEY, cleanDisplayName);
}

export function getLastRoomId() {
  if (typeof window === "undefined") return "";

  return window.localStorage.getItem(LAST_ROOM_ID_KEY) || "";
}

export function saveLastRoomId(roomId) {
  if (typeof window === "undefined") return;

  const cleanRoomId = String(roomId || "")
    .trim()
    .toUpperCase();

  if (!cleanRoomId) return;

  window.localStorage.setItem(LAST_ROOM_ID_KEY, cleanRoomId);
}

function createClientId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return `guest-${crypto.randomUUID()}`;
  }

  return `guest-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function cleanName(name) {
  return String(name || "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 24);
}
