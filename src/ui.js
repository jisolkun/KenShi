import { WEAPONS, getWeapon, DEFAULT_WEAPON_ID, isWeaponUnlocked } from './weapons.js';
import { isMobileFullscreen, isPhoneBrowser } from './fullscreen.js';

const icon = (content, className = '') => `<svg class="${className}" viewBox="0 0 40 40" fill="none" aria-hidden="true">${content}</svg>`;
const icons = [
  icon('<path d="m8 31 20-23 7-3-3 8-20 22z" fill="currentColor"/><path d="m9 23 9 8M5 35l5-5M4 15h13M2 20h10" stroke="currentColor" stroke-width="2"/>'),
  icon('<path d="M30 11A14 14 0 1 0 34 26M30 5v8h-8" stroke="currentColor" stroke-width="2"/><path d="m12 28 13-17 6-3-3 6-12 18z" fill="currentColor"/>'),
  icon('<path d="m20 4-6 8h4v11h4V12h4zM6 30l11-4 3-11 3 11 11 4-11 3-3 5-3-5z" fill="currentColor"/>'),
  icon('<path d="M20 4v32M6 12l28 16M6 28l28-16M15 7l5 5 5-5M15 33l5-5 5 5M7 18l7-2-2-7M28 31l-2-7 7-2M7 22l7 2-2 7M28 9l-2 7 7 2" stroke="currentColor" stroke-width="2"/>'),
  icon('<path d="m8 24 13-15 2-6 3 7-3 4-10 13zM19 32l13-15 2-6 3 7-3 4-10 13zM3 32l7-3-4-5z" fill="currentColor"/>'),
];
// Single-saber techniques: narrow point, opposing cuts, rise/fall, intercept,
// and retreat/reverse. Inherit the HUD's gold currentColor and 40-unit viewBox.
const yanlingSkillIcons = [
  '<path d="M20 34V10l-3 4 3-10 3 10-3-4M16 27h8M13 32v-5M27 32v-5" stroke="currentColor" stroke-width="2" stroke-linejoin="bevel"/>',
  '<path d="m18 10-9 5-4 9m0-6v6h6M22 30l9-5 4-9m0 6v-6h-6M11 28l17-16M11 23l5 5M24 12l5 5" stroke="currentColor" stroke-width="2" stroke-linejoin="bevel"/>',
  '<path d="m6 30 14-21m-7 2 7-2v7M25 10l9 21m-6-3 6 3 1-7M11 32l12-18M18 28l11-16" stroke="currentColor" stroke-width="2" stroke-linejoin="bevel"/>',
  '<path d="m8 7 20 20m-6-1 6 1-1-6M33 32H7l5-4m-5 4 5 4M9 20l9-9M10 21l18 1" stroke="currentColor" stroke-width="2" stroke-linejoin="bevel"/>',
  '<path d="M18 33H6l4-4m-4 4 4 3M9 22l8-11 13-4m-5-2 5 2-2 5M13 26l20-13M14 21l5 8M25 15l5 7" stroke="currentColor" stroke-width="2" stroke-linejoin="bevel"/>',
];
const specialIcons = {
  horse: icon('<path d="m9 31 1-12 6-7-1-7 9 6 9 2-1 8-7-3-2 13M15 8l6 8M13 28h13" stroke="currentColor" stroke-width="2"/><circle cx="27" cy="15" r="1" fill="currentColor"/>'),
  eagle: icon('<path d="m20 21-6-8L3 7l4 14 9 4 4 10 4-10 9-4 4-14-11 6z" stroke="currentColor" stroke-width="2"/><path d="m16 19 4-5 4 5-4 6z" fill="currentColor"/>'),
  captain: icon('<path d="M12 16V9l8-5 8 5v7l-8 8zM6 35l2-8 8-4 4 6 4-6 8 4 2 8M11 12h18" stroke="currentColor" stroke-width="2"/><path d="M17 15h6v4h-6z" fill="currentColor"/>'),
};
const lockIcon = icon('<rect x="9" y="18" width="22" height="17" rx="2" stroke="currentColor" stroke-width="3"/><path d="M14 18v-7a6 6 0 0 1 12 0v7M20 25v4" stroke="currentColor" stroke-width="3"/>', 'weapon-lock-icon');

