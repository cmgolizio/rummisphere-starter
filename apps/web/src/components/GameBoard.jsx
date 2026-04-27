"use client";

import { useEffect, useMemo, useRef } from "react";
import {
  BOARD,
  CLIENT_EVENTS,
  DEMO_ROOM_ID,
  RACK,
  TABLE,
  TILE_LOCATIONS,
  getTileZoneFromPoint,
  snapTilePosition,
} from "@rummisphere/shared";
import { useGameStore } from "../lib/useGameStore";
import Tile from "./Tile";

export default function GameBoard() {
  const boardRef = useRef(null);

  const socket = useGameStore((state) => state.socket);
  const room = useGameStore((state) => state.room);
  const drag = useGameStore((state) => state.drag);
  const setDrag = useGameStore((state) => state.setDrag);
  const setError = useGameStore((state) => state.setError);

  const tiles = room?.tiles || [];

  const boardTiles = tiles.filter(
    (tile) => tile.location === TILE_LOCATIONS.BOARD,
  );
  const rackTiles = tiles.filter(
    (tile) => tile.location === TILE_LOCATIONS.RACK,
  );

  const tileById = useMemo(() => {
    return new Map(tiles.map((tile) => [tile.id, tile]));
  }, [tiles]);

  useEffect(() => {
    if (!drag) return;

    function handlePointerMove(event) {
      const board = boardRef.current;
      const tile = tileById.get(drag.tileId);

      if (!board || !tile) return;

      const rect = board.getBoundingClientRect();

      const nextX = event.clientX - rect.left - drag.offsetX;
      const nextY = event.clientY - rect.top - drag.offsetY;

      setDrag({
        ...drag,
        x: nextX,
        y: nextY,
      });
    }

    function handlePointerUp() {
      const tile = tileById.get(drag.tileId);

      if (!tile) {
        setDrag(null);
        return;
      }

      const targetZone = getTileZoneFromPoint(drag.x, drag.y);
      const snapped = snapTilePosition(drag.x, drag.y, targetZone);

      socket?.emit(
        CLIENT_EVENTS.MOVE_TILE,
        {
          roomId: DEMO_ROOM_ID,
          tileId: drag.tileId,
          x: snapped.x,
          y: snapped.y,
          zone: targetZone,
        },
        (response) => {
          if (!response?.ok) {
            setError(response?.reason || "Move rejected by server.");
          }
        },
      );

      setDrag(null);
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp, { once: true });
    window.addEventListener("pointercancel", handlePointerUp, { once: true });

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
    };
  }, [drag, setDrag, setError, socket, tileById]);

  function handleTilePointerDown(event, tile) {
    if (event.button !== 0) return;

    event.preventDefault();

    const board = boardRef.current;

    if (!board) return;

    const rect = board.getBoundingClientRect();

    const pointerX = event.clientX - rect.left;
    const pointerY = event.clientY - rect.top;

    setDrag({
      tileId: tile.id,
      offsetX: pointerX - tile.x,
      offsetY: pointerY - tile.y,
      x: tile.x,
      y: tile.y,
    });
  }

  return (
    <section className='rounded-3xl border border-white/10 bg-slate-900/80 p-4 shadow-2xl shadow-black/40'>
      <div className='mb-3 flex flex-col justify-between gap-2 text-sm text-slate-300 sm:flex-row'>
        <p>
          Drag rack tiles onto the table. Board/table tiles are public. Rack
          tiles are private to each player.
        </p>

        <p>
          Table: {boardTiles.length} tiles · Your rack: {rackTiles.length} tiles
        </p>
      </div>

      <div className='overflow-auto rounded-2xl border border-cyan-300/10 bg-slate-950 p-3'>
        <div
          ref={boardRef}
          className='relative touch-none select-none overflow-hidden rounded-2xl border border-white/10'
          style={{
            width: BOARD.width,
            height: BOARD.height,
            backgroundColor: "#0f172a",
            backgroundImage:
              "linear-gradient(to right, rgba(255,255,255,0.06) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.06) 1px, transparent 1px)",
            backgroundSize: `${BOARD.cellWidth}px ${BOARD.cellHeight}px`,
          }}
        >
          <div
            className='absolute rounded-2xl border border-emerald-300/20 bg-emerald-400/[0.03]'
            style={{
              left: TABLE.x,
              top: TABLE.y,
              width: TABLE.width,
              height: TABLE.height,
            }}
          >
            <div className='absolute left-4 top-3 rounded-full border border-emerald-300/20 bg-slate-950/70 px-3 py-1 text-xs uppercase tracking-[0.25em] text-emerald-200'>
              Table
            </div>
          </div>

          <div
            className='absolute rounded-2xl border border-cyan-300/30 bg-cyan-400/[0.06]'
            style={{
              left: RACK.x,
              top: RACK.y,
              width: RACK.width,
              height: RACK.height,
            }}
          >
            <div className='absolute left-4 top-3 rounded-full border border-cyan-300/20 bg-slate-950/70 px-3 py-1 text-xs uppercase tracking-[0.25em] text-cyan-200'>
              Your rack
            </div>
          </div>

          {tiles.map((tile) => {
            const isDragging = drag?.tileId === tile.id;
            const renderTile = isDragging
              ? {
                  ...tile,
                  x: drag.x,
                  y: drag.y,
                }
              : tile;

            return (
              <Tile
                key={tile.id}
                tile={renderTile}
                isDragging={isDragging}
                onPointerDown={(event) => handleTilePointerDown(event, tile)}
              />
            );
          })}
        </div>
      </div>
    </section>
  );
}
