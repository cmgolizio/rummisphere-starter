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

const LONG_PRESS_MS = 1200;
const GROUP_DRAG_CANCEL_DISTANCE_PX = 6;
const SELECTED_TILE_SHIFT_PX = 10;

export default function GameBoard({
  onDraw,
  onEndTurn,
  onResetTurn,
  canUseTurnActions,
}) {
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
      const nextX = pointerX - drag.offsetX;
      const nextY = pointerY - drag.offsetY;

      if (drag.waitingForGroupDrag && !drag.groupTileIds?.length) {
        const movedDistance = Math.hypot(
          pointerX - drag.startPointerX,
          pointerY - drag.startPointerY,
        );

        if (movedDistance > GROUP_DRAG_CANCEL_DISTANCE_PX) {
          if (holdTimerRef.current) {
            clearTimeout(holdTimerRef.current);
            holdTimerRef.current = null;
          }

          setDrag({
            ...drag,
            waitingForGroupDrag: false,
            x: nextX,
            y: nextY,
          });
          return;
        }
      }

      if (drag.groupTileIds?.length > 0) {
        const groupTiles = drag.groupTileIds
          .map((id) => tileById.get(id))
          .filter(Boolean);

        const anchorTile = tileById.get(drag.tileId);
        if (!anchorTile) return;

        const deltas = groupTiles.map((tile) => ({
          tileId: tile.id,
          x: tile.x + (nextX - anchorTile.x),
          y: tile.y + (nextY - anchorTile.y),
        }));
        setDrag({
          ...drag,
          x: nextX,
          y: nextY,
          groupDeltas: deltas,
        });
        return;
      }

      setDrag({
        ...drag,
        x: nextX,
        y: nextY,
      });
    }

    async function handlePointerUp() {
      if (holdTimerRef.current) {
        clearTimeout(holdTimerRef.current);
        holdTimerRef.current = null;
      }

      if (drag.groupDeltas?.length > 0) {
        const sortedDeltas = [...drag.groupDeltas];
        const anchorTile = tileById.get(drag.tileId);
        const anchorDelta = sortedDeltas.find(
          (entry) => entry.tileId === drag.tileId,
        );

        if (anchorTile && anchorDelta) {
          const deltaX = anchorDelta.x - anchorTile.x;
          const deltaY = anchorDelta.y - anchorTile.y;
          const axis = Math.abs(deltaX) >= Math.abs(deltaY) ? "x" : "y";
          const direction = axis === "x" ? deltaX : deltaY;

          sortedDeltas.sort((a, b) => {
            const tileA = tileById.get(a.tileId);
            const tileB = tileById.get(b.tileId);
            const originalA = tileA?.[axis] ?? a[axis];
            const originalB = tileB?.[axis] ?? b[axis];

            return direction >= 0
              ? originalB - originalA
              : originalA - originalB;
          });
        }

        for (const entry of sortedDeltas) {
          const zone = getTileZoneFromPoint(entry.x, entry.y);
          const snapped = snapTilePosition(entry.x, entry.y, zone);

          const accepted = await new Promise((resolve) => {
            socket?.emit(
              CLIENT_EVENTS.MOVE_TILE,
              {
                roomId: room?.id,
                tileId: entry.tileId,
                x: snapped.x,
                y: snapped.y,
                zone,
              },
              (response) => {
                if (!response?.ok) {
                  setError(response?.reason || "Move rejected by server.");
                  resolve(false);
                  return;
                }

                resolve(true);
              },
            );
          });

          if (!accepted) break;
        }

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
      .filter((tile) => {
        if (tile.location !== seedTile.location) return false;
        if (tile.y !== seedTile.y) return false;

        if (tile.location === TILE_LOCATIONS.RACK) {
          return tile.ownerId === seedTile.ownerId;
        }

        return true;
      })
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

    if (ids[0] !== seedTile.id) return [seedTile.id];

    const runTiles = ids.map((id) => tileById.get(id)).filter(Boolean);
    if (!isValidOrderedRun(runTiles)) return [seedTile.id];

    return ids;
  }

  function isValidOrderedRun(runTiles) {
    if (runTiles.length < 3) return false;

    const nonJokers = runTiles.filter((tile) => !tile.joker);
    if (nonJokers.length === 0) return true;

    const color = nonJokers[0].color;

    if (!nonJokers.every((tile) => tile.color === color)) {
      return false;
    }

    let firstNumber = null;

    for (let index = 0; index < runTiles.length; index += 1) {
      const tile = runTiles[index];
      if (tile.joker) continue;

      const number = Number(tile.number);
      if (!Number.isFinite(number)) return false;

      const possibleFirstNumber = number - index;

      if (firstNumber === null) {
        firstNumber = possibleFirstNumber;
      }

      if (possibleFirstNumber !== firstNumber) {
        return false;
      }
    }

    return firstNumber >= 1 && firstNumber + runTiles.length - 1 <= 13;
  }

  function getGroupDeltas(runIds, anchorTile, anchorX, anchorY) {
    return runIds
      .map((id) => tileById.get(id))
      .filter(Boolean)
      .map((tile) => ({
        tileId: tile.id,
        x: tile.x + (anchorX - anchorTile.x),
        y: tile.y + (anchorY - anchorTile.y),
      }));
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
      startPointerX: pointerX,
      startPointerY: pointerY,
      waitingForGroupDrag: true,
      x: tile.x,
      y: tile.y,
      groupTileIds: [],
      groupDeltas: [],
    };

    setDrag(baseDrag);

    holdTimerRef.current = setTimeout(() => {
      const currentDrag = useGameStore.getState().drag;

      if (
        !currentDrag ||
        currentDrag.tileId !== tile.id ||
        !currentDrag.waitingForGroupDrag
      ) {
        return;
      }

      const runIds = computeContiguousRun(tile);

      if (runIds.length <= 1) {
        setDrag({
          ...currentDrag,
          waitingForGroupDrag: false,
        });
        return;
      }

      setDrag({
        ...currentDrag,
        waitingForGroupDrag: false,
        groupTileIds: runIds,
        groupDeltas: getGroupDeltas(runIds, tile, currentDrag.x, currentDrag.y),
      });
    }, LONG_PRESS_MS);
  }

  function handleSortRack(mode) {
    if (!room || room.phase !== "playing" || !room.isYourTurn) return;

    socket?.emit(
      CLIENT_EVENTS.SORT_RACK,
      {
        roomId: room.id,
        mode,
      },
      (response) => {
        if (!response?.ok) {
          setError(response?.reason || "Could not sort rack.");
        }
      },
    );
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
      </div>

      <div className='flex items-start gap-3'>
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
              const isGroupTile = drag?.groupTileIds?.includes(tile.id);
              const isDragging =
                drag?.tileId === tile.id || Boolean(preview) || isGroupTile;
              const shouldShift =
                isDragging &&
                (drag?.waitingForGroupDrag || drag?.groupTileIds?.length > 0);
              const renderTile = preview
                ? {
                    ...tile,
                    x: preview.x,
                    y: preview.y - SELECTED_TILE_SHIFT_PX,
                  }
                : isDragging && drag?.tileId === tile.id
                  ? {
                      ...tile,
                      x: drag.x,
                      y: shouldShift ? drag.y - SELECTED_TILE_SHIFT_PX : drag.y,
                    }
                  : isGroupTile && shouldShift
                    ? { ...tile, y: tile.y - SELECTED_TILE_SHIFT_PX }
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

        <aside className='flex min-w-[68px] flex-col gap-2 rounded-2xl border border-white/10 bg-slate-950/90 p-2'>
          <button
            type='button'
            onClick={() => handleSortRack("123")}
            className='rounded-lg border border-cyan-300/30 px-2 py-2 text-xs font-bold'
          >
            123
          </button>
          <button
            type='button'
            onClick={() => handleSortRack("333")}
            className='rounded-lg border border-cyan-300/30 px-2 py-2 text-xs font-bold'
          >
            333
          </button>
          <button
            type='button'
            aria-label='Draw tile'
            title='Draw'
            onClick={onDraw}
            disabled={!canUseTurnActions}
            className='rounded-lg border border-cyan-300/30 bg-cyan-300/15 px-2 py-2 text-lg leading-none disabled:cursor-not-allowed disabled:opacity-40'
          >
            +
          </button>
          <button
            type='button'
            aria-label='End turn'
            title='End Turn'
            onClick={onEndTurn}
            disabled={!canUseTurnActions}
            className='rounded-lg border border-emerald-300/30 bg-emerald-300/15 px-2 py-2 text-lg leading-none disabled:cursor-not-allowed disabled:opacity-40'
          >
            ✓
          </button>
          <button
            type='button'
            aria-label='Reset turn'
            title='Reset Turn'
            onClick={onResetTurn}
            disabled={!canUseTurnActions}
            className='rounded-lg border border-white/20 bg-white/10 px-2 py-2 text-lg leading-none disabled:cursor-not-allowed disabled:opacity-40'
          >
            ↺
          </button>
        </aside>
      </div>
    </section>
  );
}
