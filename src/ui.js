import { WEAPONS, getWeapon, DEFAULT_WEAPON_ID, isWeaponUnlocked } from './weapons.js';
import { isMobileFullscreen, isPhoneBrowser } from './fullscreen.js';

const icon = (content, className = '') => `<svg class="${className}" viewBox="0 0 40 40" fill="none" aria-hidden="true">${content}</svg>`;
const typeName = weapon => weapon.id === 'dual-dao' ? '双刀' : '砍刀';
const weaponSilhouette = weapon => {
  const blade = '<path d="M17 30V7l9-4q3 14-9 27z" fill="currentColor"/><path d="M12 29h13M17 30v7" stroke="currentColor" stroke-width="2"/>';
  return icon(weapon.id === 'dual-dao' ? `<g transform="translate(-7 0) rotate(-12 20 20)">${blade}</g><g transform="translate(7 0) rotate(12 20 20)">${blade}</g>` : blade, 'weapon-silhouette');
};

const healthRatio = (hp, maximum) => {
  if (!Number.isFinite(hp) || !Number.isFinite(maximum) || maximum <= 0) return 0;
  return Math.max(0, Math.min(1, hp / maximum));
};
const timeLabel = seconds => `${String(Math.floor((seconds || 0) / 60)).padStart(2, '0')}:${String(Math.floor((seconds || 0) % 60)).padStart(2, '0')}`;

