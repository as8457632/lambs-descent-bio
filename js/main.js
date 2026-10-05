'use strict';
// ─────────────────────────────────────────────
// 主循环 / 状态机 / 房间切换 / 碰撞 / 界面
// ─────────────────────────────────────────────

const game = {
  state: 'title', // title | play | dead | win
  paused: false,
  floor: null, floorNum: 1,
  player: null, cur: null,
  particles: [], toast: null, fx: [],
  cam: { x: 0, y: 0 },
  shakeAmt: 0, time: 0,
  kills: 0, roomsSeen: 0, deaths: 0,
  runTime: 0,
};

function shake(n) { game.shakeAmt = Math.max(game.shakeAmt, n); }

let cv, cx;
const BUILD = 'v5.3.1-bio'; // 版本号水印：bio-mode 分支；5.3.1 = 修掉 touchstart 读不存在的 pbtn/mbtn/gbtn 抛异常（摇杆与所有按钮全失效）
window.__BUILD = BUILD;
window.DBG_VP = () => ({ build: BUILD, inner: [innerWidth, innerHeight], vv: window.visualViewport ? [Math.round(visualViewport.width), Math.round(visualViewport.height)] : null, dpr: devicePixelRatio, css: [Math.round(cv ? cv.getBoundingClientRect().width : 0), Math.round(cv ? cv.getBoundingClientRect().height : 0)] });

function boot() {
  cv = document.getElementById('game');
  const dpr = Math.min(window.devicePixelRatio || 1, 3); // 高分屏按 DPR 放大缓冲（上限3），消除模糊/锯齿
  cv.width = CANVAS_W * dpr; cv.height = CANVAS_H * dpr;
  cx = cv.getContext('2d');
  cx.setTransform(dpr, 0, 0, dpr, 0, 0);
  window.LOGICAL_W = ROOM_W;
  document.body.classList.toggle('bio', typeof BIO !== 'undefined' && BIO); // 竖屏原生：隐藏横屏提示与页脚帮助
  IS_MOBILE = Touch.supported() && matchMedia('(pointer: coarse)').matches; // 手机布局：隐藏侧栏、视口吃满 960
  VIEW_W = (IS_MOBILE && !BIO) ? CANVAS_W : ROOM_W; // v5.0 竖屏：视口恒等于房间
  Input.init();
  Touch.init(cv);
  CloudSave.login(); CloudSave.boot(); // v4.0 静默登录 + 30s/在线事件自动补传
  // JS 驱动画布尺寸：免疫平板桌面模式/工具栏收展导致的 vw/dvh 失准
  function fitCanvas() {
    const vv = window.visualViewport;
    // visualViewport 在捏合缩放/平板桌面模式怪癖下可能远小于布局视口 → 取两者较大值，画布永不被压成小方块
    const w = Math.max(vv ? vv.width : 0, window.innerWidth || 0) || CANVAS_W;
    const h = Math.max(vv ? vv.height : 0, window.innerHeight || 0) || CANVAS_H;
    // v5.2 强制竖屏：旋转/横屏整套路径删除，画布永远按竖屏等比 letterbox
    const s = Math.min(w / CANVAS_W, h / CANVAS_H);
    game.rotScale = s;
    const cw = Math.floor(CANVAS_W * s) + 'px', chh = Math.floor(CANVAS_H * s) + 'px';
    if (cv.style.width !== cw) cv.style.width = cw;
    if (cv.style.height !== chh) cv.style.height = chh;
    game.fitScale = s;
    const fsb = document.getElementById('fsbtn');
    if (fsb) {
      fsb.classList.toggle('show', s < (BIO ? .5 : .74)); // v5.0 竖屏原生：全屏按钮只在极小窗才亮，不占 HUD 小地图位
      fsb.textContent = document.fullscreenElement || document.webkitFullscreenElement ? '⛶ 退出全屏' : '⛶ 全屏';
    }
  }
  window.__fitCanvas = fitCanvas;
  addEventListener('resize', () => { fitCanvas(); setTimeout(fitCanvas, 300); }); // 过渡态双保险
  addEventListener('orientationchange', () => setTimeout(fitCanvas, 150));
  if (window.visualViewport) {
    visualViewport.addEventListener('resize', fitCanvas);
    visualViewport.addEventListener('scroll', fitCanvas);
  }
  setInterval(fitCanvas, 1000); // 兜底：个别浏览器丢事件时 1 秒内自愈
  document.addEventListener('fullscreenchange', () => setTimeout(fitCanvas, 120));
  fitCanvas();
  // v5.2 强制竖屏：按钮只做「竖屏全屏」并尝试锁定 portrait，横屏/假旋转整套已删除
  const fsb = document.getElementById('fsbtn');
  if (fsb) {
    const el = document.documentElement;
    if (!el.requestFullscreen && !el.webkitRequestFullscreen) fsb.style.display = 'none';
    fsb.addEventListener('click', () => {
      if (document.fullscreenElement || document.webkitFullscreenElement) { (document.exitFullscreen || document.webkitExitFullscreen).call(document); return; }
      try { const r = (el.requestFullscreen || el.webkitRequestFullscreen).call(el); if (r && r.catch) r.catch(() => { }); } catch (e) { }
      setTimeout(() => { try { const so = screen.orientation; if (so && so.lock) so.lock('portrait').catch(() => { }); } catch (e) { } }, 350);
    });
  }
  window.game = game;                       // 调试接口：HP/敌人/子弹/房间/道具/属性
  window.DBG = {
    newRun, loadFloor, enterRoom, genFloor, Player, Enemy, Boss, Pickup, Tear, ETYPE, ITEMS, BOSSES, TILE, ROOM_W, ROOM_H, WORLD_W, WORLD_H,
    // 测试辅助：用真实 moveCircle 碰撞逐帧走到目标点（不瞬移）
    moveTo(x, y, spd = 3) {
      const p = game.player;
      for (let i = 0; i < 600; i++) {
        const dx = x - p.x, dy = y - p.y, d = Math.hypot(dx, dy);
        if (d < 6) return true;
        const slide = d > 40 ? 1 : d / 40; // 接近目标时减速，避免过冲
        moveCircle(p, dx / d * spd * slide, dy / d * spd * slide, game.cur);
      }
      return false;
    }
  };
  let last = performance.now(), acc = 0;
  function frame(now) {
    requestAnimationFrame(frame); // 先排下一帧，单帧异常不会杀死主循环
    acc += Math.min(now - last, 100); last = now;
    while (acc >= 1000 / 60) { update(); acc -= 1000 / 60; }
    draw();
  }
  requestAnimationFrame(frame);
}

const m0diff = () => Meta.load().bioDiff || 0;
function newRun(stage = 1, floor = 1) { // floor>1：死亡续爬（从倒下那层重来，不重爬 3 层）
  game.stage = stage;
  game.floorNum = floor;
  game.kills = 0; game.roomsSeen = 0; game.runTime = 0;
  game.theme = stageTheme(stage);
  game.mod = zoneOf(stage).mod; // 层段规则特区修饰器（T4 生效）
  game.statM = statMul(stage); // 怪物数值乘区（T3）
  if (BIO) { const df = BIO_DIFFS[m0diff()]; game.diffHp = df.hp; game.diffAtk = df.atk; game.diffCoin = df.coin; game.diffMutate = df.mutate; } // v5.1 难度分级
  game.player = new Player(WORLD_W / 2, WORLD_H / 2);
  game.player.char = Meta.load().char || 0;
  game.particles = []; game.toast = null;
  game.taughtClear = false; game.taughtWeapon = false; game.taughtDash = false; game.lastKiller = null; game.hint = null;
  // 应用局间永久强化（锻造工坊）
  const m = Meta.load();
  const p = game.player;
  p.dmg += .8 * m.up.wpn;
  p.maxHp = (CHARS[m.char || 0] && CHARS[m.char || 0].hp) || 100; // v5.2 英雄品级血量：白100/绿130/蓝160/紫200（CHARS.hp 定义）
  if (BIO) {
    const brk = heroBrk(m.char || 0); // 文档 7.2：碎片突破提升英雄上限（每阶基础属性 +8%）
    if (brk > 0) { p.dmg *= 1 + .08 * brk; p.speed *= 1 + .08 * brk; p.maxHp = Math.round(p.maxHp * (1 + .08 * brk)); }
    if (CHARS[m.char || 0] && CHARS[m.char || 0].melee) { p.weapon = { id: 'knife', lvl: 1 }; ownWeapon('knife', 1); p.dmg = Math.max(p.dmg, 7); p.maxHp += 30; } // v5.1.1 刀锋定位：高血(+30)+高攻，自带开山刀
  }
  p.maxHp += 15 * m.up.hp; p.hp = p.maxHp;
  p.ammo = p.clipMax(); p.reloadT = 0; // v5.2 弹药：开局按初始枪压满弹匣
  p.speed += .15 * m.up.spd;
  p.dashCdMax = Math.max(24, p.dashCdMax - 10 * m.up.dash);
  p.dashBase = p.dashCdMax; // v5.3 疾风核心家族按开局基准重算，避免覆盖工坊 dash 加成
  game.reviveAvail = m.up.revive > 0;
  game.runCoins = 0; game.runEarned = 0; game.levelUps = 0; game.levelChoices = null; game.settled = false; game.wcheck = null;
  game.bag = []; game.saved = 0; game.roomNum = 1; game.extractMode = false; game.bossKilled = false; game.matCarry = { iron: 0, core: 0 }; // v5.0 搜打撤：背包/救人/深度 + v5.1 随身材料
  if (BIO) { game.runCoins = 3 * m.up.coin; game.runEarned = 3 * m.up.coin; } else p.coins += 3 * m.up.coin; // 开运之手（BIO 计入随身，重置后加）
  Touch.sticks.move = Touch.sticks.aim = null;
  Touch.dashTap = false; Touch.tapped = false; Touch.menuTap = null; Touch.startedInPlay.clear();
  loadFloor(floor);
  game.state = 'play'; game.paused = false; game.mapOpen = false;
  const z = zoneOf(stage);
  game.hint = { text: isGate(stage) ? (BIO ? `⚑ 门槛关：精英更多，技能/宝箱品质上限 +1 档` : `⚑ 门槛关：怪物强化 ×1.45，Boss 获得词缀`) : stage % 5 === 1 && z.rule ? `战区解锁：${z.name} —— ${z.rule}` : `第 ${stage} 关 · ${z.name} · ${game.theme.name}`, t: 260 };
  BGM.start();
}

