import type { Tier } from '../engine';
import { formatDuration, getBestTimesFor } from '../state/storage';
import type { AppSettings, HintKind, SolveRecord, VarietyPreference } from '../state/types';
import { ASSET_URLS } from './assets';

/** Options for opening a confirmation modal dialog. */
export interface ConfirmModalOptions {
  /** Dialog title. */
  readonly title: string;
  /** Explanatory body message. */
  readonly message: string;
  /** Confirm button label. */
  readonly confirmLabel: string;
  /** Cancel button label. Defaults to `'Keep Playing'`. */
  readonly cancelLabel?: string;
  /** Callback invoked when the user confirms. */
  readonly onConfirm: () => void;
}

const SIZES: readonly number[] = [5, 6, 7, 8, 9, 10];
const TIERS: readonly Tier[] = ['easy', 'medium', 'hard'];

const TIER_LABELS: Record<Tier, string> = {
  easy: 'Easy',
  medium: 'Medium',
  hard: 'Hard',
};

let toastTimeoutId: number | null = null;

/**
 * Displays a brief floating toast notification at the bottom of the screen.
 * @param message text to display
 * @param durationMs time in milliseconds before auto-dismissing
 */
export function showToast(message: string, durationMs = 2600): void {
  const root = document.getElementById('modal-layer');
  if (!root) {
    return;
  }
  let toast = document.getElementById('stumped-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'stumped-toast';
    toast.className = 'stumped-toast';
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    root.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.add('visible');

  if (toastTimeoutId !== null) {
    window.clearTimeout(toastTimeoutId);
  }
  toastTimeoutId = window.setTimeout(() => {
    toast.classList.remove('visible');
    toastTimeoutId = null;
  }, durationMs);
}

/**
 * Closes any currently open modal dialog in `#modal-layer`.
 */
export function closeActiveModal(): void {
  const existing = document.querySelector('.modal-backdrop');
  existing?.remove();
}

/**
 * Opens a confirmation modal (for example, before abandoning an in-progress puzzle).
 * @param options confirmation dialog options
 */
export function openConfirmModal(options: ConfirmModalOptions): void {
  closeActiveModal();
  const root = document.getElementById('modal-layer');
  if (!root) {
    return;
  }

  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) {
      closeActiveModal();
    }
  });

  const dialog = document.createElement('div');
  dialog.className = 'modal-card modal-card-sm';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-labelledby', 'confirm-modal-title');

  const titleEl = document.createElement('h2');
  titleEl.id = 'confirm-modal-title';
  titleEl.className = 'modal-title';
  titleEl.textContent = options.title;

  const msgEl = document.createElement('p');
  msgEl.className = 'modal-message';
  msgEl.textContent = options.message;

  const actions = document.createElement('div');
  actions.className = 'modal-actions';

  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'wood-btn wood-btn-secondary';
  cancelBtn.textContent = options.cancelLabel ?? 'Keep Playing';
  cancelBtn.setAttribute('data-testid', 'confirm-cancel-btn');
  cancelBtn.addEventListener('click', () => {
    closeActiveModal();
  });

  const confirmBtn = document.createElement('button');
  confirmBtn.type = 'button';
  confirmBtn.className = 'wood-btn wood-btn-primary';
  confirmBtn.textContent = options.confirmLabel;
  confirmBtn.setAttribute('data-testid', 'confirm-accept-btn');
  confirmBtn.addEventListener('click', () => {
    closeActiveModal();
    options.onConfirm();
  });

  actions.append(cancelBtn, confirmBtn);
  dialog.append(titleEl, msgEl, actions);
  backdrop.appendChild(dialog);
  root.appendChild(backdrop);
  confirmBtn.focus();
}

/**
 * Opens the Settings modal dialog allowing the player to configure timer visibility,
 * size, difficulty, silver acorn mode, and region variety controls.
 * @param initialSettings current settings
 * @param onChange callback invoked whenever any setting changes
 */
