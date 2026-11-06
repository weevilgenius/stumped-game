import { MAX_ITEM_LEVEL } from './adventure/content/campaign';
import { createCampaign, deriveSeed } from './adventure/engine/campaign';
import type { AdventureState, ItemDef, Offer, Potion, RouteNode, SlotState } from './adventure/engine';
import type { AdventureSave } from './adventurePlay';

interface LegacySlot extends SlotState {
  /** First prototype's experience counter. */
  xp?: number;
  /** Encounter in which it last leveled. */
  leveledIn?: number;
}

interface LegacyGoods {
  /** Equipment or single-use item. */
  kind: 'gear' | 'consumable';
  /** The recorded definition. */
  item: ItemDef & { effect: ItemDef['effect']; value?: number };
  /** A dropped item retains its state. */
  slot?: LegacySlot;
}

interface LegacyCampaign {
  /** Original random seed. */
  seed: number;
  /** Numeric node addresses used by PR #79. */
  nodes: (Omit<RouteNode, 'id' | 'hidden' | 'next'> & { next: number[] })[];
  /** Current node index. */
  at: number | null;
  /** Entered nodes. */
  visited: number[];
  /** Unclaimed drops. */
  loot: LegacyGoods[];
  /** Stock remaining at the current shop. */
  shop: { stock: ({ goods: LegacyGoods; price: number } | null)[] } | null;
  /** Unanswered event. */
  event: string | null;
  /** Unused rest. */
  rest: boolean;
}

/**
 * Import either phase-7 prototype without discarding its original journal.
 * The converted state becomes a new replay baseline; historical commands stay
 * under `previous` because their rules and command formats differ.
 */
export function migrateAdventure(value: Record<string, unknown>): AdventureSave {
  const save = value as unknown as AdventureSave;
  save.previous = structuredClone(value);
  const state = save.state;
  const legacy = state as unknown as Omit<AdventureState, 'campaign'> & { campaign?: LegacyCampaign; pack?: LegacySlot[]; consumables?: LegacyGoods['item'][]; fights?: number };
  const first = legacy.campaign && Array.isArray(legacy.campaign.nodes);
  if (first) {
    const old = legacy.campaign!;
    const campaign = createCampaign(old.seed);
    campaign.version = 0;
    campaign.imported = true;
    campaign.map = old.nodes.map((node, index) => ({ ...node, id: String(index), hidden: false, next: node.next.map(String) }));
    campaign.node = old.at === null ? null : String(old.at);
    campaign.visited = old.visited.map(String);
    campaign.active = !!state.encounter || !!old.shop || !!old.event || old.rest;
    campaign.event = old.event ?? undefined;
    campaign.pack = legacy.pack ?? [];
    campaign.potions = (legacy.consumables ?? []).map((item): Potion => ({
      id: item.effect === 'heal' ? 'healing-potion' : item.effect === 'block' ? 'block-potion' : 'damage-potion', value: item.value!,
    }));
    const slot = (entry: LegacySlot, id: string): LegacySlot => {
      Object.assign(entry, { item: { ...entry.item, instance: entry.item.instance ?? id }, level: Math.min(MAX_ITEM_LEVEL, entry.level ?? 0), experience: entry.xp ?? 0 });
      if (entry.leveledIn === legacy.fights) campaign.leveled.push(entry.item.instance!);
      return entry;
    };
    state.slots.forEach((entry, index) => slot(entry, `import/equipped/${index}`));
    campaign.pack.forEach((entry, index) => slot(entry, `import/pack/${index}`));
    const offer = (goods: LegacyGoods, id: string, price = 0): Offer => goods.kind === 'gear'
      ? { id, price, item: { ...goods.item, instance: goods.item.instance ?? id }, potion: null, slot: goods.slot ? slot(goods.slot, id) : undefined }
      : { id, price, item: null, potion: { id: goods.item.effect === 'heal' ? 'healing-potion' : goods.item.effect === 'block' ? 'block-potion' : 'damage-potion', value: goods.item.value! } };
    campaign.loot = old.loot.map((goods, index) => offer(goods, `import/loot/${index}`));
    campaign.stock = old.shop?.stock.flatMap((entry, index) => entry ? [offer(entry.goods, `import/stock/${index}`, entry.price)] : []) ?? [];
    campaign.victory = state.outcome === 'victory';
    campaign.rng = deriveSeed(old.seed, `loot/${campaign.node}`);
    const encounter = state.encounter as unknown as { type: string; def: { harvest?: number[]; enrage?: number; flee?: number; boss?: boolean }; rounds?: number; rage?: number } | null;
    campaign.encounterRounds = Math.max(0, (encounter?.rounds ?? 0) - Number(state.phase === 'round'));
    if (encounter?.type === 'forage') {
      const def = { type: 'objective' as const, id: 'treasure-grove', goal: 1, accepts: [], deadline: 100, failDamage: 0,
        scavenge: [{ colors: encounter.def.harvest ?? [], resource: 'supplies', bands: [{ min: 1, value: 1 }, { min: 8, value: 2 }] }] };
      state.encounter = { type: 'objective', def, phase: 'scavenge', progress: 1, countdown: 100 };
    } else if (state.encounter?.type === 'enemy') {
      const enemy = state.encounter;
      Object.assign(enemy, { def: { ...enemy.def,
        budget: { enrage: encounter?.def.enrage, fleeAfter: encounter?.def.flee, boss: encounter?.def.boss },
        intents: enemy.def.intents.map((intent) => ({ ...intent, damage: intent.damage + (encounter?.rage ?? 0) })),
        scavenge: [{ colors: encounter?.def.harvest ?? [], resource: 'supplies', bands: [{ min: 1, value: 1 }, { min: 8, value: 2 }, { min: 15, value: 3 }] }],
      } });
    }
    state.campaign = campaign;
  } else if (state.campaign) {
    // PR #80 baked levels into these six catalog definitions. Restore their base
    // bands before the new engine applies levels at activation time.
    const values: Record<string, number[]> = { blade: [3, 4, 6, 9], buckler: [4, 5, 7, 9], herbs: [2, 3, 5, 7], sling: [2, 3, 5, 7], 'storm-staff': [5, 9, 13, 18], satchel: [1, 2, 3, 4] };
    for (const entry of [...state.slots, ...state.campaign.pack]) {
      const original = save.start.slots.find((initial) => initial.item.id === entry.item.id)?.item;
      const base = values[entry.item.id];
      const tier = Math.max(0, Math.round(((entry.item.price ?? 25) - 25) / 10));
      const bands = original?.bands ?? base?.map((amount, index) => ({ min: [1, 4, 8, 15][index], value: amount + tier }));
      if (bands) Object.assign(entry, { item: { ...entry.item, bands, tier: entry.item.price ? tier + 1 : undefined } });
    }
    state.campaign.version = 0;
  }
  save.version = 2;
  save.view = state.phase === 'round' ? 'adventure' : 'campaign';
  save.start = structuredClone(state);
  save.log = [];
  save.times = [];
  // The complete original records remain in `previous`, including sparse #79 records.
  save.puzzles = (save.puzzles ?? []).filter((record) => Array.isArray(record.rules));
  return save;
}
