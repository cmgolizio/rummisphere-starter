"use client";

import { BOARD, TILE_LOCATIONS } from "@rummisphere/shared";

const COLOR_CLASS = {
  red: "text-rose-600 border-rose-400/40",
  blue: "text-sky-600 border-sky-400/40",
  black: "text-slate-950 border-slate-500/50",
  orange: "text-orange-400 border-orange-200/40",
};

export default function Tile({ tile, isDragging, onPointerDown }) {
  const locationLabel =
    tile.location === TILE_LOCATIONS.RACK ? "rack" : "table";

  return (
    <button
      type='button'
      onPointerDown={onPointerDown}
      className={`absolute flex cursor-grab items-center justify-center rounded-xl border bg-amber-50 font-black shadow-lg ${
        COLOR_CLASS[tile.color] || "border-slate-400 text-slate-950"
      } ${
        isDragging
          ? "z-50 cursor-grabbing shadow-2xl shadow-cyan-300/30"
          : "z-10 hover:shadow-xl"
      }`}
      style={{
        width: BOARD.tileWidth,
        height: BOARD.tileHeight,
        transform: `translate3d(${tile.x}px, ${tile.y}px, 0)`,
        touchAction: "none",
      }}
      aria-label={`${tile.color} ${tile.number} ${locationLabel}`}
    >
      <span className='text-3xl font-extrabold leading-none'>
        {tile.joker ? "★" : tile.number}
      </span>

      {/* <span className='absolute bottom-1 right-2 text-xs opacity-50'>
        {tile.color[0]}
      </span> */}

      {tile.location === TILE_LOCATIONS.RACK ? (
        <span className='absolute left-1 top-1 h-2 w-2 rounded-full bg-cyan-400' />
      ) : null}
    </button>
  );
}
