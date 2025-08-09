export type RoomHandlers<TState> = {
  onState?: (state: TState) => void;
  onError?: (err: string) => void;
  onClose?: () => void;
};

export function connectToRoom<TState>(roomId: string, name: string, handlers: RoomHandlers<TState>) {
  const base = typeof window !== "undefined" ? window.location.origin : "http://localhost:3000";
  const sseUrl = `${base}/api/room/${encodeURIComponent(roomId)}`;
  const ctrl = new AbortController();

  // Join via POST
  const joinPromise = fetch(`${base}/api/room/${encodeURIComponent(roomId)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "join", name }),
  })
    .then((r) => r.json())
    .catch((e): Promise<{ playerId: string | null }> => {
      handlers.onError?.(String(e));
      return Promise.resolve({ playerId: null });
    });

  // Subscribe via SSE
  const ev = new EventSource(sseUrl);
  ev.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      if (msg.type === "state") handlers.onState?.(msg.state);
    } catch (e) {
      handlers.onError?.((e as Error).message);
    }
  };
  ev.onerror = () => handlers.onError?.("SSE error");

  return {
    async myId() {
      const res = await joinPromise;
      return res?.playerId || null;
    },
    placeBid(b: { bidderPlayerId: string; count: number; face: number; isPure: boolean }) {
      fetch(`${base}/api/room/${encodeURIComponent(roomId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "place_bid", ...b }),
      }).catch((e) => handlers.onError?.(String(e)));
    },
    challenge(c: { challengerPlayerId: string; challengedPlayerIds: string[]; kind: "open" | "pik" | "fan-pik" }) {
      fetch(`${base}/api/room/${encodeURIComponent(roomId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "challenge", ...c }),
      }).catch((e) => handlers.onError?.(String(e)));
    },
    startRound() {
      fetch(`${base}/api/room/${encodeURIComponent(roomId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "start_round" }),
      }).catch((e) => handlers.onError?.(String(e)));
    },
    nextRound() {
      fetch(`${base}/api/room/${encodeURIComponent(roomId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "next_round" }),
      }).catch((e) => handlers.onError?.(String(e)));
    },
    rerollSingle(playerId: string) {
      fetch(`${base}/api/room/${encodeURIComponent(roomId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "reroll_single", playerId }),
      }).catch((e) => handlers.onError?.(String(e)));
    },
    close() {
      ctrl.abort();
      ev.close();
      handlers.onClose?.();
    },
  };
}