// ── v5.3 开箱选技能（制作人口径：杀怪不给经验；技能=宝箱；家族×品质档，越高档越稀有且随关卡解锁）──
// 品质档随关卡解锁：关1-2 封顶蓝，关3 紫，关4 橙，关5+ 红；门槛关/紫箱再 +1（封顶红）
function qCapForStage(stage, purpleChest) {
  const base = stage <= 2 ? 1 : stage === 3 ? 2 : stage === 4 ? 3 : 4;
  return Math.min(4, base + (isGate(stage) ? 1 : 0) + (purpleChest ? 1 : 0));
}
const Q_WEIGHTS = [52, 28, 13, 5, 2]; // 档位越高越稀有（制作人："金色概率要低"）
function rollQ(cap) {
  let sum = 0;
  for (let i = 0; i <= cap; i++) sum += Q_WEIGHTS[i];
  let r = Math.random() * sum;
  for (let i = 0; i <= cap; i++) { r -= Q_WEIGHTS[i]; if (r <= 0) return i; }
  return cap;
}
// 本轮候选：家族卡=阶梯上可跳的更高档（受本关品质上限约束），机制卡=固定品阶且未满叠层上限
function rollOfferings(p, cap) {
  const gun = p.weapon.id, out = [];
  for (const fam of Object.keys(FAM)) {
    const f = FAM[fam];
    if (f.scope === 'gun' && f.key === 'clip' && !WEAPONS[gun].clip) continue; // 近战没有弹匣概念
    if (f.scope === 'gun' && f.key === 'rl' && WEAPONS[gun].melee) continue;    // 近战无换弹
    const cur = famTierOf(p, fam, f.scope === 'gun' ? gun : null);
    for (let t = cur + 1; t <= cap; t++) out.push(famCard(fam, t, f.scope === 'gun' ? gun : null, cur)); // 阶梯：可跳档，但跳到的档受本关品质上限约束
  }
  for (const u of UPGRADES) if (u.q <= cap && p.gunLvOf(u) < u.max && (!u.gun || u.gun === gun)) out.push(u);
  return out;
}
game.openChestChoice = function (opts = {}) {
  const p = game.player;
  const cap = qCapForStage(game.stage || 1, opts.tier === 'purple');
  game.levelCap = cap; // 三选一界面图例要显示"本关上限"（含紫箱加成），不能自己再算一遍
  const picks = [];
  const n = Math.random() < .5 ? 3 : 4; // 文档 4.1：每次呈现 3-4 个
  if (BIO) {
    let bag = rollOfferings(p, cap);
    for (let i = 0; i < n && bag.length; i++) {
      const gunOnly = Math.random() < .7; // v5.2.1 口径保留：枪池 70% / 通用池 30%
      let pool = bag.filter(o => gunOnly ? (o.gun === p.weapon.id) : !o.gun);
      if (!pool.length) pool = bag;
      const want = rollQ(cap);
      let cand = pool.filter(o => o.q === want);
      if (!cand.length) { // 回落：取与目标档差值最小的一张
        const d0 = Math.min(...pool.map(o => Math.abs(o.q - want)));
        cand = pool.filter(o => Math.abs(o.q - want) === d0);
      }
      const pick = choice(cand);
      picks.push(pick);
      bag = bag.filter(o => o !== pick && !(pick.isFam && o.isFam && o.fam === pick.fam && o.gun === pick.gun)); // 同族每轮只出一张
    }
    // 保底：一手全绿而本关允许更高档 → 随机一张提一档，避免"永远只见绿"
    if (picks.length && cap > 0 && picks.every(o => o.q === 0)) {
      const alt = rollOfferings(p, cap).filter(o => o.q > 0 && !picks.some(x => x.isFam && o.isFam && x.fam === o.fam));
      if (alt.length) picks[0] = choice(alt);
    }
  } else {
    const avail = u => p.gunLvOf(u) < u.max;
    const bag = UPGRADES.filter(u => avail(u)).slice();
    for (let i = 0; i < n && bag.length; i++) picks.push(bag.splice(Math.floor(Math.random() * bag.length), 1)[0]);
  }
  game.levelChoices = picks.length ? picks : null;
  if (!game.levelChoices) { game.runCoins += 5; game.runEarned += 5; game.toast = { item: { name: '宝箱：技能已满', desc: '全卡池满级，折算 5 金币', color: '#e8c85e' }, t: 160 }; return; }
  game.state = 'levelup';
  SFX.play('item');
};
// v5.2.2 宝箱掉落（参考原作）：箱色决定件数与掉落表，一次爆出多件（金币成串/武器带光柱/技能走三选一）
game.openChestLoot = function (room, c) {
  c.dead = true;
  SFX.play('clear');
  spawnParticles(room, c.x, c.y, 16, '#e8c85e', 3.2);
  const p = game.player;
  if (room.type === 'start') { // 初始房宝箱：从账号武器库随机出 1 把武器（不开技能）
    const wid = pickWeaponId(p) || bioAnyOwnedWeapon();
    if (wid) {
      const wp = new Pickup('weapon', c.x, c.y + 8, null, 0, wid);
      room.pickups.push(wp);
      game.fx.push({ type: 'dropbeam', x: wp.x, y: wp.y + 6, col: WEAPONS[wid].c, t: 90, t0: 90 });
      game.toast = { item: { name: '初始武器：' + WEAPONS[wid].name, desc: '踩上去可查看并装备', color: WEAPONS[wid].c }, t: 170 };
    } else game.toast = { item: { name: '武器库为空', desc: '去军械库抽一把再来', color: '#e8c85e' }, t: 170 };
    return;
  }
  // v5.3 实物掉落表：护盾/无敌进宝箱，技能位与实物分离（每次开箱最多 1 次三选一）
  // 每格按「归一化权重」取一种（旧版把独立概率当累计阈值用，导致紫箱药膏/材料/金币永不可达 —— 门禁 P0）
  const CFG = {
    wood:   { n: randi(1, 2), coins: [4, 9],   w: { weapon: .03, skill: .20, shield: 0,   invul: 0,   medkit: .22, mat: .18, coin: .37 }, shP: 0,  iF: 0,   col: '#c8a06a' },
    blue:   { n: randi(2, 3), coins: [8, 15],  w: { weapon: .10, skill: .26, shield: .08, invul: 0,   medkit: .20, mat: .16, coin: .20 }, shP: 45, iF: 0,   col: '#7fb2e8' },
    purple: { n: randi(3, 4), coins: [12, 22], w: { weapon: .18, skill: .30, shield: .12, invul: .06, medkit: .14, mat: .12, coin: .08 }, shP: 70, iF: 360, col: '#b093e8' },
  }[c.tier || 'wood'];
  let acc = 0;
  const cuts = Object.keys(CFG.w).map(k => [k, acc += CFG.w[k] / Object.values(CFG.w).reduce((a, v) => a + v, 0)]);
  let gotSkill = false, weapons = 0, spawned = 0;
  const drop = o => { o.x = c.x + rand(-34, 34); o.y = c.y + rand(-8, 26); room.pickups.push(o); spawned++; };
  for (let i = 0; i < CFG.n; i++) {
    const r = Math.random();
    const hit = cuts.find(x => r < x[1]);
    const kind = hit ? hit[0] : 'coin';
    if (kind === 'weapon' && weapons < 2) { // 开箱出武器：账号拥有池随机（参考原作紫光柱）
      const wid = pickWeaponId(p) || bioAnyOwnedWeapon();
      if (wid) { weapons++; const wp = new Pickup('weapon', 0, 0, null, 0, wid); drop(wp); game.fx.push({ type: 'dropbeam', x: wp.x, y: wp.y + 6, col: qColor(gunTier(wid)), t: 90, t0: 90 }); }
      else for (let k = 0; k < 3; k++) drop(new Pickup('coin', 0, 0));
    } else if (kind === 'skill' && !gotSkill) { gotSkill = true; } // 技能位：开完箱进三/四选一
    else if (kind === 'shield') drop(new Pickup('shield', 0, 0, { name: '护盾', power: CFG.shP }));
    else if (kind === 'invul') drop(new Pickup('invul', 0, 0, { name: '应急无敌', frames: CFG.iF }));
    else if (kind === 'medkit') drop(new Pickup('medkit', 0, 0));
    else if (kind === 'mat') drop(new Pickup('mat', 0, 0, CRAFT_MATS[Math.random() < .6 ? 'iron' : 'core']));
    else for (let k = 0, cc = randi(CFG.coins[0], CFG.coins[1]); k < Math.min(cc, 10); k++) drop(new Pickup('coin', 0, 0)); // 金币成串喷出
  }
  if (spawned === 0 && !gotSkill) for (let k = 0; k < 4; k++) drop(new Pickup('coin', 0, 0)); // 空箱保底
  if (gotSkill) game.openChestChoice({ tier: c.tier }); // 技能=家族阶梯三/四选一（紫箱品质档上限 +1）
  else game.toast = { item: { name: c.tier === 'purple' ? '紫箱开启！' : c.tier === 'blue' ? '蓝箱开启' : '宝箱开启', desc: '战利品已散落在地，去捡！', color: CFG.col }, t: 150 };
};
game.resolveWcheck = function (equip) { // v5.2.2 武器详情卡：装备 / 不换
  const wc = game.wcheck; game.wcheck = null; game.state = 'play';
  Touch.tapped = false; Touch.menuTap = null;
  if (!wc || !wc.pk || wc.pk.dead) return;
  if (equip) wc.pk.takeWeapon(game.player);
  else { wc.pk.denyCd = 150; game.hint = { text: '已跳过，武器留在地上（走近可再选）', t: 100 }; }
};
game.applyUpgrade = function (u) { // v5.3：家族卡记录"当前档"（覆盖升档，不叠乘）；机制卡仍按 id 叠层
  const p = game.player;
  if (u.isFam) {
    const f = FAM[u.fam];
    if (f.scope === 'gun') (p.gunLv[u.gun] = p.gunLv[u.gun] || {})['fam:' + u.fam] = u.tier + 1;
    else { p.upLv['gen:' + u.fam] = u.tier + 1; f.set(p, f.vals[u.tier], u.prev < 0 ? 0 : f.vals[u.prev]); }
  } else if (u.gun) { (p.gunLv[u.gun] = p.gunLv[u.gun] || {})[u.id] = (p.gunLv[u.gun][u.id] || 0) + 1; if (u.apply) u.apply(p); }
  else { p.upLv[u.id] = (p.upLv[u.id] || 0) + 1; u.apply(p); }
  if (WEAPONS[p.weapon.id].clip) { const cm = p.clipMax(); if (p.ammo > cm) p.ammo = cm; } // 弹匣上限变化时收敛
};
game.pickUpgrade = function (i) {
  const u = game.levelChoices && game.levelChoices[i];
  if (!u) return;
  game.applyUpgrade(u);
  game.levelUps++;
  game.toast = { item: { name: `[${qName(u.q)}] ${u.name}${u.gun ? ' · ' + WEAPONS[u.gun].name : ''}`, desc: u.desc, color: qColor(u.q) }, t: 160 };
  game.levelChoices = null;
  game.state = 'play';
};

function loadFloor(n) {
  game.floorNum = n;
  game.floor = genFloor(n);
  const start = game.floor.rooms.get(game.floor.startId);
  enterRoom(start, null);
}

function enterRoom(room, fromDir) {
  game.cur = room;
  game.particles = [];
  game.fx = [];
  if (!room.visited) { room.visited = true; game.roomsSeen++; }
  room.tears = []; // 敌方弹幕进房即散
  room.vortexes = []; // 漩涡场随进房重置（钉子/焦土作为战场痕迹保留）

  let ex = WORLD_W / 2, ey = WORLD_H / 2;
  if (fromDir) {
    // 从 fromDir 方向穿门 → 出现在新房间 OPP[fromDir] 侧的门，并向房内推
    const side = OPP[fromDir];
    const [dx, dy] = DOOR_CELL[side];
    ex = dx * TILE + TILE / 2; ey = dy * TILE + TILE / 2;
    const [vx, vy] = DVEC[side];
    ex -= vx * TILE * 1.35; ey -= vy * TILE * 1.35;
  }
  if (BIO) { // v5.3：血量尺度只随关卡（跨关不归零）；房间强度改由战力预算驱动
    game.roomNum = (room.dist || 0) + 1;
    game.statM = (game.diffHp || 1) * hpScale(game.stage || 1); // 难度倍率仍乘血（N1..N9），关卡倍率不再吃房内序号
  }
  createRoomContents(room, game.floorNum, ex, ey);
  modOnEnter(room); // 战区环境重掷（风向等）
  if (BIO) { // v5.2：主动技能随英雄开局自带（不再按房间逐个点亮）
    if (!Touch.supported() && !game.taughtKeys) { game.taughtKeys = true; game.hint = { text: '自动射击中：WASD 走位 · J 冲锋打击 · Space 冲刺', t: 300 }; } // v5.2 技能跟英雄：开局即带冲锋打击
  }
  game.player.x = ex; game.player.y = ey;
  // 相机瞬移到出生点视口中心，进房不"甩镜头"
  game.cam.x = clamp(ex - VIEW_W / 2, 0, WORLD_W - VIEW_W);
  game.cam.y = clamp(ey - ROOM_H / 2, 0, WORLD_H - ROOM_H);
  game.player.q = []; game.player.dashing = 0; // 跨房不清位移会带进新房"幽灵冲刺" 

  if (!room.cleared && (room.enemies.length > 0 || (room.spawnQueue || []).length > 0)) { // v5.3：预算房进房时还没有怪，按队列判定
    SFX.play('doorOpen');
    if (!game.taughtClear) { // 首次进战斗房的教学提示，一局只出现一次
      game.taughtClear = true;
      game.hint = { text: BIO ? '清光敌人，门才会开 —— 跟着绿色箭头走' : '清光敌人，门才会开 —— 方向键/右摇杆射击', t: 260 };
    }
  }
  if (room.boss) SFX.play('bossRoar');
}

