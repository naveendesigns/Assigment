/* =========================================================================
   GCC Location Decision Brief — app.js
   Vanilla ES6+. No frameworks, no build step.
   ========================================================================= */
'use strict';

/* ----------------------------- Constants ----------------------------- */
const DATA_URL = 'data/gcc-location-dataset.json';
const STORAGE_KEY = 'gcc-location-brief-v1';
const PRIORITY_MAX = 3;

const CRITERION_LABELS = {
  talent_availability: 'Talent availability',
  operating_cost: 'Operating cost',
  scalability: 'Scalability',
  industry_ecosystem: 'Industry ecosystem',
  infrastructure_continuity: 'Infrastructure & continuity',
  launch_readiness: 'Launch readiness',
};

const PRIORITY_TO_CRITERION = {
  'Talent availability': 'talent_availability',
  'Operating cost': 'operating_cost',
  'Scalability': 'scalability',
  'Industry ecosystem': 'industry_ecosystem',
  'Infrastructure & continuity': 'infrastructure_continuity',
};

const STATUS_LABELS = {
  supported_market_signal: { short: 'Supported', full: 'Supported market signal' },
  partial: { short: 'Partial', full: 'Partial evidence' },
  insufficient: { short: 'Insufficient', full: 'Insufficient evidence' },
};

const FIELD_DEFS = {
  capability: {
    label: 'Primary capability',
    options: [
      'Engineering & technology',
      'Finance & business services',
      'Customer operations',
      'Research & development',
      'Multiple functions',
    ],
    default: 'Multiple functions',
  },
  role_family: {
    label: 'Primary role family',
    options: [
      'Software engineering',
      'Data & AI',
      'Finance & accounting',
      'Customer support & operations',
      'Research & specialist roles',
      'Mixed roles',
    ],
    default: 'Mixed roles',
    helper:
      "Role specificity helps us evaluate talent evidence more meaningfully. Mixed roles may leave important hiring questions unresolved.",
  },
  india_presence: {
    label: 'Existing India presence (optional)',
    options: [
      'No existing presence',
      'Already operating in India',
      'Exploring an expansion of an existing operation',
      'Not decided',
    ],
    default: null,
    skippable: true,
  },
  initial_headcount: {
    label: 'Initial headcount',
    options: ['Under 100', '100–250', '251–500', '500+', 'Not decided'],
    default: 'Under 100',
  },
  expected_growth: {
    label: 'Expected growth',
    options: ['Slow / stable', 'Moderate growth', 'Rapid growth', 'Not decided'],
    default: 'Rapid growth',
  },
  launch_timeline: {
    label: 'Expected launch timeline',
    options: ['Within 6 months', '6–12 months', '12–24 months', 'Exploring / undecided'],
    default: 'Within 6 months',
  },
  cost_posture: {
    label: 'Cost posture',
    options: [
      'Cost-sensitive',
      'Balanced: cost and capability',
      'Capability-led: talent and ecosystem first',
    ],
    default: 'Cost-sensitive',
    helper: 'Describes your preference, not a verified budget. We will not request exact financials in this assessment.',
  },
};

const PRIORITY_OPTIONS = [
  {
    id: 'Talent availability',
    hint: 'Can the location support the roles and skills you need?',
  },
  {
    id: 'Operating cost',
    hint: 'Can you evaluate the ongoing costs using comparable assumptions?',
  },
  {
    id: 'Industry ecosystem',
    hint: 'Does the location have a relevant cluster of companies, capabilities, and supporting services?',
  },
  {
    id: 'Infrastructure & continuity',
    hint: 'Can the chosen location support your operational requirements?',
  },
  {
    id: 'Scalability',
    hint: 'Is there evidence to support your expected future expansion?',
  },
];

const STEP_DEFS = [
  {
    id: 1,
    eyebrow: 'Step 1 of 3 · Company profile',
    title: "Let's understand what you're building.",
    lead: "A GCC location that works for one business may not work for another. Start with the capabilities and roles you expect to establish.",
    fields: ['capability', 'role_family', 'india_presence'],
  },
  {
    id: 2,
    eyebrow: 'Step 2 of 3 · Scale and constraints',
    title: 'What will your GCC need to support?',
    lead: 'Your scale and timeline shape which evidence matters most. We will not request exact financials here.',
    fields: ['initial_headcount', 'expected_growth', 'launch_timeline', 'cost_posture'],
  },
  {
    id: 3,
    eyebrow: 'Step 3 of 3 · Decision priorities',
    title: 'What matters most when choosing a location?',
    lead: 'Choose up to three priorities. Your selection helps focus the comparison on the factors that matter most to your company.',
    fields: ['priorities'],
  },
];

/* ----------------------------- State ----------------------------- */
const state = {
  ready: false,
  dataset: null,
  screen: 'landing',
  prevScreen: null,
  assessmentStep: 1,
  profile: null,        // populated from default_profile after load
  priorities: [],
  priorityLens: null,   // criterion id
  evidencePanel: null,  // { cityId, criterionId }
  methodologyOpen: false,
  errors: {},
};

/* ----------------------------- DOM helpers ----------------------------- */
const $  = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const el = (tag, attrs, children = []) => {
  const node = document.createElement(tag);
  const safeAttrs = attrs || {};
  for (const [k, v] of Object.entries(safeAttrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k === 'aria') Object.entries(v).forEach(([kk, vv]) => node.setAttribute(`aria-${kk}`, vv));
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v === true) node.setAttribute(k, '');
    else if (v === false || v == null) { /* skip */ }
    else node.setAttribute(k, v);
  }
  (Array.isArray(children) ? children : [children]).forEach((c) => {
    if (c == null) return;
    if (typeof c === 'string' || typeof c === 'number') node.appendChild(document.createTextNode(String(c)));
    else node.appendChild(c);
  });
  return node;
};
const clear = (node) => { while (node && node.firstChild) node.removeChild(node.firstChild); return node; };
const show = (node) => node && node.removeAttribute('hidden');
const hide = (node) => node && node.setAttribute('hidden', '');

// Safe text setter (no innerHTML injection from data)
const setText = (node, text) => {
  if (!node) return;
  clear(node);
  node.appendChild(document.createTextNode(text == null ? '' : String(text)));
};

/* ----------------------------- Data loading ----------------------------- */
async function loadDataset() {
  let lastError;
  for (const url of [DATA_URL, 'gcc-location-dataset.json']) {
    try {
      const res = await fetch(url, { cache: 'no-cache' });
      if (!res.ok) throw new Error(`HTTP ${res.status} while loading ${url}`);
      return await res.json();
    } catch (err) {
      lastError = err;
    }
  }

  // Fall back to embedded window.GCC_LOCATION_DATA if a host page has loaded it
  if (window.GCC_LOCATION_DATA) {
    console.warn('Falling back to window.GCC_LOCATION_DATA after fetch failure:', lastError);
    return window.GCC_LOCATION_DATA;
  }
  throw lastError;
}

function getDefaultProfile(dataset) {
  const dp = dataset.default_profile || {};
  return {
    capability: dp.capability || FIELD_DEFS.capability.default,
    role_family: dp.role_family || FIELD_DEFS.role_family.default,
    india_presence: dp.india_presence || null,
    initial_headcount: dp.initial_headcount || FIELD_DEFS.initial_headcount.default,
    expected_growth: dp.expected_growth || FIELD_DEFS.expected_growth.default,
    launch_timeline: dp.launch_timeline || FIELD_DEFS.launch_timeline.default,
    cost_posture: dp.cost_posture || FIELD_DEFS.cost_posture.default,
  };
}

function getDefaultPriorities(dataset) {
  const dp = dataset.default_profile || {};
  return Array.isArray(dp.priorities) && dp.priorities.length
    ? dp.priorities.slice()
    : ['Talent availability', 'Operating cost', 'Scalability'];
}

/* ----------------------------- Persistence ----------------------------- */
function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      screen: state.screen,
      assessmentStep: state.assessmentStep,
      profile: state.profile,
      priorities: state.priorities,
      priorityLens: state.priorityLens,
    }));
  } catch (_) { /* storage may be unavailable; ignore */ }
}

function restore() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed;
  } catch (_) { return null; }
}

function clearPersisted() {
  try { localStorage.removeItem(STORAGE_KEY); } catch (_) { /* ignore */ }
}

/* ----------------------------- Profile helpers ----------------------------- */
function updateProfile(patch) {
  state.profile = Object.assign({}, state.profile, patch);
  state.errors = {};
  persist();
}

function getSelectedPriorities() {
  return state.priorities.slice();
}

function getCityEvidence(city, criterionId) {
  if (!city || !city.evidence) return null;
  return city.evidence[criterionId] || null;
}

function getEvidenceStatus(city, criterionId) {
  const ev = getCityEvidence(city, criterionId);
  return ev ? ev.status : 'insufficient';
}

function getSource(dataset, sourceId) {
  return (dataset.sources || []).find((s) => s.id === sourceId) || null;
}

function resolveSources(dataset, sourceIds) {
  if (!Array.isArray(sourceIds)) return [];
  return sourceIds.map((id) => getSource(dataset, id)).filter(Boolean);
}

function getCriterion(dataset, criterionId) {
  return (dataset.criteria || []).find((c) => c.id === criterionId) || null;
}

function findCity(dataset, cityId) {
  return (dataset.cities || []).find((c) => c.id === cityId) || null;
}