export function openSettingsModal(
  initialSettings: AppSettings,
  onChange: (updated: AppSettings) => void,
): void {
  closeActiveModal();
  const root = document.getElementById('modal-layer');
  if (!root) {
    return;
  }

  let current: AppSettings = { ...initialSettings };
  const update = (patch: Partial<AppSettings>): void => {
    current = { ...current, ...patch };
    onChange(current);
    renderContent();
  };

  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) {
      closeActiveModal();
    }
  });

  const dialog = document.createElement('div');
  dialog.className = 'modal-card';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-labelledby', 'settings-modal-title');

  const parseVariety = (val: string): VarietyPreference => (
    val === 'random' ? 'random' : (Number(val) as 0 | 1 | 2 | 3)
  );

  const renderContent = (): void => {
    dialog.replaceChildren();

    const header = document.createElement('div');
    header.className = 'modal-header';

    const title = document.createElement('h2');
    title.id = 'settings-modal-title';
    title.className = 'modal-title';
    title.textContent = 'Settings';

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'wood-btn wood-btn-secondary modal-close-btn';
    closeBtn.textContent = 'Done';
    closeBtn.setAttribute('data-testid', 'settings-close-btn');
    closeBtn.addEventListener('click', () => {
      closeActiveModal();
    });
    header.append(title, closeBtn);

    const body = document.createElement('div');
    body.className = 'settings-body';

    // 1. Timer shown or hidden
    body.appendChild(createSegmentRow(
      'Timer',
      'Show or hide the elapsed timer during a puzzle',
      [
        { label: 'Shown', value: 'true', active: current.showTimer },
        { label: 'Hidden', value: 'false', active: !current.showTimer },
      ],
      (val) => {
        update({ showTimer: val === 'true' });
      },
      'setting-timer',
    ));

    // 2. Silver acorn mode
    body.appendChild(createSegmentRow(
      'Acorn Mode',
      'Silver acorn mode gives 1 silver acorn: a single wrong reveal ends the puzzle',
      [
        { label: '3 Acorns', value: 'false', active: !current.silver },
        { label: 'Silver Acorn', value: 'true', active: current.silver },
      ],
      (val) => {
        update({ silver: val === 'true' });
      },
      'setting-silver',
    ));

    // 3. Board Size
    body.appendChild(createSegmentRow(
      'Board Size',
      'Applies when starting a new puzzle',
      [
        { label: 'Random', value: 'random', active: current.size === 'random' },
        ...SIZES.map((s) => ({
          label: `${s}×${s}`,
          value: String(s),
          active: current.size === s,
        })),
      ],
      (val) => {
        update({ size: val === 'random' ? 'random' : Number(val) });
      },
      'setting-size',
    ));

    // 4. Difficulty
    body.appendChild(createSegmentRow(
      'Difficulty',
      'Hardest solver technique required',
      [
        { label: 'Random', value: 'random', active: current.tier === 'random' },
        ...TIERS.map((t) => ({
          label: TIER_LABELS[t],
          value: t,
          active: current.tier === t,
        })),
      ],
      (val) => {
        update({ tier: val === 'random' ? 'random' : (val as Tier) });
      },
      'setting-difficulty',
    ));

    // 5. Region Size Mix (0..3 or 'random')
    body.appendChild(createSegmentRow(
      'Region Size Mix',
      'From similar-sized regions to one dominant region with small neighbors',
      [
        { label: 'Random', value: 'random', active: current.sizeMix === 'random' },
        { label: 'Similar', value: '0', active: current.sizeMix === 0 },
        { label: 'Balanced', value: '1', active: current.sizeMix === 1 },
        { label: 'Varied', value: '2', active: current.sizeMix === 2 },
        { label: 'Dominant', value: '3', active: current.sizeMix === 3 },
      ],
      (val) => {
        update({ sizeMix: parseVariety(val) });
      },
      'setting-size-mix',
    ));

    // 6. Region Shape (0..3 or 'random')
    body.appendChild(createSegmentRow(
      'Region Shape',
      'From compact blobs to long thin winding runs',
      [
        { label: 'Random', value: 'random', active: current.shape === 'random' },
        { label: 'Compact', value: '0', active: current.shape === 0 },
        { label: 'Mixed', value: '1', active: current.shape === 1 },
        { label: 'Winding', value: '2', active: current.shape === 2 },
        { label: 'Long Runs', value: '3', active: current.shape === 3 },
      ],
      (val) => {
        update({ shape: parseVariety(val) });
      },
      'setting-shape',
    ));

    // 7. Freebies (0..3 or 'random')
    body.appendChild(createSegmentRow(
      'Freebies',
      'How often a pre-revealed stump or 1-square region appears',
      [
        { label: 'Random', value: 'random', active: current.freebies === 'random' },
        { label: 'None', value: '0', active: current.freebies === 0 },
        { label: 'Rare', value: '1', active: current.freebies === 1 },
        { label: 'Sometimes', value: '2', active: current.freebies === 2 },
        { label: 'Often', value: '3', active: current.freebies === 3 },
      ],
      (val) => {
        update({ freebies: parseVariety(val) });
      },
      'setting-freebies',
    ));

    dialog.append(header, body);
  };

  renderContent();
  backdrop.appendChild(dialog);
  root.appendChild(backdrop);
}

