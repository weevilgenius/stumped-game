import type { Controller } from './controller';
import { bandOf, currentNode, eventAt, routeChoices } from './adventure/engine';
import type { AdventureCommand, CharacterDef, ItemDef, Offer, RouteNode, SlotState } from './adventure/engine';
import { MAX_ITEM_LEVEL, STARTERS, XP_PER_LEVEL } from './adventure/content/campaign';
import { LOADOUTS, LOADOUT_DESCRIPTIONS } from './adventure/content/loadouts';

/** Controller surface used by the scene's presentation model. */
export type AdventureScreenController = Pick<Controller, 'adventure' | 'adventureUnlocks' | 'adventureCommand' | 'setReady' | 'showMenu' | 'selectAdventure' | 'startAdventure' | 'playAdventure' | 'abandonAdventure'>;

/** Run management destinations rendered by the adventure Phaser scene. */
export type AdventurePanel = 'here' | 'gear' | 'map';
/** One canvas action, shared with its semantic keyboard control. */
export interface AdventureAction {
  /** Stable identity for focus and input routing. */
  name: string;
  /** Visible and spoken label. */
  label: string;
  /** Whether the action is currently unavailable. */
  disabled?: boolean;
  /** Applies the action through the controller or changes the current view. */
  onSelect: () => void;
  /** Optional item inspection on a sustained pointer press. */
  onHold?: () => void;
}
/** A compact scene card; exact item details have their own cards. */
export interface AdventureCard {
  /** Stable identity. */
  id: string;
  /** Heading. */
  title: string;
  /** Explanation or exact values. */
  body: string;
  /** Palette swatches, numbered consistently with the puzzle. */
  colors?: readonly number[];
  /** Card controls. */
  actions?: AdventureAction[];
  /** Optional interaction with the card itself. */
  press?: AdventureAction;
  /** Highlight a selected character or current item. */
  selected?: boolean;
}
/** Local presentation state; never changes the campaign rules. */
export interface AdventureScreenState {
  /** Active run management screen. */
  panel: AdventurePanel;
  /** Show concept-probe loadouts instead of campaign characters. */
  sandbox: boolean;
  /** Selected new-run character. */
  character: string;
  /** Leftmost column of the route window. */
  mapColumn: number;
  /** Nested inspection or equipment operation. */
  detail: { type: 'item'; slot: number; pack?: boolean } | { type: 'character' } | { type: 'offer'; offer: string } | { type: 'replace'; offer: string } | { type: 'equip'; pack: number } | null;
}
/** A whole screen's content, independent of Phaser and DOM. */
export interface AdventurePage {
  /** Screen heading. */
  title: string;
  /** Brief status or instructions. */
  status: string;
  /** Header navigation. */
  back: AdventureAction;
  /** Destinations in this screen group. */
  tabs: AdventureAction[];
  /** Current tab. */
  selectedTab: string;
  /** Body cards, paginated by the renderer. */
  cards: AdventureCard[];
  /** Optional forward route diagram. */
  map?: readonly RouteNode[];
  /** Map node activation, shared with keyboard controls. */
  travel?: (node: RouteNode) => void;
  /** Legally reachable map nodes. */
  reachable?: readonly string[];
  /** Visited map nodes. */
  visited?: readonly string[];
  /** Current node. */
  current?: string | null;
  /** Main footer action. */
  primary?: AdventureAction;
  /** Secondary footer action. */
  secondary?: AdventureAction;
}

/** Fresh view state when opening selection or a run. */
export function newAdventureScreen(): AdventureScreenState {
  return { panel: 'map', sandbox: false, character: 'ranger', mapColumn: 0, detail: null };
}
/** Readable content names shared across the adventure screens. */
export function adventureName(id: string): string {
  return id.replaceAll('-', ' ').replace(/^./, (letter) => letter.toUpperCase());
}
const action = (name: string, label: string, onSelect: () => void, disabled = false): AdventureAction => ({ name, label, onSelect, disabled });
const itemBands = (item: ItemDef, level = 0): string => `${item.bands.map((band) => bandOf(item.bands, band.min, level).value).join(' / ')} by size band`;
const itemCards = (item: ItemDef, slot?: SlotState): AdventureCard[] => [
  { id: 'item-effects', title: `${adventureName(item.id)} · ${adventureName(item.effect)}`,
    body: item.bands.map((band, index) => `${band.min}${item.bands[index + 1] ? `–${item.bands[index + 1].min - 1}` : '+'} squares: ${bandOf(item.bands, band.min, slot?.level).value}`).join('\n') },
  { id: 'item-timing', title: 'Colors and timing', colors: item.colors,
    body: `${item.charge ? 'All colors charge together' : 'Any matching color'}\n${item.cooldown ? `Cooldown: ${item.cooldown} turns` : 'No cooldown'}` },
  ...(slot ? [{ id: 'item-growth', title: 'Manage equipment', body: `Level ${slot.level ?? 0}/${MAX_ITEM_LEVEL} · Experience ${slot.experience ?? 0}/${XP_PER_LEVEL}\nCharge: ${slot.chargedAmount} squares` }] : []),
];