// ── 更新 ──
function update() {
  game.time++;
  Input.tick();
  if (Input.pressed('KeyF')) { // F 一键全屏：窗口太小时的自救键
    const el = document.documentElement;
    if (document.fullscreenElement || document.webkitFullscreenElement) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    else (el.requestFullscreen || el.webkitRequestFullscreen).call(el);
  }
  if (game.state === 'title') {
    if (game.toast) { game.toast.t--; if (game.toast.t <= 0) game.toast = null; } // 撤离反馈要在标题可见
    const mt = Touch.menuTap; Touch.menuTap = null;
    const m = Meta.load();
    const unlocked = m.maxStage + 1;
    game.selStage = clamp(game.selStage || 1, 1, unlocked);
    const sb = stageBtnZones();
    for (let i = 0; i < CHARS.length; i++) {
      const hitCard = Input.pressed('Digit' + (i + 1)) || (mt && inZone(charZoneHit(mt), charZones()[i]));
      if (!hitCard) continue;
      if (BIO && CHARS[i].price && !heroUnlocked(i)) { // v5.1 英雄直购（文档 3.1：金币解锁）
        if (m.coins >= CHARS[i].price) {
          m.coins -= CHARS[i].price; (m.heroes = m.heroes || {})[CHARS[i].id] = 0; m.char = i; Meta.save();
          if (window.CloudSave) CloudSave.queue();
          game.toast = { item: { name: `解锁英雄：${CHARS[i].name}`, desc: '近战型 · 高血高攻，自带开山刀', color: '#e8c85e' }, t: 200 };
          SFX.play('item');
        } else { SFX.play('deny'); game.hint = { text: `${CHARS[i].name} 需 ${CHARS[i].price} 账户金币（撤离结算获得）`, t: 150 }; }
      } else { m.char = i; Meta.save(); SFX.play('coin'); } // 点卡=只选人，不触发"点屏开局"
      Touch.tapped = false;
    }
    if (Input.pressed('ArrowLeft') || Input.pressed('KeyA') || (mt && inZone(mt, sb.l))) { game.selStage = Math.max(1, game.selStage - 1); SFX.play('shoot'); Touch.tapped = false; }
    else if (Input.pressed('ArrowRight') || Input.pressed('KeyD') || (mt && inZone(mt, sb.r))) { game.selStage = Math.min(unlocked, game.selStage + 1); SFX.play('shoot'); Touch.tapped = false; }
    const onDiffPill = (() => { if (!BIO || !mt) return false; const dz = bioDiffZones(); const di = dz.findIndex(z => inZone(mt, z)); if (di < 0) return false; Meta.load().bioDiff = di; Meta.save(); SFX.play('coin'); Touch.tapped = false; return true; })();
    const onStageBtn = mt && (inZone(mt, sb.l) || inZone(mt, sb.r));
    const onCharCard = (() => { const h = charZoneHit(mt); return h && CHARS.some((_, i) => inZone(h, charZones()[i])); })();
    if (mt && inZone(mt, accountZone())) { // 右上账号条 → 进账号面板（昵称改在面板 'nick' 行改，不再在这里弹 prompt）
      game.state = 'account'; game.acctTab = 'main'; SFX.play('coin'); Touch.tapped = false; return;
    }
    if (Input.pressed('Enter')) newRun(game.selStage);
    else if (Input.pressed('KeyS')) { game.workshopFrom = 'title'; game.state = 'workshop'; }
    else if (mt && inZone(mt, workshopBtnZone())) { game.workshopFrom = 'title'; game.state = 'workshop'; }
    else if (mt && inZone(mt, acctBtnZone())) { game.state = 'account'; game.acctTab = 'main'; SFX.play('coin'); Touch.tapped = false; return; }
    else if (mt && !onStageBtn && !onCharCard && !onDiffPill && !inZone(mt, acctBtnZone())) newRun(game.selStage); // 点选人/选关/难度/账号区外才开局
    else if (Touch.tapped) newRun(game.selStage);
    Touch.tapped = false;
    return;
  }
  if (game.state === 'account') {
    const mt = Touch.menuTap; Touch.menuTap = null;
    if (game.gachaResult && --game.gachaResult.t <= 0) game.gachaResult = null; // 抽卡结果自动淡出
    if (game.toast) { game.toast.t--; if (game.toast.t <= 0) game.toast = null; }
    if (Input.pressed('Escape')) {
      if (game.acctTab === 'armory') game.acctTab = 'main';
      else { game.state = 'title'; Touch.tapped = false; return; }
    }
    if (game.acctTab === 'armory') {
      if (mt || Touch.tapped) {
        Touch.tapped = false;
        const z = armoryZones();
        if (mt && inZone(mt, z.single)) doGacha(1);
        else if (mt && inZone(mt, z.ten)) doGacha(10);
        else if (mt && inZone(mt, z.back)) game.acctTab = 'main';
        else if (game.gachaResult) game.gachaResult = null; // 点空白先收起抽卡结果（v4.3-F3），再点才返回
        else if (mt) {
          const cell = z.cells.find(c => inZone(mt, c));
          if (cell) {
            const w = WEAPONS[cell.id], own = weaponOwned(cell.id);
            game.toast = { item: { name: `${w.name} [${qName(gunTier(cell.id))}]`, desc: own ? w.desc : '未解锁 —— 抽卡获得后局内才会掉落', color: own ? w.c : '#8a7560' }, t: 220 };
            SFX.play('shoot');
          } else game.acctTab = 'main';
        } else game.gachaResult = null;
      }
      return;
    }
    if (mt || Touch.tapped) {
      const hit = mt; Touch.tapped = false;
      const rows = acctRowsZones();
      const pick = hit ? rows.find(r => inZone(hit, r)) : null;
      if (!pick) { if (!hit) game.state = 'title'; return; } // v4.3-F3：点空白不再误判返回
      const key = pick.id;
      if (key === 'back') game.state = 'title';
      else if (key === 'armory') game.acctTab = 'armory';
      else if (key === 'status') {
        if (!CloudSave.api) { game.toast = { item: { name: '未配置服务器', desc: '先在下方「服务器」行填写地址', color: '#c9a24a' }, t: 220 }; SFX.play('deny'); }
        else CloudSave.login().then(ok => { game.toast = { item: { name: ok ? '登录成功' : '连不上，本地继续玩', desc: ok ? `账号 #${CloudSave.profile.id} 已绑定` : '已保留本地存档', color: ok ? '#7fae5a' : '#c9a24a' }, t: 240 }; if (ok) CloudSave.queue(); });
      }
      else if (key === 'nick') {
        const n = prompt('输入昵称（≤12 字）', Meta.load().nickname || '');
        if (n && n.trim()) { Meta.load().nickname = n.trim().slice(0, 12); Meta.save(); CloudSave.queue(); SFX.play('coin'); }
      } else if (key === 'server') {
        const u = prompt('账号服务器地址（留空=纯本地存档）', CloudSave.api || '');
        if (u !== null) { CloudSave.api = u.trim(); localStorage.setItem('tr_api', u.trim()); CloudSave.login().then(ok => { game.toast = { item: { name: ok ? '登录成功' : '连不上，本地继续玩', desc: ok ? `账号 #${CloudSave.profile.id} 已绑定` : '已保留本地存档', color: ok ? '#7fae5a' : '#c9a24a' }, t: 200 }; if (ok) CloudSave.queue(); }); }
      } else if (key === 'ctrl') { // v5.3 用户反馈：摇杆左右手自定义
        const mm = Meta.load();
        mm.ctrlSide = mm.ctrlSide === 'right' ? 'left' : 'right';
        Meta.save(); Touch.layoutButtons();
        game.toast = { item: { name: `移动摇杆已切到${mm.ctrlSide === 'right' ? '右' : '左'}手`, desc: '摇杆区与冲刺/技能/背包键整组换位（本设备生效）', color: '#7fae5a' }, t: 220 };
        SFX.play('coin');
      } else if (key === 'export') {
        prompt('复制存档码（换设备时在新设备导入）：', btoa(unescape(encodeURIComponent(JSON.stringify(Meta.load())))));
      } else if (key === 'import') {
        const c = prompt('粘贴存档码：', '');
        try { const d = JSON.parse(decodeURIComponent(escape(atob(c.trim())))); if (d && typeof d.coins === 'number') { Meta.data = d; Meta.save(); location.reload(); } else alert('存档码无效'); } catch (e) { alert('存档码无效'); }
      }
    }
    return;
  }
  if (game.state === 'levelup') {
    for (let i = 0; i < 4; i++) if (Input.pressed('Digit' + (i + 1))) game.pickUpgrade(i);
    const mt = Touch.menuTap; Touch.menuTap = null;
    if (mt) {
      const zones = levelCardZones();
      for (let i = 0; i < zones.length; i++)
        if (inZone(mt, zones[i])) { game.pickUpgrade(i); break; }
    }
    return;
  }
  if (game.state === 'wcheck') { // v5.2.2 武器详情卡：1/Enter=装备，2/Esc=不换
    let pick = -1;
    if (Input.pressed('Digit1') || Input.pressed('Enter')) pick = 0;
    if (Input.pressed('Digit2') || Input.pressed('Escape')) pick = 1;
    const mt = Touch.menuTap; Touch.menuTap = null;
    if (mt) { const z = wcheckZones(); for (let i = 0; i < z.length; i++) if (inZone(mt, z[i])) pick = i; }
    if (pick >= 0) game.resolveWcheck(pick === 0);
    return;
  }
  if (game.state === 'workshop') {
    const mt = Touch.menuTap; Touch.menuTap = null;
    if (Input.pressed('Escape') || (mt && inZone(mt, backBtnZone()))) {
      if (game.wsCraft) { game.wsCraft = false; Touch.tapped = false; return; } // 合成子视图先退回工坊列表
      game.state = (game.workshopFrom === 'dead' || game.workshopFrom === 'win') ? game.workshopFrom : 'title';
      Touch.tapped = false; return;
    }
    if (game.wsCraft) { // v5.1 武器合成
      const owned = Object.keys(WEAPONS).filter(weaponOwned);
      owned.forEach((wid, i) => {
        if (mt && inZone(mt, craftBtnZone(i))) {
          const r = craftWeapon(wid);
          SFX.play(r === 'ok' ? 'item' : 'deny');
          if (r === 'ok') game.toast = { item: { name: `${WEAPONS[wid].name} 升为 ${qName(gunTier(wid))}`, desc: `强化 ${gunWq(wid)} 级 · 品质每档 +10% 伤害`, color: qColor(gunTier(wid)) }, t: 180 };
        }
      });
      Touch.tapped = false;
      return;
    }
    if (mt && inZone(mt, metaRowZone(6))) { game.wsCraft = true; SFX.play('coin'); Touch.tapped = false; return; }
    for (let i = 0; i < META_UPS.length; i++) {
      const want = Input.pressed('Digit' + (i + 1)) || (mt && inZone(mt, metaRowZone(i)));
      if (want) { const r = Meta.buy(META_UPS[i].id); SFX.play(r === 'ok' ? 'coin' : 'deny'); if (r === 'ok') CloudSave.queue(); }
    }
    Touch.tapped = false;
    return;
  }
  if (game.state === 'dead' || game.state === 'win') {
    const mt = Touch.menuTap; Touch.menuTap = null;
    const next = () => game.state === 'win' ? newRun(BIO && !game.bossKilled ? game.stage : game.stage + 1) : newRun(game.stage, game.dieFloor || 1); // 通关进下一关（BIO 中途撤回归本层）/ 死亡从倒下那层续爬
    if (Input.pressed('KeyR')) next();
    else if (Input.pressed('KeyS')) { game.workshopFrom = game.state; game.state = 'workshop'; }
    else if (Input.pressed('Escape')) game.state = 'title';
    else if (mt && inZone(mt, workshopBtnZone())) { game.workshopFrom = game.state; game.state = 'workshop'; }
    else if ((mt && inZone(mt, bigNextZone())) || mt || Touch.tapped) next();
    Touch.tapped = false;
    return;
  }
  if (Touch.bagTap) { Touch.bagTap = false; game.bagOpen = !game.bagOpen; SFX.play('item'); } // 背包面板开关
  if (game.bagOpen && Touch.menuTap) { game.bagOpen = false; Touch.menuTap = null; } // 点任意处关闭
  if (Input.pressed('KeyB')) game.bagOpen = !game.bagOpen;
  if (Input.pressed('KeyP') || Touch.pauseTap) { game.paused = !game.paused; Touch.pauseTap = false; }
  if (Input.pressed('KeyM') || Touch.muteTap) { Touch.muteTap = false; game.bgmOn = BGM.toggle(); game.toastBgm = 90; }
  // 全层大地图：Tab / 触屏🗺按钮 / 点侧栏小地图 开合；开启时世界暂停（地图本身持续动态刷新）
  if (Input.pressed('Tab') || Touch.mapTap) { game.mapOpen = !game.mapOpen; game.mapAuto = true; Touch.mapTap = false; SFX.play('item'); }
  const mt0 = Touch.menuTap;
  if (game.mapOpen) {
    Touch.menuTap = null; Touch.tapped = false;
    if (Input.pressed('Escape')) game.mapOpen = false;
    else if (mt0 && inZone(mt0, mapCloseZone())) game.mapOpen = false;
    else if (mt0) game.mapAuto = true; // 轻点地图空白 → 回中跟随
    return;
  }
  if (mt0 && inZone(mt0, minimapZone())) { Touch.menuTap = null; game.mapOpen = true; game.mapAuto = true; SFX.play('item'); }
  if (game.paused) return;

  game.runTime++;
  Object.defineProperty(game, 'diff', { get() { return 1 + (game.runTime / 3600) * .08; }, configurable: true });
  Touch.tapped = false; // play 态不累积点屏标志：手指常按摇杆时死亡不能被 0 帧跳过
  Touch.menuTap = null; // 战斗中的鼠标点击不应残留到下一个菜单态
  if (game.shakeAmt > 0) game.shakeAmt *= .84;
  if (game.flashT > 0) game.flashT--;
  if (game.toast) { game.toast.t--; if (game.toast.t <= 0) game.toast = null; }
  if (game.hint) { game.hint.t--; if (game.hint.t <= 0) game.hint = null; }

  const room = game.cur, p = game.player;
  modWorldTick(p); // 熔岩脉冲等全局 tick
  p.update(room);

  // 相机跟随：死区 ±60px 防抖，lerp 平滑，钳制在世界边缘
  {
    const vw = VIEW_W, vh = ROOM_H, dz = 60;
    const scx = p.x - game.cam.x, scy = p.y - game.cam.y;
    let tx = game.cam.x, ty = game.cam.y;
    if (scx < vw / 2 - dz) tx -= (vw / 2 - dz) - scx;
    else if (scx > vw / 2 + dz) tx += scx - (vw / 2 + dz);
    if (scy < vh / 2 - dz) ty -= (vh / 2 - dz) - scy;
    else if (scy > vh / 2 + dz) ty += scy - (vh / 2 + dz);
    game.cam.x = lerp(game.cam.x, clamp(tx, 0, WORLD_W - vw), .16);
    game.cam.y = lerp(game.cam.y, clamp(ty, 0, WORLD_H - vh), .16);
  }

  // v5.3 生化模式：预算队列 + 预警口渐进刷怪；桌面模式沿用配额补刷
  if (!room.cleared) {
    if (BIO) { if (room.spawnQueue) drainSpawnQueue(room, game.floorNum); }
    else if (room.quota && room.killed < room.quota) {
      const aliveCap = Math.min(60, (IS_MOBILE ? 30 : 40) + Math.floor((game.stage - 1) / 10) * 2);
      if (--room.spawnT <= 0 && room.enemies.length < aliveCap) waveSpawn(room, game.floorNum);
    }
  }

  for (const e of room.enemies) if (!e.dead) e.update(room);
  if (room.boss && !room.boss.dead) room.boss.update(room);
  const tearN = room.tears.length; // 快照长度迭代：分裂弹 push 不再同帧二次更新
  for (let i = 0; i < tearN; i++) room.tears[i].update(room);
  updateHazards(room); // v4.3 场地危险实体：刺猬钉 / 漩涡核
  for (const pk of room.pickups) if (!pk.dead) pk.update(room);

  handleCollisions(room);

  // 本帧内死亡（同帧先爆死后踩地洞的竞态）→ 立即停止世界推进
  if (game.state !== 'play') return;

  // 清理尸体/弹/拾取物
  room.enemies = room.enemies.filter(e => !e.dead);
  room.tears = room.tears.filter(t => !t.dead);
  room.pickups = room.pickups.filter(k => !k.dead);

  // 清房判定：有配额的房间必须杀满；v5.3 队列/预警未清空前不算清房（防"进房 0 怪"瞬间误判开门）
  if (!room.cleared && room.enemies.length === 0 && !(room.spawnQueue || []).length && !(room.spawnPending || []).length && (!room.boss || room.boss.dead)) {
    if ((room.hasEnemiesPlanned || room.boss) && (!room.quota || room.killed >= room.quota)) onRoomCleared(room);
  }

  // 粒子与武器特效
  for (const q of game.particles) { q.x += q.vx; q.y += q.vy; q.vy += .12; if (--q.life <= 0) q.dead = true; }
  game.particles = game.particles.filter(q => !q.dead);
  for (const f of game.fx) f.t--;
  game.fx = game.fx.filter(f => f.t > 0);

  // 地洞
  if (room.trapdoor && dist2(p.x, p.y, room.trapdoor.x, room.trapdoor.y) < 26) {
    SFX.play('trapdoor');
    game.runCoins += 30 * game.floorNum; game.runEarned += 30 * game.floorNum; Meta.add(30 * game.floorNum); // 过层奖励实时入账
    p.heal(20);
    loadFloor(game.floorNum + 1);
  }

  // 门的通行
  if (room.cleared) tryDoors(room);
}

