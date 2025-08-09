/* file: SSE room endpoints */
import { startNewRound, placeBid, challenge as challengeAction, evaluateRound, nextRoundFromOutcome, rerollAllIfSingle } from "@/lib/game/engine";
import type { GameState, Bid } from "@/lib/game/types";

type Room = {
  id: string;
  state: GameState | null;
  subscribers: Set<(state: GameState) => void>;
  members: Map<string, string>; // playerId -> name
};

const rooms = new Map<string, Room>();

function getRoom(roomId: string): Room {
  let r = rooms.get(roomId);
  if (!r) {
    r = { id: roomId, state: null, subscribers: new Set(), members: new Map() };
    rooms.set(roomId, r);
  }
  return r;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const parts = url.pathname.split("/");
  const roomId = decodeURIComponent(parts[parts.indexOf("room") + 1] || "default");
  const room = getRoom(roomId);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      const push = (state: GameState) => {
        const data = `data: ${JSON.stringify({ type: "state", state })}\n\n`;
        controller.enqueue(encoder.encode(data));
      };
      room.subscribers.add(push);
      if (room.state) push(room.state);
      const dispose = () => room.subscribers.delete(push);
      // @ts-expect-error ReadableStream controller may not expose signal typings
      controller.signal?.addEventListener?.("abort", dispose);
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" } });
}

export async function POST(req: Request) {
  const url = new URL(req.url);
  const parts = url.pathname.split("/");
  const roomId = decodeURIComponent(parts[parts.indexOf("room") + 1] || "default");
  const room = getRoom(roomId);
  const body = await req.json();
  const type: string = body.type;
  if (type === "join") {
    const name: string = String(body.name || "玩家");
    const playerId = body.playerId || `p_${Math.random().toString(36).slice(2, 8)}`;
    room.members.set(playerId, name);
    const names = Array.from(room.members.values());
    const ids = Array.from(room.members.keys());
    if (!room.state) {
      room.state = startNewRound(null, { playerNames: names });
      // 對齊給定 ids
      room.state.players = room.state.players.map((p, i) => ({ ...p, id: ids[i] }));
      room.state.singleDiceRerollCounts = Object.fromEntries(room.state.players.map((p) => [p.id, 0]));
      room.state.drinkCounts = Object.fromEntries(room.state.players.map((p) => [p.id, 0]));
    } else {
      if (!room.state.players.find((p) => p.id === playerId)) {
        room.state.players.push({ id: playerId, name, dice: Array.from({ length: room.state.rules.dicePerPlayer }, () => Math.floor(Math.random() * 6) + 1), isActive: true });
        room.state.singleDiceRerollCounts[playerId] = 0;
        room.state.drinkCounts[playerId] = 0;
      }
    }
    return Response.json({ ok: true, playerId, state: room.state });
  } else if (type === "start_round") {
    room.state = startNewRound(room.state, {});
  } else if (type === "place_bid") {
    const bid: Omit<Bid, "timestampMs"> = {
      bidderPlayerId: body.bidderPlayerId,
      count: body.count,
      face: body.face,
      isPure: !!body.isPure,
    };
    room.state = placeBid(room.state!, bid);
  } else if (type === "challenge") {
    const challengedPlayerIds: string[] = Array.isArray(body.challengedPlayerIds) ? body.challengedPlayerIds : [];
    const kind = body.kind === "pik" ? "pik" : body.kind === "fan-pik" ? "fan-pik" : "open";
    room.state = challengeAction(room.state!, { challengerPlayerId: body.challengerPlayerId, challengedPlayerIds, type: kind });
    room.state.outcome = evaluateRound(room.state);
  } else if (type === "next_round") {
    room.state = nextRoundFromOutcome(room.state!);
  } else if (type === "reroll_single") {
    room.state = rerollAllIfSingle(room.state!, body.playerId);
  }
  if (room.state) room.subscribers.forEach((fn) => fn(room.state!));
  return Response.json({ ok: true, state: room.state });
}

