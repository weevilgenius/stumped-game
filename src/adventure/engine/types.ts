import type { CampaignCommand, CampaignEvent, CampaignState, EncounterBudget } from './campaignTypes';

/* ========================================================= *\
 *  Adventure engine contracts: definitions, state,          *
 *  commands, and events. Everything here is plain JSON.     *
 *  See docs/adventure-mode-technical.md, sections 4-8.      *
\* ========================================================= */

/** Palette index of a region's color, 0 to size - 1. */
export type ColorId = number;

/** Where a collection came from. Mirrors `FoundBy` in src/game.ts, minus 'given'. */
export type CollectSource = 'player' | 'woodpecker' | 'owl';

/** One region's pulse: its color and size. */
export interface Collection {
  /** Palette index of the region. */
  readonly color: ColorId;
  /** Squares in the region. */
  readonly amount: number;
}

/**
 * One size band: pulses of at least `min` squares, up to the next band, give `value`.
 * Bands are listed smallest first and the first starts at 1. The band number
 * (from 0) goes in events so the presenter can pick an animation tier.
 */
export interface Band {
  /** Smallest pulse in the band. */
  readonly min: number;
  /** Effect size for the band. */
  readonly value: number;
}

/** What an item does when it activates. */
export type Effect = 'attack' | 'block' | 'heal' | 'forage';

/** An equipment item. */
export interface ItemDef {
  /** Content identifier. */
  readonly id: string;
  /** What it does. */
  readonly effect: Effect;
  /** Effect size by pulse size. A charge item uses the total of its pulses. */
  readonly bands: readonly Band[];
  /** Colors that activate it. For a charge item, the colors its recipe needs, in any order. */
  readonly colors: readonly ColorId[];
  /** True if it needs every one of `colors` before it fires, false if any one fires it. */
  readonly charge?: boolean;
  /** Turns it is skipped for after it fires. Resets at round end. */
  readonly cooldown?: number;
  /** Resource a forage item adds. */
  readonly resource?: string;
  /** Unique campaign instance id; catalog ids remain readable. */
  readonly instance?: string;
  /** Shop value before selling at half price. */
  readonly price?: number;
}

/** One telegraphed enemy action. */
export interface Intent {
  /** Turns from the previous action (or the encounter's start) until this one. */
  readonly delay: number;
  /** Damage to the character. */
  readonly damage: number;
}

/** Turns leftover pulses of some colors into a resource after an encounter is won. */
export interface ScavengeRule {
  /** Colors this rule takes. Colors no rule takes are discarded. */
  readonly colors: readonly ColorId[];
  /** Resource it adds. */
  readonly resource: string;
  /** Resource added by pulse size. */
  readonly bands: readonly Band[];
}

/** An encounter: a telegraphed enemy or a noncombat objective with a deadline. */
export type EncounterDef =
  | {
    readonly type: 'enemy';
    /** Bounded campaign behavior; absent in the sandbox. */
    readonly budget?: EncounterBudget;
    /** Content identifier. */
    readonly id: string;
    /** Starting health. */
    readonly health: number;
    /** Actions it repeats in order. */
    readonly intents: readonly Intent[];
    /** Rules for the scavenge phase after it is defeated. */
    readonly scavenge: readonly ScavengeRule[];
  }
  | {
    readonly type: 'objective';
    /** Content identifier. */
    readonly id: string;
    /** Progress needed. */
    readonly goal: number;
    /** Item effects that add progress. */
    readonly accepts: readonly Effect[];
    /** Turns until the deadline. Unmet, the character takes `failDamage` and the objective ends. */
    readonly deadline: number;
    /** Damage when the deadline passes. */
    readonly failDamage: number;
    /** Rules for the scavenge phase after it is completed. */
    readonly scavenge: readonly ScavengeRule[];
  };

/** A character and starting loadout. */
export interface CharacterDef {
  /** Content identifier. */
  readonly id: string;
  /** Starting and maximum health. */
  readonly health: number;
  /** Items in the equipment slots, in priority order. */
  readonly loadout: readonly ItemDef[];
}

/** What a round could collect: one entry per region. */
export interface RoundManifest {
  /** Identifier of the play (`game.id`), so a reload can match the round to its puzzle. */
  readonly id: string;
  /** Puzzle size. */
  readonly size: number;
  /** One entry per region, givens included. */
  readonly collections: readonly Collection[];
  /** Colors whose stumps are prefilled. They are never collected by a turn. */
  readonly givenColors: readonly ColorId[];
}

/** One equipment slot. */
export interface SlotState {
  /** The item, copied in so a save keeps working if content changes. */
  readonly item: ItemDef;
  /** Readied items receive pulses. */
  ready: boolean;
  /** Round turn from which it can fire again. */
  readyAt: number;
  /** Colors a charge item has taken this round. */
  charged: ColorId[];
  /** Squares a charge item has taken this round. */
  chargedAmount: number;
  /** Campaign level, at most three. */
  level?: number;
  /** Postcombat squares toward the next level (24). */
  experience?: number;
}

/** The active encounter, which can outlast a round. */
export type EncounterState =
  | {
    readonly type: 'enemy';
    /** Its definition. */
    readonly def: EncounterDef & { readonly type: 'enemy' };
    /** 'active' while fighting, 'scavenge' for the rest of the round it was won in. */
    phase: 'active' | 'scavenge';
    /** Remaining health. */
    health: number;
    /** Index of the next intent. */
    intent: number;
    /** Turns until the next intent; 1 means it happens this turn. */
    countdown: number;
  }
  | {
    readonly type: 'objective';
    /** Its definition. */
    readonly def: EncounterDef & { readonly type: 'objective' };
    /** 'active' until met, 'scavenge' for the rest of the round it was met in. */
    phase: 'active' | 'scavenge';
    /** Progress so far. */
    progress: number;
    /** Turns until the deadline; 1 means it passes this turn. */
    countdown: number;
  };