function handleCollisions(room) {
  const p = game.player;
  for (const tr of room.tears) {
    if (tr.dead || tr.passthrough) continue; // 漩涡核飞行段不与任何实体碰撞
    if (tr.isPlayer) {
      let hit = false;
      for (const e of room.enemies) {
        if (!e.dead && !(tr.hits || (tr.hits = [])).includes(e) &&
            dist2(tr.x, tr.y, e.x, e.y) < tr.r + e.r) {
          if (tr.fuseT !== undefined) { // 罐罐雷贴身引爆：伤害只走 plop 的爆炸 AoE，不直伤+爆炸双算
            hit = true; break;
          }
          e.hit(tr.dmg * execMul(p, e), room, tr.x, tr.y); // v5.3 处决直觉对远程同样生效（+15%）
          if (tr.burn && e.hp > 0) { e.burnT = Math.max(e.burnT || 0, 180); e.burnD = Math.max(e.burnD || 0, 3); } // v5.2 引燃弹：灼烧 3 秒
          game.fx.push({ type: 'spark', id: tr.spId || (tr.colorKey === 'spark' ? 'light' : 'tear'), x: tr.x, y: tr.y, ang: Math.atan2(-tr.vy, -tr.vx), r: tr.r + 5, t: 12, t0: 12 });
          tr.hits.push(e);
          if (tr.pierce > 0) { tr.pierce--; } // 穿透：不消失，换下一个目标
          else { hit = true; }
          if (e.cfg.id !== 'minifly' && Math.random() < .35) knockback(e, tr);
          if (hit) break;
        }
      }
      if (!hit && room.boss && !room.boss.dead &&
          dist2(tr.x, tr.y, room.boss.x, room.boss.y) < tr.r + room.boss.r * .85) {
        room.boss.hit(tr.dmg); hit = true;
        game.fx.push({ type: 'spark', id: tr.spId || 'laser', x: tr.x, y: tr.y, ang: Math.atan2(-tr.vy, -tr.vx), r: tr.r + 5, t: 12, t0: 12 });
      }
      if (!hit) for (const o of room.props) {
        if (!o.dead && o.kind === 'junk' && dist2(tr.x, tr.y, o.x, o.y) < tr.r + 14) {
          damageProp(room, o, tr.dmg); hit = true; break;
        }
      }
      if (hit) tr.plop(room, 'hit');
    } else if (p.inv <= 0 && dist2(tr.x, tr.y, p.x, p.y) < tr.r + p.r * .75) {
      p.hurt(tr.dmg, game, tr.x, tr.y, '敌方弹幕'); if (tr.slow) p.slowT = 60; tr.plop(room, 'hit');
    }
  }
  // 接触伤害（出生动画期间的敌人不伤人；双向击退制造挨打感）
  for (const e of room.enemies) {
    if (!e.dead && e.spawnT <= 0 && dist2(e.x, e.y, p.x, p.y) < e.r + p.r * .75) {
      let dmg = BIO ? (e.elite ? 18 : 10) : Math.ceil(e.cfg.dmg * Math.sqrt(game.statM || 1)); // v5.2 门禁P0：承伤固定口径，难度压力由怪量/血量体现，不吃 atkM
      // v5.3 修正：血蝠空中 ×2 会破 10/18 固定口径（普通变 20、精英变 36），改为不加倍，压迫感由更快的刷怪节奏提供
      p.hurt(dmg, game, e.x, e.y, ((typeof themeMob === 'function' && themeMob(e.cfg.id) || {}).label || e.cfg.label) + (e.elite ? '·精英' : '')); // v5.2 主题怪名
      if (BIO && e.cfg.id === 'attackfly' && e.elite) { // 双头犬连咬：第 2 次接触附加 0.5s 眩晕
        e.bite = (e.bite || 0) + 1;
        if (e.bite % 2 === 0) { p.stunT = Math.max(p.stunT || 0, 30); game.flashT = Math.max(game.flashT, 6); }
      }
      if (BIO && p.upLv && p.upLv.thorns && e.hp > 0 && p.hp > 0) e.hit(2 * p.upLv.thorns, room, e.x, e.y); // 荆棘反伤
      const d = Math.max(1, dist2(e.x, e.y, p.x, p.y));
      moveCircle(e, (e.x - p.x) / d * 20, (e.y - p.y) / d * 20, room);
    }
  }
  if (room.boss && !room.boss.dead && dist2(room.boss.x, room.boss.y, p.x, p.y) < room.boss.r * .85 + p.r * .7) {
    p.hurt(BIO ? 25 : Math.ceil((game.floorNum >= 3 ? 3 : 2) * Math.sqrt(game.statM || 1)), game, room.boss.x, room.boss.y, room.boss.cfg.name); // v5.2 门禁P0：BOSS 重击恒 -25，100 血至少挨四下
  }
}

function knockback(e, tr) {
  const a = Math.atan2(tr.vy, tr.vx);
  moveCircle(e, Math.cos(a) * 6, Math.sin(a) * 6, game.cur);
}

function onRoomCleared(room) {
  room.cleared = true;
  SFX.play('clear');
  if (room.boss) {
    room.boss = null; room.hasEnemiesPlanned = false;
    game.runCoins += 40 + 20 * game.floorNum; game.runEarned += 40 + 20 * game.floorNum; if (!BIO) Meta.add(40 + 20 * game.floorNum); // BIO 走撤离入账，防双付
    const mt = Meta.load(); // 新手保护：生涯首杀 Boss 送 1 张军械券（军械库免费单抽，防开局只有制式枪无聊）
    if (!mt.ticketGiven) {
      mt.ticketGiven = true; mt.gachaTickets = (mt.gachaTickets || 0) + 1; Meta.save();
      game.hint = { text: '获得「军械券」×1！标题→账号→军械库可兑换一次免费单抽', t: 320 };
      SFX.play('item');
    }
    const cxr = WORLD_W / 2, cyr = WORLD_H / 2;
    if (!BIO) room.pickups.push(new Pickup('chest', cxr - 40, cyr)); // v5.2：生化模式每房唯一宝箱=进房初始箱
    if (BIO) { // 文档：BOSS 必掉武器合成材料
      room.pickups.push(new Pickup('mat', cxr + 30, cyr - 20, CRAFT_MATS.iron));
      room.pickups.push(new Pickup('mat', cxr + 54, cyr + 6, CRAFT_MATS.core));
    }
    if (!BIO) {
      if (game.floorNum < 3) room.trapdoor = { x: cxr + 44, y: cyr };
      else room.finalChest = true;
      game.hint = { text: game.floorNum < 3 ? 'Boss 已死！清光残敌，踩开启的地洞下潜' : 'Boss 已死！打开宝箱解救人质', t: 300 };
    } else {
      game.hint = { text: '杜尔加倒了，深度撤离通道开启！', t: 300 };
      game.victory(); // v5.2 制作人口径：击败关底 BOSS = 通关，无需再开箱
    }
  } else {
    rollClearReward(room, game.floorNum);
    if (!room.boss && !game.taughtDoor) { game.taughtDoor = true; game.hint = { text: '门已开！看小地图找亮格，走到房间边缘的门撤离', t: 240 }; }
  }
}

function tryDoors(room) {
  const p = game.player;
  for (const d of DIRS) {
    const nb = room.links[d];
    if (!nb) continue;
    if (room.doorCost && room.doorCost[d] && !room.doorOpen[d]) { // v5.1 奖励房：付随身金币开门，付不起只提示
      const cost = room.doorCost[d];
      const [ddx, ddy] = DOOR_CELL[d]; // v5.1.1：走到门前才扣款，清房隔空自动付费是bug（门禁 P1）
      if (dist2(p.x, p.y, ddx * TILE + TILE / 2, ddy * TILE + TILE / 2) > TILE * 2.4) continue;
      if (game.runCoins >= cost) {
        game.runCoins -= cost; room.doorOpen[d] = true;
        SFX.play('coin'); game.hint = { text: `支付 ${cost} 随身金币，奖励房开了！`, t: 140 };
      } else if (!room.denyT || game.runTime - room.denyT > 60) {
        room.denyT = game.runTime; SFX.play('deny');
        game.hint = { text: `奖励房需 ${cost} 随身金币（击杀掉落，可跳过不阻塞主线）`, t: 160 };
      }
      continue;
    }
    const [dx, dy] = DOOR_CELL[d];
    const cxx = dx * TILE + TILE / 2, cyy = dy * TILE + TILE / 2;
    if (dist2(p.x, p.y, cxx, cyy) < TILE * .72) {
      enterRoom(game.floor.rooms.get(nb), d);
      return;
    }
  }
}

// v5.0 背包一览：8 格物资 + 随身金币 + 幸存者
function drawBagPanel(ctx, g) {
  ctx.save();
  ctx.fillStyle = 'rgba(6,4,3,.72)'; ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  const w = 420, x0 = CANVAS_W / 2 - w / 2, y0 = 240;
  ctx.fillStyle = 'rgba(22,16,10,.96)'; ctx.beginPath(); ctx.roundRect(x0, y0, w, 400, 10); ctx.fill();
  ctx.strokeStyle = '#b08a3a'; ctx.lineWidth = 2; ctx.beginPath(); ctx.roundRect(x0, y0, w, 400, 10); ctx.stroke();
  ctx.fillStyle = '#e8c85e'; ctx.font = 'bold 18px monospace'; ctx.textAlign = 'center';
  ctx.fillText('背 包', CANVAS_W / 2, y0 + 34);
  const cw = 90, chh = 84, gap = 10, cols = 4;
  const gx = CANVAS_W / 2 - (cols * (cw + gap) - gap) / 2;
  for (let i = 0; i < 8; i++) {
    const it = (g.bag || [])[i];
    const x = gx + (i % cols) * (cw + gap), y = y0 + 56 + Math.floor(i / cols) * (chh + gap);
    ctx.fillStyle = it ? 'rgba(34,25,15,.95)' : 'rgba(14,11,8,.85)';
    ctx.beginPath(); ctx.roundRect(x, y, cw, chh, 6); ctx.fill();
    ctx.strokeStyle = it ? it.c : '#2a221a'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.roundRect(x, y, cw, chh, 6); ctx.stroke();
    if (it) {
      ctx.fillStyle = it.c; ctx.font = 'bold 20px monospace'; ctx.fillText(it.glyph, x + cw / 2, y + 36);
      ctx.font = '9px monospace'; ctx.fillStyle = '#cbb59a'; ctx.fillText(`${it.name} ×${it.n}`, x + cw / 2, y + 58);
      ctx.fillStyle = '#8a7a66'; ctx.fillText(`${it.val * it.n} 币`, x + cw / 2, y + 72);
    }
  }
  ctx.font = 'bold 14px monospace'; ctx.fillStyle = '#e8c85e';
  ctx.fillText(`随身金币 ${g.runCoins || 0}`, CANVAS_W / 2, y0 + 340);
  ctx.fillStyle = '#7fae5a';
  ctx.fillText(`已救幸存者 ${g.saved || 0} 人（结算 +100/人）`, CANVAS_W / 2, y0 + 364);
  ctx.fillStyle = '#8a7a66'; ctx.font = '11px monospace';
  ctx.fillText('点任意处关闭', CANVAS_W / 2, y0 + 388);
  ctx.restore();
}

