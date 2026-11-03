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
  /** Loot tier, 1 to 3, which sets its shop price. Missing on sandbox items. */
  readonly tier?: number;
}

/** A single-use item. Using one never takes a turn. */
export interface ConsumableDef {
  /** Content identifier. */
  readonly id: string;
  /** What it does: heal or block the character, or damage the enemy. */
  readonly effect: 'heal' | 'block' | 'attack';
  /** Effect size. */
  readonly value: number;
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
    /** Content identifier. */
    readonly id: string;
    /** Starting health. */
    readonly health: number;
    /** Actions it repeats in order. */
    readonly intents: readonly Intent[];
    /** Rules for the scavenge phase after it is defeated. Ignored when `harvest` is set. */
    readonly scavenge: readonly ScavengeRule[];
    /**
     * Colors that harvest after a kill: each goes to the first readied item that takes it as
     * experience, or becomes supplies. One fewer color harvests for each extra puzzle the fight lasts.
     */
    readonly harvest?: readonly ColorId[];
    /** Damage added to every attack for each new puzzle it survives into. */
    readonly enrage?: number;
    /** Puzzles it fights before it flees, taking its loot with it. */
    readonly flee?: number;
    /** Killing it wins the run, and the player cannot flee it. */
    readonly boss?: boolean;
  }
  | {
    /** A puzzle with no enemy, where every listed color harvests. */
    readonly type: 'forage';
    /** Content identifier. */
    readonly id: string;
    /** Colors that harvest. */
    readonly harvest: readonly ColorId[];
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
  /** Band steps gained from harvest or rest. Missing in older saves, meaning 0. */
  level?: number;
  /** Harvested squares toward the next level. */
  xp?: number;
  /** Fight number it last levelled in, so it levels at most once per fight. */
  leveledIn?: number;
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
    /** Puzzles it has been fought in. Missing in older saves. */
    rounds?: number;
    /** Damage added to each attack by enraging. */
    rage?: number;
  }
  | {
    readonly type: 'forage';
    /** Its definition. */
    readonly def: EncounterDef & { readonly type: 'forage' };
    /** Always 'scavenge': there is nothing to fight. */
    phase: 'scavenge';
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

/** What a map node holds. The player sees the kind and a fight's danger tier before choosing. */
export type NodeKind = 'fight' | 'elite' | 'boss' | 'shop' | 'rest' | 'event' | 'forage';

/** One node of the run's map. */
export interface MapNode {
  /** Column from 0 (the start) to the boss's column. */
  readonly column: number;
  /** Position within the column, from 0. */
  readonly lane: number;
  /** Nodes in its column. */
  readonly lanes: number;
  /** What it holds. */
  readonly kind: NodeKind;
  /** Danger tier, 1 to 3, which also sets loot and shop tiers. */
  readonly tier: number;
  /** Indexes of the nodes it leads to. */
  readonly next: readonly number[];
}

/** Something to pick up or buy. */
export type Goods =
  | { readonly kind: 'gear'; readonly item: ItemDef }
  | { readonly kind: 'consumable'; readonly item: ConsumableDef };

/** A shop's stock, fixed on arrival. Sold entries become null. */
export interface ShopState {
  /** Goods for sale and their prices. */
  stock: ({ readonly goods: Goods; readonly price: number } | null)[];
}

/** Route, loot, and the current stop of a campaign run. Missing on sandbox runs. */
export interface CampaignState {
  /** Seed for the map, enemies, loot, shops, and events, so the run replays exactly. */
  readonly seed: number;
  /** Every node, by index. */
  readonly nodes: readonly MapNode[];
  /** Current node, or null before the first move. */
  at: number | null;
  /** Nodes entered, in order. */
  visited: number[];
  /** Drops from the last kill, left behind on moving on. */
  loot: Goods[];
  /** The shop here, if any. */
  shop: ShopState | null;
  /** The event here, if it has not been answered yet. */
  event: string | null;
  /** True while a rest here is unused. */
  rest: boolean;
}

/** A whole adventure run. Save it with `JSON.stringify`. */
export interface AdventureState {
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
  /** Reserve items, which keep their state while packed. Missing in older saves. */
  pack?: SlotState[];
  /** Single-use items. Missing in older saves. */
  consumables?: ConsumableDef[];
  /** Encounters started, so items level at most once per fight. Missing in older saves. */
  fights?: number;
  /** Supplies, coins, and other resources by name. */
  resources: Record<string, number>;
  /** Current encounter, if any. */
  encounter: EncounterState | null;
  /** Current round, if any. */
  round: RoundState | null;
  /** Rounds finished. */
  rounds: number;
  /** Set once the run has ended, or on the reveal that kills the boss. */
  outcome: RunOutcome | null;
  /** The map and current stop. Missing on sandbox runs. */
  campaign?: CampaignState;
}

/** Where an item is kept. */
export interface ItemPlace {
  /** Equipped or packed. */
  readonly area: 'slots' | 'pack';
  /** Position in that area; the area's length means a new place at its end. */
  readonly index: number;
}

/** Input to `step()`. */
export type AdventureCommand =
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
    readonly type: 'use-consumable';
    /** Consumable index. */
    readonly index: number;
  }
  | {
    /** Moves an item between rounds, swapping with whatever is there. */
    readonly type: 'move-item';
    readonly from: ItemPlace;
    readonly to: ItemPlace;
  }
  | {
    /** Throws an item away between rounds. */
    readonly type: 'drop-item';
    readonly from: ItemPlace;
  }
  | {
    /** Leaves an unfinished fight between rounds: the enemy lands its telegraphed hit and keeps its loot. */
    readonly type: 'flee';
  }
  | {
    /** Gives up the run at any time. */
    readonly type: 'abandon';
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
  | 'no-target'
  | 'no-room'
  | 'no-supplies'
  | 'bad-node'
  | 'unavailable';

/** Something that happened, in order. Data only, no rendering instructions. */
export type AdventureEvent =
  | { readonly type: 'command-rejected'; readonly command: string; readonly reason: RejectReason }
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
    readonly outcome: 'defeated' | 'completed' | 'failed' | 'cleared' | 'fled' | 'escaped';
  }
  | { readonly type: 'consumable-used'; readonly item: string; readonly effect: ConsumableDef['effect']; readonly value: number }
  | { readonly type: 'item-moved'; readonly from: ItemPlace; readonly to: ItemPlace }
  | { readonly type: 'item-dropped'; readonly item: string }
  | { readonly type: 'experience-gained'; readonly slot: number; readonly item: string; readonly xp: number; readonly level: number }
  | { readonly type: 'item-leveled'; readonly item: string; readonly level: number }
  | { readonly type: 'enemy-enraged'; readonly encounter: string; readonly rage: number }
  | { readonly type: 'enemy-fled'; readonly encounter: string }
  | { readonly type: 'player-fled'; readonly encounter: string }
  | { readonly type: 'moved'; readonly node: number; readonly kind: NodeKind }
  | { readonly type: 'loot-dropped'; readonly loot: readonly Goods[]; readonly supplies: number }
  | { readonly type: 'goods-taken'; readonly item: string; readonly price: number }
  | { readonly type: 'item-sold'; readonly item: string; readonly price: number }
  | { readonly type: 'rested'; readonly choice: 'heal' | 'upgrade' }
  | { readonly type: 'event-answered'; readonly event: string; readonly option: number }
  | { readonly type: 'round-ended'; readonly outcome: 'completed' | 'failed' | 'abandoned' }
  | { readonly type: 'run-ended'; readonly outcome: RunOutcome };

/** What `step()` returns. */
export interface EngineResult {
  /** The new state, or the same object if the command was rejected. */
  readonly state: AdventureState;
  /** What happened, in order. */
  readonly events: readonly AdventureEvent[];
}