/** Build selection, map, inventory and location screens using the existing controller actions. */
export function adventurePage(controller: AdventureScreenController, view: AdventureScreenState, selection: boolean, onChange: () => void): AdventurePage {
  const name = adventureName;
  const navigate = (panel: AdventurePanel): void => { view.panel = panel; view.detail = null; onChange(); };
  const send = (command: AdventureCommand): void => controller.adventureCommand(command);
  const home = action('home', 'Home', controller.showMenu);
  const back = action('back', 'Back', () => { view.detail = null; onChange(); });
  const characters = view.sandbox ? LOADOUTS : STARTERS;
  const character = characters.find((entry) => entry.id === view.character) ?? characters[0];
  const locked = (definition: CharacterDef): boolean => !view.sandbox && !controller.adventureUnlocks.includes(definition.id);
  if (selection) {
    const page: AdventurePage = {
      title: 'Start an adventure', status: `Selected: ${name(character.id)}. Start confirms replacement.`, back: view.detail ? back : home,
      tabs: [false, true].map((sandbox) => action(sandbox ? 'sandbox' : 'campaign', sandbox ? 'Sandbox' : 'Campaign', () => {
        view.sandbox = sandbox; view.character = (sandbox ? LOADOUTS : STARTERS)[0].id; view.detail = null; onChange();
      })), selectedTab: view.sandbox ? 'sandbox' : 'campaign',
      cards: characters.map((definition) => ({ id: definition.id, title: `${name(definition.id)}${locked(definition) ? ' · Locked' : ''}`,
        body: `${definition.health} health · ${definition.loadout.map((item) => name(item.id)).join(' / ')}\n${LOADOUT_DESCRIPTIONS[definition.id] ?? (definition.id === 'herbalist' ? 'Healing replaces defense. Win a campaign to unlock.' : 'Two starting abilities. Find equipment, widen your colors, and reach the Warden.')}`,
        colors: [...new Set(definition.loadout.flatMap((item) => item.colors))], selected: character.id === definition.id,
        actions: [action(`select-${definition.id}`, `Choose ${name(definition.id)}`, () => { view.character = definition.id; onChange(); }, locked(definition)),
          action(`inspect-${definition.id}`, 'Details', () => { view.character = definition.id; view.detail = { type: 'character' }; onChange(); })],
      })),
      primary: action('start-run', view.sandbox ? 'Start sandbox' : 'Start campaign', () => { void controller.startAdventure(character.id); }, locked(character)),
    };
    if (view.detail) {
      page.title = name(character.id); page.tabs = [];
      page.cards = [{ id: 'character', title: `${character.health} starting health`, body: LOADOUT_DESCRIPTIONS[character.id] ?? 'A bounded 9×9 medium adventure. Victory unlocks a new starting character.' }, ...character.loadout.flatMap((item) => itemCards(item))];
    }
    return page;
  }

  const state = controller.adventure?.state;
  if (!state) return { title: 'Adventure', status: 'No run yet.', back: home, tabs: [], selectedTab: '', cards: [], primary: action('new-run', 'Choose a campaign', controller.selectAdventure) };
  const campaign = state.campaign;
  const between = state.phase === 'between';
  const ended = state.phase === 'ended';
  const node = currentNode(state);
  const supplies = state.resources.supplies ?? 0;
  const page: AdventurePage = {
    title: ended ? 'Run summary' : name(state.character), status: `Health ${Math.max(0, state.health)}/${state.maxHealth} · Supplies ${supplies}${campaign && node ? ` · Step ${node.column + 1}/${Math.max(...campaign.map.map((entry) => entry.column)) + 1}` : ''}`,
    back: view.detail ? back : home, selectedTab: view.panel,
    tabs: (['here', 'gear', 'map'] as AdventurePanel[]).map((panel, index) => action(panel, ['Here', 'Gear', 'Map'][index], () => navigate(panel))),
    cards: [],
    primary: ended ? action('new-run', 'New campaign', controller.selectAdventure)
      : state.phase === 'round' || state.encounter || !campaign ? action('play', state.phase === 'round' ? 'Resume puzzle' : 'Next puzzle', () => { void controller.playAdventure(); })
        : campaign.active ? action('location-choice', 'Visit location', () => navigate('here')) : action('choose-route', 'Choose route', () => navigate('map')),
    secondary: ended ? undefined : action('abandon', 'Give up', () => { void controller.abandonAdventure(); }),
  };
  if (ended) {
    page.tabs = [];
    page.cards = [{ id: 'summary', title: { victory: 'The Warden is defeated!', death: 'You were defeated', failed: 'Stumped', abandoned: 'You gave up' }[state.outcome ?? 'abandoned'],
      body: `${state.rounds} completed puzzles${campaign ? `\n${campaign.imported ? 'Since import: ' : ''}${campaign.wins} fights won · ${campaign.fled} escaped\n${campaign.gear} gear acquired · ${campaign.upgrades} upgrades\nSupplies ${campaign.earned} earned / ${campaign.spent} spent${campaign.victory ? '\nHerbalist unlocked for future campaigns.' : ''}` : ''}` }];
    return page;
  }
  const inspect = (slot: number, pack = false): void => { view.detail = { type: 'item', slot, pack }; onChange(); };
  const offerCards = (offers: readonly Offer[], shop: boolean): AdventureCard[] => offers.map((offer) => ({ id: offer.id, title: `${name(offer.item?.id ?? offer.potion!.id)}${shop ? ` · ${offer.price} supplies` : ''}`,
    body: offer.item ? `${name(offer.item.effect)} · ${offer.item.charge ? 'Charged' : 'Immediate'}\n${itemBands(offer.item, offer.slot?.level)}` : `Instant ${offer.potion!.value} ${offer.potion!.id.split('-')[0]}. No tactical turn.`,
    colors: offer.item?.colors,
    actions: [action(`inspect-offer-${offer.id}`, 'Details', () => { view.detail = { type: 'offer', offer: offer.id }; onChange(); }),
      action(`take-${offer.id}`, shop ? 'Buy' : 'Take', () => send(shop ? { type: 'buy', offer: offer.id } : { type: 'take-loot', offer: offer.id }),
        !between || !!state.encounter || supplies < offer.price || (offer.item ? state.slots.length >= 4 && campaign!.pack.length >= 3 : campaign!.potions.length >= 3)),
      ...(offer.item ? [action(`replace-${offer.id}`, 'Replace gear', () => { view.detail = { type: 'replace', offer: offer.id }; onChange(); }, !between || !!state.encounter || !state.slots.length)] : [])],
  }));
  if (view.detail?.type === 'offer') {
    const offerId = view.detail.offer;
    const offer = [...(campaign?.loot ?? []), ...(campaign?.stock ?? [])].find((offer) => offer.id === offerId);
    if (!offer) { view.detail = null; return adventurePage(controller, view, false, onChange); }
    page.title = name(offer.item?.id ?? offer.potion!.id); page.tabs = [];
    page.cards = offer.item ? itemCards(offer.item, offer.slot) : [{ id: 'potion', title: page.title, body: `Instant ${offer.potion!.value} ${offer.potion!.id.split('-')[0]}. No tactical turn.` }];
    return page;
  }
  if (view.detail?.type === 'item') {
    const { slot: index, pack } = view.detail;
    const slot = pack ? campaign?.pack[index] : state.slots[index];
    if (!slot) { view.detail = null; return adventurePage(controller, view, false, onChange); }
    page.title = name(slot.item.id); page.tabs = [];
    page.cards = itemCards(slot.item, slot);
    page.cards[2].body += `\nReady in ${Math.max(0, slot.readyAt - (state.round?.turn ?? 0) - 1)} reveals${slot.item.charge ? ` · Needs colors ${slot.item.colors.filter((color) => !slot.charged.includes(color)).map((color) => color + 1).join(', ')}` : ''}`;
    page.cards[2].actions = pack ? [action('equip', 'Equip / swap', () => { view.detail = { type: 'equip', pack: index }; onChange(); }, !between),
      ...(node?.kind === 'shop' && campaign?.active ? [action('sell', `Sell for ${Math.floor((slot.item.price ?? 25) / 2)}`, () => { send({ type: 'sell', pack: index }); view.detail = null; onChange(); }, !between || !!state.encounter)] : [])]
      : [action('ready', slot.ready ? 'Unready' : 'Ready', () => controller.setReady(index, !slot.ready)),
        ...(campaign ? [action('pack', 'Put in pack', () => { send({ type: 'unequip', slot: index }); view.detail = null; onChange(); }, !between || campaign.pack.length >= 3)] : []),
        action('earlier', 'Move earlier', () => {
          const order = state.slots.map((_, i) => i); [order[index], order[index - 1]] = [order[index - 1], order[index]];
          send({ type: 'set-priority', slots: order }); view.detail = { type: 'item', slot: index - 1 }; onChange();
        }, !between || index === 0)];
    if (campaign) page.cards[2].actions.push(action('drop', 'Leave here as loot', () => { send({ type: 'drop', slot: index, pack }); view.detail = null; onChange(); }, !between));
    return page;
  }
  if (view.detail?.type === 'equip' || view.detail?.type === 'replace') {
    const detail = view.detail;
    page.title = detail.type === 'equip' ? 'Choose equipment slot' : 'Replace equipped gear'; page.tabs = [];
    page.cards = state.slots.map((slot, index) => ({ id: `slot-${index}`, title: `${index + 1}. ${name(slot.item.id)}`, colors: slot.item.colors,
      body: `${itemBands(slot.item, slot.level)} · Level ${slot.level ?? 0}/${MAX_ITEM_LEVEL}\n${detail.type === 'equip' ? 'Swap the whole item with the pack. Timers and charge stay with it.' : 'This item stays here as loot.'}`,
      actions: [action(`slot-${index}`, detail.type === 'equip' ? 'Swap here' : 'Replace this item', () => {
        send(detail.type === 'equip' ? { type: 'equip', pack: detail.pack, slot: index } : { type: campaign?.stock.some((offer) => offer.id === detail.offer) ? 'buy' : 'take-loot', offer: detail.offer, replace: index }); view.detail = null; onChange();
      }, !between || (detail.type === 'replace' && !!state.encounter))],
    }));
    if (detail.type === 'equip' && state.slots.length < 4) page.cards.push({ id: 'empty-slot', title: 'Empty equipment slot', body: 'Equip without replacing an item.', actions: [action('empty-slot', 'Equip here', () => { send({ type: 'equip', pack: detail.pack, slot: state.slots.length }); view.detail = null; onChange(); }, !between)] });
    return page;
  }
  if (view.panel === 'map') {
    if (campaign) {
      page.map = campaign.map;
      page.current = campaign.node; page.visited = campaign.visited; page.reachable = routeChoices(state).map((entry) => entry.id);
      page.travel = (entry) => { send({ type: 'travel', node: entry.id }); view.mapColumn = Math.max(0, entry.column - 1); navigate('here'); };
    } else page.cards = [{ id: 'sandbox', title: 'Sandbox playtest', body: 'The current wolf continues between puzzles. Defeating it starts a new wolf after harvest.' }];
  } else if (view.panel === 'gear') {
    page.title = 'Equipment';
    page.cards = state.slots.map((slot, index) => ({ id: `equipped-${slot.item.instance ?? slot.item.id}`, title: `${index + 1}. ${name(slot.item.id)} · ${slot.ready ? 'Ready' : 'Unready'}`,
      body: `${name(slot.item.effect)} · ${itemBands(slot.item, slot.level)}\nLevel ${slot.level ?? 0}/${MAX_ITEM_LEVEL} · Tap to toggle readiness. Hold for details.`, colors: slot.item.colors,
      press: { ...action(`ready-${index}`, `${name(slot.item.id)}, ${slot.ready ? 'ready' : 'not ready'}`, () => controller.setReady(index, !slot.ready)), onHold: () => inspect(index) },
      actions: [action(`inspect-slot-${index}`, 'Inspect / manage', () => inspect(index))],
    }));
    page.cards.push(...(campaign?.pack ?? []).map((slot, index) => ({ id: `packed-${slot.item.instance ?? slot.item.id}`, title: `Pack: ${name(slot.item.id)}`, body: `${name(slot.item.effect)} · ${itemBands(slot.item, slot.level)}\nLevel ${slot.level ?? 0}/${MAX_ITEM_LEVEL} · Reserve item; does not receive pulses.`, colors: slot.item.colors, actions: [action(`inspect-pack-${index}`, 'Inspect / manage', () => inspect(index, true))] })));
    page.cards.push(...(campaign?.potions ?? []).map((potion, index) => ({ id: `potion-${index}`, title: name(potion.id), body: `Instant ${potion.value} ${potion.id.split('-')[0]}. No tactical turn.`, actions: [action(`use-potion-${index}`, 'Use potion', () => send({ type: 'use-potion', potion: index }), potion.id !== 'healing-potion' && (state.encounter?.type !== 'enemy' || state.encounter.phase !== 'active'))] })));
  } else {
    page.title = node ? name(node.kind) : name(state.character);
    const encounter = state.encounter;
    if (encounter) {
      page.cards.push({ id: 'encounter', title: name(encounter.def.id), colors: encounter.def.scavenge.flatMap((rule) => rule.colors),
        body: node?.kind === 'forage' ? 'A single puzzle of harvest. Every color becomes supplies, and readied forage gear adds its yield. Other gear stays idle and earns no experience.'
          : encounter.phase === 'scavenge' ? 'Harvesting. Readied gear takes matching colors as experience; healing and forage gear still work. Unready gear to collect harvest colors as supplies.'
            : encounter.type === 'enemy' ? `${Math.max(0, encounter.health)}/${encounter.def.health} health\nNext hit: ${encounter.def.intents[encounter.intent].damage} in ${encounter.countdown} reveals. Your pulse lands first.\n${encounter.def.budget?.fleeAfter ? `Escapes after ${encounter.def.budget.fleeAfter} puzzles.` : `Enrages by ${encounter.def.budget?.enrage ?? 0} damage per extra puzzle.`}` : 'A single puzzle of harvest. Every color becomes supplies.',
        actions: encounter.type === 'enemy' && encounter.phase === 'active' ? [action('flee', `Flee · take ${encounter.def.intents[encounter.intent].damage} damage`, () => send({ type: 'flee' }), !between || !!encounter.def.budget?.boss)] : [],
      });
    }
    if (campaign?.loot.length) page.cards.push({ id: 'loot-heading', title: 'Loot here', body: 'Take what you need before moving on. Inspect gear to compare it; replaced and dropped gear stays here.' }, ...offerCards(campaign.loot, false));
    if (campaign?.active && node?.kind === 'shop') {
      page.cards.push({ id: 'shop', title: 'Shop', body: 'Fixed stock. Potions 10–15 supplies. Sell packed gear from Gear.', actions: [action('shop-heal', 'Heal · 2 per health', () => send({ type: 'shop-heal' }), state.health >= state.maxHealth || supplies < 2), action('leave-shop', 'Leave shop', () => send({ type: 'choose', choice: 'leave' }))] }, ...offerCards(campaign.stock, true));
    } else if (campaign?.active && node?.kind === 'rest') {
      page.cards.push({ id: 'rest', title: 'A quiet rest', body: 'Heal, or improve one item. Choose once, without a puzzle.', actions: [action('rest-heal', `Heal ${Math.ceil(state.maxHealth / 3)} health`, () => send({ type: 'choose', choice: 'rest' })), action('leave-rest', 'Leave', () => send({ type: 'choose', choice: 'leave' }))] },
        ...state.slots.map((slot, index) => ({ id: `improve-${index}`, title: name(slot.item.id), body: `Level ${slot.level ?? 0}/${MAX_ITEM_LEVEL}. Improve the effect by one band step.`, colors: slot.item.colors, actions: [action(`improve-${index}`, 'Improve this item', () => send({ type: 'choose', choice: 'upgrade', slot: index }), (slot.level ?? 0) >= MAX_ITEM_LEVEL)] })));
    } else if (campaign?.active && node?.kind === 'event') {
      const event = eventAt(state)!;
      page.cards.push({ id: 'event', title: name(event.id), body: event.text, actions: event.options.map((option, index) => action(`event-${index}`, option.label, () => send({ type: 'choose', choice: 'event', option: index }), (option.supplies ?? 0) > supplies)) });
    }
    if (!encounter && (!campaign?.active || !node)) page.cards.push({ id: 'move-on', title: 'Ready to move on', body: 'Choose a connected route. Moving on leaves unclaimed loot behind.', actions: [action('route-tab', 'Open map', () => navigate('map'))] });
  }
  return page;
}