// v5.0 搜打撤：只有活着走出撤离点/击杀 BOSS，随身金币+背包物资+幸存者才入账
game.bankRun = function () {
  const m = Meta.load();
  const lootVal = (game.bag || []).reduce((a, b) => a + b.val * b.n, 0);
  const savedVal = (game.saved || 0) * 100;
  const coinVal = Math.round((game.runCoins || 0) * (game.diffCoin || 1)); // 文档 6.2：高难金币获取 ×0.6~0.9
  let total = coinVal + lootVal + savedVal;
  game.hopeless = !game.bossKilled; // 次要出口：中途撤离结算 6 折（制作人拍板）
  if (game.hopeless) total = Math.round(total * .6);
  game.coinVal = coinVal;
  if (total > 0) Meta.add(total);
  game.runBanked = total; game.lootVal = lootVal; game.savedVal = savedVal;
  game.score = game.kills * 10 + game.roomNum * 50 + (game.saved || 0) * 100 + Math.max(0, 600 - Math.floor((game.runTime || 0) / 60) * 20); // 文档 7.1 积分
  if (game.matCarry) { // 随身材料入局外库（撤离专属；死亡走 die 分支不带出）
    m.mats.iron = Math.min(999, m.mats.iron + (game.matCarry.iron || 0)); m.mats.core = Math.min(999, m.mats.core + (game.matCarry.core || 0));
    game.matGain = Object.assign({}, game.matCarry); game.matCarry = { iron: 0, core: 0 };
  }
  m.bioBest = Math.max(m.bioBest || 0, game.roomNum || 1);
  m.bioEscapes = (m.bioEscapes || 0) + 1;
  Meta.save();
  if (window.CloudSave) CloudSave.queue();
};
game.retreat = function () { // 踩撤离点：中途成功撤离
  if (BIO) {
    if (game.settled) return; game.settled = true; // v5.2 门禁P1：结算幂等
    game.bossKilled = false;
    game.bankRun();
    game.extractMode = true;
    game.state = 'win'; game.mapOpen = false;
    SFX.play('clear');
    return;
  }
  game.state = 'title';
  game.selStage = clamp(game.stage, 1, Meta.load().maxStage + 1);
  game.toast = { item: { name: '撤离成功', desc: `本局所得 ${game.runEarned || 0} 金币全额带走（死亡要损失 30%）`, color: '#7fae5a' }, t: 240 };
  if (window.CloudSave) CloudSave.queue();
  SFX.play('item');
};
game.die = function () {
  game.state = 'dead'; game.deaths++;
  game.mapOpen = false;
  game.toast = null; game.hint = null; // 结算屏不残留战斗提示文字
  game.dieFloor = game.floorNum; // 续爬锚点：只重打倒下的那层
  const m = Meta.load();
  if (BIO) { // 搜打撤铁律：没撤出去 = 全丢（随身金币/背包/幸存者），账户存量不动
    game.dieLost = (game.runCoins || 0) + (game.bag || []).reduce((a, b) => a + b.val * b.n, 0) + (game.saved || 0) * 100;
    game.runCoins = 0; game.bag = []; game.saved = 0; game.matCarry = { iron: 0, core: 0 };
    game.diePenalty = 0;
    SFX.play('death');
    return;
  }
  game.diePenalty = Math.min(m.coins, Math.floor((game.runEarned || 0) * .3)); // v4.0 数值审计：死亡损失本局所得 30%，与"撤离全保"形成真决策
  m.coins -= game.diePenalty; Meta.save();
  if (window.CloudSave) CloudSave.queue();
  SFX.play('death');
};
game.victory = function () {
  if (BIO && game.settled) return; // v5.2 门禁P1：结算幂等，防竞态双计
  game.settled = true;
  game.state = 'win'; game.mapOpen = false;
  const m = Meta.load();
  if (BIO) { // 深度撤离：通关奖先并随身，只 bankRun 一次（两次 queue 会让服务器 delta 双计）
    game.runCoins += 300; game.runEarned += 300;
    game.bossKilled = true;
    game.bankRun();
    game.extractMode = true;
    if (game.stage > m.maxStage) m.maxStage = game.stage;
    game.selStage = Math.min(m.maxStage + 1, game.stage + 1);
    Meta.save();
    SFX.play('clear'); return;
  }
  if (game.stage > m.maxStage) m.maxStage = game.stage; // 解锁下一关
  if (!m.cleared) { game.runCoins += 300; game.runEarned += 300; Meta.add(300); m.cleared = true; } // 首通大奖
  if (isGate(game.stage)) { game.runCoins += 60 * game.stage; game.runEarned += 60 * game.stage; Meta.add(60 * game.stage); } // 门槛关奖励 ×3 体现
  game.selStage = Math.min(m.maxStage + 1, game.stage + 1);
  Meta.save();
  if (window.CloudSave) CloudSave.queue(); // v4.0 账号云同步（离线自动队列重试）
  SFX.play('clear');
};

// ── 绘制 ──
function draw() {
  cx.fillStyle = '#000';
  cx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  if (game.state === 'title') { drawTitle(); return; }
  if (game.state === 'workshop') { game.wsCraft ? drawCraft(cx, game) : drawWorkshop(cx, game); return; }
  if (game.state === 'account') { (game.acctTab === 'armory' ? drawArmoryPanel : drawAccountPanel)(cx, game); return; } // 面板态短路，不走战场渲染

  const pal = themePal(game.theme || THEMES[0], game.floorNum);
  cx.save();
  let shx = 0, shy = 0;
  if (game.shakeAmt > .5) { shx = rand(-game.shakeAmt, game.shakeAmt); shy = rand(-game.shakeAmt, game.shakeAmt); }
  cx.translate(Math.round(-game.cam.x + shx), Math.round(HUD_H - game.cam.y + shy));

  drawRoom(cx, game.cur, pal, game.time);
  drawHazards(cx, game.cur, game.time); // v4.3 钉子/漩涡（地面之上、拾取物之下）
  if (BIO && game.state === 'play') drawBioArrows(cx, game.cur, game.time); // v5.1 单出口指引箭头
  if (BIO) drawSpawnMarks(cx, game.cur, game.time); // v5.3 预警口：出怪前 0.75s 的地面警告圈
  for (const pk of game.cur.pickups) if (!pk.dead) drawPickup(cx, pk, game.time);
  for (const e of game.cur.enemies) drawEnemy(cx, e, game.time);
  if (game.cur.boss && !game.cur.boss.dead) drawBoss(cx, game.cur.boss, game.time);
  if (!(game.state === 'dead' || game.state === 'win')) { drawPlayer(cx, game.player, game.time); drawHeadHud(cx, game.player, game.time); } // v5.2.2 头顶血条+弹丸
  for (const tr of game.cur.tears) drawTear(cx, tr, game.time);
  drawFx(cx, game);
  for (const q of game.particles) {
    cx.globalAlpha = clamp(q.life / 18, 0, 1);
    cx.fillStyle = q.c;
    cx.beginPath(); cx.arc(q.x, q.y, q.r, 0, TAU); cx.fill();
  }
  cx.globalAlpha = 1;
  cx.restore();

  drawHUD(cx, game);
  if (game.state === 'play') modHudTag(cx); // 战区规则徽标
  if (game.cur.boss && !game.cur.boss.dead && game.state === 'play') drawBossBar(cx, game.cur.boss);
  if (game.state === 'play' && !BIO && cv.getBoundingClientRect().width < 700) { // 画面过小：自救指引（BIO 竖屏原生，不需要）
    cx.fillStyle = 'rgba(120,20,20,.88)'; cx.fillRect(VIEW_W / 2 - 258, HUD_H + 2, 516, 36);
    cx.strokeStyle = '#e8c85e'; cx.lineWidth = 1; cx.strokeRect(VIEW_W / 2 - 258, HUD_H + 2, 516, 36);
    cx.fillStyle = '#ffe0c0'; cx.font = 'bold 13px monospace'; cx.textAlign = 'center';
    cx.fillText(Touch.supported() ? '画面过小！点上方 ⛶ 强制横屏全屏' : '画面过小！按 F 全屏 / 最大化窗口 / 按 Ctrl+0 重置缩放', VIEW_W / 2, HUD_H + 17);
    cx.font = '10px monospace'; cx.fillStyle = '#e0b090';
    const vv = window.visualViewport;
    cx.fillText(`诊断[${BUILD}] inner=${innerWidth}x${innerHeight} vv=${vv ? Math.round(vv.width) + 'x' + Math.round(vv.height) + ' scale=' + vv.scale.toFixed(2) : '-'} dpr=${devicePixelRatio}`, VIEW_W / 2, HUD_H + 32);
    cx.textAlign = 'left';
  }
  if (game.state === 'play' && game.cur.quota && !game.cur.cleared) { // 文档 8.2：顶部波次进度条 + 剩余敌数
    const q = game.cur.quota, k = Math.min(game.cur.killed, q), cxb = VIEW_W / 2;
    if (BIO) {
      const bw = 240;
      cx.fillStyle = 'rgba(0,0,0,.55)'; cx.fillRect(cxb - bw / 2, HUD_H - 16, bw, 12);
      cx.fillStyle = '#d9a92e'; cx.fillRect(cxb - bw / 2 + 2, HUD_H - 14, (bw - 4) * (k / q), 8);
      cx.strokeStyle = 'rgba(217,169,46,.7)'; cx.lineWidth = 1; cx.strokeRect(cxb - bw / 2, HUD_H - 16, bw, 12);
      cx.fillStyle = '#f0e2c0'; cx.font = 'bold 10px monospace'; cx.textAlign = 'center';
      cx.fillText(`第 ${game.roomNum} 区 · 歼灭 ${k}/${q} · 剩余 ${game.cur.enemies.length + (game.cur.spawnPending || []).length + (game.cur.spawnQueue || []).length}`, cxb, HUD_H - 20);
      const sec = Math.floor(game.runTime / 60);
      cx.textAlign = 'right'; cx.fillStyle = '#8a7a66'; cx.font = '10px monospace';
      cx.fillText(`${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`, VIEW_W - 10, 22); // v5.1.1：计时上移到右列顶端，与金币/积分/冲刺成纵列
      cx.textAlign = 'left';
    } else {
    cx.fillStyle = 'rgba(0,0,0,.55)'; cx.fillRect(cxb - 72, CANVAS_H - 24, 144, 15);
    cx.fillStyle = '#d9a92e'; cx.fillRect(cxb - 70, CANVAS_H - 22, 140 * (k / q), 11);
    cx.strokeStyle = 'rgba(217,169,46,.7)'; cx.lineWidth = 1; cx.strokeRect(cxb - 72, CANVAS_H - 24, 144, 15);
    cx.fillStyle = '#f0e2c0'; cx.font = 'bold 10px monospace'; cx.textAlign = 'center';
    cx.strokeStyle = 'rgba(10,6,4,.9)'; cx.lineWidth = 3; cx.strokeText(`本房猎杀 ${k}/${q}`, cxb, CANVAS_H - 13); // 描边防金色填充吃字
    cx.fillText(`本房猎杀 ${k}/${q}`, cxb, CANVAS_H - 13);
    cx.textAlign = 'left';
    }
  }
  if (BIO && game.state === 'play') { // v5.2 弹匣指示：波次条正下方弹丸点（品质色=有弹，灰=已耗）+ 换弹进度弧；清房走廊里也常显
    const pw = WEAPONS[game.player.weapon.id], cm = game.player.clipMax();
    if (pw.clip && cm > 0) {
      const a = Math.max(0, game.player.ammo), rl = game.player.reloadT;
      const gap = 10, x0 = VIEW_W / 2 - (cm - 1) * gap / 2, yy = HUD_H + 11;
      for (let i = 0; i < cm; i++) {
        cx.beginPath(); cx.arc(x0 + i * gap, yy, 3.6, 0, TAU);
        cx.fillStyle = i < a ? qColor(gunTier(pw.id)) : 'rgba(110,100,90,.5)'; // v5.3 弹丸点跟品质档（出身+强化）
        cx.fill();
      }
      cx.font = 'bold 9px monospace'; cx.textAlign = 'right'; cx.fillStyle = rl > 0 ? '#e8c85e' : '#8a7a66';
      cx.fillText(rl > 0 ? '换弹…' : `${a}/${cm}`, x0 - 10, yy + 3);
      if (rl > 0) {
        cx.strokeStyle = '#e8c85e'; cx.lineWidth = 2;
        cx.beginPath(); cx.arc(x0 - 24 - cx.measureText('换弹…').width, yy, 6, -Math.PI / 2, -Math.PI / 2 + TAU * (1 - rl / game.player.reloadDur())); cx.stroke();
      }
      cx.textAlign = 'left';
    }
  }
  drawVignette(cx, game);
  if (game.state === 'play') drawStragglers(cx, game); // 屏外残敌方位箭头
  if (!IS_MOBILE && !BIO) drawSidePanel(cx, game); // v5.0 竖屏无侧栏
  else drawMobileOverlay(cx, game); // 手机：右上叠层小地图 + 金币计数
  if (IS_MOBILE && !BIO && innerHeight > innerWidth && game.state === 'play' && !game.mapOpen && !game.paused) { // 竖屏观感自救：引导卡（BIO 原生竖屏，隐藏）
    cx.fillStyle = 'rgba(8,6,5,.78)';
    cx.beginPath(); cx.roundRect(VIEW_W / 2 - 210, CANVAS_H - 66, 420, 40, 8); cx.fill();
    cx.strokeStyle = '#b08a3a'; cx.lineWidth = 1.5;
    cx.beginPath(); cx.roundRect(VIEW_W / 2 - 210, CANVAS_H - 66, 420, 40, 8); cx.stroke();
    cx.fillStyle = '#e8c85e'; cx.font = 'bold 14px monospace'; cx.textAlign = 'center';
    cx.fillText('↑ 点上方「强制横屏」或旋转手机，体验完整战场', VIEW_W / 2, CANVAS_H - 41);
    cx.textAlign = 'left';
  }
  if (BIO && game.state === 'play' && game.bagOpen) drawBagPanel(cx, game);
  if (game.state === 'levelup') drawLevelUp(cx, game);
  if (game.state === 'wcheck') drawWeaponCheck(cx, game);
  if (game.state === 'play' && game.mapOpen) drawFloorMap(cx, game);
  drawItemToast(cx, game); // v5.3：toast 必须画在遮罩面板之后，否则被 .82 半透明压成灰字

  // 受击红闪
  if (game.flashT > 0) {
    cx.fillStyle = `rgba(180,20,20,${(game.flashT / 14) * .22})`;
    cx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  }
  if (game.paused && game.state === 'play' && !game.mapOpen) {
    cx.fillStyle = 'rgba(0,0,0,.55)'; cx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    if (IS_MOBILE) drawMobileStats(cx, game); // 面板先画，文案后叠保证可读
    cx.fillStyle = '#d8cba8'; cx.font = 'bold 34px monospace'; cx.textAlign = 'center';
    cx.fillText('暂停', VIEW_W / 2, CANVAS_H / 2 - 172);
    cx.font = '14px monospace'; cx.fillStyle = '#a8937c';
    cx.fillText(Touch.supported() ? '点右上暂停按钮继续' : '按 P 继续', VIEW_W / 2, CANVAS_H / 2 - 142);
    cx.textAlign = 'left';
  }
  if ((Touch.supported() || Touch.active) && game.state === 'play' && !game.mapOpen) drawTouchUI(cx, game.time);

  if (game.state === 'dead') drawDeathScreen();
  if (game.state === 'win') drawWinScreen();
  // 未清房锁门提示
  if (game.state === 'play' && !game.cur.cleared && game.cur.enemies.length === 0 && !game.cur.boss && !game.cur.hasEnemiesPlanned) {
    // 无怪房间（安全房）不需要提示
  }
}