/* ----------------------------- Validation ----------------------------- */
function validateAssessment(stepId) {
  const errs = {};
  const step = STEP_DEFS.find((s) => s.id === stepId);
  if (!step) return errs;
  step.fields.forEach((fieldKey) => {
    if (fieldKey === 'priorities') {
      if (!state.priorities || state.priorities.length === 0) {
        errs.priorities = 'Please select at least one priority.';
      } else if (state.priorities.length > PRIORITY_MAX) {
        errs.priorities = `Select up to ${PRIORITY_MAX} priorities.`;
      }
    } else {
      const def = FIELD_DEFS[fieldKey];
      if (!def || def.skippable) return;
      const val = state.profile[fieldKey];
      if (!val) errs[fieldKey] = 'Please choose an option to continue.';
    }
  });
  return errs;
}

/* ----------------------------- Recommendation logic ----------------------------- */
function generateRecommendation(dataset, profile, priorities) {
  const cities = dataset.cities || [];
  const priorityCriteria = priorities
    .map((p) => PRIORITY_TO_CRITERION[p])
    .filter(Boolean);

  // For each city, gather evidence for the user's priority criteria + ecosystem signal
  const candidates = cities.map((city) => {
    const allStatuses = (dataset.criteria || []).map((c) => getEvidenceStatus(city, c.id));
    const supportedCount = allStatuses.filter((s) => s === 'supported_market_signal').length;
    const partialCount   = allStatuses.filter((s) => s === 'partial').length;
    const insufficientCount = allStatuses.filter((s) => s === 'insufficient').length;
    return {
      city,
      supportedCount,
      partialCount,
      insufficientCount,
      total: allStatuses.length,
      priorityEvidence: priorityCriteria.map((cid) => ({
        criterionId: cid,
        evidence: getCityEvidence(city, cid),
      })),
      // strongest supported signal (prefer ecosystem + priorities)
      leadSignal: pickLeadSignal(city, priorityCriteria),
      leadLimitation: pickLeadLimitation(city, priorityCriteria),
    };
  });

  // Determine result type — dataset scoring rule:
  // "operating cost, infrastructure/continuity, and launch readiness are insufficient for all cities"
  const hasSufficientCost = candidates.some((c) => getEvidenceStatus(c.city, 'operating_cost') !== 'insufficient');
  const hasSufficientTalent = candidates.some((c) => getEvidenceStatus(c.city, 'talent_availability') === 'supported_market_signal');
  const definitiveWinner = false; // never claim a winner in this dataset

  const policy = dataset.recommendation_policy || {};
  const currentResult = policy.current_profile_result || {};

  return {
    candidates,
    definitiveWinner,
    resultType: currentResult.result_type || 'evidence-led candidate set, not a ranked winner',
    reason: currentResult.reason || '',
    nextInputs: currentResult.next_inputs_to_improve_confidence || [],
    avoid: policy.avoid || [],
    allowed: policy.allowed || [],
    priorityCriteria,
  };
}

function pickLeadSignal(city, priorityCriteria) {
  // Prefer a supported_market_signal on a priority criterion; fall back to ecosystem signal; fall back to first supported.
  const evs = city.evidence || {};
  const order = [...priorityCriteria, 'industry_ecosystem', 'scalability', 'talent_availability'];
  for (const cid of order) {
    const ev = evs[cid];
    if (ev && ev.status === 'supported_market_signal') return ev;
  }
  // Else, first supported
  for (const cid of Object.keys(evs)) {
    if (evs[cid] && evs[cid].status === 'supported_market_signal') return evs[cid];
  }
  // Else, first partial
  for (const cid of Object.keys(evs)) {
    if (evs[cid] && evs[cid].status === 'partial') return evs[cid];
  }
  // Else, first insufficient
  for (const cid of Object.keys(evs)) {
    if (evs[cid]) return evs[cid];
  }
  return null;
}

function pickLeadLimitation(city, priorityCriteria) {
  const evs = city.evidence || {};
  // Prefer limitations on priority criteria that are insufficient
  for (const cid of priorityCriteria) {
    const ev = evs[cid];
    if (ev && (ev.status === 'insufficient' || ev.status === 'partial')) {
      return { text: ev.limitations || ev.signal, criterionId: cid, status: ev.status };
    }
  }
  // Default to launch_readiness (always insufficient in this dataset)
  const lr = evs.launch_readiness;
  if (lr) return { text: lr.limitations || lr.signal, criterionId: 'launch_readiness', status: lr.status };
  return null;
}

/* ----------------------------- App bootstrap ----------------------------- */
async function init() {
  // Inject loading state into main
  const main = $('[data-app-main]');
  clear(main);
  main.appendChild(el('div', { class: 'loading-state' }, [
    el('div', { class: 'loading-state__spinner' }),
    el('div', null, 'Loading dataset…'),
  ]));

  try {
    const dataset = await loadDataset();
    state.dataset = dataset;
    state.profile = getDefaultProfile(dataset);
    state.priorities = getDefaultPriorities(dataset);
    state.priorityLens = PRIORITY_TO_CRITERION[state.priorities[0]] || 'talent_availability';

    // Restore persisted session if any
    const restored = restore();
    if (restored && restored.profile && restored.screen) {
      state.profile = Object.assign({}, state.profile, restored.profile);
      state.priorities = restored.priorities && restored.priorities.length ? restored.priorities : state.priorities;
      state.priorityLens = restored.priorityLens || PRIORITY_TO_CRITERION[state.priorities[0]];
      state.assessmentStep = restored.assessmentStep || 1;
      state.screen = restored.screen;
    }

    state.ready = true;
    renderAll();
  } catch (err) {
    console.error(err);
    clear(main);
    main.appendChild(el('div', { class: 'error-state' }, [
      el('p', null, 'Could not load the GCC location dataset.'),
      el('p', null, [
        document.createTextNode('If you opened '),
        el('code', null, 'index.html'),
        document.createTextNode(' directly with a file:// URL, browsers block '),
        el('code', null, 'fetch()'),
        document.createTextNode(' of local JSON. Run a lightweight local server from the project folder, for example:'),
      ]),
      el('pre', { style: 'white-space:pre-wrap; font-family:var(--font-mono); font-size:0.82rem; background:var(--surface-muted); padding:0.6rem 0.8rem; border-radius:6px; margin-top:0.5rem;' },
        'python3 -m http.server 8080\n# then open http://localhost:8080/\n# or:  npx serve .'
      ),
      el('p', { style: 'margin-top:0.75rem;' }, [
        document.createTextNode('Error: '),
        el('code', null, String(err.message || err)),
      ]),
    ]));
  }
}

/* ----------------------------- Render orchestration ----------------------------- */
function renderAll() {
  // Render the screens back into the main element (since we cleared it during loading)
  // Actually, the screens are static HTML already in index.html — but we cleared main during init.
  // Strategy: render screens dynamically from a function so we don't lose them.
  rebuildScreens();
  bindGlobalEvents();
  showScreen(state.screen);
  updateHeader();
  renderMethodologyContent();
}

function rebuildScreens() {
  const main = $('[data-app-main]');
  clear(main);
  main.appendChild(buildLandingScreen());
  main.appendChild(buildAssessmentScreen());
  main.appendChild(buildRecommendationScreen());
  main.appendChild(buildComparisonScreen());
  main.appendChild(buildBriefScreen());
  main.appendChild(buildMethodologyScreen());
}

/* ----------------------------- Screen builders ----------------------------- */
function buildLandingScreen() {
  const s = el('section', {
    class: 'screen screen--landing',
    dataset: { screen: 'landing' },
    aria: { labelledby: 'landing-title' },
  });
  s.innerHTML = landingHTML();
  return s;
}

function buildAssessmentScreen() {
  const s = el('section', {
    class: 'screen screen--assessment',
    dataset: { screen: 'assessment' },
    hidden: true,
    aria: { labelledby: 'assessment-title' },
  });
  s.innerHTML = assessmentHTML();
  return s;
}

function buildRecommendationScreen() {
  const s = el('section', {
    class: 'screen screen--recommendation',
    dataset: { screen: 'recommendation' },
    hidden: true,
    aria: { labelledby: 'recommendation-title' },
  });
  s.innerHTML = recommendationHTML();
  return s;
}

function buildComparisonScreen() {
  const s = el('section', {
    class: 'screen screen--comparison',
    dataset: { screen: 'comparison' },
    hidden: true,
    aria: { labelledby: 'comparison-title' },
  });
  s.innerHTML = comparisonHTML();
  return s;
}

function buildBriefScreen() {
  const s = el('section', {
    class: 'screen screen--brief',
    dataset: { screen: 'brief' },
    hidden: true,
    aria: { labelledby: 'brief-title' },
  });
  s.innerHTML = briefHTML();
  return s;
}

function buildMethodologyScreen() {
  const s = el('section', {
    class: 'screen screen--methodology',
    dataset: { screen: 'methodology' },
    hidden: true,
    aria: { labelledby: 'methodology-title' },
  });
  s.innerHTML = methodologyHTML();
  return s;
}

