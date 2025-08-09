"use client";

import { useEffect, useState } from "react";
import { type Bid, type GameState } from "@/lib/game/types";
import { challenge, evaluateRound, nextRoundFromOutcome, placeBid, startNewRound, rerollAllIfSingle, flipDirection } from "@/lib/game/engine";
import { connectToRoom } from "@/lib/net/ws";

export default function Home() {
  const [state, setState] = useState<GameState | null>(null);
  useEffect(() => {
    // 僅在客戶端初始化，避免 SSR 與 CSR 的隨機數不一致
    setState(startNewRound(null, { rules: { enableSingleDiceReroll: true }, playerNames: ["玩家1", "玩家2"] }));
  }, []);
  const [roomId, setRoomId] = useState("hk-room");
  const [myName, setMyName] = useState("玩家");
  const [myId, setMyId] = useState<string | null>(null);
  const [wsClient, setWsClient] = useState<ReturnType<typeof connectToRoom<GameState>> | null>(null);

  const lastBid = state?.bids[state.bids.length - 1] || null;
  const me = state?.players[state.currentPlayerIndex];

  const [count, setCount] = useState(2);
  const [face, setFace] = useState(2);
  const [isPure, setIsPure] = useState(false);

  // 叫骰輸入即時檢核可在後續補強

  function handleBid() {
    const bid: Omit<Bid, "timestampMs"> = {
      bidderPlayerId: me.id,
      count,
      face,
      isPure,
    };
    setState((s) => placeBid(s, bid));
  }

  function handleOpen(type: "open" | "pik" | "fan-pik" = "open") {
    setState((s) => challenge(s, { challengerPlayerId: me.id, challengedPlayerIds: [s.players[(s.currentPlayerIndex + s.players.length - 1) % s.players.length].id], type }));
  }

  function handleRevealAndNext() {
    const outcome = evaluateRound(state);
    setState((s) => ({ ...s, outcome, revealed: true }));
  }

  function handleNextRound() {
    setState((s) => nextRoundFromOutcome(s));
  }

  function connectRoom() {
    if (wsClient) return;
    const client = connectToRoom<GameState>(roomId, myName, {
      onState: (s) => setState(s),
      onError: (err) => console.error(err),
    });
    setWsClient(client);
    client.myId().then((id) => setMyId(id));
  }

  const isOnline = !!wsClient;

  function isSingleDice(dice: number[]) {
    return new Set(dice).size === dice.length;
  }

  function canReroll(playerId: string) {
    if (!state) return false;
    const used = state.singleDiceRerollCounts?.[playerId] ?? 0;
    return state.rules.enableSingleDiceReroll && used < state.rules.maxSingleDiceRerollsPerRound;
  }

  function rerollSingleFor(playerId: string) {
    if (!canReroll(playerId)) return;
    if (isOnline) {
      wsClient?.rerollSingle(playerId);
    } else {
      setState((s) => rerollAllIfSingle(s, playerId));
    }
  }

  const [challengeTargets, setChallengeTargets] = useState<string[]>([]);
  function toggleTarget(id: string) {
    setChallengeTargets((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }
  function submitChallenge(kind: "open" | "pik" | "fan-pik") {
    if (!state || !me || challengeTargets.length === 0) return;
    if (isOnline) {
      wsClient?.challenge({ challengerPlayerId: me.id, challengedPlayerIds: challengeTargets, kind });
    } else {
      setState((s) => challenge(s, { challengerPlayerId: me.id, challengedPlayerIds: challengeTargets, type: kind }));
    }
  }

  if (!state || !me) {
    return (
      <div className="min-h-screen p-6 flex items-center justify-center">
        <div className="cyber-card px-4 py-2 text-sm opacity-80">初始化遊戲中…</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen p-4 sm:p-8">
      <div className="max-w-4xl mx-auto space-y-4">
        <header className="flex items-center justify-between">
          <h1 className="text-2xl font-bold neon-text">大話骰 / Perudo</h1>
          <span className="text-sm opacity-70">第 {state.roundNumber} 局</span>
        </header>

        <section className="cyber-card p-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="flex items-end gap-2 flex-wrap">
            <input className="border rounded px-2 py-1" placeholder="房間ID" value={roomId} onChange={(e) => setRoomId(e.target.value)} />
            <input className="border rounded px-2 py-1" placeholder="你的名字" value={myName} onChange={(e) => setMyName(e.target.value)} />
            <button className="btn px-3 py-1 rounded text-[--neon-cyan]" onClick={connectRoom} disabled={isOnline}>連線</button>
            <button className="btn px-3 py-1 rounded text-[--neon-yellow]" onClick={() => setState(startNewRound(state, {}))} disabled={isOnline}>本地新局</button>
          </div>
          <div>
            <h2 className="font-semibold mb-2">玩家</h2>
            <ul className="space-y-2">
              {state.players.map((p, idx) => (
                <li key={p.id} className={`p-2 cyber-card ${idx === state.currentPlayerIndex ? "ring-1 ring-[--neon-cyan]" : ""}`}>
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      <span>
                        {idx === state.currentPlayerIndex ? "👉 " : ""}
                        {p.name}
                      </span>
                      <span className="font-mono">
                        🎲 {myId && p.id !== myId ? "? ? ? ? ?" : p.dice.join(" ")}
                        {state.drinkCounts?.[p.id] ? <span className="ml-2 text-xs opacity-80">酒 {state.drinkCounts[p.id]}</span> : null}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      {isSingleDice(p.dice) && canReroll(p.id) ? (
                        <button className="btn px-2 py-1 rounded text-[--neon-cyan]" onClick={() => rerollSingleFor(p.id)}>
                          單骰重搖 ({state.singleDiceRerollCounts[p.id]}/{state.rules.maxSingleDiceRerollsPerRound})
                        </button>
                      ) : null}
                      <label className="text-xs flex items-center gap-1">
                        <input type="checkbox" checked={challengeTargets.includes(p.id)} onChange={() => toggleTarget(p.id)} />
                        開此家
                      </label>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h2 className="font-semibold mb-2">叫骰</h2>
            <div className="flex gap-2 items-center flex-wrap">
              <label className="text-sm">數量 X</label>
              <input className="border rounded px-2 py-1 w-20" type="number" min={state.rules.minPlayers} value={count} onChange={(e) => setCount(Number(e.target.value))} />
              <label className="text-sm">點數 Y</label>
              <input className="border rounded px-2 py-1 w-20" type="number" min={1} max={6} value={face} onChange={(e) => setFace(Number(e.target.value))} />
              <label className="text-sm flex items-center gap-2">
                <input type="checkbox" checked={isPure} onChange={(e) => setIsPure(e.target.checked)} />
                齋
              </label>
              <button onClick={handleBid} className="btn px-3 py-1 rounded text-[--neon-cyan] disabled:opacity-50" disabled={!me || state.revealed}>叫</button>
              <button onClick={() => handleOpen("open")} className="btn px-3 py-1 rounded text-[--neon-yellow]" disabled={!lastBid || state.revealed}>開</button>
              <button onClick={() => handleOpen("pik")} className="btn px-3 py-1 rounded text-[--neon-magenta]" disabled={!lastBid || state.revealed}>劈</button>
              <button onClick={() => handleOpen("fan-pik")} className="btn px-3 py-1 rounded text-white" disabled={!lastBid || state.revealed}>反劈</button>
              <button onClick={() => setState((s) => flipDirection(s))} className="btn px-3 py-1 rounded" title="換方向">↺/↻</button>
            </div>

            <div className="mt-3 text-sm opacity-80">
              {lastBid ? (
                <div>
                  上一家：{lastBid.count} 個 {lastBid.face} {lastBid.isPure ? "(齋)" : ""}
                </div>
              ) : (
                <div>尚未叫骰</div>
              )}
            </div>
            <div className="mt-2 text-xs opacity-75">
              即時驗證：
              <span className={`${(lastBid && (count < state.rules.minPlayers || (count === lastBid.count && ((isPure === lastBid.isPure && face <= lastBid.face) || (!isPure && lastBid.isPure && count < lastBid.count + state.rules.nonPureBeatsPureCountIncrease))))) ? "text-red-400" : "text-green-400"}`}>
                {(lastBid && (count < state.rules.minPlayers || (count === lastBid.count && ((isPure === lastBid.isPure && face <= lastBid.face) || (!isPure && lastBid.isPure && count < lastBid.count + state.rules.nonPureBeatsPureCountIncrease))))) ? "非法" : "看起來合法"}
              </span>
              <span className="ml-3">可重搖次數：{state.singleDiceRerollCounts[me.id] ?? 0}/{state.rules.maxSingleDiceRerollsPerRound}</span>
            </div>
          </div>
        </section>

        {state.revealed ? (
          <section className="cyber-card p-4 space-y-2">
            <h2 className="font-semibold">結果</h2>
            {state.outcome ? (
              <div className="space-y-2">
                <div>合不合乎上家：{state.outcome.meetsBid ? "符合" : "不符"}</div>
                <div>罰酒倍數：x{state.outcome.penaltyMultiplier}</div>
                <div>敗家：{state.players.find((p) => p.id === state.outcome!.loserPlayerId)?.name || "—"}</div>
                <div className="font-mono text-sm">統計：{Object.entries(state.outcome.faceCounts).map(([k, v]) => `${k}:${v}`).join("  ")}</div>
              </div>
            ) : (
              <button className="px-3 py-1 rounded bg-green-600 text-white" onClick={handleRevealAndNext}>計算結果</button>
            )}
            <div>
              <button className="mt-2 btn px-3 py-1 rounded text-[--neon-cyan]" onClick={handleNextRound}>下一局</button>
            </div>
          </section>
        ) : null}

        <section className="cyber-card p-4">
          <h2 className="font-semibold mb-2">歷史</h2>
          <ol className="list-decimal list-inside space-y-1 text-sm">
            {state.bids.map((b, i) => (
              <li key={i}>
                {state.players.find((p) => p.id === b.bidderPlayerId)?.name}: {b.count} 個 {b.face} {b.isPure ? "(齋)" : ""}
              </li>
            ))}
          </ol>
          <div className="mt-3 text-xs opacity-80">
            多家挑戰：已選 {challengeTargets.length} 家
            <div className="flex flex-wrap gap-2 mt-2">
              <button className="btn px-2 py-1 rounded text-[--neon-yellow]" onClick={() => submitChallenge("open")} disabled={challengeTargets.length === 0}>開</button>
              <button className="btn px-2 py-1 rounded text-[--neon-magenta]" onClick={() => submitChallenge("pik")} disabled={challengeTargets.length === 0}>劈</button>
              <button className="btn px-2 py-1 rounded text-white" onClick={() => submitChallenge("fan-pik")} disabled={challengeTargets.length === 0}>反劈</button>
              <button className="btn px-2 py-1 rounded" onClick={() => setChallengeTargets([])} disabled={challengeTargets.length === 0}>清除選擇</button>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