/** The puzzle in progress. */
export interface RoundState {
  /** What it can collect. */
  readonly manifest: RoundManifest;
  /** Turns taken this round. */
  turn: number;
  /** Colors collected so far. */
  collected: ColorId[];
}

/** How a run ended. */
export type RunOutcome = 'death' | 'failed' | 'abandoned' | 'victory';

/** A whole adventure run. Save it with `JSON.stringify`. */
export interface AdventureState {
  /** Absent for legacy sandbox runs. */
  campaign?: CampaignState;
  /** 'between' rounds, in a 'round', or 'ended'. */
  phase: 'between' | 'round' | 'ended';
  /** Character content identifier. */
  readonly character: string;
  /** Current health. */
  health: number;
  /** Maximum health. */
  readonly maxHealth: number;
  /** Absorbs the next attack, then the rest is lost. Expires at round end. */
  block: number;
  /** Equipment in priority order. */
  slots: SlotState[];
  /** Supplies, coins, and other resources by name. */
  resources: Record<string, number>;
  /** Current encounter, if any. */
  encounter: EncounterState | null;
  /** Current round, if any. */
  round: RoundState | null;
  /** Rounds finished. */
  rounds: number;
  /** Set once the run has ended. */
  outcome: RunOutcome | null;
}

/** Input to `step()`. */
export type AdventureCommand =
  | CampaignCommand
  | {
    readonly type: 'begin-encounter';
    /** The encounter to start. */
    readonly encounter: EncounterDef;
  }
  | {
    readonly type: 'begin-round';
    /** The new puzzle's manifest. */
    readonly round: RoundManifest;
  }
  | {
    readonly type: 'turn';
    /** The pulse, or none for a wrong reveal. */
    readonly collect?: Collection;
    /** Defaults to 'player'. */
    readonly source?: CollectSource;
  }
  | {
    readonly type: 'set-ready';
    /** Slot index. */
    readonly slot: number;
    /** Readiness. */
    readonly ready: boolean;
  }
  | {
    readonly type: 'set-priority';
    /** Current slot indexes in their new order. */
    readonly slots: readonly number[];
  }
  | {
    readonly type: 'end-round';
    /** 'completed' when solved, 'failed' when out of acorns, 'abandoned' when the run is given up. */
    readonly outcome: 'completed' | 'failed' | 'abandoned';
  };

/** Why a command was rejected. */
export type RejectReason =
  | 'run-ended'
  | 'wrong-phase'
  | 'encounter-active'
  | 'bad-manifest'
  | 'bad-collection'
  | 'bad-slot'
  | 'round-incomplete'
  | 'bad-choice'
  | 'inventory-full'
  | 'insufficient-supplies';

/** Something that happened, in order. Data only, no rendering instructions. */
export type AdventureEvent =
  | CampaignEvent
  | { readonly type: 'command-rejected'; readonly command: AdventureCommand['type']; readonly reason: RejectReason }
  | { readonly type: 'encounter-started'; readonly encounter: string }
  | { readonly type: 'round-started'; readonly id: string }
  | { readonly type: 'turn-started'; readonly turn: number }
  | { readonly type: 'collected'; readonly color: ColorId; readonly amount: number; readonly source: CollectSource }
  | { readonly type: 'pulse-routed'; readonly slot: number; readonly item: string }
  | { readonly type: 'pulse-discarded' }
  | { readonly type: 'ability-charged'; readonly slot: number; readonly item: string; readonly missing: readonly ColorId[] }
  | {
    readonly type: 'ability-activated';
    readonly slot: number;
    readonly item: string;
    readonly effect: Effect;
    readonly value: number;
    /** Size band of the pulse, from 0. */
    readonly band: number;
  }
  | {
    readonly type: 'damage-applied';
    readonly target: 'character' | 'enemy';
    /** Damage before block. */
    readonly amount: number;
    /** Part of it the character's block absorbed. */
    readonly blocked: number;
    /** Target's health afterwards. */
    readonly health: number;
  }
  | { readonly type: 'healed'; readonly amount: number; readonly health: number }
  | { readonly type: 'block-changed'; readonly block: number }
  | { readonly type: 'enemy-acted'; readonly encounter: string; readonly damage: number; readonly next: number | null }
  | { readonly type: 'objective-progressed'; readonly encounter: string; readonly progress: number; readonly goal: number }
  | {
    readonly type: 'resource-changed';
    readonly resource: string;
    readonly amount: number;
    readonly total: number;
    /** Size band of the pulse, from 0. */
    readonly band: number;
  }
  | { readonly type: 'readiness-changed'; readonly slot: number; readonly ready: boolean }
  | { readonly type: 'priority-changed'; readonly items: readonly string[] }
  | {
    readonly type: 'encounter-transitioned';
    readonly encounter: string;
    /** 'scavenge' after a win; 'ended' when it is over. */
    readonly to: 'scavenge' | 'ended';
    readonly outcome: 'defeated' | 'completed' | 'failed' | 'cleared';
  }
  | { readonly type: 'round-ended'; readonly outcome: 'completed' | 'failed' | 'abandoned' }
  | { readonly type: 'run-ended'; readonly outcome: RunOutcome };

/** What `step()` returns. */
export interface EngineResult {
  /** The new state, or the same object if the command was rejected. */
  readonly state: AdventureState;
  /** What happened, in order. */
  readonly events: readonly AdventureEvent[];
}