/* ----------------------------- HTML templates ----------------------------- */
function landingHTML() {
  return `
  <header class="landing-header">
    <div class="landing-header__inner">
      <a href="#" class="brand" data-action="go-landing" aria-label="GCC Location Brief — home">
        <span class="brand__mark" aria-hidden="true">
          <svg viewBox="0 0 32 32" width="28" height="28" focusable="false">
            <circle cx="16" cy="16" r="11" fill="none" stroke="#D99516" stroke-width="2"/>
            <circle cx="16" cy="16" r="3.5" fill="#9B5E08"/>
          </svg>
        </span>
        <span class="brand__text">
          <span class="brand__name">GCC&nbsp;/&nbsp;India</span>
          <span class="brand__sub">Location Decision Brief</span>
        </span>
      </a>
      <nav class="app-nav" aria-label="Landing">
        <button type="button" class="app-nav__link" data-action="scroll-how">How it works</button>
        <button type="button" class="app-nav__link" data-action="open-methodology">Methodology</button>
        <button type="button" class="btn btn--primary btn--sm" data-action="start-assessment">Build your location brief</button>
      </nav>
    </div>
  </header>

  <div class="hero">
    <div class="hero__inner">
      <p class="hero__eyebrow">GCC location decision intelligence</p>
      <h1 id="landing-title" class="hero__title">Choose your GCC location with greater clarity.</h1>
      <p class="hero__lede">Compare Indian cities against your company's requirements, understand the trade-offs, and build an evidence-backed shortlist for your next decision.</p>
      <div class="hero__actions">
        <button type="button" class="btn btn--primary" data-action="start-assessment">Build your location brief</button>
        <button type="button" class="btn btn--ghost" data-action="scroll-how">Explore how it works</button>
      </div>

      <div class="hero-preview" aria-hidden="true">
        <div class="hero-preview__bar">
          <span class="hero-preview__tag">Provisional shortlist</span>
          <span class="hero-preview__date">Research cut-off · 12 Oct 2026</span>
        </div>
        <div class="hero-preview__grid">
          <div class="hero-preview__city">
            <div class="hero-preview__city-head">
              <span class="hero-preview__city-name">Bengaluru</span>
              <span class="status-pill status-pill--supported">Supported signal</span>
            </div>
            <p class="hero-preview__city-line">22.1 MSF Grade A leasing in 2025; ORR &amp; Whitefield micro-markets.</p>
            <div class="hero-preview__city-meta"><span>Evidence</span><span class="evidence-bar"><i style="width:66%"></i></span></div>
          </div>
          <div class="hero-preview__city">
            <div class="hero-preview__city-head">
              <span class="hero-preview__city-name">Hyderabad</span>
              <span class="status-pill status-pill--partial">Partial</span>
            </div>
            <p class="hero-preview__city-line">Established GCC ecosystem; SBD / Off-SBD micro-markets.</p>
            <div class="hero-preview__city-meta"><span>Evidence</span><span class="evidence-bar"><i style="width:60%"></i></span></div>
          </div>
          <div class="hero-preview__city">
            <div class="hero-preview__city-head">
              <span class="hero-preview__city-name">Chennai</span>
              <span class="status-pill status-pill--supported">Supported signal</span>
            </div>
            <p class="hero-preview__city-line">~4× GCC leasing growth vs 2021; engineering / manufacturing tilt.</p>
            <div class="hero-preview__city-meta"><span>Evidence</span><span class="evidence-bar"><i style="width:58%"></i></span></div>
          </div>
          <div class="hero-preview__city">
            <div class="hero-preview__city-head">
              <span class="hero-preview__city-name">Pune</span>
              <span class="status-pill status-pill--partial">Partial</span>
            </div>
            <p class="hero-preview__city-line">Kharadi micro-market; technology and financial-services signals.</p>
            <div class="hero-preview__city-meta"><span>Evidence</span><span class="evidence-bar"><i style="width:55%"></i></span></div>
          </div>
        </div>
        <p class="hero-preview__note">Illustrative preview. Evidence coverage shown as a directional indicator, not a city score.</p>
      </div>

      <p class="hero__trust">Recommendations reflect your stated priorities and available evidence. Missing data and important assumptions remain visible.</p>
    </div>
  </div>

  <section class="how-section" id="how" aria-labelledby="how-title">
    <div class="how-section__inner">
      <p class="section-eyebrow">How it works</p>
      <h2 id="how-title" class="section-title">Three steps to a defensible shortlist</h2>
      <ol class="how-steps">
        <li class="how-step">
          <span class="how-step__num">01</span>
          <h3 class="how-step__title">Define your requirements</h3>
          <p class="how-step__body">Tell us about the capabilities, roles, scale, timeline, and cost posture of your planned GCC. Defaults match a typical small, mixed-function centre.</p>
        </li>
        <li class="how-step">
          <span class="how-step__num">02</span>
          <h3 class="how-step__title">Compare locations</h3>
          <p class="how-step__body">Inspect source-backed evidence for Bengaluru, Hyderabad, Chennai, and Pune across six criteria. Evidence gaps stay visible — never papered over.</p>
        </li>
        <li class="how-step">
          <span class="how-step__num">03</span>
          <h3 class="how-step__title">Review your decision brief</h3>
          <p class="how-step__body">Generate a printable brief that captures your profile, candidate cities, priority-specific findings, risks, and the next evidence you need to gather.</p>
        </li>
      </ol>
    </div>
  </section>

  <footer class="app-footer">
    <div class="app-footer__inner">
      <div class="app-footer__brand">
        <span class="brand__name">GCC&nbsp;/&nbsp;India</span>
        <span class="app-footer__sub">Location Decision Brief · v1.0.0</span>
      </div>
      <nav class="app-footer__nav" aria-label="Footer">
        <button type="button" class="app-nav__link" data-action="open-methodology">Methodology</button>
        <button type="button" class="app-nav__link" data-action="open-sources">Sources</button>
        <button type="button" class="app-nav__link" data-action="start-assessment">Start assessment</button>
      </nav>
      <p class="app-footer__note">Decision support only. Not investment, legal, or tax advice.</p>
    </div>
  </footer>
  `;
}

function assessmentHTML() {
  return `
  <div class="assessment__inner">
    <div class="assessment__head">
      <p class="section-eyebrow" data-assessment-eyebrow>Step 1 of 3 · Company profile</p>
      <h1 class="section-title" data-assessment-title id="assessment-title">Let's understand what you're building.</h1>
      <p class="section-lede" data-assessment-lead>A GCC location that works for one business may not work for another. Start with the capabilities and roles you expect to establish.</p>
    </div>
    <div class="assessment__body" data-assessment-body></div>
    <div class="assessment__footer">
      <button type="button" class="btn btn--ghost" data-action="assessment-back">Back</button>
      <div class="assessment__footer-meta" data-assessment-meta></div>
      <button type="button" class="btn btn--primary" data-action="assessment-continue">Continue</button>
    </div>
  </div>
  `;
}

function recommendationHTML() {
  return `
  <div class="recommendation__inner">
    <div class="recommendation__head">
      <p class="section-eyebrow">Provisional result</p>
      <h1 class="section-title" id="recommendation-title">Your provisional location shortlist</h1>
      <p class="section-lede">Your profile points to several credible locations to investigate. The evidence available here supports market-level comparisons, but does not yet establish a definitive winner for your company's exact requirements.</p>
    </div>
    <div class="profile-summary" data-profile-summary></div>
    <div class="recommendation__framing" data-recommendation-framing></div>
    <div class="city-cards" data-city-cards></div>
    <div class="evidence-legend" aria-label="Evidence status legend">
      <span class="evidence-legend__item"><span class="status-pill status-pill--supported">Supported market signal</span><span>A source supports a specific market-level observation.</span></span>
      <span class="evidence-legend__item"><span class="status-pill status-pill--partial">Partial evidence</span><span>Relevant evidence exists, but does not fully answer the company-specific question.</span></span>
      <span class="evidence-legend__item"><span class="status-pill status-pill--insufficient">Insufficient evidence</span><span>The dataset cannot support a reliable conclusion for that criterion.</span></span>
    </div>
    <div class="recommendation__actions">
      <button type="button" class="btn btn--primary" data-action="go-comparison">Compare locations</button>
      <button type="button" class="btn btn--ghost" data-action="go-assessment">Edit my profile</button>
      <button type="button" class="btn btn--ghost" data-action="open-methodology">View methodology</button>
    </div>
  </div>
  `;
}

function comparisonHTML() {
  return `
  <div class="comparison__inner">
    <div class="comparison__head">
      <p class="section-eyebrow">Interactive comparison</p>
      <h1 class="section-title" id="comparison-title">Compare your candidate locations</h1>
      <p class="section-lede">Inspect the evidence and trade-offs behind each location. This comparison does not declare a universal winner.</p>
    </div>
    <div class="comparison__toolbar">
      <div class="profile-summary profile-summary--compact" data-profile-summary-2></div>
      <div class="comparison__toolbar-actions">
        <button type="button" class="btn btn--ghost btn--sm" data-action="edit-priorities">Edit priorities</button>
        <button type="button" class="btn btn--ghost btn--sm" data-action="reset">Reset</button>
      </div>
    </div>
    <div class="priority-lens" data-priority-lens>
      <span class="priority-lens__label">Priority lens</span>
      <div class="priority-lens__chips" data-priority-lens-chips></div>
    </div>
    <div class="priority-lens__summary" data-priority-lens-summary></div>
    <div class="comparison__table-wrap" data-comparison-table-wrap></div>
    <div class="comparison-stacked" data-comparison-stacked></div>
    <div class="comparison__explanation" data-comparison-explanation></div>
    <div class="comparison__actions">
      <button type="button" class="btn btn--primary" data-action="go-brief">Generate decision brief</button>
      <button type="button" class="btn btn--ghost" data-action="go-recommendation">Back to shortlist</button>
    </div>
  </div>
  `;
}

function briefHTML() {
  return `
  <div class="brief__inner">
    <div class="brief__head">
      <p class="section-eyebrow">Decision brief</p>
      <h1 class="section-title" id="brief-title">GCC Location Decision Brief</h1>
      <p class="brief__meta" data-brief-meta></p>
    </div>
    <div class="brief__actions no-print">
      <button type="button" class="btn btn--ghost btn--sm" data-action="go-assessment">Edit inputs</button>
      <button type="button" class="btn btn--ghost btn--sm" data-action="go-comparison">Back to comparison</button>
      <button type="button" class="btn btn--primary btn--sm" data-action="print-brief">Print / Save as PDF</button>
      <button type="button" class="btn btn--ghost btn--sm" data-action="reset">Start over</button>
    </div>
    <article class="brief__article" data-brief-article></article>
  </div>
  `;
}

