import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY;

const supabase =
  SUPABASE_URL && SUPABASE_SECRET_KEY
    ? createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      })
    : null;

export function isPersistenceEnabled() {
  return Boolean(supabase);
}

export async function loadRoomState(roomId) {
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("matches")
    .select("state")
    .eq("room_code", roomId)
    .maybeSingle();

  if (error) {
    console.error("[persistence] failed to load room", {
      roomId,
      error: error.message,
    });

    return null;
  }

  return data?.state || null;
}

export async function saveRoomState(state) {
  if (!supabase) return;

  const { error } = await supabase.from("matches").upsert(
    {
      room_code: state.id,
      phase: state.phase,
      state,
      updated_at: new Date().toISOString(),
    },
    {
      onConflict: "room_code",
    },
  );

  if (error) {
    console.error("[persistence] failed to save room", {
      roomId: state.id,
      error: error.message,
    });
  }
}

export async function logMatchMove({
  roomId,
  playerId,
  moveType,
  payload = {},
  resultingVersion = null,
}) {
  if (!supabase) return;

  const { error } = await supabase.from("match_moves").insert({
    room_code: roomId,
    player_id: playerId,
    move_type: moveType,
    payload,
    resulting_version: resultingVersion,
  });

  if (error) {
    console.error("[persistence] failed to log move", {
      roomId,
      playerId,
      moveType,
      error: error.message,
    });
  }
}

export async function deleteRoomState(roomId) {
  if (!supabase) return;

  const { error } = await supabase
    .from("matches")
    .delete()
    .eq("room_code", roomId);

  if (error) {
    console.error("[persistence] failed to delete room", {
      roomId,
      error: error.message,
    });
  }
}
