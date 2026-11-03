import type { Controller } from './controller';
import { currentNode, routeChoices } from './adventure/engine';
import type { AdventureCommand, CharacterDef, ItemDef, Offer, RouteNode, SlotState } from './adventure/engine';
import { STARTERS } from './adventure/content/campaign';
import { LOADOUTS, LOADOUT_DESCRIPTIONS } from './adventure/content/loadouts';

/** Controller surface used by the scene's presentation model. */
export type AdventureScreenController = Pick<Controller, 'adventure' | 'adventureUnlocks' | 'adventureCommand' | 'setReady' | 'showMenu' | 'selectAdventure' | 'startAdventure' | 'playAdventure' | 'abandonAdventure'>;

/** Run management destinations rendered by the adventure Phaser scene. */
export type AdventurePanel = 'route' | 'gear' | 'loot' | 'location' | 'potions';
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
  /** Page of cards. */
  page: number;
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
  return { panel: 'route', sandbox: false, character: 'ranger', page: 0, mapColumn: 0, detail: null };
}
/** Readable content names shared across the adventure screens. */
export function adventureName(id: string): string {
  return id.replaceAll('-', ' ').replace(/^./, (letter) => letter.toUpperCase());
}
const action = (name: string, label: string, onSelect: () => void, disabled = false): AdventureAction => ({ name, label, onSelect, disabled });
const itemCards = (item: ItemDef, slot?: SlotState): AdventureCard[] => [
  { id: 'item-effects', title: `${adventureName(item.id)} · ${adventureName(item.effect)}`,
    body: item.bands.map((band, index) => `${band.min}${item.bands[index + 1] ? `–${item.bands[index + 1].min - 1}` : '+'} squares: ${band.value}`).join('\n') },
  { id: 'item-timing', title: 'Colors and timing', colors: item.colors,
    body: `${item.charge ? 'All colors charge together' : 'Any matching color'}\n${item.cooldown ? `Cooldown: ${item.cooldown} turns` : 'No cooldown'}` },
  ...(slot ? [{ id: 'item-growth', title: 'Manage equipment', body: `Level ${slot.level ?? 0}/3 · Experience ${slot.experience ?? 0}/24\nCharge: ${slot.chargedAmount} squares` }] : []),
];