function methodologyHTML() {
  return `
  <div class="methodology__inner">
    <div class="methodology__head">
      <p class="section-eyebrow">Methodology &amp; sources</p>
      <h1 class="section-title" id="methodology-title">How this brief is built</h1>
      <p class="section-lede">An evidence-first prototype. We surface what each cited source actually supports, and we keep missing evidence visible rather than filling gaps with scores.</p>
    </div>
    <div class="methodology__body" data-methodology-body></div>
    <div class="methodology__actions no-print">
      <button type="button" class="btn btn--ghost" data-action="close-methodology">Close</button>
      <button type="button" class="btn btn--ghost" data-action="go-landing">Back to start</button>
    </div>
  </div>
  `;
}

/* ----------------------------- Show / hide screens ----------------------------- */
function showScreen(name) {
  state.prevScreen = state.screen;
  state.screen = name;
  $$('.screen', $('[data-app-main]')).forEach((s) => {
    if (s.dataset.screen === name) s.removeAttribute('hidden');
    else s.setAttribute('hidden', '');
  });
  // Render the screen's dynamic content
  if (name === 'landing')      renderLandingDynamics();
  if (name === 'assessment')   renderAssessment();
  if (name === 'recommendation') renderRecommendation();
  if (name === 'comparison')   renderComparison();
  if (name === 'brief')        renderBrief();
  if (name === 'methodology')  renderMethodologyContent();
  updateHeader();
  persist();
  // Scroll to top of main
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function updateHeader() {
  const header = $('[data-app-header]');
  show(header);
  const progress = $('[data-app-progress]');
  const isAssessment = state.screen === 'assessment';
  if (isAssessment) show(progress); else hide(progress);

  // Toggle nav button visibility
  const comparisonBtn = header.querySelector('[data-action="go-comparison"]');
  const briefBtn = header.querySelector('[data-action="go-brief"]');
  if (comparisonBtn) comparisonBtn.hidden = !['recommendation', 'comparison', 'brief'].includes(state.screen);
  if (briefBtn) briefBtn.hidden = !['recommendation', 'comparison', 'brief'].includes(state.screen);

  // Progress stepper
  if (isAssessment) {
    $$('.progress-stepper__item', progress).forEach((item) => {
      const stepNum = parseInt(item.dataset.step, 10);
      item.classList.toggle('is-active', stepNum === state.assessmentStep);
      item.classList.toggle('is-done', stepNum < state.assessmentStep);
    });
  }
}

/* ----------------------------- Landing dynamics ----------------------------- */
function renderLandingDynamics() {
  // Nothing dynamic — landing is static HTML. Hook scroll-to-how.
}

/* ----------------------------- Assessment rendering ----------------------------- */
function renderAssessment() {
  const step = STEP_DEFS.find((s) => s.id === state.assessmentStep) || STEP_DEFS[0];
  setText($('[data-assessment-eyebrow]'), step.eyebrow);
  setText($('[data-assessment-title]'), step.title);
  setText($('[data-assessment-lead]'), step.lead);

  const meta = $('[data-assessment-meta]');
  if (step.id === 3) {
    setText(meta, `${state.priorities.length} / ${PRIORITY_MAX} selected`);
  } else {
    setText(meta, '');
  }

  // Update continue button label on last step
  const continueBtn = $('[data-action="assessment-continue"]');
  setText(continueBtn, step.id === 3 ? 'Generate my location brief' : 'Continue');

  // Update back button
  const backBtn = $('[data-action="assessment-back"]');
  if (state.assessmentStep === 1) {
    backBtn.textContent = 'Back to landing';
  } else {
    backBtn.textContent = 'Back';
  }

  // Render fields
  const body = $('[data-assessment-body]');
  clear(body);

  if (step.id === 3) {
    body.appendChild(renderPrioritiesField());
  } else {
    step.fields.forEach((fieldKey) => body.appendChild(renderField(fieldKey)));
    if (step.id === 3) {
      // (not used; priorities handled above)
    }
  }

  // If step 3, also render review summary above the priorities
  if (step.id === 3) {
    body.insertBefore(renderProfileReview(), body.firstChild);
  }
}

function renderField(fieldKey) {
  const def = FIELD_DEFS[fieldKey];
  if (!def) return el('div');

  const wrap = el('div', { class: 'field-block', dataset: { field: fieldKey } });
  const head = el('div', { class: 'field-block__head' }, [
    el('label', { class: 'field-block__label', id: `label-${fieldKey}` }, [
      document.createTextNode(def.label),
      def.skippable ? el('span', { class: 'field-block__tag' }, 'Optional · skippable') : null,
    ]),
  ]);
  wrap.appendChild(head);

  if (def.helper) {
    wrap.appendChild(el('p', { class: 'field-block__helper' }, def.helper));
  }

  const isRadio = !def.skippable || fieldKey !== 'india_presence' || true; // single-select
  const list = el('div', {
    class: 'option-list' + (def.options.length > 4 ? '' : ' is-single-col'),
    role: 'radiogroup',
    aria: { labelledby: `label-${fieldKey}` },
  });

  def.options.forEach((opt) => {
    const isSelected = state.profile[fieldKey] === opt;
    const isDefault = def.default === opt;
    const card = el('button', {
      type: 'button',
      class: 'option-card' + (isSelected ? ' is-selected' : ''),
      dataset: { field: fieldKey, value: opt },
      role: 'radio',
      aria: { checked: isSelected ? 'true' : 'false' },
      onClick: (e) => {
        e.preventDefault();
        updateProfile({ [fieldKey]: opt });
        // re-render the field only
        renderAssessment();
      },
    }, [
      el('span', { class: 'option-card__control option-card__control--radio', aria: { hidden: 'true' } }),
      el('span', { class: 'option-card__body' }, [
        el('span', { class: 'option-card__title' }, opt),
      ]),
      isDefault ? el('span', { class: 'option-card__default' }, 'Default') : null,
    ]);
    list.appendChild(card);
  });

  // For skippable fields, allow clearing
  if (def.skippable) {
    const clearCard = el('button', {
      type: 'button',
      class: 'option-card' + (state.profile[fieldKey] == null ? ' is-selected' : ''),
      dataset: { field: fieldKey, value: '' },
      role: 'radio',
      aria: { checked: state.profile[fieldKey] == null ? 'true' : 'false' },
      onClick: (e) => {
        e.preventDefault();
        updateProfile({ [fieldKey]: null });
        renderAssessment();
      },
    }, [
      el('span', { class: 'option-card__control option-card__control--radio', aria: { hidden: 'true' } }),
      el('span', { class: 'option-card__body' }, [
        el('span', { class: 'option-card__title' }, 'Prefer not to say / skip'),
      ]),
    ]);
    list.appendChild(clearCard);
  }

  wrap.appendChild(list);

  // Error message slot
  if (state.errors[fieldKey]) {
    wrap.classList.add('is-error');
    wrap.appendChild(el('p', { class: 'field-block__error' }, state.errors[fieldKey]));
  }

  return wrap;
}

function renderPrioritiesField() {
  const wrap = el('div', { class: 'field-block', dataset: { field: 'priorities' } });
  wrap.appendChild(el('div', { class: 'field-block__head' }, [
    el('label', { class: 'field-block__label', id: 'label-priorities' }, [
      document.createTextNode('Decision priorities'),
      el('span', { class: 'field-block__tag' }, `Choose up to ${PRIORITY_MAX}`),
    ]),
  ]));
  wrap.appendChild(el('p', { class: 'field-block__helper' },
    'Your selection focuses the comparison on the criteria that matter most. We will not invent scores for criteria with insufficient evidence.'));

  const list = el('div', {
    class: 'option-list',
    role: 'group',
    aria: { labelledby: 'label-priorities' },
  });

  PRIORITY_OPTIONS.forEach((opt) => {
    const isSelected = state.priorities.includes(opt.id);
    const isDefault = ['Talent availability', 'Operating cost', 'Scalability'].includes(opt.id);
    const card = el('button', {
      type: 'button',
      class: 'option-card' + (isSelected ? ' is-selected' : ''),
      dataset: { field: 'priorities', value: opt.id },
      role: 'checkbox',
      aria: { checked: isSelected ? 'true' : 'false' },
      onClick: (e) => {
        e.preventDefault();
        togglePriority(opt.id);
        renderAssessment();
      },
    }, [
      el('span', { class: 'option-card__control option-card__control--check', aria: { hidden: 'true' } }),
      el('span', { class: 'option-card__body' }, [
        el('span', { class: 'option-card__title' }, opt.id),
        el('span', { class: 'option-card__hint' }, opt.hint),
      ]),
      isDefault ? el('span', { class: 'option-card__default' }, 'Default') : null,
    ]);
    list.appendChild(card);
  });

  wrap.appendChild(list);

  if (state.errors.priorities) {
    wrap.classList.add('is-error');
    wrap.appendChild(el('p', { class: 'field-block__error' }, state.errors.priorities));
  }

  return wrap;
}

function togglePriority(priorityId) {
  const idx = state.priorities.indexOf(priorityId);
  if (idx >= 0) {
    state.priorities.splice(idx, 1);
  } else {
    if (state.priorities.length >= PRIORITY_MAX) {
      toast(`Up to ${PRIORITY_MAX} priorities. Remove one to add another.`);
      return;
    }
    state.priorities.push(priorityId);
  }
  state.errors = {};
  persist();
}

function renderProfileReview() {
  const review = el('div', { class: 'profile-review' });
  review.appendChild(el('p', { class: 'profile-review__title' }, 'Your inputs so far'));
  const grid = el('div', { class: 'profile-review__grid' });
  [
    ['Capability', state.profile.capability],
    ['Role family', state.profile.role_family],
    ['India presence', state.profile.india_presence || '—'],
    ['Initial headcount', state.profile.initial_headcount],
    ['Expected growth', state.profile.expected_growth],
    ['Launch timeline', state.profile.launch_timeline],
    ['Cost posture', state.profile.cost_posture],
  ].forEach(([k, v]) => {
    grid.appendChild(el('div', { class: 'profile-review__item' }, [
      el('span', { class: 'profile-review__key' }, k),
      el('span', { class: 'profile-review__val' }, v || '—'),
    ]));
  });
  review.appendChild(grid);
  return review;
}

/* ----------------------------- Recommendation rendering ----------------------------- */
function renderRecommendation() {
  const dataset = state.dataset;
  const rec = generateRecommendation(dataset, state.profile, state.priorities);

  // Profile summary
  renderProfileSummary($('[data-profile-summary]'));

  // Framing
  const framing = $('[data-recommendation-framing]');
  clear(framing);
  framing.appendChild(el('p', null, [
    el('strong', null, 'Your profile: '),
    document.createTextNode(profileSentence(state.profile, state.priorities)),
  ]));
  framing.appendChild(el('p', null, [
    el('strong', null, 'What the evidence supports: '),
    document.createTextNode(rec.reason || rec.resultType),
  ]));
  framing.appendChild(el('p', null, [
    el('strong', null, 'Why no winner: '),
    document.createTextNode(
      'Comparable role-level talent data, like-for-like all-in cost data, infrastructure-continuity data, and launch-readiness data are not available in this dataset. We therefore present an evidence-led candidate set, not a ranked winner.'
    ),
  ]));

  // City cards
  const cardsWrap = $('[data-city-cards]');
  clear(cardsWrap);
  rec.candidates.forEach((cand) => cardsWrap.appendChild(renderCityCard(cand, rec)));
}

function profileSentence(profile, priorities) {
  const parts = [
    profile.capability,
    `with ${profile.role_family.toLowerCase()}`,
    `· ${profile.initial_headcount} to start`,
    `· ${profile.expected_growth.toLowerCase()}`,
    `· launch ${profile.launch_timeline.toLowerCase()}`,
    `· ${profile.cost_posture.toLowerCase()}`,
  ];
  if (priorities && priorities.length) {
    parts.push(`· priorities: ${priorities.join(', ')}`);
  }
  return parts.join(' ');
}

function renderCityCard(cand, rec) {
  const { city, supportedCount, partialCount, insufficientCount, total } = cand;
  const lead = cand.leadSignal;
  const limit = cand.leadLimitation;

  const card = el('article', { class: 'city-card' });

  card.appendChild(el('div', { class: 'city-card__head' }, [
    el('div', null, [
      el('div', { class: 'city-card__name' }, city.name),
      el('div', { class: 'city-card__state' }, city.state),
    ]),
    el('span', {
      class: 'status-pill status-pill--' + (lead ? lead.status.replace('supported_market_signal', 'supported') : 'insufficient'),
    }, lead ? STATUS_LABELS[lead.status].full : 'No evidence'),
  ]));

  if (lead) {
    card.appendChild(el('p', { class: 'city-card__signal' }, lead.signal));
  } else {
    card.appendChild(el('p', { class: 'city-card__signal' }, 'No source-backed signal available in this dataset.'));
  }

  // Why it merits further investigation — derived from city_summary
  card.appendChild(el('p', { class: 'city-card__why' }, [
    el('strong', null, 'Why it merits evaluation: '),
    document.createTextNode(city.city_summary || 'See evidence detail.'),
  ]));

  // Lead limitation
  if (limit) {
    card.appendChild(el('div', { class: 'city-card__limit' }, [
      el('strong', null, 'Investigate: '),
      document.createTextNode(limit.text),
    ]));
  }

  // Coverage indicator
  const coverage = el('div', { class: 'city-card__coverage' });
  coverage.appendChild(el('span', null, `Evidence coverage · ${supportedCount}/${total} supported · ${insufficientCount}/${total} insufficient`));
  const bar = el('div', { class: 'city-card__coverage-bar' });
  (state.dataset.criteria || []).forEach((c) => {
    const status = getEvidenceStatus(city, c.id);
    bar.appendChild(el('span', { class: 'is-' + status.replace('supported_market_signal', 'supported') }));
  });
  coverage.appendChild(bar);
  card.appendChild(coverage);

  card.appendChild(el('button', {
    type: 'button',
    class: 'city-card__cta',
    onClick: () => openEvidencePanel(city.id, lead ? criterionIdFromEvidence(city, lead) : 'industry_ecosystem'),
  }, 'Explore evidence →'));

  return card;
}

function criterionIdFromEvidence(city, ev) {
  for (const [cid, e] of Object.entries(city.evidence || {})) {
    if (e === ev) return cid;
  }
  return 'industry_ecosystem';
}

/* ----------------------------- Profile summary ----------------------------- */
function renderProfileSummary(node) {
  if (!node) return;
  clear(node);
  node.appendChild(el('span', { class: 'profile-summary__label' }, 'Profile'));
  [
    state.profile.capability,
    state.profile.role_family,
    state.profile.initial_headcount,
    state.profile.cost_posture,
  ].forEach((v) => node.appendChild(el('span', { class: 'profile-summary__chip' }, v)));
  node.appendChild(el('span', { class: 'profile-summary__label' }, 'Priorities'));
  state.priorities.forEach((p) => node.appendChild(el('span', { class: 'profile-summary__chip profile-summary__chip--priority' }, p)));
  node.appendChild(el('button', {
    type: 'button',
    class: 'profile-summary__edit',
    onClick: () => goAssessmentStep(1),
  }, 'Edit'));
}

/* ----------------------------- Comparison rendering ----------------------------- */
function renderComparison() {
  const dataset = state.dataset;
  renderProfileSummary($('[data-profile-summary-2]'));

  // Priority lens chips
  const chipsWrap = $('[data-priority-lens-chips]');
  clear(chipsWrap);
  // Available lenses = union of selected priorities + all criteria (so the user can inspect any)
  const lenses = (dataset.criteria || []).map((c) => ({ id: c.id, label: c.label }));
  lenses.forEach((l) => {
    const isActive = state.priorityLens === l.id;
    chipsWrap.appendChild(el('button', {
      type: 'button',
      class: 'lens-chip' + (isActive ? ' is-active' : ''),
      dataset: { lens: l.id },
      onClick: () => {
        state.priorityLens = l.id;
        renderComparison();
        persist();
      },
    }, [
      el('span', { class: 'lens-chip__dot' }),
      document.createTextNode(l.label),
    ]));
  });

  // Lens summary
  renderLensSummary();

  // Comparison table (desktop)
  renderComparisonTable();

  // Comparison stacked (mobile)
  renderComparisonStacked();

  // Explanation
  renderComparisonExplanation();
}

function renderLensSummary() {
  const wrap = $('[data-priority-lens-summary]');
  clear(wrap);
  const criterion = getCriterion(state.dataset, state.priorityLens);
  if (!criterion) return;
  const cities = state.dataset.cities || [];

  const statuses = cities.map((c) => getEvidenceStatus(c, state.priorityLens));
  const hasInsufficient = statuses.some((s) => s === 'insufficient');
  const hasSupported = statuses.some((s) => s === 'supported_market_signal');
  const hasPartial = statuses.some((s) => s === 'partial');

  wrap.appendChild(el('strong', null, criterion.label + '. '));
  const bits = [];
  if (hasSupported) bits.push('at least one city has a supported market signal');
  if (hasPartial)   bits.push('at least one city has partial evidence');
  if (hasInsufficient) bits.push('at least one city has insufficient evidence');
  wrap.appendChild(document.createTextNode(
    `Across the four candidates, ${bits.join(', ')}. ` +
    `This is an evidence state, not a quality rating — do not infer a city ranking from it.`
  ));

  if (hasInsufficient) {
    wrap.appendChild(el('span', { class: 'priority-lens__gap' },
      '⚠ Comparable numeric evidence is missing for at least one city. Composite scoring is disabled.'));
  }
}

function renderComparisonTable() {
  const wrap = $('[data-comparison-table-wrap]');
  clear(wrap);
  const dataset = state.dataset;
  const cities = dataset.cities || [];
  const criteria = dataset.criteria || [];

  const table = el('table', { class: 'comparison-table' });

  // thead
  const thead = el('thead');
  const headRow = el('tr');
  headRow.appendChild(el('th', { scope: 'col' }, 'Criterion'));
  cities.forEach((c) => {
    headRow.appendChild(el('th', { scope: 'col', class: state.priorityLens === 'overview' ? '' : '' }, [
      el('div', { class: 'city-head' }, [
        el('span', { class: 'city-head__name' }, c.name),
        el('span', { class: 'city-head__state' }, c.state),
      ]),
    ]));
  });
  thead.appendChild(headRow);
  table.appendChild(thead);

  // tbody
  const tbody = el('tbody');
  criteria.forEach((crit) => {
    const tr = el('tr', { class: state.priorityLens === crit.id ? 'is-active' : '' });
    tr.appendChild(el('td', { class: 'criterion-cell', scope: 'row' }, [
      document.createTextNode(crit.label),
      el('span', { class: 'criterion-cell__unit' }, crit.unit || ''),
    ]));
    cities.forEach((c) => {
      const ev = getCityEvidence(c, crit.id);
      tr.appendChild(el('td', null, [renderCell(c, crit.id, ev)]));
    });
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  wrap.appendChild(table);
}

function renderCell(city, criterionId, ev) {
  const status = ev ? ev.status : 'insufficient';
  const statusClass = status.replace('supported_market_signal', 'supported');
  const finding = ev ? ev.signal : 'Evidence unavailable.';
  const content = el('div', {
    class: 'cell-content',
    dataset: { status: statusClass, cityId: city.id, criterionId },
    role: 'button',
    tabindex: '0',
    aria: { label: `Open evidence for ${city.name}, ${CRITERION_LABELS[criterionId] || criterionId}` },
    onClick: () => openEvidencePanel(city.id, criterionId),
    onKeyDown: (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openEvidencePanel(city.id, criterionId); }
    },
  }, [
    el('div', { class: 'cell-content__status' }, [
      el('span', { class: 'status-pill status-pill--' + statusClass }, STATUS_LABELS[status].full),
    ]),
    el('div', { class: 'cell-content__finding' }, finding),
    el('span', { class: 'cell-content__link' }, 'Explore evidence →'),
  ]);
  return content;
}

function renderComparisonStacked() {
  const wrap = $('[data-comparison-stacked]');
  clear(wrap);
  const dataset = state.dataset;
  const cities = dataset.cities || [];
  const criteria = dataset.criteria || [];
  cities.forEach((c) => {
    const cityBlock = el('div', { class: 'comparison-stacked__city' });
    cityBlock.appendChild(el('div', { class: 'comparison-stacked__city-head' }, [
      el('span', { class: 'comparison-stacked__city-name' }, c.name),
      el('span', { class: 'comparison-stacked__city-state' }, c.state),
    ]));
    criteria.forEach((crit) => {
      const ev = getCityEvidence(c, crit.id);
      const status = ev ? ev.status : 'insufficient';
      const statusClass = status.replace('supported_market_signal', 'supported');
      const row = el('div', { class: 'comparison-stacked__row' + (state.priorityLens === crit.id ? ' is-active' : '') });
      row.appendChild(el('div', { class: 'comparison-stacked__criterion' }, [
        el('span', null, crit.label),
        el('span', { class: 'status-pill status-pill--' + statusClass }, STATUS_LABELS[status].short),
      ]));
      row.appendChild(el('div', {
        class: 'cell-content',
        dataset: { status: statusClass, cityId: c.id, criterionId: crit.id },
        role: 'button',
        tabindex: '0',
        onClick: () => openEvidencePanel(c.id, crit.id),
        onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openEvidencePanel(c.id, crit.id); } },
      }, [
        el('div', { class: 'cell-content__finding' }, ev ? ev.signal : 'Evidence unavailable.'),
        el('span', { class: 'cell-content__link' }, 'Explore evidence →'),
      ]));
      cityBlock.appendChild(row);
    });
    wrap.appendChild(cityBlock);
  });
}