function drawTitle() {
  const ctx = cx, t = game.time;
  ctx.save();
  ctx.fillStyle = '#0a0808'; ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  ctx.translate(PANEL_W / 2, 0); // 标题内容居中于全画布
  for (let row = 0; row < Math.ceil(CANVAS_H / 24); row++) for (let col = -4; col < 20; col++) {
    const x = col * 52 + (row % 2) * 26, y = row * 24;
    const shade = (row * 7 + col * 13) % 5;
    ctx.fillStyle = ['#170f0b', '#1a120c', '#150e09', '#1b130d', '#160f0a'][shade];
    ctx.fillRect(x + 1, y + 1, 50, 22);
  }
  // 干涸血渍
  ctx.fillStyle = 'rgba(60,12,10,.5)';
  for (const [bx, by, br] of [[120, 90, 26], [560, 60, 18], [640, 400, 30], [80, 430, 22], [300, 480, 16]]) {
    ctx.beginPath(); ctx.ellipse(bx, by, br, br * .55, br, 0, TAU); ctx.fill();
  }
  // 身后透光的门洞
  const dg = ctx.createRadialGradient(ROOM_W / 2, 318, 8, ROOM_W / 2, 318, 110);
  dg.addColorStop(0, 'rgba(255,190,110,.16)'); dg.addColorStop(.5, 'rgba(180,110,50,.07)'); dg.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = dg; ctx.beginPath(); ctx.arc(ROOM_W / 2, 318, 110, 0, TAU); ctx.fill();
  ctx.fillStyle = 'rgba(5,3,2,.85)';
  ctx.beginPath();
  ctx.moveTo(ROOM_W / 2 - 44, 372); ctx.lineTo(ROOM_W / 2 - 44, 268);
  ctx.quadraticCurveTo(ROOM_W / 2, 214, ROOM_W / 2 + 44, 268);
  ctx.lineTo(ROOM_W / 2 + 44, 372); ctx.fill();
  // 背景晕光
  const g = ctx.createRadialGradient(ROOM_W / 2, CANVAS_H / 2, 60, ROOM_W / 2, CANVAS_H / 2, 420);
  g.addColorStop(0, 'rgba(36,21,18,.0)'); g.addColorStop(1, 'rgba(3,2,2,.82)');
  ctx.fillStyle = g; ctx.fillRect(-PANEL_W / 2, 0, CANVAS_W, CANVAS_H);

  // 标题
  ctx.save();
  ctx.translate(ROOM_W / 2, UIY(122));
  ctx.fillStyle = '#120808';
  ctx.font = 'bold 64px monospace'; ctx.textAlign = 'center';
  ctx.fillText('解救行动', 3, 5);
  ctx.fillStyle = '#c98f2e';
  ctx.fillText('解救行动', 0, 0);
  // 标题火星飞散
  ctx.fillStyle = '#e8b24a';
  for (let i = 0; i < 6; i++) {
    const x = -130 + i * 52 + Math.sin(i * 5) * 16;
    const y = 14 + ((t * .05 + i * 27) % 34);
    ctx.globalAlpha = clamp(1 - (y - 14) / 34, 0, 1) * .8;
    ctx.beginPath(); ctx.arc(x, y, 1.8, 0, TAU); ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.restore();
  ctx.fillStyle = '#8a9ab0'; ctx.font = '16px monospace'; ctx.textAlign = 'center';
  ctx.fillText('O P E R A T I O N :   R E S C U E', ROOM_W / 2, UIY(158));
  ctx.fillStyle = '#5a6472'; ctx.font = '12px monospace';
  ctx.fillText('— 突入敌楼，逐层清剿，解救人质 —', ROOM_W / 2, UIY(180));

  // 角色选择卡（大立绘 + 称号，点击即选；1-4 键快选）
  ctx.fillStyle = '#8a7a66'; ctx.font = '12px monospace'; ctx.textAlign = 'center';
  ctx.fillText(BIO ? '选择干员（点击卡片）' : '选择干员（点击卡片 / 1-4 键 · 纯外观差异）', ROOM_W / 2, UIY(222));
  const cz = charZones();
  CHARS.forEach((ch, i) => {
    const z = cz[i], sel = (Meta.load().char || 0) === i;
    const gd = ctx.createLinearGradient(0, z.y, 0, z.y + z.h);
    gd.addColorStop(0, sel ? 'rgba(74,54,30,.97)' : 'rgba(28,21,14,.9)');
    gd.addColorStop(1, sel ? 'rgba(38,27,14,.97)' : 'rgba(14,10,7,.9)');
    ctx.fillStyle = gd;
    ctx.beginPath(); ctx.roundRect(z.x, z.y, z.w, z.h, 9); ctx.fill();
    ctx.strokeStyle = sel ? '#e8c85e' : '#4a3a2a'; ctx.lineWidth = sel ? 2.6 : 1.4;
    ctx.beginPath(); ctx.roundRect(z.x, z.y, z.w, z.h, 9); ctx.stroke();
    if (sel) { // 选中角标
      ctx.fillStyle = '#e8c85e'; ctx.beginPath(); ctx.arc(z.x + z.w - 12, z.y + 12, 4, 0, TAU); ctx.fill();
    }
    ctx.save(); ctx.translate(z.x + z.w / 2, z.y + (BIO ? 66 : 52)); ctx.scale(BIO ? 2.4 : 2.1, BIO ? 2.4 : 2.1);
    drawPlayer(ctx, { x: 0, y: 0, inv: 0, anim: 0, moving: false, aim: { x: .55, y: -.35 }, shotsPerDir: 1, char: i }, t);
    ctx.restore();
    const locked = BIO && ch.price && !heroUnlocked(i);
    if (locked) { // 未解锁英雄：压暗 + 价格独立一行（v5.1.1 P0-U1：不与名字同行叠字）
      ctx.fillStyle = 'rgba(5,4,3,.62)'; ctx.beginPath(); ctx.roundRect(z.x, z.y, z.w, z.h, 9); ctx.fill();
      ctx.fillStyle = '#e8c85e'; ctx.font = 'bold 11px monospace'; ctx.textAlign = 'center';
      ctx.fillText(`解锁 ${ch.price} 币`, z.x + z.w / 2, z.y + z.h - 44);
    }
    if (BIO && ch.tier !== undefined) { // v5.2 门禁P1：英雄品级色（白/绿/蓝/紫）角标
      const TC = ['#cfc6b8', '#7fae5a', '#7fb2e8', '#b093e8'];
      ctx.fillStyle = TC[ch.tier] || TC[0]; ctx.beginPath(); ctx.arc(z.x + 13, z.y + 13, 5.5, 0, TAU); ctx.fill();
      ctx.font = 'bold 9px monospace'; ctx.textAlign = 'left'; ctx.fillText(['白级', '绿级', '蓝级', '紫级'][ch.tier] || '', z.x + 22, z.y + 16);
    }
    ctx.fillStyle = sel ? '#e8c85e' : '#b0a08a'; ctx.font = 'bold 13px monospace'; ctx.textAlign = 'center';
    ctx.fillText(ch.name, z.x + z.w / 2, z.y + z.h - 22);
    ctx.fillStyle = '#6a5c4c'; ctx.font = '9px monospace';
    let tt = ch.title, tw = ctx.measureText(tt).width; // v5.1.1：称号超卡宽自动缩字，防裁切溢出
    if (tw > z.w - 6) ctx.font = `bold ${Math.max(7, Math.floor(9 * (z.w - 6) / tw))}px monospace`;
    ctx.fillText(tt, z.x + z.w / 2, z.y + z.h - 8);
  });

  // 脚下血泊与泪迹
  ctx.fillStyle = 'rgba(70,10,10,.55)';
  ctx.beginPath(); ctx.ellipse(ROOM_W / 2, UIY(378), 62, 13, .06, 0, TAU); ctx.fill();
  ctx.fillStyle = 'rgba(140,190,255,.18)';
  ctx.beginPath(); ctx.ellipse(ROOM_W / 2 + 30, UIY(384), 16, 4, 0, 0, TAU); ctx.fill();
  // v4.0 选关器：◀ 第 N 关 · 战区 · 主题 ▶（解锁到 maxStage+1）
  const m0 = Meta.load();
  const sel = clamp(game.selStage || 1, 1, m0.maxStage + 1);
  const z0 = zoneOf(sel), th0 = stageTheme(sel);
  ctx.fillStyle = 'rgba(10,7,5,.78)';
  ctx.beginPath(); ctx.roundRect(ROOM_W / 2 - 104, UIY(354), 208, 38, 8); ctx.fill();
  ctx.strokeStyle = '#b08a3a'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.roundRect(ROOM_W / 2 - 104, UIY(354), 208, 38, 8); ctx.stroke();
  ctx.fillStyle = '#8a7a66'; ctx.font = 'bold 20px monospace'; ctx.textAlign = 'center';
  if (sel > 1) ctx.fillText('◀', ROOM_W / 2 - 128, UIY(379));
  ctx.fillStyle = sel < m0.maxStage + 1 ? '#e8c85e' : 'rgba(138,122,102,.35)'; ctx.fillText('▶', ROOM_W / 2 + 128, UIY(379)); // 锁定态灰显仍占位
  ctx.fillStyle = '#e8c85e'; ctx.font = 'bold 15px monospace';
  ctx.fillText(`第 ${sel} 关 · ${z0.name}${isGate(sel) ? ' · 门槛' : ''}`, ROOM_W / 2, UIY(369));
  ctx.fillStyle = '#9cb0c8'; ctx.font = '10px monospace';
  ctx.fillText(`${th0.name} · ${z0.rule || '解救人质，逐层深入'}`, ROOM_W / 2, UIY(385));
  if (BIO) { // v5.1 难度分级选择条
    const dz = bioDiffZones(), cur = Meta.load().bioDiff || 0;
    ctx.font = '10px monospace'; ctx.fillStyle = '#8a7a66'; ctx.textAlign = 'center';
    ctx.fillText('难 度', ROOM_W / 2, dz[0].y - 6);
    BIO_DIFFS.forEach((df, i) => {
      const z = dz[i];
      ctx.fillStyle = i === cur ? 'rgba(46,33,16,.95)' : 'rgba(14,11,8,.85)';
      ctx.beginPath(); ctx.roundRect(z.x, z.y, z.w, z.h, 6); ctx.fill();
      ctx.strokeStyle = i === cur ? df.c : '#3a2e24'; ctx.lineWidth = i === cur ? 2 : 1;
      ctx.beginPath(); ctx.roundRect(z.x, z.y, z.w, z.h, 6); ctx.stroke();
      ctx.fillStyle = i === cur ? df.c : '#6b5a4a'; ctx.font = 'bold 12px monospace';
      ctx.fillText(`${df.id} ${df.name}`, z.x + z.w / 2, z.y + 20);
    });
    ctx.textAlign = 'left';
  }
  const fly = { cfg: ETYPE.fly, x: ROOM_W / 2 + Math.cos(t * .04) * 150, y: UIY(190) + Math.sin(t * .04) * 10, r: 12, flash: 0, spawnT: 0 };
  const fly2 = { cfg: ETYPE.attackfly, x: ROOM_W / 2 + Math.cos(t * .05 + 3) * 190, y: UIY(202) + Math.sin(t * .03) * 8, r: 11, flash: 0, spawnT: 0 };
  drawEnemy(ctx, fly, t); drawEnemy(ctx, fly2, t);

  // 提示
  if (Math.floor(t / 32) % 2 === 0) {
    cx.fillStyle = '#e0d0b8'; cx.font = 'bold 20px monospace';
    cx.fillText(Touch.supported() ? '轻触屏幕 开始行动' : '按 Enter 开始行动', ROOM_W / 2, UIY(424));
  }
  drawWorkshopBtn(cx, game);
  cx.fillStyle = '#8a7a66'; cx.font = BIO ? '10px monospace' : '12px monospace';
  cx.fillText(BIO ? (Touch.supported() ? '单指移动 · 自动射击 · 搜打撤：带物资活着撤离才算赚' : 'WASD 移动 · 自动射击 · Space 冲刺 · 活着撤离带走物资') : (Touch.supported() ? '左摇杆移动 · 右摇杆射击 · 打怪升级三选一 · 赚金币进工坊' : 'WASD 移动 · 方向键射击 · Space 冲刺 · 打怪升级三选一 · 赚金币进工坊'), ROOM_W / 2, BIO ? CANVAS_H - 12 : UIY(490)); // v5.1.1：BIO 提示下移贴画布底，不压账号按钮
  ctx.restore(); // 归还标题居中变换
  { // 账号入口按钮：画布绝对坐标绘制，与 acctBtnZone 命中区严格一致
    const z = acctBtnZone();
    cx.fillStyle = 'rgba(28,22,14,.95)'; cx.beginPath(); cx.roundRect(z.x, z.y, z.w, z.h, 6); cx.fill();
    cx.strokeStyle = '#5a7a8a'; cx.lineWidth = 1.5; cx.beginPath(); cx.roundRect(z.x, z.y, z.w, z.h, 6); cx.stroke();
    cx.fillStyle = CloudSave.token && CloudSave.online ? '#7fae5a' : '#9cc4ee'; cx.font = 'bold 14px monospace'; cx.textAlign = 'center';
    cx.fillText('账号', z.x + z.w / 2, z.y + 21);
    cx.textAlign = 'left';
  }
  cx.fillStyle = 'rgba(138,115,96,.55)'; cx.font = '10px monospace';
  if (BIO) { cx.textAlign = 'left'; cx.fillText(BUILD, 6, CANVAS_H - 6); } // v5.1.1 复核P2：水印移左下，不与底部操作提示叠字
  else { cx.textAlign = 'right'; cx.fillText(BUILD, CANVAS_W - 6, CANVAS_H - 6); }
  // v4.0 账号状态条（右上，点击改昵称）
  const m1 = Meta.load();
  const az = accountZone();
  cx.fillStyle = 'rgba(10,7,5,.66)';
  cx.beginPath(); cx.roundRect(az.x, az.y, az.w, az.h, 5); cx.fill();
  cx.fillStyle = CloudSave.online ? '#7fae5a' : '#a8937c'; cx.font = '10px monospace'; cx.textAlign = BIO ? 'center' : 'right';
  cx.fillText(BIO ? `账号 ${m1.coins}` : `#${CloudSave.profile ? CloudSave.profile.id : '-'} ${m1.nickname || '游客'} 金币${m1.coins} 最高${m1.maxStage}关`, BIO ? az.x + az.w / 2 : CANVAS_W - 10, az.y + 13); cx.textAlign = 'left';
  cx.textAlign = 'left';
  if (game.toast) { // 撤离等结算反馈：标题屏顶部横幅
    cx.globalAlpha = Math.min(1, game.toast.t / 40);
    cx.fillStyle = 'rgba(20,14,8,.92)';
    cx.beginPath(); cx.roundRect(CANVAS_W / 2 - 230, 40, 460, 44, 8); cx.fill();
    cx.strokeStyle = game.toast.item.color; cx.lineWidth = 2;
    cx.beginPath(); cx.roundRect(CANVAS_W / 2 - 230, 40, 460, 44, 8); cx.stroke();
    cx.fillStyle = game.toast.item.color; cx.font = 'bold 15px monospace'; cx.textAlign = 'center';
    cx.fillText(game.toast.item.name, CANVAS_W / 2, 58);
    cx.fillStyle = '#cbb59a'; cx.font = '11px monospace';
    cx.fillText(game.toast.item.desc, CANVAS_W / 2, 76);
    cx.globalAlpha = 1; cx.textAlign = 'left';
  }
}

function drawAccountPanel(cx, g) {
  cx.fillStyle = '#0a0806'; cx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  cx.fillStyle = '#e8c85e'; cx.font = 'bold 24px monospace'; cx.textAlign = 'center';
  cx.fillText('账 号', CANVAS_W / 2, 90);
  const rows = acctRowsZones();
  const m = Meta.load();
  const ownedN = Object.keys(WEAPONS).filter(weaponOwned).length;
  const labels = [
    ['status', CloudSave.token ? (CloudSave.online ? `已登录：账号 #${CloudSave.profile && CloudSave.profile.id} · 云同步✓` : '已登录 · 当前离线（本地暂存，恢复后自动补传）') : '未登录 —— 点这里登录（连不上则本地存档照常玩）'],
    ['nick', `昵称：${m.nickname || '（未设置，点这里填写）'}`],
    ['server', `服务器：${CloudSave.api || '（未设置 = 纯本地存档，点这里填写）'}`],
    ['export', '导出存档码（复制给新设备）'],
    ['import', '导入存档码（粘贴后自动重载）'],
    ['armory', `军械库：已拥有 ${ownedN}/${Object.keys(WEAPONS).length} 把 · 军械券×${m.gachaTickets || 0} —— 点这里抽枪`],
    ['ctrl', `操作：移动摇杆在${m.ctrlSide === 'left' ? '左' : '右'}手 —— 点这里切换`],
    ['back', '返 回'],
  ];
  rows.forEach((r, i) => {
    const [id, text] = labels[i];
    cx.fillStyle = id === 'back' ? 'rgba(60,44,26,.6)' : 'rgba(24,18,12,.9)';
    cx.beginPath(); cx.roundRect(r.x, r.y, r.w, r.h, 8); cx.fill();
    cx.strokeStyle = id === 'status' && CloudSave.online ? '#7fae5a' : id === 'armory' ? '#8a6f3a' : '#4a382a'; cx.lineWidth = 1.5;
    cx.beginPath(); cx.roundRect(r.x, r.y, r.w, r.h, 8); cx.stroke();
    cx.fillStyle = id === 'status' ? (CloudSave.token ? '#b8d8a8' : '#e0d0b8') : id === 'armory' ? '#e8c85e' : '#cbb59a';
    cx.font = '13px monospace'; cx.textAlign = 'center';
    cx.fillText(text.length > 44 ? text.slice(0, 41) + '…' : text, r.x + r.w / 2, r.y + 29);
  });
  drawPanelToast(cx);
  cx.fillStyle = '#5a4c42'; cx.font = '10px monospace';
  cx.fillText('微信/抖音小游戏登录通道已预留（platform.js），当前为游客+服务器账号', CANVAS_W / 2, CANVAS_H - 18);
  cx.textAlign = 'left';
}

// 账号/军械库面板顶部 toast（v4.3-F3：状态行登录结果等反馈不再只活在标题屏）
function drawPanelToast(cx) {
  if (!game.toast) return;
  cx.globalAlpha = Math.min(1, game.toast.t / 40);
  cx.fillStyle = 'rgba(20,14,8,.94)';
  cx.beginPath(); cx.roundRect(CANVAS_W / 2 - 230, 10, 460, 44, 8); cx.fill();
  cx.strokeStyle = game.toast.item.color; cx.lineWidth = 2;
  cx.beginPath(); cx.roundRect(CANVAS_W / 2 - 230, 10, 460, 44, 8); cx.stroke();
  cx.fillStyle = game.toast.item.color; cx.font = 'bold 14px monospace'; cx.textAlign = 'center';
  cx.fillText(game.toast.item.name, CANVAS_W / 2, 28);
  cx.fillStyle = '#cbb59a'; cx.font = '11px monospace';
  const d = game.toast.item.desc;
  cx.fillText(d.length > 40 ? d.slice(0, 37) + '…' : d, CANVAS_W / 2, 45);
  cx.globalAlpha = 1;
}

// ── v4.3 军械库：抽卡解锁武器（出身档 橙6%/紫28%/蓝66%，十连保 ≥紫，重复返 80 币）──
function doGacha(n) {
  const r = gachaPull(n);
  if (!r) { SFX.play('deny'); game.gachaResult = { fail: true, n, t: 360 }; return; }
  game.gachaResult = Object.assign({ n, t: 600 }, r);
}
function drawArmoryPanel(cx, g) {
  cx.fillStyle = '#0a0806'; cx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  const m = Meta.load();
  cx.fillStyle = '#e8c85e'; cx.font = 'bold 20px monospace'; cx.textAlign = 'center';
  cx.fillText('军 械 库', CANVAS_W / 2, 46);
  cx.fillStyle = '#cbb59a'; cx.font = '11px monospace';
  cx.fillText(`金币 ${m.coins} · 军械券 ×${m.gachaTickets || 0} · 局内只会掉落你已拥有的枪`, CANVAS_W / 2, 68);
  const z = armoryZones();
  z.cells.forEach(c => {
    const w = WEAPONS[c.id], owned = weaponOwned(c.id);
    cx.fillStyle = owned ? 'rgba(30,22,14,.95)' : 'rgba(26,21,16,.95)';
    cx.beginPath(); cx.roundRect(c.x, c.y, c.w, c.h, 7); cx.fill();
    cx.strokeStyle = owned ? w.c : '#4a3c2c'; cx.lineWidth = owned ? 2 : 1.2;
    cx.beginPath(); cx.roundRect(c.x, c.y, c.w, c.h, 7); cx.stroke();
    cx.save(); cx.beginPath(); cx.arc(c.x + 22, c.y + 24, 13, 0, TAU);
    cx.fillStyle = owned ? w.c : '#3a3026'; cx.fill();
    cx.fillStyle = owned ? '#1a120a' : '#8a7560'; cx.font = 'bold 14px monospace';
    cx.fillText(w.glyph, c.x + 22, c.y + 29);
    cx.textAlign = 'left'; cx.font = 'bold 11px monospace';
    cx.fillStyle = owned ? '#e8dcc4' : '#9a8468';
    cx.fillText(owned ? w.name : '？？？', c.x + 40, c.y + 22);
    cx.font = '10px monospace'; cx.fillStyle = owned ? '#a8937c' : '#7a6a54';
    cx.fillText(owned ? `历史 Lv${m.weapons[c.id] || 1}` : '抽卡解锁', c.x + 40, c.y + 37);
    const tq = gunTier(c.id); // v5.3 品质档角标：绿/蓝/紫/橙/红（绿=出身最低，不打标）
    if (tq > 0) {
      cx.fillStyle = qColor(tq); cx.font = 'bold 9px monospace'; cx.textAlign = 'right';
      cx.fillText(qName(tq), c.x + c.w - 6, c.y + 12);
    }
    cx.textAlign = 'center';
    cx.restore();
  });
  const t = m.gachaTickets || 0;
  const btn = (r, label, sub, afford) => {
    cx.fillStyle = afford ? 'rgba(40,28,14,.95)' : 'rgba(18,15,12,.9)';
    cx.beginPath(); cx.roundRect(r.x, r.y, r.w, r.h, 8); cx.fill();
    cx.strokeStyle = afford ? '#e8c85e' : '#3a3128'; cx.lineWidth = 2;
    cx.beginPath(); cx.roundRect(r.x, r.y, r.w, r.h, 8); cx.stroke();
    cx.fillStyle = afford ? '#e8dcc4' : '#57493a'; cx.font = 'bold 15px monospace';
    cx.fillText(label, r.x + r.w / 2, r.y + 20);
    cx.font = '10px monospace'; cx.fillStyle = afford ? '#a8937c' : '#3f342a';
    cx.fillText(sub, r.x + r.w / 2, r.y + 36);
  };
  const tenCost = Math.max(0, 1200 - 150 * Math.min(t, 10));
  btn(z.single, '单抽', t > 0 ? `券抵 150 · 免费（余${t}）` : '150 金币', t > 0 || m.coins >= 150);
  btn(z.ten, '十连', tenCost === 1200 ? '1200 金币 · 必出紫档+' : `${tenCost} 金币（${Math.min(t, 10)}券抵扣）· 必出紫档+`, t > 0 || m.coins >= 1200);
  cx.fillStyle = '#8a7560'; cx.font = '12px monospace';
  cx.fillText('返 回', z.back.x + z.back.w / 2, z.back.y + 22);
  cx.strokeStyle = '#4a382a'; cx.lineWidth = 1.5;
  cx.beginPath(); cx.roundRect(z.back.x, z.back.y, z.back.w, z.back.h, 6); cx.stroke();
  // v4.3-F3：抽卡结果改「分组摘要」——新枪逐把（稀有度配色）+ 重复合并一行，18px 行距不再糊字
  const res = g.gachaResult;
  if (res) {
    cx.globalAlpha = Math.min(1, res.t / 60);
    if (res.fail) {
      cx.fillStyle = '#c4303a'; cx.font = 'bold 14px monospace';
      cx.fillText(`金币不足：${res.n === 10 ? '十连需 1200' : '单抽需 150'} 金币`, CANVAS_W / 2, UIY(396));
    } else {
      const fresh = res.results.filter(r => !r.dup);
      const dupN = res.results.length - fresh.length;
      cx.font = 'bold 13px monospace';
      if (fresh.length) {
        cx.fillStyle = '#cbb59a'; cx.textAlign = 'left';
        const head = `新枪 ×${fresh.length}：`;
        let y390 = UIY(390);
        cx.fillText(head, CANVAS_W / 2 - 220, y390);
        let x = CANVAS_W / 2 - 220 + cx.measureText(head).width + 2;
        fresh.forEach((r, i) => {
          const w = WEAPONS[r.id], seg = `${w.name}[${qName(gunTier(r.id))}]${i < fresh.length - 1 ? '、' : ''}`;
          cx.fillStyle = qColor(gunTier(r.id));
          if (x + cx.measureText(seg).width > CANVAS_W / 2 + 220) { x = CANVAS_W / 2 - 220; y390 += 22; }
          cx.fillText(seg, x, y390); x += cx.measureText(seg).width;
        });
        cx.textAlign = 'center';
      } else {
        cx.fillStyle = '#8a7560';
        cx.fillText('全是重复 —— 已自动折算金币', CANVAS_W / 2, UIY(390));
      }
      cx.fillStyle = '#a8937c'; cx.font = '11px monospace';
      cx.fillText(`花 ${res.cost}${res.tickets ? `（券×${res.tickets}）` : ''}${dupN ? ` · 重复×${dupN} 返还 ${res.refund}` : ''} —— 点任意处关闭`, CANVAS_W / 2, UIY(416));
    }
    cx.globalAlpha = 1; cx.textAlign = 'left';
  } else {
    cx.fillStyle = '#5a4c42'; cx.font = '10px monospace';
    cx.fillText('概率：橙 6% · 紫 28% · 蓝 66%（出身档，工坊可合成升档至红）｜重复枪折算金币', CANVAS_W / 2, UIY(400));
  }
  drawPanelToast(cx);
  cx.textAlign = 'left';
}

function statLines() {
  const p = game.player;
  const sec = Math.floor(game.runTime / 60);
  return [
    `突入区域：${game.theme ? game.theme.floors[game.floorNum - 1] : ''}`,
    `击杀：${game.kills}    探索房间：${game.roomsSeen}`,
    `拾取道具：${p ? p.items.length : 0} 个    存活时间：${Math.floor(sec / 60)}分${sec % 60}秒`,
  ];
}

function drawDeathScreen() {
  cx.fillStyle = 'rgba(20,2,2,.78)';
  cx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  cx.save(); cx.translate(PANEL_W / 2, 0);
  if (BIO) { // 搜打撤铁律：没撤出去 = 全丢
    cx.fillStyle = '#c4303a'; cx.font = 'bold 44px monospace'; cx.textAlign = 'center';
    cx.fillText('撤 离 失 败', ROOM_W / 2, UIY(170));
    cx.fillStyle = '#a8937c'; cx.font = '13px monospace';
    cx.fillText('倒在实验室 ' + game.roomNum + ' —— 本局随身所得全部丢失（账户存量不动）', ROOM_W / 2, UIY(196));
    cx.fillStyle = '#c46a5a'; cx.font = 'bold 15px monospace';
    cx.fillText('损失：随身金币 ' + (game.dieLost || 0) + ' 枚', ROOM_W / 2, UIY(250));
    cx.fillStyle = '#8a5a4a'; cx.font = '15px monospace';
    statLines().forEach((t, i) => cx.fillText(t, ROOM_W / 2, UIY(290) + i * 26));
    cx.fillStyle = '#b093e8'; cx.font = 'bold 14px monospace';
    cx.fillText('致命伤来自：' + (game.lastKiller || '未知'), ROOM_W / 2, UIY(390));
    drawWorkshopBtn(cx, game);
    { const z = bigNextZone();
      cx.fillStyle = 'rgba(120,40,30,.9)'; cx.beginPath(); cx.roundRect(z.x, z.y, z.w, z.h, 8); cx.fill();
      cx.strokeStyle = '#e8c85e'; cx.lineWidth = 2; cx.beginPath(); cx.roundRect(z.x, z.y, z.w, z.h, 8); cx.stroke();
      cx.fillStyle = '#ffe0c0'; cx.font = 'bold 17px monospace';
      cx.fillText('⟳ 再战第 ' + game.stage + ' 次远征', z.x + z.w / 2, z.y + 28); }
    cx.fillStyle = '#e0d0b8'; cx.font = '11px monospace';
    cx.fillText('点按钮再战 · 点工坊强化 · Esc 回基地', ROOM_W / 2, CANVAS_H - 14); // v5.1.1：贴画布底，不被裁半
    cx.textAlign = 'left'; cx.restore(); return;
  }
  cx.fillStyle = '#c4303a'; cx.font = 'bold 58px monospace'; cx.textAlign = 'center';
  cx.fillText('行 动 失 败', ROOM_W / 2, UIY(170));
  cx.fillStyle = '#a8937c'; cx.font = '13px monospace'; cx.fillText(`第 ${game.stage} 关 · 倒在第 ${game.dieFloor || game.floorNum} 层 —— 损失本局所得 30%（-${game.diePenalty || 0} 金币），续爬该层`, ROOM_W / 2, UIY(196));
  cx.fillStyle = '#8a5a4a'; cx.font = '15px monospace';
  statLines().forEach((s, i) => cx.fillText(s, ROOM_W / 2, UIY(240) + i * 26));
  cx.fillStyle = '#c46a5a'; cx.font = '13px monospace';
  cx.fillText(`致命伤来自：${game.lastKiller || '未知'}`, ROOM_W / 2, UIY(330));
  const p = game.player;
  if (p && p.items.length) {
    p.items.slice(0, 9).forEach((it, i) => {
      drawItemIcon(cx, it, ROOM_W / 2 - (Math.min(p.items.length, 9) - 1) * 20 + i * 40, UIY(350), game.time);
    });
  }
  cx.fillStyle = '#b093e8'; cx.font = 'bold 14px monospace';
  cx.fillText(`本局收获金币 +${game.runCoins || 0}（实时入账）`, ROOM_W / 2, UIY(412));
  drawWorkshopBtn(cx, game);
  if (Math.floor(game.time / 30) % 2 === 0) {
    cx.fillStyle = '#e0d0b8'; cx.font = 'bold 14px monospace';
    { const z = bigNextZone();
      cx.fillStyle = 'rgba(120,40,30,.9)'; cx.beginPath(); cx.roundRect(z.x, z.y, z.w, z.h, 8); cx.fill();
      cx.strokeStyle = '#e8c85e'; cx.lineWidth = 2; cx.beginPath(); cx.roundRect(z.x, z.y, z.w, z.h, 8); cx.stroke();
      cx.fillStyle = '#ffe0c0'; cx.font = 'bold 17px monospace'; cx.textAlign = 'center';
      cx.fillText(`⟳ 重试第 ${game.stage} 关 · 第 ${game.dieFloor || ''} 层`, z.x + z.w / 2, z.y + 28); cx.textAlign = 'left'; }
    cx.fillText(Touch.supported() ? '点按钮重试本关 · 点工坊按钮强化自己' : 'R 重试本关 · S 工坊 · Esc 回标题', ROOM_W / 2, UIY(490));
  }
  cx.restore();
}

// v5.0 搜打撤「成功撤离」结算屏：物资网格 + 逐项折算 + 总入账
function drawExtractSettle() {
  cx.fillStyle = '#e8c85e'; cx.font = 'bold 44px monospace'; cx.textAlign = 'center';
  cx.fillText('成 功 撤 离', ROOM_W / 2, UIY(150));
  cx.fillStyle = '#a8937c'; cx.font = '13px monospace';
  const deep = game.cur && game.cur.type === 'boss';
  cx.fillText(`第 ${game.stage} 次远征 · ` + (deep ? 'BOSS 击破，深度撤离' : '见好就收，带资回营'), ROOM_W / 2, UIY(180));
  cx.fillStyle = '#8a7a66'; cx.font = 'bold 13px monospace';
  cx.fillText('获 取 物 资', ROOM_W / 2, UIY(216));
  const cw = 104, ch = 70, gap = 10, cols = 4;
  const x0 = ROOM_W / 2 - (cols * (cw + gap) - gap) / 2, y0 = UIY(230);
  for (let i = 0; i < 8; i++) {
    const it = (game.bag || [])[i];
    const x = x0 + (i % cols) * (cw + gap), y = y0 + Math.floor(i / cols) * (ch + gap);
    cx.fillStyle = it ? 'rgba(30,22,14,.95)' : 'rgba(14,11,8,.8)';
    cx.beginPath(); cx.roundRect(x, y, cw, ch, 6); cx.fill();
    cx.strokeStyle = it ? it.c : '#2a221a'; cx.lineWidth = it ? 1.8 : 1;
    cx.beginPath(); cx.roundRect(x, y, cw, ch, 6); cx.stroke();
    if (it) {
      cx.fillStyle = it.c; cx.font = 'bold 22px monospace';
      cx.fillText(it.glyph, x + cw / 2, y + 34);
      cx.font = '10px monospace'; cx.fillStyle = '#cbb59a';
      cx.fillText(`${it.name} ×${it.n}`, x + cw / 2, y + 54);
      cx.fillStyle = '#8a7a66'; cx.font = '9px monospace';
      cx.fillText(`${it.val * it.n} 币`, x + cw / 2, y + 68);
    }
  }
  const ty = y0 + 2 * ch + gap + 36;
  cx.font = 'bold 14px monospace';
  const rows = [
    ['随身金币', Math.round((game.runCoins || 0) * (game.diffCoin || 1)), '#e8c85e'], // v5.2 门禁P2：显示难度折后实收
    ['物资折算', game.lootVal || 0, '#7fae5a'],
    [`解救幸存者 ${game.saved || 0} 人`, game.savedVal || 0, '#8ecbff'],
  ];
  if (game.bossKilled) rows.push(['远征通关奖', Math.round(300 * (game.diffCoin || 1)), '#b093e8']); // v5.1.1：显示难度折后实收
  rows.forEach(([k, v, c], i) => {
    cx.textAlign = 'left'; cx.fillStyle = '#a8937c';
    cx.fillText(k, ROOM_W / 2 - 150, ty + i * 24);
    cx.textAlign = 'right'; cx.fillStyle = c;
    cx.fillText('+' + v, ROOM_W / 2 + 150, ty + i * 24);
  });
  cx.textAlign = 'center'; cx.fillStyle = '#ffe0c0'; cx.font = 'bold 18px monospace';
  cx.fillText(`总入账 ${game.runBanked || 0} 金币${game.hopeless ? '（绝望逃跑 ×0.6）' : ''}`, ROOM_W / 2, ty + rows.length * 24 + 16);
  { // 文档 7.1：积分与评级印章（v5.1.1 P1：右移到明细列之外，不压数字）
    const sc = game.score || 0;
    const grade = sc >= 1200 ? 'S' : sc >= 800 ? 'A' : sc >= 450 ? 'B' : 'C';
    const gc = { S: '#e8c85e', A: '#b093e8', B: '#8ecbff', C: '#8a7a66' }[grade];
    cx.save(); cx.translate(Math.min(CANVAS_W - 42, ROOM_W / 2 + 210), ty + 30); cx.rotate(-.22);
    cx.strokeStyle = gc; cx.lineWidth = 3; cx.globalAlpha = .9;
    cx.beginPath(); cx.arc(0, 0, 30, 0, TAU); cx.stroke();
    cx.fillStyle = gc; cx.font = 'bold 34px monospace'; cx.fillText(grade, 0, 12);
    cx.font = '9px monospace'; cx.fillText(`积分 ${sc}`, 0, 44);
    cx.restore(); cx.globalAlpha = 1;
  }
  cx.fillStyle = '#8a7a66'; cx.font = '11px monospace';
  cx.fillText(`最深推进：实验室 ${Meta.load().bioBest || game.roomNum} · 累计成功撤离 ${Meta.load().bioEscapes || 0} 次`, ROOM_W / 2, ty - 18);
  drawWorkshopBtn(cx, game);
  { const z = bigNextZone();
    cx.fillStyle = 'rgba(40,80,45,.92)'; cx.beginPath(); cx.roundRect(z.x, z.y, z.w, z.h, 8); cx.fill();
    cx.strokeStyle = '#e8c85e'; cx.lineWidth = 2; cx.beginPath(); cx.roundRect(z.x, z.y, z.w, z.h, 8); cx.stroke();
    cx.fillStyle = '#f0e2c0'; cx.font = 'bold 18px monospace';
    cx.fillText(`▶ 第 ${game.stage + 1} 次远征`, z.x + z.w / 2, z.y + 29); }
  cx.fillStyle = '#e0d0b8'; cx.font = '13px monospace';
  cx.fillText('点按钮下一波远征 · 点工坊强化 · Esc 回基地', ROOM_W / 2, UIY(490));
  cx.textAlign = 'left';
}

function drawWinScreen() {
  cx.fillStyle = 'rgba(10,8,2,.72)';
  cx.fillRect(0, 0, CANVAS_W, CANVAS_H);
  cx.save(); cx.translate(PANEL_W / 2, 0);
  if (BIO) { drawExtractSettle(); cx.restore(); return; }
  cx.fillStyle = '#e8c85e'; cx.font = 'bold 46px monospace'; cx.textAlign = 'center';
  cx.fillText('人 质 解 救 成 功', ROOM_W / 2, UIY(170));
  cx.fillStyle = '#e8c85e'; cx.font = '13px monospace'; cx.fillText(`第 ${game.stage} 关通关！解锁第 ${game.stage + 1} 关`, ROOM_W / 2, UIY(196));
  cx.fillStyle = '#9a8a5a'; cx.font = '15px monospace';
  statLines().forEach((s, i) => cx.fillText(s, ROOM_W / 2, UIY(240) + i * 26));
  cx.fillStyle = '#b093e8'; cx.font = 'bold 14px monospace';
  cx.fillText(`本局收获金币 +${game.runCoins || 0}（实时入账）`, ROOM_W / 2, 400);
  drawWorkshopBtn(cx, game);
  if (Math.floor(game.time / 30) % 2 === 0) {
    cx.fillStyle = '#e0d0b8'; cx.font = 'bold 14px monospace';
    { const z = bigNextZone();
      cx.fillStyle = 'rgba(40,80,45,.92)'; cx.beginPath(); cx.roundRect(z.x, z.y, z.w, z.h, 8); cx.fill();
      cx.strokeStyle = '#e8c85e'; cx.lineWidth = 2; cx.beginPath(); cx.roundRect(z.x, z.y, z.w, z.h, 8); cx.stroke();
      cx.fillStyle = '#f0e2c0'; cx.font = 'bold 18px monospace'; cx.textAlign = 'center';
      cx.fillText(`▶ 进入第 ${game.stage + 1} 关`, z.x + z.w / 2, z.y + 29); cx.textAlign = 'left'; }
    cx.fillText(Touch.supported() ? '点按钮进下一关 · 点工坊强化' : 'R 下一关 · S 工坊 · Esc 回标题', ROOM_W / 2, UIY(490));
  }
  cx.restore();
}

boot();