const weaponSilhouette = weapon => {
  const id = weapon.id;
  const blade = '<path d="M18 29V10l5-6 2 19-5 6z" fill="currentColor"/><path d="M13 29h15M20 29v8" stroke="currentColor" stroke-width="2"/>';
  const shapes = {
    'qiang': '<path d="M20 37V13M20 3l-4 10 4 3 4-3z" stroke="currentColor" stroke-width="2"/><path d="m19 15-8 5 7-1" fill="currentColor"/>',
    'shemao': '<path d="M20 38V18q-9-4 0-9t0-7q10 7 0 16" stroke="currentColor" stroke-width="2"/>',
    'guandao': '<path d="M20 38V5M20 5q14 1 10 13l-10 5" stroke="currentColor" stroke-width="3"/>',
    'fangtian-ji': '<path d="M20 38V3M14 11v10h12V11M14 10l-5 5 5 7M26 10l5 5-5 7" stroke="currentColor" stroke-width="2"/>',
    'staff': '<path d="m11 37 18-34" stroke="currentColor" stroke-width="4"/><path d="m12 30 5 3M24 9l5 3" stroke="#9d5d3d" stroke-width="3"/>',
    'three-section-staff': '<path d="m7 6 7 10m3 4 7 10m3-3 7-10M14 16l3 4m7 10 3-3" stroke="currentColor" stroke-width="3"/>',
    'nine-section-whip': '<path d="M7 5q30 2 14 15T8 36" stroke="currentColor" stroke-width="3" stroke-dasharray="5 2"/>',
    'iron-whip': '<path d="m12 35 17-29M13 29l6 3M16 24l6 3M19 19l6 3M22 14l6 3M25 9l6 3" stroke="currentColor" stroke-width="3"/>',
    'war-hammer': '<path d="M20 37V17" stroke="currentColor" stroke-width="4"/><path d="M9 6h22v13H9z" fill="currentColor"/>',
    'wolf-club': '<path d="m12 37 10-17M17 21l-5-4 3-5-1-6 6 1 4-5 4 5 6 1-3 6 1 6-6 1-4 5z" fill="currentColor"/>',
    'hook-swords': '<path d="M12 35V10q0-8 7-5M28 35V10q0-8-7-5M7 25l10 2M23 25l10 2" stroke="currentColor" stroke-width="3"/>',
    'emei-piercers': '<path d="m9 32 8-24m6 24 8-24M10 20h8m5 0h8" stroke="currentColor" stroke-width="2"/><circle cx="14" cy="20" r="4" stroke="currentColor"/><circle cx="27" cy="20" r="4" stroke="currentColor"/>',
    'mandarin-yue': '<path d="M8 9q21 11 0 23l5-12zM32 9Q11 20 32 32l-5-12z" fill="currentColor"/>',
    'meteor-hammer': '<path d="M7 6q27 7 14 17t7 9" stroke="currentColor" stroke-width="2"/><path d="m28 25 7 4v8h-9l-4-7z" fill="currentColor"/>',
    'judge-brush': '<path d="m10 33 13-20 4 3-13 20zM23 13l2-9 9-3-7 15z" fill="currentColor"/>',
    'battle-yue': '<path d="M20 37V6" stroke="currentColor" stroke-width="4"/><path d="M8 7q12 9 24 0v16q-12-8-24 0z" fill="currentColor"/>',
  };
  let shape = shapes[id];
  if (!shape && id.includes('axe')) shape = '<path d="m9 37 5-30m17 30-5-30" stroke="currentColor" stroke-width="3"/><path d="M14 7 3 10v12l11-7M26 7l11 3v12l-11-7" fill="currentColor"/>';
  if (!shape && id.includes('maces')) shape = '<path d="M12 37V6M28 37V6M8 8h8v15H8zM24 8h8v15h-8z" stroke="currentColor" stroke-width="3"/>';
  if (!shape && id === 'dual-ji') shape = '<path d="M12 37V4M28 37V4M12 10h7v10h-7M28 10h-7v10h7" stroke="currentColor" stroke-width="2"/>';
  if (!shape && id === 'pu-dao') shape = '<path d="M20 38V20M20 22V4q13 4 6 16z" stroke="currentColor" stroke-width="3"/>';
  if (!shape && id.includes('dual')) shape = `<g transform="translate(-7 0) rotate(-12 20 20)">${blade}</g><g transform="translate(7 0) rotate(12 20 20)">${blade}</g>`;
  if (!shape && id.includes('dao')) shape = '<path d="M17 30V7l9-4q3 14-9 27z" fill="currentColor"/><path d="M12 29h13M17 30v7" stroke="currentColor" stroke-width="2"/>' + (id === 'ring-dao' ? '<circle cx="28" cy="10" r="3" stroke="currentColor"/><circle cx="25" cy="18" r="3" stroke="currentColor"/>' : id === 'miao-dao' ? '<path d="M17 34v5" stroke="currentColor" stroke-width="3"/>' : '');
  return icon(shape || blade, 'weapon-silhouette');
};