function renderComparisonExplanation() {
  const wrap = $('[data-comparison-explanation]');
  clear(wrap);
  wrap.appendChild(el('h2', null, 'What this comparison tells you'));
  const ul = el('ul');
  const items = [
    'Bengaluru and Hyderabad show strong established GCC and technology-market signals.',
    'Chennai shows strong recent GCC leasing growth and relevant engineering/manufacturing ecosystem signals.',
    'Pune is a credible alternative for selected technology, engineering, and financial-services roles.',
    'None of these observations establishes a company-specific winner.',
    'Comparable cost, exact role-level talent, infrastructure, and launch-readiness evidence are still required.',
  ];
  items.forEach((t) => ul.appendChild(el('li', null, t)));
  wrap.appendChild(ul);

  // Add note about what is NOT inferred
  wrap.appendChild(el('p', { style: 'margin-top:1rem; font-family:var(--font-mono); font-size:11px; color:var(--ink-400); letter-spacing:0.04em;' },
    'Note · Office leasing volume is a proxy for ecosystem activity, not a measure of talent supply, total operating cost, or launch readiness. Status labels reflect evidence state, not city quality.'
  ));
}

/* ----------------------------- Evidence panel ----------------------------- */
function openEvidencePanel(cityId, criterionId) {
  state.evidencePanel = { cityId, criterionId };
  renderEvidencePanel();
  const drawer = $('[data-evidence-drawer]');
  show(drawer);
  drawer.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
  // focus close
  setTimeout(() => {
    const closeBtn = drawer.querySelector('[data-action="close-evidence"]');
    if (closeBtn) closeBtn.focus();
  }, 50);
}

