export type Player = {
  id: string;
  name: string;
  dice: number[]; // values 1-6
  isActive: boolean;
};

export type Bid = {
  count: number; // X
  face: number; // Y (1-6)
  isPure: boolean; // 齋: ones are NOT wild
  bidderPlayerId: string;
  timestampMs: number;
};

export type Challenge = {
  challengerPlayerId: string;
  challengedPlayerIds: string[]; // 支援「開兩家/多家」
  type: "open" | "pik" | "fan-pik"; // 開 / 劈 / 反劈
  timestampMs: number;
};

export type RoundOutcome = {
  lastBid: Bid | null;
  loserPlayerId: string | null;
  meetsBid: boolean | null;
  penaltyMultiplier: number; // 1, 2, 4
  faceCounts: Record<number, number>; // 1..6 aggregated per rules at evaluation time
};

export type RulesConfig = {
  minPlayers: number; // default 2
  dicePerPlayer: number; // default 5
  allowPureBids: boolean; // 是否啟用「齋」
  nonPureBeatsPureCountIncrease: number; // 用「飛」壓「齋」時，X 至少需要 +N（常見為 2）。可設 0 或 2
  pureFaceRankingHighestIsOne: boolean; // 齋時 1 為最大
  nonPureOnesAreWild: boolean; // 非齋時 1 可作百搭
  enableSingleDiceReroll: boolean; // 「單骰」可重搖
  maxSingleDiceRerollsPerRound: number; // 最多次數
  enableWrappedBonus: boolean; // 「圍骰/爆子」加成
  wrappedBonusNonPureIncrement: number; // 非齋五同點 -> +1 視為多一粒
  wrappedBonusPureIncrement: number; // 齋五同點 -> +2 視為多兩粒
};

export type GameState = {
  rules: RulesConfig;
  players: Player[];
  currentPlayerIndex: number; // 指向下一位行動玩家
  turnDirection: 1 | -1; // 1=順時針, -1=逆時針
  bids: Bid[];
  challenges: Challenge[];
  roundNumber: number;
  revealed: boolean; // 是否已開骰
  outcome: RoundOutcome | null;
  singleDiceRerollCounts: Record<string, number>; // playerId -> used times
  drinkCounts: Record<string, number>; // playerId -> 已喝酒數
};

export const defaultRules: RulesConfig = {
  minPlayers: 2,
  dicePerPlayer: 5,
  allowPureBids: true,
  nonPureBeatsPureCountIncrease: 2,
  pureFaceRankingHighestIsOne: true,
  nonPureOnesAreWild: true,
  enableSingleDiceReroll: false,
  maxSingleDiceRerollsPerRound: 3,
  enableWrappedBonus: false,
  wrappedBonusNonPureIncrement: 1,
  wrappedBonusPureIncrement: 2,
};