/**
 * Opens the Best Times modal dialog showing top solves per board size and difficulty,
 * with starred clean solves sorted before assisted solves.
 * @param initialSize initial board size filter (5 to 10)
 * @param initialTier initial difficulty filter
 * @param onPlaySeed optional callback to launch a puzzle from a recorded seed code
 */
export function openBestTimesModal(
  initialSize = 6,
  initialTier: Tier = 'medium',
  onPlaySeed?: (seedCode: string) => void,
): void {
  closeActiveModal();
  const root = document.getElementById('modal-layer');
  if (!root) {
    return;
  }

  let selectedSize = initialSize;
  let selectedTier: Tier = initialTier;

  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) {
      closeActiveModal();
    }
  });

  const dialog = document.createElement('div');
  dialog.className = 'modal-card';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-labelledby', 'best-times-modal-title');

  const renderContent = (): void => {
    dialog.replaceChildren();

    const header = document.createElement('div');
    header.className = 'modal-header';

    const title = document.createElement('h2');
    title.id = 'best-times-modal-title';
    title.className = 'modal-title';
    title.textContent = 'Best Times';

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'wood-btn wood-btn-secondary modal-close-btn';
    closeBtn.textContent = 'Done';
    closeBtn.setAttribute('data-testid', 'best-times-close-btn');
    closeBtn.addEventListener('click', () => {
      closeActiveModal();
    });
    header.append(title, closeBtn);

    const legend = document.createElement('p');
    legend.className = 'best-times-legend';
    legend.textContent = '★ Starred (clean) times are listed first, followed by all other completed solves sorted by time.';

    // Filter controls
    const filters = document.createElement('div');
    filters.className = 'best-times-filters';

    filters.appendChild(createSegmentRow(
      'Size',
      '',
      SIZES.map((s) => ({
        label: `${s}×${s}`,
        value: String(s),
        active: selectedSize === s,
      })),
      (val) => {
        selectedSize = Number(val);
        renderContent();
      },
      'times-size',
    ));

    filters.appendChild(createSegmentRow(
      'Difficulty',
      '',
      TIERS.map((t) => ({
        label: TIER_LABELS[t],
        value: t,
        active: selectedTier === t,
      })),
      (val) => {
        selectedTier = val as Tier;
        renderContent();
      },
      'times-tier',
    ));

    // List of entries for selectedSize + selectedTier
    const entries = getBestTimesFor(selectedSize, selectedTier);
    const listContainer = document.createElement('div');
    listContainer.className = 'best-times-list';

    if (entries.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'best-times-empty';
      empty.textContent = `No completed ${selectedSize}×${selectedSize} ${TIER_LABELS[selectedTier]} puzzles yet.`;
      listContainer.appendChild(empty);
    } else {
      entries.forEach((entry, idx) => {
        const row = document.createElement('div');
        row.className = 'best-time-row';

        const rank = document.createElement('span');
        rank.className = 'best-time-rank';
        rank.textContent = `#${idx + 1}`;

        const duration = document.createElement('span');
        duration.className = 'best-time-duration';
        duration.textContent = formatDuration(entry.timeMs);

        const quals = createQualificationBadges(entry);

        const codeSpan = document.createElement('span');
        codeSpan.className = 'best-time-code';
        codeSpan.textContent = entry.code;

        row.append(rank, duration, quals, codeSpan);

        if (onPlaySeed) {
          const playBtn = document.createElement('button');
          playBtn.type = 'button';
          playBtn.className = 'wood-btn wood-btn-sm wood-btn-secondary';
          playBtn.textContent = 'Replay';
          playBtn.addEventListener('click', () => {
            closeActiveModal();
            onPlaySeed(entry.code);
          });
          row.appendChild(playBtn);
        }

        listContainer.appendChild(row);
      });
    }

    dialog.append(header, legend, filters, listContainer);
  };

  renderContent();
  backdrop.appendChild(dialog);
  root.appendChild(backdrop);
}