function closeEvidencePanel() {
  state.evidencePanel = null;
  const drawer = $('[data-evidence-drawer]');
  hide(drawer);
  drawer.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
}

function renderEvidencePanel() {
  const { cityId, criterionId } = state.evidencePanel || {};
  const city = findCity(state.dataset, cityId);
  const criterion = getCriterion(state.dataset, criterionId);
  const ev = city ? getCityEvidence(city, criterionId) : null;

  const titleEl = $('[data-evidence-title]');
  const eyebrowEl = $('[data-evidence-eyebrow]');
  const bodyEl = $('[data-evidence-body]');

  setText(eyebrowEl, `Evidence · ${city ? city.name : 'Unknown city'} · ${criterion ? criterion.label : criterionId}`);
  setText(titleEl, criterion ? criterion.label : criterionId);

  clear(bodyEl);

  if (!city || !ev) {
    bodyEl.appendChild(el('div', { class: 'ev-section' }, [
      el('div', { class: 'ev-section__label' }, 'Status'),
      el('div', { class: 'ev-section__body' }, [
        el('span', { class: 'status-pill status-pill--insufficient' }, 'Evidence unavailable'),
        el('p', { style: 'margin-top:0.6rem;' },
          'No comparable evidence in this dataset supports a reliable assessment for this criterion. We do not invent a replacement source.'
        ),
      ]),
    ]));
    return;
  }

  // Status
  bodyEl.appendChild(el('div', { class: 'ev-section' }, [
    el('div', { class: 'ev-section__label' }, 'Evidence status'),
    el('div', { class: 'ev-section__body' }, [
      el('span', { class: 'status-pill status-pill--' + ev.status.replace('supported_market_signal', 'supported') }, STATUS_LABELS[ev.status].full),
      el('p', { style: 'margin-top:0.5rem; font-size:0.85rem; color:var(--ink-600);' },
        statusDefinition(ev.status)),
    ]),
  ]));

  // Finding
  bodyEl.appendChild(el('div', { class: 'ev-section' }, [
    el('div', { class: 'ev-section__label' }, 'Finding'),
    el('div', { class: 'ev-section__body' }, ev.signal),
  ]));

  // Decision implication
  bodyEl.appendChild(el('div', { class: 'ev-section' }, [
    el('div', { class: 'ev-section__label' }, 'Decision implication'),
    el('div', { class: 'ev-section__body' }, ev.decision_implication || '—'),
  ]));

  // Limitations
  bodyEl.appendChild(el('div', { class: 'ev-section ev-section--limitations' }, [
    el('div', { class: 'ev-section__label' }, 'Limitations'),
    el('div', { class: 'ev-section__body' }, ev.limitations || '—'),
  ]));

  // Micro-markets (if available for this city)
  if (city.key_micro_markets && city.key_micro_markets.length) {
    bodyEl.appendChild(el('div', { class: 'ev-section' }, [
      el('div', { class: 'ev-section__label' }, 'Key micro-markets (cited)'),
      el('div', { class: 'ev-section__body' }, city.key_micro_markets.map((m) => m.name).join(' · ')),
    ]));
  }

  // Sources
  bodyEl.appendChild(el('div', { class: 'ev-section' }, [
    el('div', { class: 'ev-section__label' }, 'Sources'),
    el('div', { class: 'ev-section__body' }, resolveSources(state.dataset, ev.source_ids).map((s) => renderSourceCard(s))),
  ]));
}

function renderSourceCard(source) {
  if (!source) return el('div', { class: 'ev-source' }, [el('em', null, 'Source unavailable.')]);
  const card = el('div', { class: 'ev-source' });
  card.appendChild(el('div', { class: 'ev-source__head' }, [
    el('span', { class: 'ev-source__id' }, source.id),
    el('span', { class: 'ev-source__date' }, source.published || ''),
  ]));
  card.appendChild(el('div', { class: 'ev-source__title' }, source.title));
  card.appendChild(el('div', { class: 'ev-source__publisher' }, source.publisher));
  if (source.url && isHttpUrl(source.url)) {
    const a = el('a', {
      class: 'ev-source__url',
      href: source.url,
      target: '_blank',
      rel: 'noopener noreferrer nofollow',
    }, source.url);
    card.appendChild(a);
  }
  if (source.limitations) {
    card.appendChild(el('div', { class: 'brief-source__limit', style: 'margin-top:0.5rem;' }, source.limitations));
  }
  return card;
}

function statusDefinition(status) {
  const map = (state.dataset && state.dataset.methodology && state.dataset.methodology.status_definitions) || {};
  return map[status] || '';
}