const names = ['突进斩', '回旋斩', '跃空斩', '玄冰阵', '飞刃'];
const healthRatio = (hp, maximum) => {
  if (!Number.isFinite(hp) || !Number.isFinite(maximum) || maximum <= 0) return 0;
  return Math.max(0, Math.min(1, hp / maximum));
};
const timeLabel = seconds => `${String(Math.floor((seconds || 0) / 60)).padStart(2, '0')}:${String(Math.floor((seconds || 0) % 60)).padStart(2, '0')}`;

export function createUI(callbacks = {}, initialSelectedWeaponId = DEFAULT_WEAPON_ID) {
  let selectedWeaponId = isWeaponUnlocked(initialSelectedWeaponId) ? initialSelectedWeaponId : DEFAULT_WEAPON_ID;
  let weaponFilter = '全部';
  const root = document.createElement('div');
  root.className = 'game-interface';
  const phoneBrowser = isPhoneBrowser();
  root.dataset.phone = String(phoneBrowser);
  root.dataset.fullscreen = String(!phoneBrowser || isMobileFullscreen());
  root.dataset.landscape = String(!phoneBrowser || matchMedia('(orientation: landscape)').matches);
  root.dataset.entryReady = String(!phoneBrowser || (
    isMobileFullscreen() && matchMedia('(orientation: landscape)').matches
  ));
  root.innerHTML = `
    <div class="battle-hud is-hidden">
      <div class="player-panel">
        <div class="level-seal"><span>LV.</span><b>01</b></div>
        <div class="player-vitals"><div class="player-name"><b>夏侯惇</b><span>双刃 · 破阵</span></div>
          <div class="health-track"><i></i><span>100 / 100</span></div>
          <div class="stamina-track"><i></i></div>
          <div class="soul-row"><span>魂</span><div class="soul-crystals">${Array.from({ length: 6 }, () => '<i></i>').join('')}</div><b class="soul-count">0 / 6</b></div>
        </div>
      </div>
      <div class="stage-panel"><div class="stage-heading"><span>荒寺 · 夜袭</span><button class="pause-button" data-action="pause" aria-label="暂停游戏"><i></i><i></i></button></div><div class="stage-steps"><span>STAGE</span>${[1, 2, 3].map(n => `<i data-wave="${n}">${String(n).padStart(2, '0')}</i>`).join('')}</div><div class="stage-details"><span class="kill-count">斩敌 0 / 36</span><span class="battle-time">00:00</span></div></div>
      <div class="specials">${Object.entries(specialIcons).map(([kind, svg]) => `<button class="special-button" data-special="${kind}" aria-label="召唤${({ horse: '战骑', eagle: '猎鹰', captain: '援军' })[kind]}" title="本场可使用一次">${svg}<span>${({ horse: '战骑', eagle: '猎鹰', captain: '援军' })[kind]}</span><small>一次</small></button>`).join('')}</div>
      <div class="skills">${names.map((name, i) => `<button class="skill-button" data-skill="${i}" aria-label="${name}"><span class="skill-key">${i + 1}</span>${icons[i]}<span class="skill-name">${name}</span><span class="skill-cost">◆ 1</span><span class="cooldown-text"></span><i class="cooldown-mask"></i></button>`).join('')}</div>
      <div class="boss-panel is-hidden"><span>镇寺鬼将</span><div class="boss-track"><i></i></div></div>
      <div class="combo-panel is-hidden"><strong>0</strong><span>连斩 <small>COMBO</small></span></div>
      <div class="battle-footer"><span class="objective">肃清荒寺中的亡灵</span><span class="control-hint">点击移动 / 锁敌 · 双击翻滚</span></div>
    </div>
    <div class="screen-layer" data-screen="start">
      <section class="intro-panel"><div class="chapter-caption"><i></i><span>第一卷 · 寺影</span><small>CHAPTER I</small></div>
        <div class="game-title"><span class="title-stamp">斩魂</span><h1>亡灵<br>杀手</h1><p>UNDEAD SLAYER</p></div>
        <div class="intro-copy"><span class="thin-rule"></span><p>荒寺钟声起，百鬼踏夜来。<br>百般兵刃，破阵而行。</p></div>
        <div class="intro-level"><span>壹</span><div><small>今夜之战</small><b>荒寺 · 夜袭</b></div><i>三阵 / 三十六敌</i></div>
        <button class="primary-button start-button" data-action="start"><span>选兵入阵</span><i>→</i></button>
        <div class="intro-controls"><span>点地行走</span><i>·</i><span>点敌追击</span><i>·</i><span>双击翻滚</span></div>
      </section>
      <div class="intro-side"><span>风起荒寺</span><i></i><small>百兵出鞘 · 百鬼退散</small></div>
      <div class="intro-footer"><span>低多边形 · 国风动作</span><div><button class="text-button" data-action="sound" aria-label="切换声音">声音 · 开</button><button class="text-button" data-action="help">操作指引</button></div></div>
    </div>
    <section class="armory-layer is-hidden" aria-label="百兵谱"><header class="armory-header"><div><span>兵器谱 · ${WEAPONS.filter(item => isWeaponUnlocked(item.id)).length} 已解锁 / ${WEAPONS.length} 式</span><h2>百兵入阵</h2></div><button class="text-button" data-action="armory-back">← 返回</button></header><div class="armory-body"><div class="armory-catalog"><nav class="weapon-filters" aria-label="兵器类别"></nav><div class="weapon-grid"></div></div><div class="weapon-live-preview" aria-label="人物持兵与连招预览"><span class="preview-eyebrow">持兵演武</span><div class="preview-floor-mark" aria-hidden="true"></div><div class="preview-caption"><b class="preview-weapon-name"></b><span>点选兵器 · 演示四式连招</span><button class="text-button" data-action="weapon-preview">↻ 再演一遍</button></div></div><aside class="weapon-detail"></aside></div></section>
    <button class="mobile-entry-overlay" data-action="mobile-entry" aria-label="点击全屏横屏后继续游戏">
      <span class="mobile-entry-mark" aria-hidden="true">↻</span>
      <b>点击全屏 · 横屏进入</b>
      <span>点击后进入全屏；若未自动横屏，请将手机转为横向</span>
      <i>点击继续</i>
    </button>
    <div class="modal-layer is-hidden"><section class="game-modal" role="dialog" aria-modal="true" aria-label="战场菜单"></section></div>
    <div class="notification" role="status"><span></span></div>
    <div class="damage-layer" aria-hidden="true"></div>
    <div class="orientation-notice" role="status"><div class="orientation-icon" aria-hidden="true">↻</div><b>请横屏游玩</b><span>将手机旋转至横向后继续</span><button class="orientation-retry" data-action="mobile-view-retry">重新尝试全屏与横屏</button></div>
  `;
  document.body.append(root);
  const $ = selector => root.querySelector(selector);
  const $$ = selector => [...root.querySelectorAll(selector)];
  // HUD nodes persist for the level. Avoid re-querying and replacing unchanged
  // text every tick, particularly while combat is paused or resources are full.
  const hud = {
    health: $('.health-track'), healthFill: $('.health-track i'), healthText: $('.health-track span'),
    stamina: $('.stamina-track i'), souls: $('.soul-count'), crystals: $$('.soul-crystals i'),
    waves: $$('.stage-steps i'), kills: $('.kill-count'), time: $('.battle-time'),
    combo: $('.combo-panel'), comboCount: $('.combo-panel strong'),
    boss: $('.boss-panel'), bossFill: $('.boss-track i'),
    skills: $$('.skill-button').map(button => ({button, svg: button.querySelector('svg'), defaultIcon: button.querySelector('svg').innerHTML, yanlingIcon: false, cost: button.querySelector('.skill-cost'), text: button.querySelector('.cooldown-text'), mask: button.querySelector('.cooldown-mask')})),
    specials: $$('.special-button').map(button => ({button, label: button.querySelector('small')})),
  };
  const styleValues = new WeakMap();
  function setStyle(el, property, value) {
    const previous = styleValues.get(el) || {};
    if (previous[property] === value) return;
    el.style[property] = value;
    previous[property] = value;
    styleValues.set(el, previous);
  }
  const setText = (el, value) => { if (el.textContent !== String(value)) el.textContent = value; };
  let mode = 'start';
  let sound = true;
  let noticeTimer;
  let noticeEntrance;
  let previousMode = 'start';
  let currentData = {};
  let previousData = {};
  let lastCriticalLabelTime = -Infinity;
  const call = (name, ...args) => callbacks[name]?.(...args);
  const syncMobileDisplay = () => {
    if (!phoneBrowser) return;
    root.dataset.fullscreen = String(isMobileFullscreen());
    root.dataset.landscape = String(matchMedia('(orientation: landscape)').matches);
    if (root.dataset.fullscreen === 'true' && root.dataset.landscape === 'true') {
      root.dataset.entryReady = 'true';
    }
    const title = $('.orientation-notice b');
    const message = $('.orientation-notice>span');
    if (root.dataset.fullscreen !== 'true') {
      setText(title, '需要全屏游玩');
      setText(message, '点击下方按钮重试；若仍失败，请将游戏添加到手机主屏幕后打开');
    } else if (root.dataset.landscape !== 'true') {
      setText(title, '请横屏游玩');
      setText(message, '浏览器未能锁定方向，请打开自动旋转并将手机转为横向');
    }
  };
  const onFullscreenChange = () => syncMobileDisplay();
  if (phoneBrowser) {
    document.addEventListener('fullscreenchange', onFullscreenChange);
    document.addEventListener('webkitfullscreenchange', onFullscreenChange);
    window.addEventListener('resize', onFullscreenChange);
    screen.orientation?.addEventListener?.('change', onFullscreenChange);
    syncMobileDisplay();
  }

  root.addEventListener('pointerdown', event => {
    if (event.target.closest('button, .game-modal, .intro-panel, .armory-layer')) event.stopPropagation();
  });
  root.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button || button.disabled) return;
    event.stopPropagation();
    if (button.dataset.skill !== undefined) { call('skill', Number(button.dataset.skill)); return; }
    if (button.dataset.special) { call('special', button.dataset.special); return; }
    if (button.dataset.weapon) { if (!isWeaponUnlocked(button.dataset.weapon)) return; setWeapon(button.dataset.weapon); call('weapon', selectedWeaponId); return; }
    if (button.dataset.filter) { weaponFilter = button.dataset.filter; renderArmory(); return; }
    const action = button.dataset.action;
    if (action === 'weapon-preview') { if (isWeaponUnlocked(selectedWeaponId)) call('weapon', selectedWeaponId); return; }
    if (action === 'start') { showScreen('armory'); call('weapon', selectedWeaponId); return; }
    if (action === 'armory-back') { showScreen('start'); return; }
    if (action === 'armory-confirm') { if (isWeaponUnlocked(selectedWeaponId)) call('start', selectedWeaponId); return; }
    if (action === 'choose-weapon') { call('chooseWeapon', selectedWeaponId); showScreen('armory'); return; }
    if (action === 'sound') {
      sound = !sound;
      call('sound', sound);
      updateSound();
    } else if (action === 'help') {
      previousMode = mode;
      previousData = currentData;
      call('help');
      showScreen('help');
    } else if (action === 'close-help') {
      showScreen(previousMode, previousData);
      if (previousMode === 'hide') call('resume');
    } else if (action === 'mobile-view-retry') {
      call('mobileViewRetry');
    } else if (action === 'mobile-entry') {
      call('mobileEntry');
    } else call(action);
  });

  function updateSound() {
    $$('[data-action="sound"]').forEach(button => {
      button.textContent = `声音 · ${sound ? '开' : '关'}`;
      button.setAttribute('aria-pressed', String(sound));
    });
  }

  function update(state) {
    if (state.weaponId && state.weaponId !== selectedWeaponId) setWeapon(state.weaponId);
    const maxHp = Number.isFinite(state.maxHp) && state.maxHp > 0 ? state.maxHp : 100;
    const hp = Number.isFinite(state.hp) ? Math.max(0, Math.min(maxHp, state.hp)) : maxHp;
    setStyle(hud.healthFill, 'width', `${healthRatio(hp, maxHp) * 100}%`);
    setText(hud.healthText, `${Math.ceil(hp)} / ${maxHp}`);
    hud.health.classList.toggle('low-health', hp / maxHp < 0.3);
    setStyle(hud.stamina, 'width', `${Math.max(0, Math.min(100, (state.stamina ?? 100) / (state.maxStamina || 100) * 100))}%`);
    const souls = state.souls ?? 0, maxSouls = state.maxSouls || 6;
    setText(hud.souls, `${Math.ceil(souls)} / ${Math.ceil(maxSouls)}`);
    hud.crystals.forEach((crystal, i) => {
      const fill = Math.max(0, Math.min(1, souls / maxSouls * 6 - i));
      crystal.classList.toggle('filled', fill > 0);
      setStyle(crystal, 'background', `linear-gradient(0deg, #adedef ${fill * 100}%, #23393d ${fill * 100}%)`);
    });
    hud.waves.forEach((step, i) => {
      step.classList.toggle('current', i + 1 === state.wave);
      step.classList.toggle('complete', i + 1 < state.wave);
    });
    setText(hud.kills, `斩敌 ${state.kills ?? 0} / ${state.total ?? 36}`);
    setText(hud.time, timeLabel(state.time));
    const combo = state.combo ?? 0;
    hud.combo.classList.toggle('is-hidden', combo < 2);
    setText(hud.comboCount, combo);
    const bossRatio = healthRatio(state.bossHp, state.bossMaxHp);
    hud.boss.classList.toggle('is-hidden', bossRatio <= 0);
    setStyle(hud.bossFill, 'width', `${bossRatio * 100}%`);
    hud.skills.forEach(({button, cost, text, mask}, i) => {
      const skill = state.skills?.[i] || { cost: i > 2 ? 3 : 2, cooldown: 0, maxCooldown: 1 };
      const remaining = Math.max(0, skill.cooldown || 0);
      const insufficient = souls < (skill.cost || 0);
      const disabled = remaining > 0 || insufficient;
      if (button.disabled !== disabled) button.disabled = disabled;
      button.classList.toggle('cooling', remaining > 0);
      button.classList.toggle('no-souls', insufficient);
      setText(cost, `◆ ${skill.cost || 0}`);
      setText(text, remaining > 0 ? Math.ceil(remaining) : '');
      setStyle(mask, 'height', `${Math.min(100, remaining / (skill.maxCooldown || 1) * 100)}%`);
      const title = `${getWeapon(selectedWeaponId).skillNames[i]} · ${skill.cost || 0} 魂${remaining > 0 ? ` · 冷却 ${Math.ceil(remaining)} 秒` : insufficient ? ' · 魂力不足，斩敌可获得魂力' : ` · 快捷键 ${i + 1}`}`;
      if (button.title !== title) button.title = title;
    });
    hud.specials.forEach(({button, label}) => {
      const available = state.specials?.[button.dataset.special] !== false;
      if (button.disabled !== !available) button.disabled = !available;
      setText(label, available ? '一次' : '已用');
    });
    if (typeof state.sound === 'boolean' && sound !== state.sound) { sound = state.sound; updateSound(); }
  }

  function showScreen(next, data = {}) {
    mode = next;
    currentData = data;
    root.dataset.mode = next;
    $('.screen-layer').classList.toggle('is-hidden', next !== 'start');
    $('.armory-layer').classList.toggle('is-hidden', next !== 'armory');
    $('.battle-hud').classList.toggle('is-hidden', ['start', 'armory'].includes(next));
    if (next === 'armory') renderArmory();
    const modal = !['start', 'armory', 'hide'].includes(next);
    $('.modal-layer').classList.toggle('is-hidden', !modal);
    if (!modal) return;
    // A transient wave message should never cover the pause or result menu.
    clearTimeout(noticeTimer);
    noticeEntrance?.cancel();
    $('.notification').classList.remove('visible');
    $('.notification').classList.add('is-hidden');
    const controls = `<div class="modal-settings"><button class="text-button" data-action="sound">声音 · ${sound ? '开' : '关'}</button><button class="text-button" data-action="help">操作指引</button></div>`;
    let content;
    if (next === 'pause') {
      content = `<span class="modal-eyebrow">刀锋暂歇</span><h2>休战</h2><p class="modal-description">战场已暂停，待君再入阵。</p><button class="primary-button" data-action="resume"><span>继续战斗</span><i>→</i></button><button class="secondary-button" data-action="retry">重新入阵</button><button class="text-button change-weapon" data-action="choose-weapon">换兵器 · 重整出战</button>${controls}`;
    } else if (next === 'help') {
      content = `<span class="modal-eyebrow">兵法 · 操作</span><h2>${getWeapon(selectedWeaponId).name}破阵</h2><div class="help-list"><p><b>点击地面</b><span>移动至目标，近敌自动挥刃</span></p><p><b>点击敌人</b><span>锁定追击，直至敌人倒下</span></p><p><b>双击 / 空格</b><span>翻滚闪避，消耗蓝色体力</span></p><p><b>技能 1 — 5</b><span>消耗魂力；斩敌获得魂晶</span></p><p><b>战骑 · 猎鹰 · 援军</b><span>各可召唤一次，把握时机</span></p><p><b>三枚星印</b><span>全灭敌人 · 三分钟内 · 受击≤2</span></p></div><button class="primary-button" data-action="close-help"><span>知晓</span><i>→</i></button>`;
    } else {
      const victory = next === 'win';
      const stars = Math.max(0, Math.min(3, data.stars ?? (victory ? 1 : 0)));
      const starSvg = '<svg viewBox="0 0 40 40" aria-hidden="true"><path d="m20 3 5 11 12 2-9 9 2 12-10-6-10 6 2-12-9-9 12-2z"/></svg>';
      content = `<span class="modal-eyebrow">${victory ? '荒寺 · 夜袭 / 肃清' : '荒寺 · 夜袭 / 未竟'}</span><h2>${victory ? '破阵凯旋' : '身陨荒寺'}</h2><div class="result-stars">${[0, 1, 2].map(i => `<span class="${i < stars ? 'earned' : ''}">${starSvg}</span>`).join('')}</div><p class="modal-description">${victory ? '兵刃已收，寺中再无亡灵。' : '百鬼尚未退去，再战一场。'}</p><div class="result-stats"><div><span>斩敌</span><b>${data.kills ?? 0}</b></div><div><span>用时</span><b>${timeLabel(data.time)}</b></div><div><span>受击</span><b>${data.hits ?? 0}</b></div></div><div class="star-criteria"><span class="${victory ? 'achieved' : ''}">全灭敌人</span><span class="${victory && data.time <= 180 ? 'achieved' : ''}">三分钟内</span><span class="${victory && data.hits <= 2 ? 'achieved' : ''}">受击≤2</span></div><button class="primary-button" data-action="retry"><span>${victory ? '再战荒寺' : '重整旗鼓'}</span><i>→</i></button><button class="text-button change-weapon" data-action="choose-weapon">换兵器 · 重整出战</button>${controls}`;
    }
    $('.game-modal').innerHTML = content;
    updateSound();
  }


  function renderArmory() {
    const weapon = getWeapon(selectedWeaponId);
    setText($('.armory-header span'), `兵器谱 · ${WEAPONS.filter(item => isWeaponUnlocked(item.id)).length} 已解锁 / ${WEAPONS.length} 式`);
    setText($('.preview-weapon-name'), weapon.name);
    $('.weapon-filters').innerHTML = ['全部', '刀剑', '长兵', '重兵', '奇门'].map(category => `<button data-filter="${category}" aria-pressed="${weaponFilter === category}" class="${weaponFilter === category ? 'active' : ''}">${category}</button>`).join('');
    $('.weapon-grid').innerHTML = WEAPONS.filter(item => weaponFilter === '全部' || item.category === weaponFilter).map(item => {
      const unlocked = isWeaponUnlocked(item.id);
      const selected = unlocked && item.id === selectedWeaponId;
      return `<button class="weapon-card ${selected ? 'selected' : ''} ${unlocked ? '' : 'locked'}" data-weapon="${item.id}" aria-pressed="${selected}" aria-disabled="${!unlocked}" ${unlocked ? '' : 'disabled'}>${weaponSilhouette(item)}<b>${item.name}</b><small>${item.category}</small>${unlocked ? `<span class="weapon-selected">${selected ? '已选' : '选择'}</span>` : `<span class="weapon-locked">${lockIcon}<span>未解锁</span></span>`}</button>`;
    }).join('');
    $('.weapon-detail').innerHTML = `<div class="weapon-detail-heading"><span>所选兵器 / ${weapon.category}</span>${weaponSilhouette(weapon)}<h3>${weapon.name}</h3><b>${weapon.tagline}</b></div><p class="weapon-description">${weapon.description}</p><div class="weapon-stats">${[['speed', '出招速度'], ['power', '打击威力'], ['reach', '攻击距离']].map(([key, label]) => `<div><span>${label}</span><i aria-label="${weapon.stats[key]} / 5">${[1,2,3,4,5].map(n => `<em class="${n <= weapon.stats[key] ? 'filled' : ''}"></em>`).join('')}</i></div>`).join('')}</div><div class="weapon-moves"><span>四式连招 · 近敌自动施展</span><ol>${weapon.moves.map(move => `<li>${typeof move === 'string' ? move : move.name}</li>`).join('')}</ol></div><button class="primary-button" data-action="armory-confirm"><span>携${weapon.name}入阵</span><i>→</i></button><small class="weapon-preview-note">左侧选兵 · 中央观看连招</small>`;
  }
  function setWeapon(id) {
    if (!isWeaponUnlocked(id)) return;
    const weapon = getWeapon(id);
    selectedWeaponId = weapon.id;
    setText($('.player-name>span'), `${weapon.name} · 破阵`);
    hud.skills.forEach((entry, i) => {
      const {button, svg} = entry;
      setText(button.querySelector('.skill-name'), weapon.skillNames[i]);
      button.setAttribute('aria-label', weapon.skillNames[i]);
      const yanlingIcon = weapon.id === 'yanling-dao';
      if (entry.yanlingIcon !== yanlingIcon) {
        svg.innerHTML = yanlingIcon ? yanlingSkillIcons[i] : entry.defaultIcon;
        entry.yanlingIcon = yanlingIcon;
      }
    });
    setText($('.intro-side small'), `${weapon.name}出鞘 · 百鬼退散`);
    try { localStorage.setItem('undead-slayer-weapon', selectedWeaponId); } catch {}
    if (mode === 'armory') renderArmory();
  }

  function notify(text) {
    clearTimeout(noticeTimer);
    const el = $('.notification');
    noticeEntrance?.cancel();
    setText(el.querySelector('span'), text);
    el.classList.remove('is-hidden');
    el.classList.add('visible');
    noticeEntrance = el.animate([
      { opacity: 0, transform: 'translate(-50%, -8px)' },
      { opacity: 1, transform: 'translate(-50%, 0)' },
    ], { duration: matchMedia('(prefers-reduced-motion: reduce)').matches ? 100 : 240, easing: 'cubic-bezier(.22,.61,.36,1)' });
    noticeTimer = setTimeout(() => el.classList.remove('visible'), 2700);
  }

  function damage(text, x, y, kind = 'normal') {
    const el = document.createElement('span');
    el.className = `damage-number ${kind}`;
    if (kind === 'critical') {
      const now = performance.now();
      if (now - lastCriticalLabelTime < 100) el.classList.add('critical-secondary');
      else lastCriticalLabelTime = now;
    }
    el.textContent = text;
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    $('.damage-layer').append(el);
    el.addEventListener('animationend', () => el.remove(), { once: true });
    setTimeout(() => el.remove(), 1500);
  }

  setWeapon(selectedWeaponId);
  updateSound();
  return { setWeapon, getSelectedWeapon: () => selectedWeaponId, update, showScreen, notify, damage, syncMobileDisplay, destroy() {
    clearTimeout(noticeTimer);
    noticeEntrance?.cancel();
    if (phoneBrowser) {
      document.removeEventListener('fullscreenchange', onFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', onFullscreenChange);
      window.removeEventListener('resize', onFullscreenChange);
      screen.orientation?.removeEventListener?.('change', onFullscreenChange);
    }
    root.remove();
  } };
}