interface SegmentChoice {
  readonly label: string;
  readonly value: string;
  readonly active: boolean;
}

const createSegmentRow = (
  label: string,
  description: string,
  choices: readonly SegmentChoice[],
  onSelect: (value: string) => void,
  testIdPrefix: string,
): HTMLElement => {
  const row = document.createElement('div');
  row.className = 'setting-row';

  const header = document.createElement('div');
  header.className = 'setting-header';

  const title = document.createElement('div');
  title.className = 'setting-label';
  title.textContent = label;
  header.appendChild(title);

  if (description) {
    const desc = document.createElement('div');
    desc.className = 'setting-desc';
    desc.textContent = description;
    header.appendChild(desc);
  }

  const group = document.createElement('div');
  group.className = 'segment-group';
  group.setAttribute('role', 'group');
  group.setAttribute('aria-label', label);

  for (const choice of choices) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = choice.active ? 'segment-btn active' : 'segment-btn';
    btn.textContent = choice.label;
    btn.setAttribute('aria-pressed', String(choice.active));
    btn.setAttribute('data-testid', `${testIdPrefix}-${choice.value}`);
    btn.addEventListener('click', () => {
      onSelect(choice.value);
    });
    group.appendChild(btn);
  }

  row.append(header, group);
  return row;
};

const HINT_ICON_URL: Record<HintKind, string> = {
  reveal: ASSET_URLS.woodpecker,
  explain: ASSET_URLS.owl,
  eliminate: ASSET_URLS.squirrel,
};

const HINT_TITLE: Record<HintKind, string> = {
  reveal: 'Woodpecker hint used',
  explain: 'Owl hint used',
  eliminate: 'Squirrel hint used',
};

const createQualificationBadges = (entry: SolveRecord): HTMLElement => {
  const wrap = document.createElement('div');
  wrap.className = 'best-time-quals';

  if (entry.clean) {
    const star = document.createElement('span');
    star.className = 'best-time-star clean';
    star.textContent = '★';
    star.title = 'Clean solve';
    star.setAttribute('aria-label', 'Clean solve');
    wrap.appendChild(star);
  }

  if (entry.silver) {
    const img = document.createElement('img');
    img.src = ASSET_URLS.silverAcorn;
    img.alt = 'Silver acorn mode';
    img.title = 'Silver acorn mode';
    img.className = 'qual-icon';
    wrap.appendChild(img);
  }

  for (const h of entry.hintsUsed) {
    const img = document.createElement('img');
    img.src = HINT_ICON_URL[h];
    img.alt = HINT_TITLE[h];
    img.title = HINT_TITLE[h];
    img.className = 'qual-icon';
    wrap.appendChild(img);
  }

  if (entry.acornsLost > 0) {
    const lostBadge = document.createElement('span');
    lostBadge.className = 'qual-acorns-lost';
    lostBadge.title = `${entry.acornsLost} acorn(s) lost`;
    const img = document.createElement('img');
    img.src = ASSET_URLS.acorn;
    img.alt = 'Acorn lost';
    img.className = 'qual-icon';
    const count = document.createElement('span');
    count.textContent = `-${entry.acornsLost}`;
    lostBadge.append(img, count);
    wrap.appendChild(lostBadge);
  }

  if (entry.repeat) {
    const rep = document.createElement('span');
    rep.className = 'best-time-star assisted';
    rep.textContent = 'Repeat';
    rep.title = 'Repeat play';
    wrap.appendChild(rep);
  }

  return wrap;
};