export function createUI(callbacks = {}, initialSelectedWeaponId = DEFAULT_WEAPON_ID) {
  let selectedWeaponId = isWeaponUnlocked(initialSelectedWeaponId) ? initialSelectedWeaponId : DEFAULT_WEAPON_ID;
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
        <div class="player-vitals"><div class="player-name"><b>夏侯惇</b><span>双刀 · 普攻</span></div>
          <div class="health-track"><i></i><span>100 / 100</span></div>
          <div class="stamina-track"><i></i></div>
        </div>
      </div>
      <div class="stage-panel"><div class="stage-heading"><span>荒寺 · 夜袭</span><button class="pause-button" data-action="pause" aria-label="暂停游戏"><i></i><i></i></button></div><div class="stage-steps"><span>STAGE</span>${[1, 2, 3].map(n => `<i data-wave="${n}">${String(n).padStart(2, '0')}</i>`).join('')}</div><div class="stage-details"><span class="kill-count">斩敌 0 / 36</span><span class="battle-time">00:00</span></div></div>
      <div class="boss-panel is-hidden"><span>镇寺鬼将</span><div class="boss-track"><i></i></div></div>
      <div class="combo-panel is-hidden"><strong>0</strong><span>连斩 <small>COMBO</small></span></div>
      <div class="battle-footer"><span class="objective">肃清荒寺中的亡灵</span><span class="control-hint">点击移动 / 锁敌 · 双击翻滚</span></div>
    </div>
    <div class="screen-layer" data-screen="start">
      <section class="intro-panel"><div class="chapter-caption"><i></i><span>第一卷 · 寺影</span><small>CHAPTER I</small></div>
        <div class="game-title"><span class="title-stamp">斩魂</span><h1>亡灵<br>杀手</h1><p>UNDEAD SLAYER</p></div>
        <div class="intro-copy"><span class="thin-rule"></span><p>荒寺钟声起，百鬼踏夜来。<br>双刀与砍刀，普攻破阵。</p></div>
        <div class="intro-level"><span>壹</span><div><small>今夜之战</small><b>荒寺 · 夜袭</b></div><i>三阵 / 三十六敌</i></div>
        <button class="primary-button start-button" data-action="start"><span>选择类型</span><i>→</i></button>
        <div class="intro-controls"><span>点地行走</span><i>·</i><span>点敌追击</span><i>·</i><span>双击翻滚</span></div>
      </section>
      <div class="intro-side"><span>风起荒寺</span><i></i><small>双刃出鞘 · 百鬼退散</small></div>
      <div class="intro-footer"><span>低多边形 · 国风动作</span><div><button class="text-button" data-action="sound" aria-label="切换声音">声音 · 开</button><button class="text-button" data-action="help">操作指引</button></div></div>
    </div>
    <section class="armory-layer is-hidden" aria-label="武器类型"><header class="armory-header"><div><span>武器类型 · 普攻演武</span><h2>择刃入阵</h2></div><button class="text-button" data-action="armory-back">← 返回</button></header><div class="armory-body"><div class="armory-catalog"><p class="type-selection-note">选择武器类型<br><span>近敌自动衔接四式普攻</span></p><div class="weapon-grid"></div></div><div class="weapon-live-preview" aria-label="人物持兵与连招预览"><span class="preview-eyebrow">持兵演武</span><div class="preview-floor-mark" aria-hidden="true"></div><div class="preview-caption"><b class="preview-weapon-name"></b><span>点选类型 · 演示四式普攻</span><button class="text-button" data-action="weapon-preview">↻ 再演一遍</button></div></div><aside class="weapon-detail"></aside></div></section>
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
    stamina: $('.stamina-track i'),
    waves: $$('.stage-steps i'), kills: $('.kill-count'), time: $('.battle-time'),
    combo: $('.combo-panel'), comboCount: $('.combo-panel strong'),
    boss: $('.boss-panel'), bossFill: $('.boss-track i'),
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
    if (button.dataset.weapon) { if (!isWeaponUnlocked(button.dataset.weapon)) return; setWeapon(button.dataset.weapon); call('weapon', selectedWeaponId); return; }
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
      content = `<span class="modal-eyebrow">刀锋暂歇</span><h2>休战</h2><p class="modal-description">战场已暂停，待君再入阵。</p><button class="primary-button" data-action="resume"><span>继续战斗</span><i>→</i></button><button class="secondary-button" data-action="retry">重新入阵</button><button class="text-button change-weapon" data-action="choose-weapon">换类型 · 重整出战</button>${controls}`;
    } else if (next === 'help') {
      content = `<span class="modal-eyebrow">兵法 · 操作</span><h2>${typeName(getWeapon(selectedWeaponId))}破阵</h2><div class="help-list"><p><b>点击地面</b><span>移动至目标，近敌自动挥刃</span></p><p><b>点击敌人</b><span>锁定追击，直至敌人倒下</span></p><p><b>双击 / 空格</b><span>翻滚闪避，消耗蓝色体力</span></p><p><b>WASD / 方向键</b><span>移动；P / Esc 暂停或继续</span></p><p><b>三枚星印</b><span>全灭敌人 · 三分钟内 · 受击≤2</span></p></div><button class="primary-button" data-action="close-help"><span>知晓</span><i>→</i></button>`;
    } else {
      const victory = next === 'win';
      const stars = Math.max(0, Math.min(3, data.stars ?? (victory ? 1 : 0)));
      const starSvg = '<svg viewBox="0 0 40 40" aria-hidden="true"><path d="m20 3 5 11 12 2-9 9 2 12-10-6-10 6 2-12-9-9 12-2z"/></svg>';
      content = `<span class="modal-eyebrow">${victory ? '荒寺 · 夜袭 / 肃清' : '荒寺 · 夜袭 / 未竟'}</span><h2>${victory ? '破阵凯旋' : '身陨荒寺'}</h2><div class="result-stars">${[0, 1, 2].map(i => `<span class="${i < stars ? 'earned' : ''}">${starSvg}</span>`).join('')}</div><p class="modal-description">${victory ? '兵刃已收，寺中再无亡灵。' : '百鬼尚未退去，再战一场。'}</p><div class="result-stats"><div><span>斩敌</span><b>${data.kills ?? 0}</b></div><div><span>用时</span><b>${timeLabel(data.time)}</b></div><div><span>受击</span><b>${data.hits ?? 0}</b></div></div><div class="star-criteria"><span class="${victory ? 'achieved' : ''}">全灭敌人</span><span class="${victory && data.time <= 180 ? 'achieved' : ''}">三分钟内</span><span class="${victory && data.hits <= 2 ? 'achieved' : ''}">受击≤2</span></div><button class="primary-button" data-action="retry"><span>${victory ? '再战荒寺' : '重整旗鼓'}</span><i>→</i></button><button class="text-button change-weapon" data-action="choose-weapon">换类型 · 重整出战</button>${controls}`;
    }
    $('.game-modal').innerHTML = content;
    updateSound();
  }


  function renderArmory() {
    const weapon = getWeapon(selectedWeaponId);
    setText($('.armory-header span'), '武器类型 · 普攻演武');
    setText($('.preview-weapon-name'), typeName(weapon));
    $('.weapon-grid').innerHTML = WEAPONS.filter(item => ['dual-dao', 'tang-dao'].includes(item.id)).map(item => {
      const selected = item.id === selectedWeaponId;
      return `<button class="weapon-card ${selected ? 'selected' : ''}" data-weapon="${item.id}" aria-pressed="${selected}">${weaponSilhouette(item)}<b>${typeName(item)}</b><small>${item.id === 'dual-dao' ? '双刃交替' : '双手挥砍'}</small><span class="weapon-selected">${selected ? '已选' : '选择'}</span></button>`;
    }).join('');
    $('.weapon-detail').innerHTML = `<div class="weapon-detail-heading"><span>所选类型</span>${weaponSilhouette(weapon)}<h3>${typeName(weapon)}</h3><b>四式普攻 · 近敌自动施展</b></div><p class="weapon-description">${weapon.id === 'dual-dao' ? '左右双刃交替挥斩，接续四式普攻。' : '双手持刀，衔接斜斩、横斩、上撩与落劈。'}<br>点击敌人锁定追击，移动与翻滚调整位置。</p><div class="weapon-moves"><span>普攻动作</span><ol>${weapon.moves.map(move => `<li>${typeof move === 'string' ? move : move.name}</li>`).join('')}</ol></div><button class="primary-button" data-action="armory-confirm"><span>以${typeName(weapon)}入阵</span><i>→</i></button><small class="weapon-preview-note">左侧选类型 · 中央观看普攻</small>`;
  }

  function setWeapon(id) {
    if (!isWeaponUnlocked(id)) return;
    const weapon = getWeapon(id);
    selectedWeaponId = weapon.id;
    setText($('.player-name>span'), `${typeName(weapon)} · 普攻`);
    setText($('.intro-side small'), `${typeName(weapon)}出鞘 · 百鬼退散`);
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
