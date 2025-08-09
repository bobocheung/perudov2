import { Bid, Challenge, GameState, Player, RulesConfig, RoundOutcome, defaultRules } from "./types";

function rollDie(): number {
  return Math.floor(Math.random() * 6) + 1;
}

export function createPlayers(names: string[], dicePerPlayer: number): Player[] {
  return names.map((name, idx) => ({
    id: `p${idx + 1}`,
    name,
    dice: Array.from({ length: dicePerPlayer }, rollDie),
    isActive: true,
  }));
}

export function startNewRound(
  prev: GameState | null,
  opts: { rules?: Partial<RulesConfig>; startingPlayerIndex?: number; playerNames?: string[] }
): GameState {
  const rules: RulesConfig = { ...defaultRules, ...(opts.rules || {}) };
  const players: Player[] = prev?.players?.length
    ? prev.players.map((pl) => ({ ...pl, dice: Array.from({ length: rules.dicePerPlayer }, rollDie) }))
    : createPlayers(opts.playerNames || ["玩家1", "玩家2"], rules.dicePerPlayer);

  const startingIndex =
    typeof opts.startingPlayerIndex === "number"
      ? opts.startingPlayerIndex % players.length
      : prev?.currentPlayerIndex || 0;

  return {
    rules,
    players,
    currentPlayerIndex: startingIndex,
    turnDirection: prev?.turnDirection ?? 1,
    bids: [],
    challenges: [],
    roundNumber: (prev?.roundNumber || 0) + 1,
    revealed: false,
    outcome: null,
    singleDiceRerollCounts: Object.fromEntries(players.map((p) => [p.id, 0])),
    drinkCounts:
      prev?.drinkCounts ||
      Object.fromEntries(players.map((p) => [p.id, 0])),
  };
}

export function getNextPlayerIndex(state: GameState, fromIndex?: number): number {
  const start = typeof fromIndex === "number" ? fromIndex : state.currentPlayerIndex;
  const len = state.players.length;
  return (start + state.turnDirection + len) % len;
}

export function canOverbid(prevBid: Bid | null, nextBid: Bid, rules: RulesConfig): boolean {
  if (nextBid.face < 1 || nextBid.face > 6) return false;
  if (nextBid.count < rules.minPlayers) return false;

  if (!prevBid) return true;

  // If switching purity contexts, enforce special rule: non-pure must add count when beating pure
  if (!nextBid.isPure && prevBid.isPure) {
    if (nextBid.count < prevBid.count + rules.nonPureBeatsPureCountIncrease) return false;
    return true;
  }

  if (nextBid.isPure && !prevBid.isPure) {
    // Pure can be considered stronger at same count if face ranking higher than prev
    if (nextBid.count < prevBid.count) return false;
    if (nextBid.count === prevBid.count) {
      // compare pure faces, possibly with 1 highest
      const prevRank = pureRank(prevBid.face, rules);
      const nextRank = pureRank(nextBid.face, rules);
      return nextRank > prevRank;
    }
    return true;
  }

  // Same purity context
  if (nextBid.count < prevBid.count) return false;
  if (nextBid.count === prevBid.count) {
    return nextBid.face > prevBid.face;
  }
  return true;
}

function pureRank(face: number, rules: RulesConfig): number {
  if (!rules.pureFaceRankingHighestIsOne) return face; // 1..6
  // Make 1 highest: map 1->7, others unchanged order below
  return face === 1 ? 7 : face;
}

export function placeBid(state: GameState, bid: Omit<Bid, "timestampMs">): GameState {
  const timestampMs = Date.now();
  const lastBid = state.bids[state.bids.length - 1] || null;
  if (!canOverbid(lastBid, { ...bid, timestampMs }, state.rules)) {
    throw new Error("非法叫骰");
  }
  const nextIndex = getNextPlayerIndex(state);
  return {
    ...state,
    bids: [...state.bids, { ...bid, timestampMs }],
    currentPlayerIndex: nextIndex,
  };
}

export function challenge(state: GameState, action: Omit<Challenge, "timestampMs">): GameState {
  const timestampMs = Date.now();
  return {
    ...state,
    challenges: [...state.challenges, { ...action, timestampMs }],
    revealed: true,
  };
}

