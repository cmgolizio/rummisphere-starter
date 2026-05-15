"use client";

import { useEffect, useMemo, useRef } from "react";
import {
  BOARD,
  CLIENT_EVENTS,
  RACK,
  TABLE,
  TILE_LOCATIONS,
  getTileZoneFromPoint,
  snapTilePosition,
} from "@rummisphere/shared";
import { useGameStore } from "../lib/useGameStore";
import Tile from "./Tile";

const LONG_PRESS_MS = 900;

export default function GameBoard() {
  const boardRef = useRef(null);
  const holdTimerRef = useRef(null);

  const socket = useGameStore((state) => state.socket);
  const room = useGameStore((state) => state.room);
  const playerId = useGameStore((state) => state.playerId);
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

  const tileById = useMemo(
    () => new Map(tiles.map((tile) => [tile.id, tile])),
    [tiles],
  );

  useEffect(() => {
    if (!drag) return;

    function handlePointerMove(event) {
      const board = boardRef.current;
      if (!board) return;

      const rect = board.getBoundingClientRect();
      const pointerX = event.clientX - rect.left;
      const pointerY = event.clientY - rect.top;

      if (drag.groupTileIds?.length > 0) {
        const groupTiles = drag.groupTileIds
          .map((id) => tileById.get(id))
          .filter(Boolean);

        const anchorTile = tileById.get(drag.tileId);
        if (!anchorTile) return;

        const anchorNextX = pointerX - drag.offsetX;
        const anchorNextY = pointerY - drag.offsetY;

        const deltas = groupTiles.map((tile) => ({
          tileId: tile.id,
          x: tile.x + (anchorNextX - anchorTile.x),
          y: tile.y + (anchorNextY - anchorTile.y),
        }));
        setDrag({
          ...drag,
          x: anchorNextX,
          y: anchorNextY,
          groupDeltas: deltas,
        });
        return;
      }

      setDrag({
        ...drag,
        x: pointerX - drag.offsetX,
        y: pointerY - drag.offsetY,
      });
    }

    function handlePointerUp() {
      if (holdTimerRef.current) clearTimeout(holdTimerRef.current);

      if (drag.groupDeltas?.length > 0) {
        drag.groupDeltas.forEach((entry) => {
          const zone = getTileZoneFromPoint(entry.x, entry.y);
          const snapped = snapTilePosition(entry.x, entry.y, zone);

          socket?.emit(CLIENT_EVENTS.MOVE_TILE, {
            roomId: room?.id,
            tileId: entry.tileId,
            x: snapped.x,
            y: snapped.y,
            zone,
          });
        });
        setDrag(null);
        return;
      }

      const tile = tileById.get(drag.tileId);
      if (!tile) return setDrag(null);

      const zone = getTileZoneFromPoint(drag.x, drag.y);
      const snapped = snapTilePosition(drag.x, drag.y, zone);

      socket?.emit(
        CLIENT_EVENTS.MOVE_TILE,
        {
          roomId: room?.id,
          tileId: drag.tileId,
          x: snapped.x,
          y: snapped.y,
          zone,
        },
        (response) => {
          if (!response?.ok)
            setError(response?.reason || "Move rejected by server.");
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
  }, [drag, room?.id, setDrag, setError, socket, tileById]);

  function computeContiguousRun(seedTile) {
    const sameZoneRow = tiles
      .filter(
        (tile) => tile.location === seedTile.location && tile.y === seedTile.y,
      )
      .sort((a, b) => a.x - b.x);

    const idx = sameZoneRow.findIndex((tile) => tile.id === seedTile.id);
    if (idx === -1) return [seedTile.id];

    const ids = [seedTile.id];

    for (let i = idx - 1; i >= 0; i -= 1) {
      if (sameZoneRow[i + 1].x - sameZoneRow[i].x !== BOARD.cellWidth) break;
      ids.unshift(sameZoneRow[i].id);
    }

    for (let i = idx + 1; i < sameZoneRow.length; i += 1) {
      if (sameZoneRow[i].x - sameZoneRow[i - 1].x !== BOARD.cellWidth) break;
      ids.push(sameZoneRow[i].id);
    }

    return ids;
  }

  function handleTilePointerDown(event, tile) {
    if (event.button !== 0) return;
    if (!room?.isYourTurn || room?.phase !== "playing") return;

    event.preventDefault();
    const board = boardRef.current;
    if (!board) return;

    const rect = board.getBoundingClientRect();
    const pointerX = event.clientX - rect.left;
    const pointerY = event.clientY - rect.top;

    const baseDrag = {
      tileId: tile.id,
      offsetX: pointerX - tile.x,
      offsetY: pointerY - tile.y,
      x: tile.x,
      y: tile.y,
      groupTileIds: [],
      groupDeltas: [],
    };

    setDrag(baseDrag);

    holdTimerRef.current = setTimeout(() => {
      const runIds = computeContiguousRun(tile);
      if (runIds.length <= 1) return;
      setDrag({ ...baseDrag, groupTileIds: runIds });
    }, LONG_PRESS_MS);
  }

  function handleSortRack(mode) {
    if (!room || room.phase !== "playing" || !room.isYourTurn) return;

    const ownRack = rackTiles.filter((tile) => tile.ownerId === playerId);
    const colorRank = { red: 0, blue: 1, black: 2, orange: 3 };
    const sorted = [...ownRack].sort((a, b) => {
      if (a.joker && !b.joker) return 1;
      if (!a.joker && b.joker) return -1;
      if (mode === "123") {
        const c = (colorRank[a.color] ?? 99) - (colorRank[b.color] ?? 99);
        return c !== 0 ? c : (a.number ?? 99) - (b.number ?? 99);
      }
      const n = (a.number ?? 99) - (b.number ?? 99);
      return n !== 0
        ? n
        : (colorRank[a.color] ?? 99) - (colorRank[b.color] ?? 99);
    });

    sorted.forEach((tile, index) => {
      const columns = Math.floor(
        (RACK.width - BOARD.tileWidth) / BOARD.cellWidth,
      );
      const column = index % columns;
      const row = Math.floor(index / columns);

      socket?.emit(CLIENT_EVENTS.MOVE_TILE, {
        roomId: room.id,
        tileId: tile.id,
        x: BOARD.cellWidth * (column + 1),
        y: RACK.y + row * BOARD.cellHeight,
        zone: TILE_LOCATIONS.RACK,
      });
    });
  }

  const highlighted = new Set(room?.highlightedTileIds || []);

  return (
    <section className='rounded-2xl border border-white/10 bg-slate-900/80 p-3 shadow-xl shadow-black/30'>
      <div className='mb-2 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-300'>
        <p>
          Drag rack tiles onto the table. Hold press on first tile of a run to
          move grouped tiles.
        </p>
        <p>
          Table: {boardTiles.length} · Rack: {rackTiles.length}
        </p>
        <div className='flex gap-2'>
          <button
            type='button'
            onClick={() => handleSortRack("123")}
            className='rounded-lg border border-cyan-300/30 px-2 py-1 font-bold'
          >
            123
          </button>
          <button
            type='button'
            onClick={() => handleSortRack("333")}
            className='rounded-lg border border-cyan-300/30 px-2 py-1 font-bold'
          >
            333
          </button>
        </div>
      </div>

      <div className='overflow-hidden rounded-2xl border border-cyan-300/10 bg-slate-950 p-2'>
        <div
          ref={boardRef}
          className='relative touch-none select-none overflow-hidden rounded-2xl border border-white/10'
          style={{ width: BOARD.width, height: BOARD.height }}
        >
          <div
            className='absolute rounded-2xl border border-emerald-300/20 bg-emerald-400/[0.03]'
            style={{
              left: TABLE.x,
              top: TABLE.y,
              width: TABLE.width,
              height: TABLE.height,
            }}
          />
          <div
            className='absolute rounded-2xl border border-cyan-300/30 bg-cyan-400/[0.06]'
            style={{
              left: RACK.x,
              top: RACK.y,
              width: RACK.width,
              height: RACK.height,
            }}
          />

          {tiles.map((tile) => {
            const preview = drag?.groupDeltas?.find(
              (entry) => entry.tileId === tile.id,
            );
            const isDragging = drag?.tileId === tile.id || Boolean(preview);
            const renderTile = preview
              ? { ...tile, x: preview.x, y: preview.y }
              : isDragging && drag?.tileId === tile.id
                ? { ...tile, x: drag.x, y: drag.y }
                : tile;

            return (
              <Tile
                key={tile.id}
                tile={renderTile}
                highlighted={highlighted.has(tile.id)}
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