function isHttpUrl(url) {
  try {
    const u = new URL(String(url));
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch (_) { return false; }
}

/* ----------------------------- Brief rendering ----------------------------- */
function renderBrief() {
  const dataset = state.dataset;
  const meta = $('[data-brief-meta]');
  const dateStr = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  setText(meta, `Generated ${dateStr} · Dataset v${dataset.version || '1.0.0'} · Research cut-off ${dataset.research_cutoff || ''}`);

  const article = $('[data-brief-article]');
  clear(article);

  // Section A — Executive summary
  article.appendChild(renderBriefSection('A', 'Executive summary', [
    el('p', null, [
      el('strong', null, 'Profile: '),
      document.createTextNode(profileSentence(state.profile, state.priorities)),
    ]),
    el('p', null,
      'The available evidence supports evaluating four candidate Indian cities for your Global Capability Centre. It does not establish a definitive winner for your exact requirements.'
    ),
    el('p', null, [
      el('strong', null, 'Why no winner: '),
      document.createTextNode(
        'The profile requests multiple functions and mixed roles, while comparable role-level talent data, like-for-like all-in cost data, infrastructure-continuity data, and launch-readiness data are not available in this dataset. Composite scoring is therefore disabled, and cities are presented as candidates for further evaluation.'
      ),
    ]),
    el('p', null, [
      el('strong', null, 'Use this brief to: '),
      document.createTextNode(
        'align leadership on the candidate set, the evidence gaps, and the next inputs required before a defensible location decision can be made.'
      ),
    ]),
  ]));

  // Section B — Company requirements
  article.appendChild(renderBriefSection('B', 'Company requirements', [
    renderRequirementsGrid(),
  ]));

  // Section C — Candidate location assessment
  const cityBlock = el('div');
  (dataset.cities || []).forEach((c) => cityBlock.appendChild(renderBriefCity(c)));
  article.appendChild(renderBriefSection('C', 'Candidate location assessment', [cityBlock]));

  // Section D — Priority-specific findings
  article.appendChild(renderBriefSection('D', 'Priority-specific findings', renderPriorityFindings()));

  // Section E — Risks and open questions
  article.appendChild(renderBriefSection('E', 'Risks and open questions', [
    el('ul', null, [
      el('li', null, 'Which specific roles and seniority levels must be hired?'),
      el('li', null, 'What salary assumptions should be used for each role family?'),
      el('li', null, 'What office model and micro-market should be compared?'),
      el('li', null, 'What does "launch within six months" include — entity, hiring, office, IT, security, vendors, compliance?'),
      el('li', null, 'Which setup dependencies have already been completed?'),
      el('li', null, 'What evidence is needed to evaluate operational continuity (power, connectivity, commute, BCP)?'),
      el('li', null, 'Are state GCC policies (e.g., Maharashtra, Gujarat) applicable to this company profile?'),
    ]),
  ]));

  // Section F — Recommended next steps
  article.appendChild(renderBriefSection('F', 'Recommended next steps', [
    el('ol', null, [
      el('li', null, 'Specify the top two or three functions and priority role families, with target hiring volumes and seniority mix.'),
      el('li', null, 'Gather comparable role-level salary and hiring evidence for the four candidate cities using the same date and assumptions.'),
      el('li', null, 'Compare like-for-like office and operating costs (rent + fit-out + recurring charges) for a consistent micro-market and seat count.'),
      el('li', null, 'Validate site-specific office availability and launch dependencies (entity, compliance, hiring lead times, vendor mobilisation).'),
      el('li', null, 'Define a continuity indicator set (power, connectivity, commute) and validate per micro-market.'),
      el('li', null, 'Revisit the shortlist once critical evidence gaps are resolved.'),
    ]),
  ]));

  // Section G — Sources and methodology
  const sourcesBlock = el('div');
  (dataset.sources || []).forEach((s) => sourcesBlock.appendChild(renderBriefSource(s)));
  article.appendChild(renderBriefSection('G', 'Sources and methodology', [
    el('p', null, [
      el('strong', null, 'Methodology: '),
      document.createTextNode(dataset.methodology && dataset.methodology.approach || 'Evidence-first.'),
    ]),
    el('p', { style: 'margin-top:0.5rem;' }, [
      el('strong', null, 'Scoring rule: '),
      document.createTextNode(dataset.methodology && dataset.methodology.scoring_rule || 'Composite scoring disabled when any weighted criterion lacks comparable data.'),
    ]),
    el('p', { style: 'margin-top:0.75rem;' }, 'Sources used in this brief:'),
    sourcesBlock,
  ]));

  // Critical caveats
  if (dataset.methodology && dataset.methodology.critical_caveats && dataset.methodology.critical_caveats.length) {
    article.appendChild(renderBriefSection('', 'Critical caveats', [
      el('ul', null, dataset.methodology.critical_caveats.map((c) => el('li', null, c))),
    ]));
  }
}

function renderBriefSection(letter, title, children) {
  const sec = el('section', { class: 'brief-section' });
  sec.appendChild(el('div', { class: 'brief-section__head' }, [
    letter ? el('span', { class: 'brief-section__num' }, `Section ${letter}`) : el('span', { class: 'brief-section__num' }, 'Note'),
    el('h2', { class: 'brief-section__title' }, title),
  ]));
  children.forEach((c) => sec.appendChild(c));
  return sec;
}

function renderRequirementsGrid() {
  const grid = el('div', { class: 'brief-requirements' });
  const rows = [
    ['Primary capability', state.profile.capability],
    ['Role family', state.profile.role_family],
    ['Existing India presence', state.profile.india_presence || 'Not provided'],
    ['Initial headcount', state.profile.initial_headcount],
    ['Expected growth', state.profile.expected_growth],
    ['Launch timeline', state.profile.launch_timeline],
    ['Cost posture', state.profile.cost_posture],
    ['Selected priorities', state.priorities.join('; ')],
  ];
  rows.forEach(([k, v]) => grid.appendChild(el('div', { class: 'brief-requirements__item' }, [
    el('span', { class: 'brief-requirements__key' }, k),
    el('span', { class: 'brief-requirements__val' }, v || '—'),
  ])));
  return grid;
}

function renderBriefCity(city) {
  const wrap = el('div', { class: 'brief-city' });
  wrap.appendChild(el('div', { class: 'brief-city__head' }, [
    el('span', { class: 'brief-city__name' }, `${city.name}, ${city.state}`),
    el('span', { class: 'brief-city__state' }, city.market_position || ''),
  ]));

  const body = el('div', { class: 'brief-city__body' });

  // Why it merits evaluation
  const ecosystem = getCityEvidence(city, 'industry_ecosystem');
  body.appendChild(el('p', null, [
    el('span', { class: 'label' }, 'Why it merits evaluation'),
    document.createTextNode(city.city_summary || (ecosystem ? ecosystem.signal : '—')),
  ]));

  // Relevant ecosystem signals
  if (ecosystem) {
    body.appendChild(el('p', null, [
      el('span', { class: 'label' }, 'Ecosystem signal'),
      document.createTextNode(ecosystem.signal),
    ]));
  }

  // Important gaps (pull insufficient + partial limitations)
  const gaps = (state.dataset.criteria || [])
    .map((c) => ({ c, ev: getCityEvidence(city, c.id) }))
    .filter(({ ev }) => ev && (ev.status === 'insufficient' || ev.status === 'partial'))
    .map(({ c, ev }) => `${c.label}: ${ev.limitations || ev.signal}`);

  body.appendChild(el('p', null, [
    el('span', { class: 'label' }, 'Important gaps'),
    document.createTextNode(gaps.length ? gaps.join(' ') : 'No gaps recorded.'),
  ]));

  // Questions that must be answered before a decision
  const lr = getCityEvidence(city, 'launch_readiness');
  const oc = getCityEvidence(city, 'operating_cost');
  const ta = getCityEvidence(city, 'talent_availability');
  body.appendChild(el('p', null, [
    el('span', { class: 'label' }, 'Questions before a decision'),
    document.createTextNode(
      [
        ta ? ta.decision_implication : null,
        oc ? oc.decision_implication : null,
        lr ? lr.decision_implication : null,
      ].filter(Boolean).join(' '),
    ),
  ]));

  wrap.appendChild(body);
  return wrap;
}

function renderPriorityFindings() {
  const items = state.priorities.map((p) => {
    const cid = PRIORITY_TO_CRITERION[p];
    if (!cid) return null;
    const criterion = getCriterion(state.dataset, cid);
    const cities = state.dataset.cities || [];
    const statuses = cities.map((c) => ({ city: c, ev: getCityEvidence(c, cid) }));
    const hasInsufficient = statuses.some((s) => !s.ev || s.ev.status === 'insufficient');

    return el('div', { class: 'brief-city' }, [
      el('div', { class: 'brief-city__head' }, [
        el('span', { class: 'brief-city__name' }, p),
        el('span', { class: 'brief-city__state' }, hasInsufficient ? 'Insufficient comparable evidence' : 'Mixed evidence'),
      ]),
      el('div', { class: 'brief-city__body' }, [
        el('p', null, [
          el('span', { class: 'label' }, 'What the dataset supports'),
          document.createTextNode(priorityFindingText(p, statuses)),
        ]),
        el('p', null, [
          el('span', { class: 'label' }, 'Gap'),
          document.createTextNode(priorityGapText(p, cid, criterion)),
        ]),
      ]),
    ]);
  }).filter(Boolean);

  if (!items.length) {
    return [el('p', null, 'No priorities selected — the brief cannot highlight priority-specific findings.')];
  }
  return items;
}

function priorityFindingText(priority, statuses) {
  if (priority === 'Talent availability') {
    return 'Sector-level signals exist (technology, financial services, engineering/manufacturing), but the profile\'s mixed-role scope is too broad to estimate role-specific availability, salary, or time-to-hire for any city.';
  }
  if (priority === 'Operating cost') {
    return 'No comparable all-in cost figures are included for any city. Rent proxies and leasing volume are not substitutes for like-for-like role-level salary plus occupancy estimates.';
  }
  if (priority === 'Scalability') {
    return 'Market-level leasing depth and office-completion pipeline provide a positive signal for Bengaluru, Hyderabad, Chennai, and Pune. None of these signals isolates this company\'s ability to scale its exact roles at its target cost.';
  }
  if (priority === 'Industry ecosystem') {
    return 'Supported GCC ecosystem signals exist for all four cities, with micro-markets identified (Bengaluru ORR/Whitefield/North, Hyderabad SBD/Off-SBD, Chennai OMR/MPR/PTR, Pune Kharadi). Ecosystem presence does not prove fit for every role family or budget.';
  }
  if (priority === 'Infrastructure & continuity') {
    return 'No consistent, comparable city-level continuity dataset is included. Operational reliability must be validated per micro-market during due diligence.';
  }
  return 'See evidence panel for details.';
}

function priorityGapText(priority, criterionId, criterion) {
  if (!criterion) return 'Criterion not found.';
  if (priority === 'Talent availability') return 'Specify the top role families and seniority mix, then obtain role-level supply, salary, and time-to-hire estimates per city.';
  if (priority === 'Operating cost') return 'Request same-date, like-for-like salary and occupancy estimates for a consistent office model, micro-market, and seat count.';
  if (priority === 'Scalability') return 'Test company-specific expansion paths: hiring funnel per role family, suitable office availability, and budget per seat over 12–36 months.';
  if (priority === 'Industry ecosystem') return 'Map the relevant ecosystem (anchor customers, suppliers, support services) per role family and validate fit for this company\'s mandate.';
  if (priority === 'Infrastructure & continuity') return 'Define a continuity indicator set (power, connectivity, commute, BCP) and validate per micro-market.';
  return 'Resolve evidence gaps before relying on this criterion for a decision.';
}

function renderBriefSource(source) {
  const wrap = el('div', { class: 'brief-source' });
  wrap.appendChild(el('div', { class: 'brief-source__id' }, source.id));
  wrap.appendChild(el('div', null, [
    el('div', { class: 'brief-source__title' }, source.title),
    el('div', { class: 'brief-source__meta' }, `${source.publisher} · ${source.published || ''}`),
  ]));
  if (source.url && isHttpUrl(source.url)) {
    wrap.appendChild(el('a', {
      class: 'brief-source__url',
      href: source.url,
      target: '_blank',
      rel: 'noopener noreferrer nofollow',
    }, 'Open source ↗'));
  } else {
    wrap.appendChild(el('span', { class: 'brief-source__url', style: 'color:var(--ink-400);' }, 'No URL'));
  }
  if (source.limitations) {
    wrap.appendChild(el('div', { class: 'brief-source__limit' }, source.limitations));
  }
  return wrap;
}

/* ----------------------------- Methodology rendering ----------------------------- */
function renderMethodologyContent() {
  const dataset = state.dataset;
  if (!dataset) return;
  const modalBody = $('[data-methodology-modal-body]');
  const screenBody = $('[data-methodology-body]');
  const html = buildMethodologyHTML(dataset);
  if (modalBody) { clear(modalBody); modalBody.innerHTML = html; }
  if (screenBody) { clear(screenBody); screenBody.innerHTML = html; }
}

function buildMethodologyHTML(dataset) {
  const m = dataset.methodology || {};
  const sources = dataset.sources || [];
  const caveats = m.critical_caveats || [];

  const statusDefHTML = Object.entries(m.status_definitions || {}).map(([k, v]) => `
    <p><span class="status-pill status-pill--${k.replace('supported_market_signal', 'supported')}">${STATUS_LABELS[k] ? STATUS_LABELS[k].full : k}</span> ${escapeHTML(v)}</p>
  `).join('');

  const sourcesHTML = sources.map((s) => `
    <div class="brief-source">
      <div class="brief-source__id">${escapeHTML(s.id)}</div>
      <div>
        <div class="brief-source__title">${escapeHTML(s.title)}</div>
        <div class="brief-source__meta">${escapeHTML(s.publisher)} · ${escapeHTML(s.published || '')}</div>
      </div>
      ${s.url && isHttpUrl(s.url) ? `<a class="brief-source__url" href="${escapeHTML(s.url)}" target="_blank" rel="noopener noreferrer nofollow">Open source ↗</a>` : '<span class="brief-source__url" style="color:var(--ink-400);">No URL</span>'}
      ${s.limitations ? `<div class="brief-source__limit">${escapeHTML(s.limitations)}</div>` : ''}
    </div>
  `).join('');

  return `
    <h3>Approach</h3>
    <p>${escapeHTML(m.approach || 'Evidence-first.')}</p>

    <h3>Evidence categories</h3>
    ${statusDefHTML}

    <h3>Comparison principles</h3>
    <ul>
      <li>Compare equivalent measures wherever possible.</li>
      <li>Keep source dates and definitions visible.</li>
      <li>Do not treat office leasing as a direct measure of talent availability.</li>
      <li>Do not treat market growth as proof of company-specific scalability.</li>
      <li>Do not assume incentives apply without checking eligibility.</li>
      <li>Do not infer launch timelines from city-level information.</li>
      <li>Keep missing evidence visible.</li>
      <li>Separate user preferences from observed city data.</li>
    </ul>

    <h3>Scoring policy</h3>
    <p>${escapeHTML(m.scoring_rule || 'Composite scoring disabled when any weighted criterion lacks comparable data.')}</p>
    <p><strong>Illustrative weights (talent, cost, scalability):</strong> ${formatWeights(m.weighting)}.</p>
    <p style="font-family:var(--font-mono); font-size:11px; color:var(--ink-400); letter-spacing:0.04em;">${escapeHTML(m.weighting_note || '')}</p>

    <h3>Critical caveats</h3>
    <ul>${caveats.map((c) => `<li>${escapeHTML(c)}</li>`).join('')}</ul>

    <h3>Sources</h3>
    ${sourcesHTML}
  `;
}

function formatWeights(w) {
  if (!w) return 'not specified';
  return Object.entries(w).map(([k, v]) => `${CRITERION_LABELS[k] || k}: ${Math.round(v * 100)}%`).join(' · ');
}

function escapeHTML(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* ----------------------------- Methodology modal ----------------------------- */
function openMethodology() {
  // The methodology dialog is the topmost layer. Dismiss any open evidence
  // drawer so closing the dialog returns to the page instead of revealing it.
  const drawer = $('[data-evidence-drawer]');
  if (drawer && !drawer.hidden) closeEvidencePanel();
  renderMethodologyContent();
  const modal = $('[data-methodology-modal]');
  show(modal);
  modal.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
  setTimeout(() => {
    const closeBtn = modal.querySelector('[data-action="close-methodology"]');
    if (closeBtn) closeBtn.focus();
  }, 50);
}

function closeMethodology() {
  const modal = $('[data-methodology-modal]');
  hide(modal);
  modal.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
}

/* ----------------------------- Toast ----------------------------- */
let toastTimer = null;
function toast(msg) {
  const t = $('[data-toast]');
  setText(t, msg);
  show(t);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => hide(t), 2800);
}

/* ----------------------------- Navigation actions ----------------------------- */
function startAssessment() {
  state.assessmentStep = 1;
  state.errors = {};
  showScreen('assessment');
}

function goAssessmentStep(step) {
  state.assessmentStep = step;
  state.errors = {};
  showScreen('assessment');
}

function assessmentBack() {
  if (state.assessmentStep > 1) {
    state.assessmentStep -= 1;
    state.errors = {};
    renderAssessment();
    persist();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } else {
    showScreen('landing');
  }
}

function assessmentContinue() {
  const errs = validateAssessment(state.assessmentStep);
  if (Object.keys(errs).length) {
    state.errors = errs;
    renderAssessment();
    return;
  }
  if (state.assessmentStep < STEP_DEFS.length) {
    state.assessmentStep += 1;
    state.errors = {};
    renderAssessment();
    persist();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } else {
    // Step 3 done — go to recommendation
    showScreen('recommendation');
  }
}

function resetAssessment() {
  state.profile = getDefaultProfile(state.dataset);
  state.priorities = getDefaultPriorities(state.dataset);
  state.priorityLens = PRIORITY_TO_CRITERION[state.priorities[0]] || 'talent_availability';
  state.assessmentStep = 1;
  state.errors = {};
  state.evidencePanel = null;
  closeEvidencePanel();
  clearPersisted();
  showScreen('landing');
  toast('Assessment reset to defaults.');
}

function editPriorities() {
  state.assessmentStep = 3;
  showScreen('assessment');
}

function printBrief() {
  // ensure brief is the visible screen
  if (state.screen !== 'brief') showScreen('brief');
  setTimeout(() => window.print(), 200);
}

function scrollToHow() {
  const how = document.getElementById('how');
  if (how) how.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/* ----------------------------- Event binding ----------------------------- */
function bindGlobalEvents() {
  // Delegate clicks via data-action
  document.addEventListener('click', handleActionClick);
  // Escape key for drawer/modal
  document.addEventListener('keydown', handleKeyDown);
}

function handleActionClick(e) {
  const target = e.target.closest('[data-action]');
  if (!target) return;
  const action = target.dataset.action;
  switch (action) {
    case 'start-assessment':    startAssessment(); break;
    case 'go-landing':          showScreen('landing'); break;
    case 'go-assessment':       goAssessmentStep(1); break;
    case 'go-recommendation':   showScreen('recommendation'); break;
    case 'go-comparison':       showScreen('comparison'); break;
    case 'go-brief':            showScreen('brief'); break;
    case 'open-methodology':    openMethodology(); break;
    case 'close-methodology':   closeMethodology(); break;
    case 'open-sources':        openMethodology(); break;
    case 'close-evidence':      closeEvidencePanel(); break;
    case 'assessment-back':     assessmentBack(); break;
    case 'assessment-continue': assessmentContinue(); break;
    case 'edit-priorities':     editPriorities(); break;
    case 'reset':               resetAssessment(); break;
    case 'print-brief':         printBrief(); break;
    case 'scroll-how':          scrollToHow(); break;
    default: break;
  }
}

function handleKeyDown(e) {
  if (e.key === 'Escape') {
    const drawer = $('[data-evidence-drawer]');
    const modal = $('[data-methodology-modal]');
    if (modal && !modal.hidden) { closeMethodology(); return; }
    if (drawer && !drawer.hidden) { closeEvidencePanel(); return; }
  }
}

/* ----------------------------- Boot ----------------------------- */
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