export function evaluateRound(state: GameState): RoundOutcome {
  const lastBid = state.bids[state.bids.length - 1] || null;
  const penaltyMultiplier = computePenaltyMultiplier(state);

  const faceCountsRaw: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
  state.players.forEach((p) => {
    p.dice.forEach((v) => {
      faceCountsRaw[v] += 1;
    });
  });

  const faceCounts = { ...faceCountsRaw };

  if (!lastBid) {
    return {
      lastBid: null,
      loserPlayerId: null,
      meetsBid: null,
      penaltyMultiplier,
      faceCounts,
    };
  }

  // Count toward the face considering rules
  let totalForFace = 0;
  if (lastBid.isPure) {
    // Pure: ones are not wild; only exact face counts
    totalForFace = faceCounts[lastBid.face] || 0;
  } else {
    // Non-pure: ones are wild
    totalForFace = (faceCounts[lastBid.face] || 0) + (state.rules.nonPureOnesAreWild ? faceCounts[1] || 0 : 0);
  }

  // Wrapped bonuses
  if (state.rules.enableWrappedBonus) {
    const isFiveOfAKind = Object.values(faceCountsRaw).some((n) => n === state.rules.dicePerPlayer);
    if (isFiveOfAKind) {
      if (lastBid.isPure) totalForFace += state.rules.wrappedBonusPureIncrement;
      else totalForFace += state.rules.wrappedBonusNonPureIncrement;
    }
  }

  const meetsBid = totalForFace >= lastBid.count;

  const challenger = state.challenges[state.challenges.length - 1] || null;
  const loserPlayerId = determineLoser(state, meetsBid, challenger);

  return {
    lastBid,
    loserPlayerId,
    meetsBid,
    penaltyMultiplier,
    faceCounts,
  };
}

function computePenaltyMultiplier(state: GameState): number {
  // 開: 1x, 劈: 2x, 反劈: 4x (簡化，若多家則仍按最後動作)
  const last = state.challenges[state.challenges.length - 1];
  if (!last) return 1;
  if (last.type === "open") return 1;
  if (last.type === "pik") return 2;
  return 4; // fan-pik
}

function determineLoser(state: GameState, meetsBid: boolean, challenger: Challenge | null): string {
  const lastBid = state.bids[state.bids.length - 1]!;
  if (!challenger) {
    // No challenge recorded; by default, last bidder loses nothing yet. Fallback: no loser.
    return "";
  }
  if (meetsBid) {
    return challenger.challengerPlayerId; // 開骰者錯
  }
  return lastBid.bidderPlayerId; // 上家吹牛
}

export function nextRoundFromOutcome(state: GameState): GameState {
  if (!state.revealed) return state;
  const outcome = evaluateRound(state);
  const loserIndex = state.players.findIndex((p) => p.id === outcome.loserPlayerId);
  const startingIndex = loserIndex >= 0 ? loserIndex : state.currentPlayerIndex;
  // 計酒數
  const loserId = outcome.loserPlayerId;
  const penalty = outcome.penaltyMultiplier;
  const nextDrink = { ...state.drinkCounts };
  if (loserId) nextDrink[loserId] = (nextDrink[loserId] || 0) + penalty;

  return startNewRound(
    {
      ...state,
      outcome,
      drinkCounts: nextDrink,
    },
    { startingPlayerIndex: startingIndex }
  );
}

export function flipDirection(state: GameState): GameState {
  return { ...state, turnDirection: (state.turnDirection === 1 ? -1 : 1) };
}

export function canRerollSingleDice(state: GameState, playerId: string): boolean {
  if (!state.rules.enableSingleDiceReroll) return false;
  const used = state.singleDiceRerollCounts[playerId] || 0;
  return used < state.rules.maxSingleDiceRerollsPerRound;
}

export function rerollAllIfSingle(state: GameState, playerId: string): GameState {
  // 「單骰」: 五個皆不同，可出示後重搖
  const player = state.players.find((p) => p.id === playerId);
  if (!player) return state;
  const set = new Set(player.dice);
  if (set.size === player.dice.length) {
    if (!canRerollSingleDice(state, playerId)) return state;
    const nextPlayers = state.players.map((p) =>
      p.id === playerId ? { ...p, dice: Array.from({ length: state.rules.dicePerPlayer }, rollDie) } : p
    );
    return {
      ...state,
      players: nextPlayers,
      singleDiceRerollCounts: {
        ...state.singleDiceRerollCounts,
        [playerId]: (state.singleDiceRerollCounts[playerId] || 0) + 1,
      },
    };
  }
  return state;
}