/** Build selection, map, inventory and location screens using the existing controller actions. */
export function adventurePage(controller: AdventureScreenController, view: AdventureScreenState, selection: boolean, onChange: () => void): AdventurePage {
  const name = adventureName;
  const navigate = (panel: AdventurePanel): void => { view.panel = panel; view.detail = null; view.page = 0; onChange(); };
  const send = (command: AdventureCommand): void => controller.adventureCommand(command);
  const home = action('home', 'Home', controller.showMenu);
  const back = action('back', 'Back', () => { view.detail = null; view.page = 0; onChange(); });
  const characters = view.sandbox ? LOADOUTS : STARTERS;
  const character = characters.find((entry) => entry.id === view.character) ?? characters[0];
  const locked = (definition: CharacterDef): boolean => !view.sandbox && !controller.adventureUnlocks.includes(definition.id);
  if (selection) {
    const page: AdventurePage = {
      title: 'Start an adventure', status: `Selected: ${name(character.id)}. Start confirms replacement.`, back: view.detail ? back : home,
      tabs: [false, true].map((sandbox) => action(sandbox ? 'sandbox' : 'campaign', sandbox ? 'Sandbox' : 'Campaign', () => {
        view.sandbox = sandbox; view.character = (sandbox ? LOADOUTS : STARTERS)[0].id; view.page = 0; view.detail = null; onChange();
      })), selectedTab: view.sandbox ? 'sandbox' : 'campaign',
      cards: characters.map((definition) => ({ id: definition.id, title: `${name(definition.id)}${locked(definition) ? ' · Locked' : ''}`,
        body: `${definition.health} health · ${definition.loadout.map((item) => name(item.id)).join(' / ')}\n${LOADOUT_DESCRIPTIONS[definition.id] ?? (definition.id === 'herbalist' ? 'Healing replaces defense. Win a campaign to unlock.' : 'Two starting abilities. Find equipment, widen your colors, and reach the Warden.')}`,
        colors: [...new Set(definition.loadout.flatMap((item) => item.colors))], selected: character.id === definition.id,
        actions: [action(`select-${definition.id}`, `Choose ${name(definition.id)}`, () => { view.character = definition.id; onChange(); }, locked(definition)),
          action(`inspect-${definition.id}`, 'Details', () => { view.character = definition.id; view.detail = { type: 'character' }; view.page = 0; onChange(); })],
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
    title: ended ? 'Run summary' : name(state.character), status: `Health ${Math.max(0, state.health)}/${state.maxHealth} · Supplies ${supplies}${campaign && node ? ` · Step ${node.column + 1}/15` : ''}`,
    back: view.detail ? back : home, selectedTab: view.panel,
    tabs: (['route', 'gear', 'loot', 'location', 'potions'] as AdventurePanel[]).map((panel, index) => action(panel, ['Route', 'Gear', 'Loot', node?.kind === 'shop' ? 'Shop' : 'Camp', 'Potions'][index], () => navigate(panel))),
    cards: [],
    primary: ended ? action('new-run', 'New campaign', controller.selectAdventure)
      : state.phase === 'round' || state.encounter || !campaign ? action('play', state.phase === 'round' ? 'Resume puzzle' : 'Next puzzle', () => { void controller.playAdventure(); })
        : campaign.active ? action('location-choice', 'Visit location', () => navigate('location')) : action('choose-route', 'Choose route', () => navigate('route')),
    secondary: ended ? undefined : action('abandon', 'Give up', () => { void controller.abandonAdventure(); }),
  };
  if (ended) {
    page.tabs = [];
    page.cards = [{ id: 'summary', title: { victory: 'The Warden is defeated!', death: 'You were defeated', failed: 'Stumped', abandoned: 'You gave up' }[state.outcome ?? 'abandoned'],
      body: `${state.rounds} completed puzzles${campaign ? `\n${campaign.wins} fights won · ${campaign.fled} escaped\n${campaign.gear} gear acquired · ${campaign.upgrades} upgrades\nSupplies ${campaign.earned} earned / ${campaign.spent} spent${campaign.victory ? '\nHerbalist unlocked for future campaigns.' : ''}` : ''}` }];
    return page;
  }
  const inspect = (slot: number, pack = false): void => { view.detail = { type: 'item', slot, pack }; view.page = 0; onChange(); };
  const addOffers = (offers: readonly Offer[], shop: boolean): void => {
    page.cards = offers.map((offer) => ({ id: offer.id, title: `${name(offer.item?.id ?? offer.potion!.id)}${shop ? ` · ${offer.price} supplies` : ''}`,
      body: offer.item ? `${name(offer.item.effect)} · ${offer.item.charge ? 'Charged' : 'Immediate'}\n${offer.item.bands.map((band) => band.value).join(' / ')} by size band` : `Instant ${offer.potion!.value} ${offer.potion!.id.split('-')[0]}. No tactical turn.`,
      colors: offer.item?.colors,
      actions: [action(`inspect-offer-${offer.id}`, 'Details', () => { view.detail = { type: 'offer', offer: offer.id }; view.page = 0; onChange(); }),
        action(`take-${offer.id}`, shop ? 'Buy' : 'Take', () => send(shop ? { type: 'buy', offer: offer.id } : { type: 'take-loot', offer: offer.id }),
          !between || !!state.encounter || supplies < offer.price || (offer.item ? state.slots.length >= 4 && campaign!.pack.length >= 3 : campaign!.potions.length >= 3)),
        ...(!shop && offer.item ? [action(`replace-${offer.id}`, 'Replace gear', () => { view.detail = { type: 'replace', offer: offer.id }; view.page = 0; onChange(); }, !between || !!state.encounter || !state.slots.length)] : [])],
    }));
  };
  if (view.detail?.type === 'offer') {
    const offerId = view.detail.offer;
    const offer = [...(campaign?.loot ?? []), ...(campaign?.stock ?? [])].find((offer) => offer.id === offerId);
    if (!offer) { view.detail = null; return adventurePage(controller, view, false, onChange); }
    page.title = name(offer.item?.id ?? offer.potion!.id); page.tabs = [];
    page.cards = offer.item ? itemCards(offer.item) : [{ id: 'potion', title: page.title, body: `Instant ${offer.potion!.value} ${offer.potion!.id.split('-')[0]}. No tactical turn.` }];
    return page;
  }
  if (view.detail?.type === 'item') {
    const { slot: index, pack } = view.detail;
    const slot = pack ? campaign?.pack[index] : state.slots[index];
    if (!slot) { view.detail = null; return adventurePage(controller, view, false, onChange); }
    page.title = name(slot.item.id); page.tabs = [];
    page.cards = itemCards(slot.item, slot);
    page.cards[2].body += `\nReady in ${Math.max(0, slot.readyAt - (state.round?.turn ?? 0) - 1)} reveals${slot.item.charge ? ` · Needs colors ${slot.item.colors.filter((color) => !slot.charged.includes(color)).map((color) => color + 1).join(', ')}` : ''}`;
    page.cards[2].actions = pack ? [action('equip', 'Equip / swap', () => { view.detail = { type: 'equip', pack: index }; view.page = 0; onChange(); }, !between),
      ...(node?.kind === 'shop' && campaign?.active ? [action('sell', `Sell for ${Math.floor((slot.item.price ?? 25) / 2)}`, () => { send({ type: 'sell', pack: index }); view.detail = null; onChange(); }, !between || !!state.encounter)] : [])]
      : [action('ready', slot.ready ? 'Unready' : 'Ready', () => controller.setReady(index, !slot.ready)),
        ...(campaign ? [action('pack', 'Put in pack', () => { send({ type: 'unequip', slot: index }); view.detail = null; onChange(); }, !between || campaign.pack.length >= 3)] : []),
        action('earlier', 'Move earlier', () => {
          const order = state.slots.map((_, i) => i); [order[index], order[index - 1]] = [order[index - 1], order[index]];
          send({ type: 'set-priority', slots: order }); view.detail = { type: 'item', slot: index - 1 }; onChange();
        }, !between || index === 0)];
    return page;
  }
  if (view.detail?.type === 'equip' || view.detail?.type === 'replace') {
    const detail = view.detail;
    page.title = detail.type === 'equip' ? 'Choose equipment slot' : 'Replace equipped gear'; page.tabs = [];
    page.cards = state.slots.map((slot, index) => ({ id: `slot-${index}`, title: `${index + 1}. ${name(slot.item.id)}`, colors: slot.item.colors,
      body: detail.type === 'equip' ? 'Swap the whole item with the pack. Timers and charge stay with it.' : 'This item will be left behind.',
      actions: [action(`slot-${index}`, detail.type === 'equip' ? 'Swap here' : 'Replace this item', () => {
        send(detail.type === 'equip' ? { type: 'equip', pack: detail.pack, slot: index } : { type: 'take-loot', offer: detail.offer, replace: index }); view.detail = null; onChange();
      }, !between || (detail.type === 'replace' && !!state.encounter))],
    }));
    if (detail.type === 'equip' && state.slots.length < 4) page.cards.push({ id: 'empty-slot', title: 'Empty equipment slot', body: 'Equip without replacing an item.', actions: [action('empty-slot', 'Equip here', () => { send({ type: 'equip', pack: detail.pack, slot: state.slots.length }); view.detail = null; onChange(); }, !between)] });
    return page;
  }
  if (view.panel === 'route') {
    if (campaign) {
      page.map = campaign.map;
      page.current = campaign.node; page.visited = campaign.visited; page.reachable = routeChoices(state).map((entry) => entry.id);
      page.travel = (entry) => { send({ type: 'travel', node: entry.id }); view.mapColumn = Math.max(0, entry.column - 1); view.panel = ['shop', 'rest', 'event'].includes(entry.kind) ? 'location' : 'route'; onChange(); };
    } else page.cards = [{ id: 'sandbox', title: 'Sandbox playtest', body: 'The current wolf continues between puzzles. Defeating it starts a new wolf after harvest. Equipment and potions remain available from the tabs.' }];
  } else if (view.panel === 'gear') {
    page.title = 'Equipment';
    page.cards = state.slots.map((slot, index) => ({ id: `equipped-${slot.item.instance ?? slot.item.id}`, title: `${index + 1}. ${name(slot.item.id)} · ${slot.ready ? 'Ready' : 'Unready'}`,
      body: `${name(slot.item.effect)} · Level ${slot.level ?? 0}/3\nFirst eligible ready item takes each pulse.`, colors: slot.item.colors,
      actions: [action(`inspect-slot-${index}`, 'Inspect / manage', () => inspect(index)), action(`ready-${index}`, slot.ready ? 'Unready' : 'Ready', () => controller.setReady(index, !slot.ready))],
    }));
    page.cards.push(...(campaign?.pack ?? []).map((slot, index) => ({ id: `packed-${slot.item.instance ?? slot.item.id}`, title: `Pack: ${name(slot.item.id)}`, body: `${name(slot.item.effect)} · Level ${slot.level ?? 0}/3\nReserve item; does not receive pulses.`, colors: slot.item.colors, actions: [action(`inspect-pack-${index}`, 'Inspect / manage', () => inspect(index, true))] })));
  } else if (view.panel === 'loot') {
    page.title = 'Loot';
    if (campaign) addOffers(campaign.loot, false);
    if (!page.cards.length) page.cards = [{ id: 'no-loot', title: 'No pending loot', body: 'Defeat an enemy and finish its puzzle to collect rewards. Moving to another location leaves unclaimed loot behind.' }];
  } else if (view.panel === 'potions') {
    page.title = 'Consumables';
    page.cards = (campaign?.potions ?? []).map((potion, index) => ({ id: `potion-${index}`, title: name(potion.id), body: `Instant ${potion.value} ${potion.id.split('-')[0]}.\nNo tactical turn; can be used before an immediate carried-over attack.`, actions: [action(`use-potion-${index}`, 'Use potion', () => send({ type: 'use-potion', potion: index }), potion.id !== 'healing-potion' && (state.encounter?.type !== 'enemy' || state.encounter.phase !== 'active'))] }));
    if (!page.cards.length) page.cards = [{ id: 'no-potions', title: 'No consumables', body: 'Carry up to three potions, found as loot or bought at shops.' }];
  } else {
    page.title = node ? name(node.kind) : 'Encounter';
    const encounter = state.encounter;
    if (encounter) {
      page.cards = [{ id: 'encounter', title: name(encounter.def.id), colors: encounter.def.scavenge.flatMap((rule) => rule.colors),
        body: encounter.type === 'enemy' ? `${Math.max(0, encounter.health)}/${encounter.def.health} health\nNext hit: ${encounter.def.intents[encounter.intent].damage} in ${encounter.countdown} reveals. Your pulse lands first.\n${encounter.def.budget?.fleeAfter ? `Escapes after ${encounter.def.budget.fleeAfter} puzzles.` : `Enrages by ${encounter.def.budget?.enrage ?? 0} damage per extra puzzle.`}` : 'A single puzzle of harvest. Every color becomes supplies.',
        actions: encounter.type === 'enemy' && encounter.phase === 'active' ? [action('flee', `Flee · take ${encounter.def.intents[encounter.intent].damage} damage`, () => send({ type: 'flee' }), !between || !!encounter.def.budget?.boss)] : [],
      }, { id: 'harvest', title: 'After the fight', body: 'Swatches show harvest colors. Readied gear takes matching colors as experience; healing gear heals. Unready gear to harvest supplies instead. Each extra combat puzzle reduces the harvest.' }];
    } else if (campaign?.active && node?.kind === 'shop') {
      addOffers(campaign.stock, true);
      page.cards.unshift({ id: 'shop', title: 'Fixed stock · no rerolls', body: 'Gear 25–45 supplies. Potions 10–15. Sell packed gear from Equipment.', actions: [action('shop-heal', 'Heal · 2 per health', () => send({ type: 'shop-heal' }), state.health >= state.maxHealth || supplies < 2), action('leave-shop', 'Leave shop', () => send({ type: 'choose', choice: 'leave' }))] });
    } else if (campaign?.active && node?.kind === 'rest') {
      page.cards = [{ id: 'rest', title: 'A quiet rest', body: 'Choose recovery or one equipment improvement. This stop resolves once, without a puzzle.', actions: [action('rest-heal', `Heal ${Math.ceil(state.maxHealth / 3)} health`, () => send({ type: 'choose', choice: 'rest' })), action('leave-rest', 'Leave', () => send({ type: 'choose', choice: 'leave' }))] },
        ...state.slots.map((slot, index) => ({ id: `improve-${index}`, title: name(slot.item.id), body: `Level ${slot.level ?? 0}/3. Improve each size band's effect by one step.`, colors: slot.item.colors, actions: [action(`improve-${index}`, 'Improve this item', () => send({ type: 'choose', choice: 'upgrade', slot: index }), (slot.level ?? 0) >= 3)] }))];
    } else if (campaign?.active && node?.kind === 'event') {
      page.cards = [{ id: 'event', title: 'A quiet clearing', body: 'A traveler offers a trade. A thorny cache tempts you. Choose once; no puzzle is required.', actions: [action('trade', '6 supplies for 6 health', () => send({ type: 'choose', choice: 'trade' }), supplies < 6), action('risk', '4 damage for gear', () => send({ type: 'choose', choice: 'risk' })), action('leave-event', 'Leave peacefully', () => send({ type: 'choose', choice: 'leave' }))] }];
    } else page.cards = [{ id: 'move-on', title: 'Ready to move on', body: 'Choose a connected route. Equipment and unclaimed rewards are available from their own tabs.', actions: [action('route-tab', 'Open route', () => navigate('route'))] }];
  }
  return page;
}
