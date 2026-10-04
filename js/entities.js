'use strict';
// ─────────────────────────────────────────────
// 实体：玩家 / 弹道 / 敌人 / Boss / 掉落 / 道具
// ─────────────────────────────────────────────

function hitWall(room, x, y, r) {
  for (const [ox, oy] of [[-r, -r], [r, -r], [-r, r], [r, r], [0, -r], [0, r], [-r, 0], [r, 0]]) {
    if (room.solidTile(Math.floor((x + ox) / TILE), Math.floor((y + oy) / TILE))) return true;
  }
  return false;
}
function moveCircle(e, dx, dy, room) {
  const r = e.r * .8;
  if (dx && !hitWall(room, e.x + dx, e.y, r)) e.x += dx;
  if (dy && !hitWall(room, e.x, e.y + dy, r)) e.y += dy;
}

// ── 泪弹 / 敌方弹 ──
class Tear {
  constructor(x, y, vx, vy, dmg, r, isPlayer, opts = {}) {
    this.x = x; this.y = y; this.vx = vx; this.vy = vy;
    this.dmg = dmg; this.r = r; this.isPlayer = isPlayer;
    this.life = opts.life || 80; this.dead = false;
    this.homing = opts.homing || false; this.big = opts.big || false;
    this.colorKey = opts.colorKey || null;
    this.bulletKey = opts.bulletKey || null; // Q 版弹种分型（缺省走 colorKey/敌我兜底）
    this.pierce = opts.pierce || 0;
    if (opts.splitT !== undefined) { this.splitT = opts.splitT; this.sp = Math.hypot(vx, vy); this.rot = opts.rot; this.eliteSplit = opts.eliteSplit; }
    // v4.3 十新枪行为参数
    this.squash = 0; this.spId = opts.spId || null;
    this.passthrough = !!opts.passthrough;         // 漩涡核：飞行段不与任何实体碰撞
    this.slow = !!opts.slow;                       // v5.1 突变减速弹：命中玩家减速 1 秒
    if (opts.boomer) { this.boomer = true; this.boomerT = 44; this.phase = 'out'; }
    if (opts.fuseT !== undefined) { this.fuseT = opts.fuseT; this.fuse0 = opts.fuseT || 1; this.fuse = 1; this.landed = false; }
    if (opts.blast !== undefined) this.blast = opts.blast;   // 爆炸半径（plop 时引爆）
    this.bounces = opts.bounces;                              // 橡皮鸭：剩余撞墙反弹次数（undefined=不复弹）
    this.convert = opts.convert || null;                      // 'pin' | 'vortex'：死亡转为场地危险实体
    if (this.convert) { this.pinR = opts.pinR; this.vR = opts.vR; }
    this.burn = opts.burn || false; // v5.2 引燃弹（火焰/花毒/蜂毒）：命中挂灼烧
    this.deathBurst = opts.deathBurst || null;                // 死亡绽出小子弹（千瓣菊/工蜂箱）
    if (!isPlayer && BIO) this.dmg = 10; // v5.2 门禁P0：敌弹固定 -10；桌面沿用 sqrt 缓升
  }
  update(room) {
    modTear(this);
    if (this.squash > 0) this.squash = Math.max(0, this.squash - .12);
    if (this.boomer) { this.updateBoomer(room); return; }
    if (this.fuseT !== undefined) { this.updateFuse(room); return; }
    if (this.homing) {
      const tgt = this.isPlayer ? nearestEnemy(room, this.x, this.y) : game.player;
      if (tgt) {
        const a0 = Math.atan2(this.vy, this.vx), sp = Math.hypot(this.vx, this.vy);
        let a1 = Math.atan2(tgt.y - this.y, tgt.x - this.x);
        let da = a1 - a0; while (da > Math.PI) da -= TAU; while (da < -Math.PI) da += TAU;
        const a2 = a0 + clamp(da, -.09, .09);
        this.vx = Math.cos(a2) * sp; this.vy = Math.sin(a2) * sp;
      }
    }
    this.x += this.vx; this.y += this.vy;
    if (this.splitT !== undefined && --this.splitT <= 0) {
      this.dead = true;
      const base = Math.PI / 4 + (this.rot || 0);
      for (let i = 0; i < 4; i++) {
        const a = base + i * Math.PI / 2;
        room.tears.push(new Tear(this.x, this.y, Math.cos(a) * this.sp, Math.sin(a) * this.sp,
          2, 5.5, false, { life: 90, bulletKey: "shard" }));
      }
      if (this.eliteSplit) for (let i = 0; i < 4; i++) {
        const a = base + Math.PI / 4 + i * Math.PI / 2;
        room.tears.push(new Tear(this.x, this.y, Math.cos(a) * this.sp, Math.sin(a) * this.sp,
          2, 5.5, false, { life: 90, bulletKey: "shard" }));
      }
      SFX.play('enemyShoot');
      return;
    }
    if (--this.life <= 0) { this.plop(room, 'life'); return; }
    // 探墙拆两轴：橡皮鸭可分别翻 vx/vy 复弹，其余弹种照旧消亡
    const wy = hitWall(room, this.x, this.vy ? this.y + Math.sign(this.vy) * this.r : this.y, this.r * .6);
    const wx = hitWall(room, this.vx ? this.x + Math.sign(this.vx) * this.r : this.x, this.y, this.r * .6);
    if (wy || wx) {
      if (this.bounces !== undefined && this.bounces > 0) {
        if (wy) { this.vy = -this.vy; this.y += this.vy * 2; }
        if (wx) { this.vx = -this.vx; this.x += this.vx * 2; }
        this.bounces--; this.squash = 1;
        game.fx.push({ type: 'bounce', x: this.x, y: this.y, r: this.r + 3, dir: Math.atan2(-this.vy, -this.vx), t: 10, t0: 10 });
      } else this.plop(room, 'wall');
    }
  }
  updateBoomer(room) { // 骨镰回旋镖：去程直线，到点/撞墙折返，回程自导追玩家（清 hits 可再砍一刀）
    if (--this.life <= 0) { this.dead = true; return; }
    if (this.phase === 'out') {
      this.x += this.vx; this.y += this.vy; this.boomerT--;
      if (this.boomerT <= 0 || hitWall(room, this.x + this.vx, this.y + this.vy, this.r * .5)) {
        this.phase = 'back'; this.hits = [];
      }
      return;
    }
    const p = game.player;
    if (!p) { this.dead = true; return; }
    const a = Math.atan2(p.y - this.y, p.x - this.x), sp = Math.hypot(this.vx, this.vy) || 5;
    this.vx = Math.cos(a) * sp; this.vy = Math.sin(a) * sp;
    this.x += this.vx; this.y += this.vy;
    if (dist2(this.x, this.y, p.x, p.y) < p.r + this.r + 6) { this.dead = true; SFX.play('item'); }
  }
  updateFuse(room) { // 罐罐雷：飞到落点或撞墙即着陆停转，引信烧尽由 plop 统一引爆
    this.fuseT--;
    this.fuse = clamp(this.fuseT / this.fuse0, 0, 1);
    if (this.fuseT <= 0) { this.plop(room, 'fuse'); return; }
    if (!this.landed) {
      const nx = this.x + this.vx, ny = this.y + this.vy;
      if (hitWall(room, nx, ny, this.r * .5)) { this.landed = true; this.vx = this.vy = 0; this.squash = 1; }
      else { this.x = nx; this.y = ny; }
    }
  }
  plop(room, cause) {
    this.dead = true;
    if (this.blast !== undefined) { // 贴身接触即炸：定点雷特性
      damageArea(room, this.x, this.y, this.blast, this.dmg);
      game.fx.push({ type: 'blast', x: this.x, y: this.y, r: this.blast, seed: randi(0, 9), t: 18, t0: 18 });
      addScorch(room, this.x, this.y, this.blast * .8);
      SFX.play('boom');
    }
    if (this.convert) convertTear(room, this);
    if (this.deathBurst) burstTear(room, this);
    spawnParticles(room, this.x, this.y, 3, this.isPlayer ? '#9cc4ee' : '#c96a4a', 1.4);
  }
}

// 弹体死亡转化：刺猬钉→落地钉（超 8 根最旧先亡）/ 漩涡核→坍缩场（同屏 2 个）
function convertTear(room, tr) {
  if (tr.convert === 'pin') {
    while (room.pins.length >= 8) room.pins.shift();
    room.pins.push({ x: tr.x, y: tr.y, life: 360, r: tr.pinR || 26, dmg: tr.dmg * .35 * (1 + .4 * (game.player && game.player.gl('p_mort') || 0)), slow: !!(game.player && game.player.gl('p_bar')), cap: WEAPONS.pin.c, angle: rand(-1.5, -.7), l5: !!(game.player && game.player.weapon.id === 'pin' && game.player.weapon.lvl >= 5) });
  } else if (tr.convert === 'vortex') {
    while (room.vortexes.length >= 2) room.vortexes.shift();
    room.vortexes.push({ x: tr.x, y: tr.y, life: Math.round(300 * (tr.vDur || 1)), r: tr.vR || 56, tickDmg: tr.dmg * .45, burstDmg: tr.dmg * 2.2 * (tr.vBoom || 1) });
  }
}
// 死亡绽片：千瓣菊花瓣 / 工蜂箱小蜂（均为玩家友弹）
function burstTear(room, tr) {
  const b = tr.deathBurst;
  game.fx.push({ type: b.fx, x: tr.x, y: tr.y, r: tr.r + 6, seed: randi(0, 9), n: b.n, t: 14, t0: 14 });
  for (let i = 0; i < b.n; i++) {
    const a = i * TAU / b.n + rand(-(b.jit || .3), b.jit || .3), sp = b.sp * rand(.75, 1.15);
    room.tears.push(new Tear(tr.x, tr.y, Math.cos(a) * sp, Math.sin(a) * sp, tr.dmg * b.dmgMul, 5.5, true,
      { life: b.life, bulletKey: b.key, homing: b.homing || false, burn: b.burn || false }));
  }
}

// 瞬发 AoE 直伤（罐罐雷/漩涡/荆棘鞭/穿云枪共用），绕开弹体碰撞管线
function damageArea(room, x, y, r, dmg) {
  for (const e of room.enemies) {
    if (e.dead || e.spawnT > 0) continue;
    if (dist2(x, y, e.x, e.y) < r + e.r * .6) e.hit(dmg, room, e.x, e.y);
  }
  const b = room.boss;
  if (b && !b.dead && dist2(x, y, b.x, b.y) < r + b.r * .5) b.hit(dmg);
}
function hasLos(room, x1, y1, x2, y2) {
  const d = Math.hypot(x2 - x1, y2 - y1), n = Math.max(1, Math.ceil(d / 16));
  for (let i = 1; i < n; i++) {
    const x = x1 + (x2 - x1) * i / n, y = y1 + (y2 - y1) * i / n;
    if (room.solidTile(Math.floor(x / TILE), Math.floor(y / TILE))) return false;
  }
  return true;
}
function addScorch(room, x, y, r) {
  room.scorch.push({ x, y, r, a: rand(0, TAU), al: rand(.24, .38) });
  if (room.scorch.length > 12) room.scorch.shift();
}

// 场地危险实体逐帧：钉子周期扎刺 / 漩涡吸聚+跳伤+到期塌缩
function updateHazards(room) {
  for (let i = room.pins.length - 1; i >= 0; i--) {
    const pin = room.pins[i];
    pin.life--;
    if (pin.life <= 0) { room.pins.splice(i, 1); continue; }
    if (pin.life % 45 === 0) { damageArea(room, pin.x, pin.y, pin.r, pin.dmg); if (pin.slow) for (const e of room.enemies) if (!e.dead && dist2(pin.x, pin.y, e.x, e.y) < pin.r + e.r) e.pinSlow = 60; } // v5.2 p_bar 铁蒺藜减速
  }
  for (let i = room.vortexes.length - 1; i >= 0; i--) {
    const v = room.vortexes[i];
    v.life--;
    const pull = v.life > 30 ? 1.6 : 1.6 * v.life / 30; // 末期吸力渐衰给敌人挣脱窗口
    for (const e of room.enemies) {
      if (e.dead || e.spawnT > 0) continue;
      const d = Math.max(1, dist2(v.x, v.y, e.x, e.y));
      if (d < v.r + e.r) moveCircle(e, (v.x - e.x) / d * pull, (v.y - e.y) / d * pull, room);
    }
    const b = room.boss;
    if (b && !b.dead && b.act === 'idle') { // Boss 只在闲逛相位吃 25% 吸力，冲锋/瞬移不被拉扯
      const d = Math.max(1, dist2(v.x, v.y, b.x, b.y));
      if (d < v.r + b.r) moveCircle(b, (v.x - b.x) / d * pull * .25, (v.y - b.y) / d * pull * .25, room);
    }
    if (v.life % 30 === 0) damageArea(room, v.x, v.y, v.r * .5, v.tickDmg);
    if (v.life <= 0) {
      damageArea(room, v.x, v.y, v.r, v.burstDmg);
      game.fx.push({ type: 'implode', x: v.x, y: v.y, r: v.r, t: 16, t0: 16 });
      SFX.play('zap');
      room.vortexes.splice(i, 1);
    }
  }
}

// 各枪有效射程（自动索敌判定 + 侧栏展示共用口径）
function weaponRange(p) {
  const w = WEAPONS[p.weapon.id], lvl = p.weapon.lvl;
  const raw = (() => { switch (w.id) {
    case 'laser': return (340 + 30 * lvl) * (p.tearLife / 80);
    case 'light': return 280 * (p.tearLife / 80);
    case 'flame': return (24 + lvl * 3) * p.tearSpeed * .89;
    case 'whip': return 78 + 8 * lvl;
    case 'knife': case 'club': case 'claw': case 'reaper': return w.reach || 96;
    case 'rail': return WORLD_W;
    case 'mortar': return 5.4 * (34 + lvl * 2) + 60;
    case 'sickle': return p.tearSpeed * 1.05 * 44;
    case 'pin': return p.tearSpeed * 1.1 * 70;
    case 'hive': return p.tearSpeed * .9 * 60;
    case 'vortex': return p.tearSpeed * 34;
    default: return p.tearSpeed * p.tearLife;
  } })();
  return raw * (1 + (p.gunMods ? p.gunMods().rng : 0));
}
function autoTarget(room, p) { // v5.0 自动炮塔：射程内最近「看得见」的敌人
  const cand = [];
  for (const e of room.enemies) if (!e.dead && e.spawnT <= 0) cand.push(e);
  if (room.boss && !room.boss.dead) cand.push(room.boss);
  cand.sort((a, b) => dist2(p.x, p.y, a.x, a.y) - dist2(p.x, p.y, b.x, b.y));
  for (const c of cand) if (dist2(p.x, p.y, c.x, c.y) <= weaponRange(p) + c.r && hasLos(room, p.x, p.y, c.x, c.y)) return c;
  return null;
}
function nearestEnemy(room, x, y) {
  let best = null, bd = 1e9;
  for (const e of room.enemies) { if (e.dead) continue; const d = dist2(x, y, e.x, e.y); if (d < bd) { bd = d; best = e; } }
  if (room.boss && !room.boss.dead) { const d = dist2(x, y, room.boss.x, room.boss.y); if (d < bd) best = room.boss; }
  return best;
}

// ── 局内升级三选一卡池（可叠加，带等级上限）──
const UPGRADES = [
  { id: 'spread',  name: '散弹之芯', desc: '弹数 +1（每发伤害 -10%）', max: 3, c: '#e8a83a', glyph: '散', cat: 'atk', rar: 'R',
    apply(p) { p.shotsPerDir++; p.dmg *= .9; } },
  { id: 'dmg',     name: '空尖弹', desc: '伤害 +15%', max: 5, c: '#c94a4a', glyph: '刃', cat: 'atk', rar: 'R',
    apply(p) { p.dmg *= 1.15; } },
  { id: 'rate',    name: '急促呼吸', desc: '射击间隔 -2 帧', max: 4, c: '#8ecbff', glyph: '急', cat: 'atk', rar: 'R',
    apply(p) { p.fireDelay = Math.max(5, p.fireDelay - 2); } },
  { id: 'boots',   name: '鼠捷之靴', desc: '移动速度 +0.3', max: 3, c: '#7fae5a', glyph: '捷', cat: 'surv', rar: 'R',
    apply(p) { p.speed += .3; } },
  { id: 'pierce',  name: '贯穿之刺', desc: '子弹穿透 +1 个敌人', max: 2, c: '#b8c4cc', glyph: '穿', cat: 'atk', rar: 'R',
    apply(p) { p.pierce++; } },
  { id: 'homing',  name: '磁引之核', desc: '眼泪追踪敌人', max: 1, c: '#7f7fe8', glyph: '磁', cat: 'atk', rar: 'SR',
    apply(p) { p.homing = true; } },
  { id: 'vital',   name: '生之心', desc: '生命上限 +20 并回满 20', max: 3, c: '#c4303a', glyph: '生', cat: 'surv', rar: 'R',
    apply(p) { p.maxHp += 20; p.heal(20); } },
  { id: 'vacuum',  name: '贪婪磁石', desc: '拾取范围 +45', max: 2, c: '#d9a92e', glyph: '贪', cat: 'res', rar: 'R',
    apply(p) { p.pickupMag += 45; } },
  { id: 'dashcd',  name: '疾风核心', desc: '冲刺冷却 -18%', max: 3, c: '#7fb2e8', glyph: '风', cat: 'surv', rar: 'R',
    apply(p) { p.dashCdMax = Math.max(24, Math.round(p.dashCdMax * .82)); } },
  { id: 'longer',  name: '长歌之弦', desc: '射程 +20%', max: 2, c: '#b093e8', glyph: '弦', cat: 'atk', rar: 'R',
    apply(p) { p.tearLife = Math.round(p.tearLife * 1.2); } },
  { id: 'maint',   name: '枪械保养', desc: '当前枪等级 +1（伤害地板随级成长）', max: 4, c: '#d9a92e', glyph: '养', cat: 'res', rar: 'SR',
    apply(p) { p.weapon.lvl = Math.min(WEAPONS[p.weapon.id].max, p.weapon.lvl + 1); if (WEAPONS[p.weapon.id].clip) p.ammo = Math.min(p.clipMax(), p.ammo + 1); } }, // v5.2 门禁P2：枪不再掉落后的等级成长通道
  // v5.1 文档 4.2 四方向补全：控制/生存/资源 + 紫卡协同（v5.2：护盾卡删除——护盾将做成武器；血约半心删除）
  { id: 'slowfield', name: '减速力场', desc: '120 圈内敌人移速 -40%', max: 1, c: '#6ab0d8', glyph: '滞', cat: 'ctrl', rar: 'SR',
    apply(p) { p.upLv.slowfield = 1; } },
  { id: 'bloodlust', name: '嗜血回复', desc: '每击杀 8 只回复 20 生命', max: 2, c: '#c96a4a', glyph: '嗜', cat: 'res', rar: 'SR',
    apply(p) { p.bloodNeed = Math.max(5, (p.bloodNeed || 8) - 3); } },
  { id: 'thorns',    name: '荆棘反伤', desc: '受接触伤害时反弹 2 点', max: 2, c: '#7d9c6a', glyph: '荆', cat: 'surv', rar: 'SR',
    apply(p) { p.upLv.thorns = (p.upLv.thorns || 0) + 1; } },
  { id: 'execute',   name: '处决直觉', desc: '对眩晕/麻痹敌人伤害 +50%', max: 1, c: '#c4303a', glyph: '处', cat: 'atk', rar: 'SSR',
    apply(p) { p.upLv.execute = 1; } },
  { id: 'adrenaline', name: '肾上腺素', desc: '击杀后 2 秒移速 +30%', max: 1, c: '#e8a83a', glyph: '肾', cat: 'res', rar: 'SSR',
    apply(p) { p.upLv.adrenaline = 1; } },
  { id: 'siphon',    name: '经验虹吸', desc: '经验获取 +25%', max: 1, c: '#b093e8', glyph: '吸', cat: 'res', rar: 'SSR',
    apply(p) { p.upLv.siphon = 1; } },
];

// ── 玩家：移动 / 瞄准 / 射击 / 经验 ──
class Player {
  constructor(x, y) {
    this.x = x; this.y = y; this.r = 15;
    this.speed = 3.0; this.dmg = 3.2; this.tearSpeed = 6.6; this.tearR = 6.5;
    this.fireDelay = 13; this.tearLife = 80;
    this.hp = 100; this.maxHp = 100; // v5.2 数字血条：英雄品级定上限（newRun 里按 CHARS.hp 覆写）
    // v4.0 单货币：钱包即账户余额（Meta.coins），代理保持旧代码 p.coins++ 全兼容
    Object.defineProperty(this, 'coins', {
      get() { return Meta.load().coins; },
      set(v) { const d = Meta.load(); d.coins = v; Meta.save(); },
    });
    this.dashCd = 0; this.dashCdMax = 70; this.dashing = 0; this.dashVx = 0; this.dashVy = 0;
    this.homing = false; this.shotsPerDir = 1; this.pickupMag = 24; this.bloodNeed = 8; this.bloodCnt = 0; this.adrT = 0;
    this.pierce = 0;
    this.weapon = { id: 'tear', lvl: 1 };
    this.ammo = 0; this.reloadT = 0; // v5.2 弹药：打空自动换弹（近战无弹匣）
    this.skills = [ // v5.2 技能表跟英雄：开局自带冲锋打击（手雷/符咒退役）
      { id: 'dashstrike', glyph: '冲', cd: 0, cdMax: 120, unlocked: true },
    ];
    this.gunLv = {}; // v5.2 枪技能：{gunId:{cardId:次数}}，只对当前持枪生效
    this.level = 1; this.xp = 0; this.xpNext = 8; this.upLv = {};
    this.inv = 0; this.cd = 0; this.q = [];
    this.vx = 0; this.vy = 0; this.chainT = 0; this.zing = 0; this.stillT = 0; this.slowT = 0; this.stunT = 0; // v4.0 特区状态 + v5.1 减速/眩晕
    this.aim = { x: 0, y: 1 }; this.moving = false; this.anim = 0;
    this.items = [];
  }
  hurt(n, g, srcX, srcY, killer) {
    if (this.inv > 0 || g.state !== 'play') return;
    this.hp -= n; this.inv = 90;
    g.lastKiller = killer || '未知';
    this.q = []; // 受击打断已排队的连射
    g.flashT = 14;
    if (srcX !== undefined) { // 玩家自己被弹开，制造"挨打感"与脱离贴脸
      const d = Math.max(1, dist2(this.x, this.y, srcX, srcY));
      moveCircle(this, (this.x - srcX) / d * 14, (this.y - srcY) / d * 14, g.cur);
    }
    SFX.play('hurt'); shake(n >= 15 ? 9 : 5);
    if (IS_MOBILE && navigator.vibrate) { try { navigator.vibrate(n >= 15 ? 60 : 35); } catch (e) {} }
    spawnParticles(g.cur, this.x, this.y, 10, '#c93030', 3);
    addBlood(g.cur, this.x, this.y, 14);
    if (this.hp <= 0 && g.reviveAvail) { // 亡者残响：每局一次的复活
      g.reviveAvail = false;
      this.hp = 40; this.inv = 200;
      g.hint = { text: '亡者残响：你从血泊里爬了回来', t: 160 };
      SFX.play('item'); shake(10);
      return;
    }
    if (this.hp <= 0) { this.hp = 0; g.die(); }
  }
  fireLaser(room, ux, uy, lvl) {
    const len = (340 + 30 * lvl) * (this.tearLife / 80), hitR = (13 + 2.5 * lvl) * (1 + .4 * this.gl('l_wide')); // v5.2 l_wide 光束加宽
    const dmg = weaponDmg(this, WEAPONS.laser);
    let ex = this.x, ey = this.y;
    const hits = [];
    for (let d = 18; d < len; d += 7) {
      const px = this.x + ux * d, py = this.y + uy * d;
      if (room.solidTile(Math.floor(px / TILE), Math.floor(py / TILE))) break;
      ex = px; ey = py;
      for (const e of room.enemies)
        if (!e.dead && e.spawnT <= 0 && !hits.includes(e) && dist2(px, py, e.x, e.y) < hitR + e.r * .6) { hits.push(e); }
      if (room.boss && !room.boss.dead && !hits.includes(room.boss) && dist2(px, py, room.boss.x, room.boss.y) < room.boss.r * .9) hits.push(room.boss);
    }
    for (const h of hits) { const dd = this.gl('l_cut') && h.maxHp && h.hp > h.maxHp * .5 ? dmg * 1.25 : dmg; h.hit ? (h.cfg ? h.hit(dd, room, h.x, h.y) : h.hit(dd)) : null; } // v5.2 l_cut 高热切割
    game.fx.push({ type: 'laser', x1: this.x + ux * 16, y1: this.y + uy * 16, x2: ex, y2: ey, lvl, t: 9 });
    SFX.play('laser');
  }
  fireChain(room, ux, uy, lvl) {
    const dmg = weaponDmg(this, WEAPONS.light);
    const maxChain = 2 + Math.min(3, lvl) + this.gl('j_jump');
    const pts = [{ x: this.x + ux * 14, y: this.y + uy * 14 }];
    const hit = [];
    const los = (x1, y1, x2, y2) => hasLos(room, x1, y1, x2, y2);
    for (let c = 0; c < maxChain; c++) {
      let best = null, bd = c === 0 ? 280 * (this.tearLife / 80) : 170;
      for (const e of room.enemies) {
        if (e.dead || e.spawnT > 0 || hit.includes(e)) continue;
        const d = dist2(pts[c].x, pts[c].y, e.x, e.y);
        if (d < bd && los(pts[c].x, pts[c].y, e.x, e.y)) { bd = d; best = e; }
      }
      if (room.boss && !room.boss.dead && !hit.includes(room.boss)) {
        const d = dist2(pts[c].x, pts[c].y, room.boss.x, room.boss.y);
        if (d < bd && los(pts[c].x, pts[c].y, room.boss.x, room.boss.y)) { bd = d; best = room.boss; }
      }
      if (!best) break;
      hit.push(best);
      pts.push({ x: best.x, y: best.y });
      if (best.cfg) best.hit(dmg, room, best.x, best.y); else best.hit(dmg);
      if (this.gl('j_par') && best.cfg && Math.random() < .15) best.stun = Math.max(best.stun || 0, 30); // v5.2 j_par 感电
    }
    if (pts.length > 1) {
      game.fx.push({ type: 'bolt', pts, lvl, t: 10 });
      SFX.play('zap');
    } else {
      // 无目标时向前发射一枚短程电弧弹，保证开火必有反馈
      room.tears.push(new Tear(this.x + ux * 14, this.y + uy * 14,
        ux * this.tearSpeed * .9, uy * this.tearSpeed * .9, dmg * (this.gl('j_amp') ? .85 : .7), 6 + lvl * .6, true, // v5.2 j_amp 兜底弹增强
        { life: Math.round(30 * (this.tearLife / 80)), colorKey: 'spark', pierce: 1 }));
      SFX.play('zap');
    }
  }
  // v5.1 近战武器：扇形挥击（whip 管线泛化），词条=击退/麻痹/大弧
  fireMelee(room, ux, uy, lvl, w) {
    const base = Math.atan2(uy, ux);
    const q = ((Meta.load().wq || {})[w.id] || 0);
    const gm = this.gunMods();
    let spread = (w.arc || 2.2) + (q >= 3 ? .5 : 0) + .6 * this.gl('kn_arc');
    if (this.gl('rp_ring') && w.id === 'reaper') spread = TAU - .1; // v5.2 灭世环
    const range = ((w.reach || 96) + 4 * lvl) * (1 + gm.rng);
    const dmg = weaponDmg(this, w);
    let hitAny = false;
    const foes = room.enemies.filter(e => !e.dead && e.spawnT <= 0);
    if (room.boss && !room.boss.dead) foes.push(room.boss);
    for (const e of foes) {
      const d = Math.max(1, dist2(this.x, this.y, e.x, e.y));
      if (d > range + e.r * .6) continue;
      let da = Math.atan2(e.y - this.y, e.x - this.x) - base;
      while (da > Math.PI) da -= TAU; while (da < -Math.PI) da += TAU;
      if (Math.abs(da) > spread / 2) continue;
      let dd = dmg * (this.upLv.execute && e.stun > 0 ? 1.5 : 1) * (w._six ? .6 : 1); // 紫卡协同：处决直觉；六连抓第二段 ×0.6
      if ((this.gl('r_pier') && w.id === 'rail') || (this.gl('cl_brk') && w.id === 'club')) dd = e.dr ? dd / Math.max(.35, 1 - e.dr) : dd; // v5.2 破甲
      if (e.cfg) e.hit(dd, room, e.x, e.y); else e.hit(dd);
      if (w.id === 'club' && e.cfg) moveCircle(e, (e.x - this.x) / d * 26 * (1 + .5 * this.gl('cl_knock')), (e.y - this.y) / d * 26, room); // 钢筋棒击退
      if (w.id === 'club' && this.gl('cl_quake') && e.cfg && Math.random() < .2) e.stun = Math.max(e.stun || 0, 30);                    // v5.2 震地
      if (w.id === 'claw' && e.cfg && Math.random() < .3 + .1 * this.gl('cw_par')) e.stun = Math.max(e.stun || 0, 30);                  // 电弧爪麻痹 30%(+)
      hitAny = true;
      if (this.gl('rp_gaze') && w.id === 'reaper') e.pinSlow = 45; // v5.2 死亡凝视
    }
    game.fx.push({ type: 'whip', x: this.x, y: this.y, ang: base, spread, r: range, hit: hitAny, col: w.c, t: 12, t0: 12 });
    if (w.id === 'claw' && this.gl('cw_six') && !w._six) this.fireMelee(room, Math.cos(base + .5), Math.sin(base + .5), lvl, Object.assign({}, w, { _six: 1 })); // v5.2 六连抓：第二段
    SFX.play(hitAny ? 'hit' : 'dash');
  }
  // 荆棘鞭：无弹体近战扇形，瞬发结算 + 14 帧鞭影 fx
  fireWhip(room, ux, uy, lvl, depth = 0) {
    const base = Math.atan2(uy, ux), range = (78 + 8 * lvl) * (1 + this.gunMods().rng), spread = 1.5;
    const dmg = weaponDmg(this, WEAPONS.whip);
    let hitAny = false, hits = 0;
    const foes = room.enemies.filter(e => !e.dead && e.spawnT <= 0);
    if (room.boss && !room.boss.dead) foes.push(room.boss);
    for (const e of foes) {
      const d = Math.max(1, dist2(this.x, this.y, e.x, e.y));
      if (d > range + e.r * .6) continue;
      let da = Math.atan2(e.y - this.y, e.x - this.x) - base;
      while (da > Math.PI) da -= TAU; while (da < -Math.PI) da += TAU;
      if (Math.abs(da) > spread / 2 || !hasLos(room, this.x, this.y, e.x, e.y)) continue;
      let dd = this.upLv.execute && e.stun > 0 ? dmg * 1.5 : dmg; // v5.2 处决协同进荆棘鞭
      if (e.cfg) e.hit(dd, room, e.x, e.y); else e.hit(dd);
      if (this.gl('w_tan') && e.cfg && Math.random() < .12) e.stun = Math.max(e.stun || 0, 36); // 缠缚定身
      hits++; hitAny = true;
    }
    if (this.gl('w_leech') && hits) this.heal(Math.min(6, hits * 2)); // 吸血藤
    game.fx.push({ type: 'whip', x: this.x, y: this.y, ang: base, spread, r: range, hit: hitAny, t: 14, t0: 14 });
    if (depth === 0 && this.gl('w_two')) this.fireWhip(room, Math.cos(base + .45), Math.sin(base + .45), lvl, 1); // 二连鞭击
    SFX.play(hitAny ? 'hit' : 'dash');
  }
  // 穿云枪：cd 就绪即蓄满，开火=全图宽瞬发贯穿线，伤害随距离衰减至 40% 下限
  fireRail(room, ux, uy, lvl) {
    const dmg0 = weaponDmg(this, WEAPONS.rail);
    let ex = this.x, ey = this.y;
    const pts = [];
    for (let d = 18; d < WORLD_W; d += 7) {
      const px = this.x + ux * d, py = this.y + uy * d;
      if (room.solidTile(Math.floor(px / TILE), Math.floor(py / TILE))) break;
      ex = px; ey = py; pts.push([px, py, d]);
    }
    const hitR = 12 + lvl * 1.5, hit = [];
    for (const [px, py, d] of pts) {
      const dmg = dmg0 * Math.max(.5, 1 - d / 1200);
      for (const e of room.enemies) {
        if (e.dead || e.spawnT > 0 || hit.includes(e)) continue;
        if (dist2(px, py, e.x, e.y) < hitR + e.r * .6) { hit.push(e); e.hit(this.gl('r_pier') && e.dr ? dmg / Math.max(.35, 1 - e.dr) : dmg, room, e.x, e.y); } // v5.2 r_pier 穿甲
      }
      const b = room.boss;
      if (b && !b.dead && !hit.includes(b) && dist2(px, py, b.x, b.y) < hitR + b.r * .5) { hit.push(b); b.hit(dmg); }
    }
    game.fx.push({ type: 'rail', x1: this.x + ux * 16, y1: this.y + uy * 16, x2: ex, y2: ey, lvl, t: 13, t0: 13 });
    SFX.play('laser');
  }
  // v5.2 主动技能表跟英雄：唯一槽=冲锋打击（自动朝最近敌突进扇斩）
  castSkill(room, i) {
    const sk = this.skills[i];
    if (!sk || !sk.unlocked || sk.cd > 0) return;
    if (sk.id === 'dashstrike') { // v5.2 唯一英雄主动技：冲锋打击 // 冲刺打击：自动朝最近敌短突 + 2.5× 扇形斩
      const tgt0 = nearestEnemy(room, this.x, this.y);
      const base = tgt0 ? Math.atan2(tgt0.y - this.y, tgt0.x - this.x) : Math.atan2(this.aim.y, this.aim.x);
      this.dashing = Math.max(this.dashing, 8); this.dashVx = Math.cos(base) * 9.2; this.dashVy = Math.sin(base) * 9.2;
      const dmg = this.dmg * 2.5, range = 120;
      let hitAny = false;
      const foes = room.enemies.filter(e => !e.dead && e.spawnT <= 0);
      if (room.boss && !room.boss.dead) foes.push(room.boss);
      for (const e of foes) {
        const d = Math.max(1, dist2(this.x, this.y, e.x, e.y));
        if (d > range + e.r * .6) continue;
        let da = Math.atan2(e.y - this.y, e.x - this.x) - base;
        while (da > Math.PI) da -= TAU; while (da < -Math.PI) da += TAU;
        if (Math.abs(da) > 1.3) continue;
        if (e.cfg) e.hit(dmg, room, e.x, e.y); else e.hit(dmg);
        hitAny = true;
      }
      game.fx.push({ type: 'whip', x: this.x, y: this.y, ang: base, spread: 2.6, r: range, hit: hitAny, col: '#e8a83a', t: 12, t0: 12 });
      sk.cd = sk.cdMax; SFX.play('dash');
    }
  }
  // v5.2 枪技能卡读取：当前枪的卡等级与聚合加成（clip/rl/rng/dmg/cd）
  gl(key) { const g = this.gunLv && this.gunLv[this.weapon.id]; return (g && g[key]) || 0; }
  gunMods() {
    const m = { clip: 0, rl: 0, rng: 0, dmg: 0, cd: 0 };
    const g = (this.gunLv || {})[this.weapon.id] || {};
    for (const k of Object.keys(g)) {
      const u = UPGRADES.find(x => x.id === k);
      if (u && u.add) for (const a of Object.keys(u.add)) m[a] = (m[a] || 0) + u.add[a] * g[k];
    }
    return m;
  }
  gunLvOf(u) { const p = game.player; return u.gun ? (((p.gunLv || {})[u.gun] || {})[u.id] || 0) : (p.upLv[u.id] || 0); }
  heal(n) { this.hp = clamp(this.hp + n, 0, this.maxHp); }
  // v5.2 弹药：弹匣上限（随 Lv 与技能卡成长）/ 换弹时长；近战武器返回 0（无弹药概念）
  clipMax() { const w = WEAPONS[this.weapon.id]; if (!w.clip) return 0; return Math.max(1, Math.round((w.clip + this.gunMods().clip) * (1 + .1 * (this.weapon.lvl - 1)))); }
  reloadDur() { const w = WEAPONS[this.weapon.id]; return Math.max(18, Math.round(w.rl * (1 - this.gunMods().rl))); }
  update(room) {
    if (this.inv > 0) this.inv--;
    // 玩家卡岩自救（击退/异常导致的嵌入）；冲刺穿墙态豁免
    if (!this.dashing && room.solidTile(Math.floor(this.x / TILE), Math.floor(this.y / TILE))) {
      outer: for (let r2 = 1; r2 < 5; r2++)
        for (let oy = -r2; oy <= r2; oy++) for (let ox = -r2; ox <= r2; ox++) {
          const tx = Math.floor(this.x / TILE) + ox, ty = Math.floor(this.y / TILE) + oy;
          if (tx > 0 && ty > 0 && tx < GRID_W - 1 && ty < GRID_H - 1 && !room.solidTile(tx, ty)) {
            this.x = tx * TILE + 24; this.y = ty * TILE + 24; break outer;
          }
        }
    }
    if (this.stunT > 0) this.stunT--; // 双头犬连咬眩晕：短暂失去操作
    let [mx, my] = Input.dir('v');
    if (this.stunT > 0) { mx = 0; my = 0; }
    if (Touch.active) {
      const [tx, ty] = Touch.vector('move');
      mx += tx; my += ty;
      const ml = Math.hypot(mx, my);
      if (ml > 1) { mx /= ml; my /= ml; }
    }
    const mm = modPlayerPre(this, mx, my);
    if (mm) { mx = mm[0]; my = mm[1]; }
    this.moving = !!(mx || my);
    // 冲刺（Space / 触屏按钮）：移动方向优先，静止时朝枪口；带无敌帧，可撞开宝箱与杂物
    if ((Input.pressed('Space') || Touch.dashTap) && modTryDash(this)) { Touch.dashTap = false; }
    else if ((Input.pressed('Space') || Touch.dashTap) && this.dashCd <= 0 && this.dashing <= 0) {
      Touch.dashTap = false;
      let dx = mx, dy = my;
      if (!dx && !dy) { dx = this.aim.x; dy = this.aim.y; }
      const l = Math.hypot(dx, dy) || 1;
      this.dashing = game.mod === 'ice' ? 20 : 13; this.dashVx = dx / l * 9.2; this.dashVy = dy / l * 9.2;
      this.dashCd = this.dashCdMax;
      SFX.play('dash');
      if (!game.taughtDash) { game.taughtDash = true; game.hint = { text: '冲刺无敌帧：能穿岩石杂物，撞开箱子和货柜', t: 200 }; }
    } else if (Touch.dashTap) Touch.dashTap = false;
    modDashTick(this);
    if (this.dashing > 0) {
      this.dashing--;
      this.inv = Math.max(this.inv, 2); // 冲刺全程无敌
      // 穿墙冲刺：岩石/杂物直接掠过，只有外墙挡路
      {
        const wallAt = (x, y) => room.wallOnlyTile(Math.floor(x / TILE), Math.floor(y / TILE));
        const nx = this.x + this.dashVx, ny = this.y + this.dashVy;
        if (!wallAt(nx + Math.sign(this.dashVx) * (this.r - 4), this.y)) this.x = nx;
        if (!wallAt(this.x, ny + Math.sign(this.dashVy) * (this.r - 4))) this.y = ny;
        this.x = clamp(this.x, TILE + this.r, WORLD_W - TILE - this.r);
        this.y = clamp(this.y, TILE + this.r, WORLD_H - TILE - this.r);
      }
      if (this.dashing % 2 === 0) game.fx.push({ type: 'ghost', x: this.x, y: this.y, char: this.char, t: 8 });
      for (const pk of room.pickups)
        if (!pk.dead && pk.kind === 'chest' && dist2(pk.x, pk.y, this.x, this.y) < pk.r + this.r) openChest(room, pk);
      for (const o of room.props)
        if (!o.dead && dist2(o.x, o.y, this.x, this.y) < 20 + this.r) damageProp(room, o, 99);
      if (this.dashing === 0) this.inv = Math.max(this.inv, 3); // 尾帧仅 3 帧缓冲，配合 CD 防永无敌
    } else if (modPlayerMove(this, room)) { /* 冰面惯性滑行中 */ }
    else if (this.moving) { this.anim++; const sm = (this.slowT > 0 ? .8 : 1) * (this.adrT > 0 ? 1.3 : 1); moveCircle(this, mx * this.speed * sm, my * this.speed * sm, room); }
    if (this.dashCd > 0) this.dashCd--;
    if (this.slowT > 0) this.slowT--;
    if (this.adrT > 0) this.adrT--;
    // v5.0 主动技能：触屏按钮 / J·K 键；冷却逐帧递减
    if (BIO) {
      let idx = Touch.skillTap;
      if (idx < 0 && Input.pressed('KeyJ')) idx = 0;
      Touch.skillTap = -1;
      if (idx >= 0) this.castSkill(room, idx);
      for (const sk of this.skills) if (sk.cd > 0) sk.cd--;
    }
    // 射击：BIO 自动索敌（射程内最近敌人自动开火，玩家只管走位）；桌面手动瞄准
    let ax, ay;
    if (BIO) {
      const tgt = autoTarget(room, this); // 视线过滤：不再隔岩开火
      if (tgt) {
        const d = Math.max(1, dist2(this.x, this.y, tgt.x, tgt.y));
        if (d <= weaponRange(this)) {
          if (d > 8) { ax = (tgt.x - this.x) / d; ay = (tgt.y - this.y) / d; this.aim = { x: ax, y: ay }; } // v5.2：索敌即转枪口
          else { ax = this.aim.x; ay = this.aim.y; } // 贴身重叠：沿当前枪口仍开火（否则零向量卡死不出弹）
        }
      }
    } else {
      [ax, ay] = Input.dir('a');
      if (!ax && !ay && Touch.active) { const v = Touch.vector('aim'); ax = v[0]; ay = v[1]; }
    }
    if (ax || ay) {
      const l = Math.hypot(ax, ay);
      const ux = ax / l, uy = ay / l;
      this.aim = { x: ux, y: uy };
      const w = WEAPONS[this.weapon.id];
      const effCd = Math.max(4, Math.round(w.cd * (this.fireDelay / 13) * (1 - this.gunMods().cd))); // v5.2 枪技能 cd 加成
      const clip = this.clipMax();
      if (clip && this.ammo <= 0 && this.reloadT <= 0) { this.reloadT = this.reloadDur(); this.q = []; } // v5.2 打空即换弹：排队连射一并作废
      if (this.cd <= 0 && !(clip && this.reloadT > 0)) {
        if (clip) this.ammo--;
        this.cd = effCd;
        const lvl = this.weapon.lvl;
        // 枪口火光（+冲锋枪抛壳）：Q 版反馈 fx
        game.fx.push({ type: 'flash', id: w.id, x: this.x + ux * 20, y: this.y + uy * 20, ang: Math.atan2(uy, ux), r: w.id === 'tear' ? 7 : 10, t: 7, t0: 7 });
        if (w.id === 'tear') game.fx.push({ type: 'casing', x: this.x + ux * 10 - uy * 9, y: this.y + uy * 10 + ux * 9 + 5, ang: Math.atan2(uy, ux) + 2.2, t: 16, t0: 16 });
        if (w.id === 'tear') {
          for (let i = 0; i < this.shotsPerDir + this.gl('te_multi'); i++) this.q.push({ dx: ux, dy: uy, d: i * 7, kind: 'tear' }); // v5.2 te_multi 双弹连射
        } else if (w.id === 'flame') {
          const n = 3 + Math.floor(lvl / 2) + this.gl('f_noz'), base = Math.atan2(uy, ux);
          for (let i = 0; i < n; i++) {
            const a = base + (i - (n - 1) / 2) * .17 + rand(-.04, .04);
            const sp = this.tearSpeed * rand(.8, .98);
            room.tears.push(new Tear(this.x + Math.cos(a) * 14, this.y + Math.sin(a) * 14,
              Math.cos(a) * sp, Math.sin(a) * sp, weaponDmg(this, w), 6.5 + lvl * .8, true,
              { life: 24 + lvl * 3, colorKey: 'flame', burn: this.gl('f_burn') > 0 }));
          }
          SFX.play('flame');
        } else if (w.id === 'laser') {
          this.fireLaser(room, ux, uy, lvl);
        } else if (w.id === 'light') {
          this.fireChain(room, ux, uy, lvl);
        } else if (w.id === 'sickle') { // v5.2 s_two 双镰齐掷
          for (let k = 0, cnt = 1 + this.gl('s_two'); k < cnt; k++) {
            const rot = k === 0 ? 1 : .55, sh = k === 0 ? 1 : .45;
            const bx = ux * rot - uy * sh, by = ux * sh + uy * rot;
            room.tears.push(new Tear(this.x + bx * 14, this.y + by * 14,
              bx * this.tearSpeed * 1.05, by * this.tearSpeed * 1.05, weaponDmg(this, w), 9 + lvl * .5, true,
              { life: 150, bulletKey: 'sickle', boomer: true, spId: 'sickle', pierce: 999 })); // 高穿透：命中不消亡，折返清 hits 后再砍
          }
          SFX.play('shoot');
        } else if (w.id === 'mortar') { // v5.2 m_two 双罐齐投 / m_big 大爆装药
          for (let k = 0, cnt = 1 + this.gl('m_two'); k < cnt; k++) {
            const ox = k === 0 ? 0 : (Math.random() < .5 ? -22 : 22);
            room.tears.push(new Tear(this.x + ux * 12 + ox, this.y + uy * 12,
              ux * 5.4, uy * 5.4, weaponDmg(this, w), 11, true,
              { life: 200, bulletKey: 'grenade', spId: 'mortar', fuseT: 34 + lvl * 2, blast: (60 + lvl * 6) * (1 + .3 * this.gl('m_big')) }));
          }
          SFX.play('shoot');
        } else if (w.melee) {
          this.fireMelee(room, ux, uy, lvl, w);
        } else if (w.id === 'whip') {
          this.fireWhip(room, ux, uy, lvl);
        } else if (w.id === 'chrys') {
          room.tears.push(new Tear(this.x + ux * 14, this.y + uy * 14,
            ux * this.tearSpeed, uy * this.tearSpeed, weaponDmg(this, w), 8, true,
            { life: this.tearLife, bulletKey: 'chrys', spId: 'chrys', pierce: this.pierce,
              deathBurst: { key: 'petal', n: 4 + Math.min(2, lvl - 1) + 2 * this.gl('c_reb'), dmgMul: .35, sp: this.tearSpeed * .75, life: Math.round(26 * (1 + .5 * this.gl('c_blo'))), jit: .15, fx: 'petal', homing: this.gl('c_tra') > 0, burn: this.gl('c_tox') > 0 } }));
          SFX.play('shoot');
        } else if (w.id === 'pin') {
          room.tears.push(new Tear(this.x + ux * 14, this.y + uy * 14,
            ux * this.tearSpeed * 1.1, uy * this.tearSpeed * 1.1, weaponDmg(this, w), 7, true,
            { life: 70, bulletKey: 'pin', spId: 'pin', convert: 'pin', pinR: (26 + (lvl >= 5 ? 6 : 0)) * (1 + .25 * this.gl('p_row')) }));
          SFX.play('shoot');
        } else if (w.id === 'rail') {
          this.fireRail(room, ux, uy, lvl);
        } else if (w.id === 'duck') {
          room.tears.push(new Tear(this.x + ux * 14, this.y + uy * 14,
            ux * this.tearSpeed, uy * this.tearSpeed, weaponDmg(this, w), 7.5, true,
            { life: 110, bulletKey: 'duck', spId: 'duck', bounces: 2 + lvl + this.gl('d_bnc'), pierce: this.pierce, homing: this.homing }));
          SFX.play('shoot');
        } else if (w.id === 'hive') {
          room.tears.push(new Tear(this.x + ux * 14, this.y + uy * 14,
            ux * this.tearSpeed * .9, uy * this.tearSpeed * .9, weaponDmg(this, w), 10, true,
            { life: 60, bulletKey: 'hive', spId: 'hive',
              deathBurst: { key: 'bee', n: 3 + Math.min(2, lvl - 1) + 2 * this.gl('h_queen'), dmgMul: .55, sp: 4.6, life: Math.round(70 * (1 + .5 * this.gl('h_loyal'))), homing: true, fx: 'hivex', burn: this.gl('h_venom') > 0 } }));
          SFX.play('shoot');
        } else if (w.id === 'vortex') {
          room.tears.push(new Tear(this.x + ux * 14, this.y + uy * 14,
            ux * this.tearSpeed, uy * this.tearSpeed, weaponDmg(this, w), 9, true,
            { life: 34, bulletKey: 'core', spId: 'vortex', passthrough: true, convert: 'vortex', vR: (52 + lvl * 4) * (1 + .3 * this.gl('v_col')), vDur: 1 + .6 * this.gl('v_suc'), vBoom: 1 + .5 * this.gl('v_boom') }));
          SFX.play('shoot');
        } else if (w.id === 'twin') {
          for (let i = 0; i < this.shotsPerDir; i++) this.q.push({ dx: ux, dy: uy, d: i * 7, kind: 'tear', wid: 'twin' });
          const ns = 1 + (lvl >= 3 ? 1 : 0) + this.gl('tw_three');
          for (let i = 0; i < ns; i++) this.q.push({ dx: ux, dy: uy, d: randi(6, 8) + i * 7, kind: 'shadow', wid: 'twin', bulletKey: 'shadow', dmgMul: this.gl('tw_bal') ? .7 : .5 });
          game.fx.push({ type: 'clone', x: this.x - ux * 18, y: this.y - uy * 18, ang: Math.atan2(uy, ux), lvl, char: this.char || 0, t: 12, t0: 12 });
        }
      }
    }
    if (this.cd > 0) this.cd--;
    if (this.reloadT > 0 && --this.reloadT <= 0) { // v5.2 换弹完成：压满弹匣 + 灰烟反馈
      this.ammo = this.clipMax();
      game.fx.push({ type: 'puff', x: this.x, y: this.y - 8, r: 8, t: 14, t0: 14, seed: randi(0, 9) });
    }
    for (const s of this.q) {
      if (--s.d <= 0) {
        const j = (s.kind === 'tear' || !s.kind) ? (Math.random() - .5) * .06 : 0;
        const c = Math.cos(j), sn = Math.sin(j);
        const dx = s.dx * c - s.dy * sn, dy = s.dx * sn + s.dy * c;
        room.tears.push(new Tear(
          this.x + dx * 16, this.y + dy * 16,
          dx * this.tearSpeed, dy * this.tearSpeed,
          weaponDmg(this, WEAPONS[s.wid || 'tear']) * (s.dmgMul === undefined ? 1 : s.dmgMul),
          s.r || this.tearR, true,
          { life: s.life || this.tearLife, homing: this.homing, big: this.tearR > 9, pierce: this.pierce,
            bulletKey: s.bulletKey || null, spId: s.wid || 'tear' }
        ));
        if (!s.bulletKey) SFX.play('shoot'); // 影弹静音，听觉上是"一枪+回声"
      }
    }
    this.q = this.q.filter(s => s.d > 0);
  }
}

// ── 敌人配置 ──
const ETYPE = {
  fly:       { id: 'fly',       label: '绿头蝇',   hp: 4,  r: 12, spd: 1.0, dmg: 2, ai: 'wander' },
  attackfly: { id: 'attackfly', label: '吸血蝇',   hp: 4,  r: 11, spd: 1.7, dmg: 2, ai: 'chase' },
  gaper:     { id: 'gaper',     label: '空洞行者', hp: 11, r: 16, spd: 1.2, dmg: 2, ai: 'chase' },
  pooter:    { id: 'pooter',    label: '喷射囊',   hp: 8,  r: 14, spd: .9,  dmg: 2, ai: 'shooter', fire: 105, bs: 2.7 },
  spider:    { id: 'spider',    label: '裂腭蛛',   hp: 5,  r: 13, spd: 1.9, dmg: 2, ai: 'zig' },
  hopper:    { id: 'hopper',    label: '跳脸蛤',   hp: 8,  r: 14, spd: 2.6, dmg: 2, ai: 'hop' },
  splitter:  { id: 'splitter',  label: '脓包分裂怪', hp: 10, r: 15, spd: 1.2, dmg: 2, ai: 'chase', split: 'minifly' },
  minifly:   { id: 'minifly',   label: '小飞虫',   hp: 3,  r: 8,  spd: 2.1, dmg: 2, ai: 'chase' },
  turret:    { id: 'turret',    label: '四向炮台', hp: 12, r: 14, spd: 0,   dmg: 2, ai: 'turret',  fire: 85,  bs: 2.7 },
  spreader:  { id: 'spreader',  label: '散射甲虫', hp: 9,  r: 14, spd: 1.0, dmg: 2, ai: 'spread',  fire: 95,  bs: 2.9 },
  ghost:     { id: 'ghost',     label: '孤魂',     hp: 10, r: 15, spd: .75, dmg: 2, ai: 'ghostx',  fire: 135, bs: 2.3, float: true },
  bat:       { id: 'bat',       label: '血蝠',     hp: 5,  r: 12, spd: 2.2, dmg: 2, ai: 'swoop' },
  mushroom:  { id: 'mushroom',  label: '孢子菇',   hp: 9,  r: 14, spd: 0,   dmg: 2, ai: 'ring',    fire: 150, bs: 2.0 },
  bone:      { id: 'bone',      label: '骨蛇',     hp: 8,  r: 12, spd: 1.1, dmg: 2, ai: 'charge' },
  eye:       { id: 'eye',       label: '浮眼',     hp: 8,  r: 13, spd: .9,  dmg: 2, ai: 'burst',   fire: 130, bs: 2.9 },
  glasp:     { id: 'glasp',     label: '格拉斯波', hp: 34, r: 20, spd: .55, dmg: 3, ai: 'chase' }, // 文档坦克：慢、厚、受击减伤 30%
};
// v5.1.1 文档血线基线（仅 BIO 生效）：行尸 50 / 格拉斯波 200，其余按文档定位等比
const BIO_HPBASE = { fly: 18, attackfly: 26, gaper: 50, pooter: 40, spider: 26, hopper: 34, splitter: 48, minifly: 12, turret: 52, spreader: 44, ghost: 42, bat: 30, mushroom: 40, bone: 38, eye: 36, glasp: 200 };
const ELITE_CHANCE = [0.14, 0.22, 0.30];

class Enemy {
  constructor(typeId, x, y, floorNum, opts = {}) {
    this.cfg = ETYPE[typeId];
    this.x = x; this.y = y;
    this.bite = 0; // v5.1 连咬计数（精英 attackfly 第 2 次接触附加眩晕）
    this.elite = opts.elite !== undefined ? opts.elite
      : Math.random() < ((ELITE_CHANCE[clamp(floorNum - 1, 0, 2)] || 0) + (isGate(game.stage || 1) ? .12 : 0)) && typeId !== 'minifly';
    this.rScale = (this.elite ? 1.35 : 1) * (BIO ? 1.35 : 1); // v5.2 制作人：怪物整体大一号，精英再上探
    this.r = this.cfg.r * this.rScale;
    const es = this.elite ? 2.2 : 1;
    const hpBase = BIO && BIO_HPBASE[this.cfg.id] ? BIO_HPBASE[this.cfg.id] : this.cfg.hp * (1 + .35 * (floorNum - 1)); // v5.1.1 文档血线基线（BIO 不吃层数缓升）
    this.hp = Math.ceil(Math.round(hpBase * es * (game.statM || 1) * 1000) / 1000); // v5.1.1 复核P2：先修浮点毛刺再取整；主线 game.diff 死乘子删除
    this.maxHp = this.hp;
    this.spdMul = (this.elite ? 1.12 : 1) * Math.min(1.6, 1 + ((game.statM || 1) - 1) * .22); // 速度只吃 22% 乘区，防后期弹不出手
    this.dead = false; this.flash = 0;
    this.spawnT = opts.instant ? 0 : 42; // 出生动画期间不移动不伤人
    this.t = randi(0, 100); this.fire = randi(50, this.cfg.fire || 100);
    if (typeId === 'glasp') this.dr = .3;
    this.rushT = 0; this.enraged = false; // v5.1 猎杀者：间歇冲刺 + 低血狂暴
    this.wdx = rand(-1, 1); this.wdy = rand(-1, 1);
    this.state = 'ground'; this.hopT = randi(20, 50); this.hvx = 0; this.hvy = 0; this.stun = 0;
  }
  hit(d, room, tx, ty) {
    if (this.dr) d *= 1 - this.dr; // 受击减伤（格拉斯波 30% / 装甲突变 20%）
    if (this.mut === 'armored') d *= .8;
    if (this.cfg.id === 'bat' && !this.enraged && this.hp - d > 0 && this.hp - d <= this.maxHp * .3) { this.enraged = true; this.spdMul *= 1.4; }
    this.hp -= d; this.flash = 6;
    spawnParticles(room, tx, ty, 4, '#c93030', 2.2);
    if (this.hp <= 0) {
      this.dead = true;
      SFX.play('kill');
      game.fx.push({ type: 'puff', x: this.x, y: this.y, r: this.r, t: 18, t0: 18, seed: randi(0, 9) }); // Q 版死亡烟圈
      spawnParticles(room, this.x, this.y, 9, '#a82020', 3.2);
      addBlood(room, this.x, this.y, this.r + 6);
      game.kills++;
      if (BIO) { // v5.1 紫卡/资源被动触发
        const pl = game.player;
        if (pl.upLv.adrenaline) pl.adrT = 120;
        if (pl.upLv.bloodlust && ++pl.bloodCnt >= pl.bloodNeed) { pl.bloodCnt = 0; pl.heal(20); }
        if (pl.weapon.id === 'reaper' && pl.gl('rp_harv')) pl.heal(4); // v5.2 收割
      }
      if (room.quota && !room.cleared && this.cfg.id !== 'minifly') room.killed++; // 分裂仔喂配额会让"真怪"提前清零，不计
      game.gainXp(Math.ceil(2 + this.maxHp / 30)); // v5.2 门禁P1：经验再收敛（浅房 1-2 级、深房 3-5 级）
      game.runCoins += 2; game.runEarned += 2; if (!BIO) Meta.add(2); // 搜打撤：局内所得活着带走
      if (BIO && Math.random() < .12) room.pickups.push(new Pickup('loot', this.x, this.y, choice(LOOT)));
      if (this.elite) { // 精英必掉 1 资源 + 必掉 1 合成材料；v5.2：心废除，15% 掉药膏
        room.pickups.push(new Pickup(Math.random() < .15 ? 'medkit' : choice(['coin', 'coin', 'coin']), this.x, this.y));
        if (BIO) room.pickups.push(new Pickup('mat', this.x + 14, this.y, CRAFT_MATS.iron));
      }
      if (BIO && this.cfg.id === 'glasp' && !this.elite) room.pickups.push(new Pickup('mat', this.x + 14, this.y, Math.random() < .5 ? CRAFT_MATS.iron : CRAFT_MATS.core)); // 格拉斯波必掉材料
      if (this.cfg.split) for (let i = 0; i < 2; i++)
        room.enemies.push(new Enemy(this.cfg.split, this.x + rand(-14, 14), this.y + rand(-14, 14), game.floorNum));
    } else SFX.play('hit');
  }
  update(room) {
    if (this.flash > 0) this.flash--;
    if (this.burnT > 0 && --this.burnT % 30 === 0 && this.hp > 0) this.hit(this.burnD || 3, room, this.x, this.y); // v5.2 灼烧跳伤
    if (this.pinSlow > 0) this.pinSlow--;
    if (this.stun > 0) { this.stun--; return; } // 麻痹/眩晕：不移动不开火
    if (this.spawnT > 0) { this.spawnT--; return; }
    // 卡墙自救：非漂浮怪若困在实心格里（击退/生成导致），传送到最近空格，防止房间永远清不掉
    if (this.t % 30 === 0 && !this.cfg.float && room.solidTile(Math.floor(this.x / TILE), Math.floor(this.y / TILE))) {
      outer: for (let r2 = 1; r2 < 5; r2++)
        for (let oy = -r2; oy <= r2; oy++) for (let ox = -r2; ox <= r2; ox++) {
          const tx = Math.floor(this.x / TILE) + ox, ty = Math.floor(this.y / TILE) + oy;
          if (tx > 0 && ty > 0 && tx < GRID_W - 1 && ty < GRID_H - 1 && !room.solidTile(tx, ty)) {
            this.x = tx * TILE + 24; this.y = ty * TILE + 24; break outer;
          }
        }
    }
    this.t++;
    const p = game.player;
    const c = this.cfg;
    let spd = c.spd * this.spdMul * (this.pinSlow > 0 ? .8 : 1); // v5.2 铁蒺藜/凝视减速
    if (game.player && game.player.upLv && game.player.upLv.slowfield && dist2(game.player.x, game.player.y, this.x, this.y) < 120) spd *= .6; // 减速力场
    const [dx, dy] = [p.x - this.x, p.y - this.y];
    const dl = Math.max(1, Math.hypot(dx, dy));
    const mv = c.float ? moveFloat : ((e, vx, vy, r) => moveCircle(e, vx, vy, r));
    switch (c.ai) {
      case 'wander':
        if (this.t % 70 === 0) { const a = rand(0, TAU); this.wdx = Math.cos(a); this.wdy = Math.sin(a); }
        if (!this.bump(room, this.wdx * spd, this.wdy * spd, mv))
        { const a = rand(0, TAU); this.wdx = Math.cos(a); this.wdy = Math.sin(a); }
        this.bump(room, 0, Math.sin(this.t * .3) * .5, mv); // 抖动也走碰撞，防止漂进石头里
        break;
      case 'chase':
        this.bump(room, dx / dl * spd, dy / dl * spd, mv);
        break;
      case 'zig': {
        const px = -dy / dl, py = dx / dl, s = Math.sin(this.t * .22);
        this.bump(room, (dx / dl + px * s) * spd, (dy / dl + py * s) * spd, mv);
        break;
      }
      case 'shooter':
        if (dl < 130) this.bump(room, -dx / dl * spd * .6, -dy / dl * spd * .6, mv);
        else this.bump(room, Math.sin(this.t * .04) * spd, Math.cos(this.t * .055) * spd, mv);
        if (--this.fire <= 0) {
          this.fire = c.fire;
          room.tears.push(new Tear(this.x, this.y, dx / dl * c.bs, dy / dl * c.bs, 2, 6, false, { life: 120, bulletKey: "bile", slow: this.mut === 'slowshot' }));
          SFX.play('enemyShoot');
        }
        break;
      case 'hop':
        if (this.state === 'ground') {
          if (--this.hopT <= 0) {
            this.state = 'air';
            const pow = spd * 1.35;
            this.hvx = dx / dl * pow; this.hvy = dy / dl * pow;
            this.hopT = randi(28, 55);
          }
        } else {
          this.bump(room, this.hvx, this.hvy, mv);
          this.hvx *= .93; this.hvy *= .93;
          if (Math.hypot(this.hvx, this.hvy) < .6) this.state = 'ground';
        }
        break;
      case 'turret': // 定身四向炮台，齐射角度逐轮旋转
        if (--this.fire <= 0) {
          this.fire = c.fire;
          const base = (this.t * .05) % (Math.PI / 2);
          const n = this.elite ? 8 : 4;
          for (let i = 0; i < n; i++) {
            const a = base + i * TAU / n;
            room.tears.push(new Tear(this.x, this.y, Math.cos(a) * c.bs, Math.sin(a) * c.bs, 2, 6, false, { life: 130, bulletKey: "shell" }));
          }
          SFX.play('enemyShoot');
        }
        break;
      case 'spread': // 三向（精英五向）散射甲虫
        this.bump(room, Math.sin(this.t * .03) * spd, Math.cos(this.t * .047) * spd, mv);
        if (--this.fire <= 0) {
          this.fire = c.fire;
          const a0 = Math.atan2(dy, dx), n = this.elite ? 5 : 3;
          for (let i = 0; i < n; i++) {
            const a = a0 + (i - (n - 1) / 2) * .24;
            room.tears.push(new Tear(this.x, this.y, Math.cos(a) * c.bs, Math.sin(a) * c.bs, 2, 6, false, { life: 120 }));
          }
          SFX.play('enemyShoot');
        }
        break;
      case 'ghostx': // 飘忽幽灵：穿岩缓进，X 形弹道飞至中途分裂
        this.bump(room, dx / dl * spd + Math.sin(this.t * .06) * .5, dy / dl * spd + Math.cos(this.t * .05) * .5, mv);
        if (--this.fire <= 0) {
          this.fire = c.fire;
          const rot = Math.atan2(dy, dx) - Math.PI / 4;
          room.tears.push(new Tear(this.x, this.y, Math.cos(rot) * c.bs, Math.sin(rot) * c.bs, 2, 6.5, false,
            { life: 150, splitT: 42, rot, eliteSplit: this.elite }));
          room.tears.push(new Tear(this.x, this.y, Math.cos(rot + Math.PI / 2) * c.bs, Math.sin(rot + Math.PI / 2) * c.bs, 2, 6.5, false,
            { life: 150, splitT: 42, rot, eliteSplit: this.elite }));
          room.tears.push(new Tear(this.x, this.y, Math.cos(rot + Math.PI) * c.bs, Math.sin(rot + Math.PI) * c.bs, 2, 6.5, false,
            { life: 150, splitT: 42, rot, eliteSplit: this.elite }));
          room.tears.push(new Tear(this.x, this.y, Math.cos(rot + Math.PI * 1.5) * c.bs, Math.sin(rot + Math.PI * 1.5) * c.bs, 2, 6.5, false,
            { life: 150, splitT: 42, rot, eliteSplit: this.elite }));
          SFX.play('enemyShoot');
        }
        break;
      case 'swoop': { // v5.1 猎杀者：间歇冲刺——盯梢蓄力 40 帧 → 直线突进 18 帧（冲刺接触伤×2，main 判定）
        if (this.state === 'ground') {
          if (--this.hopT <= 0) { this.state = 'air'; this.hvx = dx / dl * spd * 3.2; this.hvy = dy / dl * spd * 3.2; this.rushT = 18; this.hopT = randi(50, 80); }
          else this.bump(room, Math.sin(this.t * .1) * spd * .5, Math.cos(this.t * .13) * spd * .5, mv);
        } else {
          this.bump(room, this.hvx, this.hvy, mv);
          if (--this.rushT <= 0) this.state = 'ground';
        }
        break;
      }
      case 'ring': // 孢子菇：定点八向环射
        if (--this.fire <= 0) {
          this.fire = c.fire;
          for (let i = 0; i < 8; i++) {
            const a = i * TAU / 8 + this.t * .01;
            room.tears.push(new Tear(this.x, this.y, Math.cos(a) * c.bs, Math.sin(a) * c.bs, 2, 6, false, { life: 130, colorKey: 'spore' }));
          }
          SFX.play('enemyShoot');
        }
        break;
      case 'charge': // 骨蛇：蓄力瞄准 → 直线冲锋 → 硬直
        if (this.state === 'ground') {
          if (--this.hopT <= 0) { this.state = 'wind'; this.hopT = 34; }
        } else if (this.state === 'wind') {
          if (--this.hopT <= 0) {
            this.state = 'air';
            this.hvx = dx / dl * 7.2; this.hvy = dy / dl * 7.2; this.hopT = 46;
          }
        } else if (this.state === 'air') {
          this.bump(room, this.hvx, this.hvy, mv);
          if (--this.hopT <= 0 || hitWall(room, this.x, this.y, this.r * .8)) { this.state = 'rest'; this.hopT = 26; }
        } else if (--this.hopT <= 0) { this.state = 'ground'; this.hopT = randi(40, 70); }
        break;
      case 'burst': { // 浮眼：漂移 + 三连发点射
        this.bump(room, Math.sin(this.t * .035) * spd, Math.cos(this.t * .05) * spd, mv);
        this.burst = this.burst || 0; this.burstT = this.burstT || 0;
        if (this.burst > 0) {
          if (--this.burstT <= 0) {
            this.burstT = 11; this.burst--;
            room.tears.push(new Tear(this.x, this.y, dx / dl * c.bs, dy / dl * c.bs, 2, 6, false, { life: 120 }));
            SFX.play('enemyShoot');
          }
        } else if (--this.fire <= 0) { this.fire = c.fire; this.burst = 3; this.burstT = 0; }
        break;
      }
    }
  }
  bump(room, vx, vy, mv) {
    mv = mv || ((e, ax, ay, r) => moveCircle(e, ax, ay, r));
    const before = this.x + this.y;
    mv(this, vx, vy, room);
    return Math.abs(this.x + this.y - before) > Math.abs(vx + vy) * .3;
  }
}

// 幽灵移动：只被墙挡，不被岩石挡
function moveFloat(e, dx, dy, room) {
  const r = e.r * .8;
  if (dx && !hitWallFloat(room, e.x + dx, e.y, r)) e.x += dx;
  if (dy && !hitWallFloat(room, e.x, e.y + dy, r)) e.y += dy;
}
function hitWallFloat(room, x, y, r) {
  for (const [ox, oy] of [[-r, -r], [r, -r], [-r, r], [r, r], [0, -r], [0, r], [-r, 0], [r, 0]]) {
    if (room.wallOnlyTile(Math.floor((x + ox) / TILE), Math.floor((y + oy) / TILE))) return true;
  }
  return false;
}

// ── Boss ──
const BOSSES = [
  { id: 'gluttony',    arch: 'glutton', name: '暴食肉山', hp: 128, r: 56, cycle: ['spit', 'hop', 'summon'], bs: 2.7 },
  { id: 'broodmother', arch: 'brood',   name: '铁颚蛛后', hp: 240, r: 50, cycle: ['radial', 'dash', 'summon2', 'spit'], bs: 2.5 },
  { id: 'the_maw',     arch: 'glutton', name: '巨颚装甲车', hp: 290, r: 58, cycle: ['spit', 'sweep', 'radial', 'hop', 'dash', 'summon'], bs: 3.1 }, // v5.1 杜尔加原型：+触手横扫
];

class Boss {
  constructor(cfg, x, y, floorNum) {
    this.cfg = cfg;
    this.x = x; this.y = y; this.r = cfg.r;
    this.hp = Math.ceil(cfg.hp * (1 + .18 * (floorNum - 1)) * (game.statM || 1));
    if (BIO) this.hp = this.maxHp = Math.ceil(this.hp * (game.statM || 1)); // v5.2 门禁P1：BIO 关底血吃文档房间倍率（房8 ×3）
    this.maxHp = this.hp;
    this.affix = isGate(game.stage || 1) ? choice(['rage', 'barrage', 'summon']) : null; // 门槛关 Boss 词缀
    this.dead = false; this.flash = 0; this.phase2 = false;
    this.act = 'idle'; this.actT = 50; this.cycleI = randi(0, cfg.cycle.length - 1);
    this.vx = 0; this.vy = 0; this.t = 0; this.volley = 0;
  }
  nextAct() {
    this.act = this.cfg.cycle[this.cycleI % this.cfg.cycle.length];
    this.cycleI++;
    const p = game.player;
    const [dx, dy] = [p.x - this.x, p.y - this.y];
    const dl = Math.max(1, Math.hypot(dx, dy));
    const bs = this.cfg.bs * (this.phase2 ? 1.15 : 1);
    switch (this.act) {
      case 'spit': this.actT = 22; this.volley = this.phase2 ? 2 : 1; break;
      case 'hop': // 先亮落点红圈 16 帧再跳，杜绝零预警必中
        this.teleKind = 'hop'; this.act = 'tele'; this.actT = this.affix === 'rage' ? 11 : 16;
        this.hopFrom = { x: this.x, y: this.y };
        this.hopTo = { x: clamp(p.x, TILE * 2, WORLD_W - TILE * 2), y: clamp(p.y, TILE * 2, WORLD_H - TILE * 2) };
        break;
      case 'radial': this.actT = 16; break;
      case 'sweep': this.actT = this.phase2 ? 46 : 62; this.sweepA = rand(0, TAU); this.sweepHit = 0; break; // 触手横扫：旋转扇形危险区
      case 'dash': // 先锁定方向原地蓄力预警，再真正冲锋（玩家有躲避窗口）
        const dv = this.affix === 'rage' ? 10.5 : 8.2; // 狂暴词缀：更快更长的冲锋
        if (Math.abs(dx) > Math.abs(dy)) { this.vx = Math.sign(dx) * dv; this.vy = 0; }
        else { this.vy = Math.sign(dy) * dv; this.vx = 0; }
        this.teleKind = 'dash'; this.act = 'tele'; this.actT = this.affix === 'rage' ? 20 : 30;
        break;
      case 'summon': { this.actT = 30;
        if (game.cur.enemies.length < (this.affix === 'summon' ? 12 : 10)) { // 随从上限，防滚雪球；增援词缀放宽
          const n = (this.phase2 ? 4 : 3) + (this.affix === 'summon' ? 2 : 0);
          for (let i = 0; i < n; i++)
            game.cur.enemies.push(new Enemy('attackfly', this.x + rand(-60, 60), this.y + rand(-60, 60), game.floorNum));
        }
        break; }
      case 'summon2': { this.actT = 30;
        if (game.cur.enemies.length < 10) for (let i = 0; i < 2; i++)
          game.cur.enemies.push(new Enemy('spider', this.x + rand(-60, 60), this.y + rand(-60, 60), game.floorNum));
        break; }
    }
    this.actParam = { dx: dx / dl, dy: dy / dl, bs };
  }
  fireFan(n, spread, baseAng, speed) {
    if (this.affix === 'barrage') n = Math.ceil(n * 1.5); // 弹幕词缀：量提升
    for (let i = 0; i < n; i++) {
      const a = baseAng + (i - (n - 1) / 2) * spread;
      game.cur.tears.push(new Tear(
        this.x + Math.cos(a) * this.r * .6, this.y + Math.sin(a) * this.r * .6,
        Math.cos(a) * speed, Math.sin(a) * speed, 2, 7, false, { life: 150, bulletKey: 'ember' }));
    }
    SFX.play('enemyShoot');
  }
  hit(d) {
    this.hp -= d; this.flash = 5;
    spawnParticles(game.cur, this.x, this.y, 3, '#c93030', 2);
    if (!this.phase2 && this.hp <= this.maxHp * .5) {
      this.phase2 = true; SFX.play('bossRoar'); shake(8);
    }
    if (this.hp <= 0) {
      this.hp = 0; this.dead = true;
      SFX.play('bossRoar'); shake(14);
      for (let i = 0; i < 8; i++)
        spawnParticles(game.cur, this.x + rand(-this.r, this.r), this.y + rand(-this.r, this.r), 6, '#a82020', 3.5);
      addBlood(game.cur, this.x, this.y, this.r);
    } else SFX.play('hit');
  }
  update(room) {
    if (this.flash > 0) this.flash--;
    this.t++;
    if (!this.phase2 && this.hp <= this.maxHp * .5) { this.phase2 = true; SFX.play('bossRoar'); shake(8); }
    const slow = this.phase2 ? .77 : 1; // 文档 P2 攻速 +30% → 行动间隔 ×1/1.3
    if (this.act === 'idle') {
      const p = game.player;
      moveCircle(this, (p.x - this.x) * .004, (p.y - this.y) * .004, room);
      if (--this.actT <= 0) this.nextAct();
      return;
    }
    this.actT -= 1;
    switch (this.act) {
      case 'tele': // 蓄力预警：定身不动，渲染层按 teleKind 画危险带/落点圈
        if (this.t % 5 === 0) spawnParticles(room, this.x + rand(-this.r, this.r) * .5, this.y + rand(-this.r, this.r) * .5, 2, '#ffcf5e', 2);
        if (this.actT <= 0) {
          if (this.teleKind === 'hop') { this.act = 'hop'; this.actT = 20; }
          else { this.act = 'dash'; this.actT = 34; shake(5); }
          SFX.play('bossRoar');
        }
        break;
      case 'spit':
        if (this.actT <= 0) {
          const a = Math.atan2(this.actParam.dy, this.actParam.dx);
          this.fireFan(5, .26, a, this.actParam.bs * (this.phase2 ? 1.2 : 1));
          if (--this.volley > 0) this.actT = 14 * slow; else { this.act = 'idle'; this.actT = 26 * slow; }
        }
        break;
      case 'hop':
        if (this.actT > 0) {
          const f = 1 - this.actT / 20;
          this.x = lerp(this.hopFrom.x, this.hopTo.x, f); this.y = lerp(this.hopFrom.y, this.hopTo.y, f);
        } else {
          shake(7); SFX.play('bossRoar');
          this.fireFan(10, TAU / 10, rand(0, TAU), this.cfg.bs * .85);
          this.act = 'idle'; this.actT = 24 * slow;
        }
        break;
      case 'sweep': { // 旋转触手：扫过玩家所在扇区且距离 <200 时扣心（每次横扫最多 2 段）
        this.sweepA += (this.phase2 ? .11 : .08) * slow;
        const pa = Math.atan2(game.player.y - this.y, game.player.x - this.x);
        let da = pa - this.sweepA; while (da > Math.PI) da -= TAU; while (da < -Math.PI) da += TAU;
        if (Math.abs(da) < .42 && dist2(this.x, this.y, game.player.x, game.player.y) < 200 && this.actT % 24 === 0 && this.sweepHit < 2) {
          this.sweepHit++; game.player.hurt(BIO ? 2 : 1, game, this.x, this.y, this.cfg.name + '·触手横扫');
        }
        if (this.actT <= 0) { this.act = 'idle'; this.actT = 24 * slow; }
        break;
      }
      case 'radial':
        if (this.actT <= 0) {
          this.fireFan(this.phase2 ? 16 : 12, TAU / (this.phase2 ? 16 : 12), this.t * .3, this.actParam.bs * .9);
          this.act = 'idle'; this.actT = 22 * slow;
        }
        break;
      case 'dash':
        moveCircle(this, this.vx, this.vy, room);
        if (this.t % 6 === 0) spawnParticles(room, this.x, this.y, 2, '#5a4466', 2);
        if (this.actT <= 0 || hitWall(room, this.x, this.y, this.r * .8)) {
          this.act = 'idle'; this.actT = 26 * slow; shake(4);
        }
        break;
      default: // summon 类
        if (this.actT <= 0) { this.act = 'idle'; this.actT = 28 * slow; }
    }
  }
}

// ── 掉落物 ──
class Pickup {
  constructor(kind, x, y, item = null, price = 0, wid = null) {
    this.kind = kind; this.x = x; this.y = y; this.item = item; this.price = price; this.wid = wid;
    this.r = kind === 'chest' ? 16 : kind === 'extract' ? 20 : 12;
    this.dead = false; this.taken = false; this.denyCd = 0;
  }
  // 武器拾取：换装或升级
  takeWeapon(p) {
    const wd = WEAPONS[this.wid];
    if (p.weapon.id === this.wid) {
      if (p.weapon.lvl < wd.max) p.weapon.lvl++;
      else p.dmg += .3; // 满级后转化为永久伤害
    } else { p.weapon = { id: this.wid, lvl: 1 }; p.q = []; } // 换枪即收起已排队的旧枪连射（影弹不从新枪里射出）
    p.ammo = p.clipMax(); p.reloadT = 0; // v5.2 弹药：换/升武器即时补满弹匣
    ownWeapon(this.wid, p.weapon.lvl); // 武器库：记录拥有 + 历史最高 Lv
    SFX.play('item'); this.dead = true;
    game.toast = { item: { name: `${wd.name} Lv${p.weapon.lvl}`, desc: wd.desc, color: wd.c }, t: 160 };
    if (!game.taughtWeapon) {
      game.taughtWeapon = true;
      game.hint = { text: '同一把枪再捡→升级；换别的枪→等级清零，捡前先想清楚', t: 300 };
    }
  }
  update(room) {
    const p = game.player;
    const d = dist2(p.x, p.y, this.x, this.y);
    if (this.kind !== 'chest' && this.kind !== 'extract' && this.kind !== 'item' && this.kind !== 'weapon' && this.price <= 0) {
      const mag = p.pickupMag + 6;
      if (d < mag * 2 && d > 1) {
        const pull = this.kind === 'coin' ? 2.6 : 1.6;
        this.x += (p.x - this.x) / d * pull; this.y += (p.y - this.y) / d * pull;
      }
    }
    if (this.denyCd > 0) this.denyCd--;
    // 商店货：先付钱后拾取
    if (this.price > 0) {
      if (d < this.r + p.r * .7) {
        const purse = BIO ? (game.runCoins || 0) : p.coins; // 搜打撤：商店花随身金币，死了不双亏
        if (purse >= this.price) {
          if (BIO) game.runCoins -= this.price; else p.coins -= this.price; this.price = 0;
          SFX.play('coin');
          spawnParticles(room, this.x, this.y, 6, '#e8c85e', 2);
        } else if (this.denyCd <= 0) { SFX.play('deny'); this.denyCd = 45; game.hint = { text: BIO ? `随身金币不足（需 ${this.price} 枚，击杀怪物掉落）` : `金币不足（需 ${this.price} 枚）`, t: 80 }; }
      }
      return;
    }
    // 拾取
    if (d < this.r + p.r * .7) {
      switch (this.kind) {
        case 'medkit': // v5.2 药膏：+40 生命，满血拒收
          if (p.hp >= p.maxHp) return;
          p.heal(40); SFX.play('heal'); this.dead = true;
          game.toast = { item: { name: '使用药膏', desc: '回复 40 生命', color: '#e88a7a' }, t: 110 }; break;
        case 'coin': if (BIO) { game.runCoins++; game.runEarned++; } else p.coins++; SFX.play('coin'); this.dead = true; break;
        case 'skill': // v5.2 藏品室直出技能卡
          game.grantSkill(this.item.u); this.dead = true; break;
        case 'item':
          p.applyItem(this.item); SFX.play('item'); this.dead = true;
          game.toast = { item: this.item, t: 200 };
          if (this.win) game.victory();
          break;
        case 'weapon':
          this.takeWeapon(p);
          if (this.win) game.victory(); // 最终宝箱可能出武器，通关标记不能丢
          break;
        case 'chest':
          openChest(room, this); // 钥匙已退役：碰到即开（冲刺撞开更快）
          break;
        case 'extract':
          game.retreat(); // 撤离：本局结束，金币落袋
          break;
        case 'loot':
          if (addToBag(this.item)) SFX.play('coin'); else SFX.play('item');
          this.dead = true; break;
        case 'mat': {
          const k = this.item.id;
          game.matCarry = game.matCarry || { iron: 0, core: 0 };
          game.matCarry[k]++; SFX.play('coin'); this.dead = true;
          game.toast = { item: { name: `获得材料：${this.item.name}`, desc: '活着撤离后可在工坊合成武器品质', color: this.item.c }, t: 130 }; break;
        }
        case 'save':
          game.saved = (game.saved || 0) + 1; SFX.play('item'); this.dead = true;
          game.toast = { item: { name: '救出一名幸存者', desc: `一起撤出去（结算 +100 金币/人）`, color: '#7fae5a' }, t: 150 }; break;
      }
    }
  }
}

// 宝箱开启（接触或冲刺撞开，无钥匙门槛）
function openChest(room, c) {
  const p = game.player;
  SFX.play('doorOpen'); c.dead = true;
  spawnParticles(room, c.x, c.y, 14, '#e8c85e', 3);
  if (BIO && c.bioInit) { // v5.2 细则5：房间宝箱随机开出 1 个当前枪的技能（直接入账）
    const u = game.rollSkill();
    if (u) game.grantSkill(u);
    else for (let i = 0; i < 3; i++) room.pickups.push(new Pickup('coin', c.x + rand(-20, 20), c.y + rand(-10, 10)));
    room.pickups.push(new Pickup('coin', c.x - 26, c.y + 8));
    return;
  }
  const def = randomItem(p);
  const wid = Math.random() < .35 ? pickWeaponId(p) : null;
  if (wid || def) {
    const it = wid ? new Pickup('weapon', c.x, c.y - 6, null, 0, wid)
      : new Pickup('item', c.x, c.y - 6, def);
    if (room.finalChest) it.win = true;
    room.pickups.push(it);
  } else {
    for (let i = 0; i < 3; i++) room.pickups.push(new Pickup('coin', c.x + rand(-20, 20), c.y + rand(-10, 10)));
    if (room.finalChest) game.victory(); // 道具池耗尽的最终层宝箱直接判通关
  }
  room.pickups.push(new Pickup('coin', c.x - 26, c.y + 8));
  room.pickups.push(new Pickup(choice(['medkit', 'coin']), c.x + 26, c.y + 8)); // v5.2：宝箱副产物心→药膏
  if (BIO) for (let i = 0; i < randi(1, 2); i++) room.pickups.push(new Pickup('loot', c.x + rand(-30, 30), c.y + rand(-16, 16), choice(LOOT))); // 搜打撤：宝箱是物资主来源
}

// ── 武器系统：14 把枪，抽卡解锁入武器库，局内拾取换装/升级（重复拾取 +1 级，最高 5 级）──
const WEAPONS = {
  tear:  { id: 'tear',  name: '制式冲锋枪', c: '#9cc4ee', glyph: '枪', cd: 10, mult: 1,   max: 5, rar: null, rdmg: 18, clip: 3, rl: 60, desc: '3 发一装填，新兵蛋子才用' },
  laser: { id: 'laser', name: '激光枪', c: '#ff5f5f', glyph: '激', cd: 30, mult: 2.8, max: 5, rar: 'SR', rdmg: 40, clip: 4, rl: 84, desc: '贯穿一切的光束' },
  light: { id: 'light', name: '闪电枪', c: '#ffe066', glyph: '雷', cd: 22, mult: 1.8, max: 5, rar: 'SR', rdmg: 26, clip: 5, rl: 78, desc: '在敌人间跳跃的电弧' },
  flame: { id: 'flame', name: '火焰枪', c: '#ff9040', glyph: '焰', cd: 11, mult: .5,  max: 5, rar: 'R', rdmg: 4,  clip: 6, rl: 60, desc: '近距扇形烈焰，以量取胜' },
  sickle: { id: 'sickle', name: '骨镰回旋镖', c: '#cbb98a', glyph: '镰', cd: 26, mult: 1.35, max: 5, rar: 'SR', rdmg: 28, clip: 3, rl: 72, desc: '掷出折返，去回两段都能砍人' },
  mortar: { id: 'mortar', name: '罐罐雷', c: '#a8c05a', glyph: '罐', cd: 40, mult: 2.6, max: 5, rar: 'SSR', rdmg: 50, clip: 2, rl: 120, desc: '抛物罐雷落地爆炸，焦土留痕' },
  whip:   { id: 'whip',   name: '荆棘鞭',   c: '#b04a6a', glyph: '鞭', cd: 24, mult: 1.9, max: 5, rar: 'SR', rdmg: 24, clip: 4, rl: 60, desc: '近身扇形鞭击，一发横扫一片' },
  chrys:  { id: 'chrys',  name: '千瓣菊',   c: '#f2c4d4', glyph: '菊', cd: 18, mult: 1.15,  max: 5, rar: 'R', rdmg: 10,  clip: 4, rl: 60, desc: '主弹碎裂成花瓣飞散' },
  pin:    { id: 'pin',    name: '刺猬钉',   c: '#9b8fd0', glyph: '钉', cd: 30, mult: 1.1, max: 5, rar: 'SR', rdmg: 22, clip: 3, rl: 90, desc: '钉落地成刺，扎穿踩上来的敌人' },
  rail:   { id: 'rail',   name: '穿云枪',   c: '#7fe0d8', glyph: '云', cd: 48, mult: 4.5, max: 5, rar: 'SSR', rdmg: 90, clip: 2, rl: 100, desc: '蓄满即发，一线贯穿全屋' },
  duck:   { id: 'duck',   name: '橡皮鸭',   c: '#f2cf3a', glyph: '鸭', cd: 9,  mult: .55, max: 5, rar: 'R', rdmg: 8,  clip: 5, rl: 42, desc: '嘎？会弹墙的橡皮鸭' },
  hive:   { id: 'hive',   name: '工蜂箱',   c: '#e0a83c', glyph: '蜂', cd: 34, mult: 1.3, max: 5, rar: 'SR', rdmg: 16, clip: 4, rl: 96, desc: '蜂巢炸裂，放蜂追猎' },
  vortex: { id: 'vortex', name: '漩涡核',   c: '#8f6fd8', glyph: '旋', cd: 60, mult: 2,   max: 5, rar: 'SSR', rdmg: 48, clip: 2, rl: 108, desc: '漩涡吸聚敌人，塌缩引爆' },
  twin:   { id: 'twin',   name: '双影铳',   c: '#c8c0e8', glyph: '影', cd: 16, mult: .8,  max: 5, rar: 'R', rdmg: 10, clip: 5, rl: 72, desc: '实体弹后跟着影弹，双倍节拍' },
  // v5.1 近战双大类（文档 3.2）：melee 武器走扇形挥击判定，不走弹体
  knife:  { id: 'knife',  name: '开山刀',   c: '#d8d2c4', glyph: '刀', cd: 30, mult: 2.2, max: 5, rar: 'R',   melee: true, arc: 2.2, reach: 90, mdmg: 15, desc: '近距扇形劈砍，刀刀到肉' },
  club:   { id: 'club',   name: '钢筋棒',   c: '#a8937c', glyph: '棒', cd: 50, mult: 3.0, max: 5, rar: 'SR',  melee: true, arc: 2.6, reach: 90, mdmg: 22, desc: '大开大合，挥中即击退' },
  claw:   { id: 'claw',   name: '电弧爪',   c: '#7fe0d8', glyph: '爪', cd: 36, mult: 1.6, max: 5, rar: 'SR', melee: true, arc: 1.8, reach: 90, mdmg: 17, desc: '高速连抓，附带麻痹' },
  reaper: { id: 'reaper', name: '骨镰王',   c: '#cbb98a', glyph: '镰', cd: 45, mult: 2.6, max: 5, rar: 'SSR', melee: true, arc: 3.1, reach: 90, mdmg: 32, desc: '环形死亡横扫，一寸不留' },
};
// ── v5.2 枪技能矩阵：每枪 4 张专属卡（制作人拍板首版）；add=聚合加成键(clip/rl/rng/dmg/cd)，无 add 的走发射分支 gl(id) 特判 ──
const GUN_SKILLS = [
  // 制式冲锋枪（白）
  { id: 'te_clip', gun: 'tear', name: '加长弹匣', desc: '弹匣 +2 发', max: 2, cat: 'res', rar: 'R', glyph: '匣', add: { clip: 2 } },
  { id: 'te_rng', gun: 'tear', name: '稳定弹道', desc: '射程 +25%', max: 2, cat: 'atk', rar: 'R', glyph: '稳', add: { rng: .25 } },
  { id: 'te_rl', gun: 'tear', name: '快速装填', desc: '换弹时间 -30%', max: 2, cat: 'res', rar: 'R', glyph: '填', add: { rl: .3 } },
  { id: 'te_multi', gun: 'tear', name: '双弹连射', desc: '每次射击 +1 发弹', max: 1, cat: 'atk', rar: 'SSR', glyph: '双' },
  // 激光枪（蓝）
  { id: 'l_wide', gun: 'laser', name: '充能光束', desc: '光束宽度 +40%', max: 1, cat: 'atk', rar: 'R', glyph: '粗' },
  { id: 'l_cut', gun: 'laser', name: '高热切割', desc: '对 >50% 血敌人 +25% 伤害', max: 1, cat: 'atk', rar: 'SR', glyph: '切' },
  { id: 'l_batt', gun: 'laser', name: '节能电池', desc: '换弹 -25%', max: 2, cat: 'res', rar: 'SR', glyph: '电', add: { rl: .25 } },
  { id: 'l_core', gun: 'laser', name: '聚焦棱镜', desc: '伤害 +20%', max: 2, cat: 'atk', rar: 'SSR', glyph: '棱', add: { dmg: .2 } },
  // 闪电枪（蓝）
  { id: 'j_jump', gun: 'light', name: '超载跳', desc: '链跳目标 +1', max: 2, cat: 'atk', rar: 'R', glyph: '跳' },
  { id: 'j_par', gun: 'light', name: '感电', desc: '命中 15% 麻痹 0.5 秒', max: 1, cat: 'ctrl', rar: 'SR', glyph: '麻' },
  { id: 'j_wide', gun: 'light', name: '弧光延展', desc: '射程 +15%', max: 2, cat: 'atk', rar: 'R', glyph: '弧', add: { rng: .15 } },
  { id: 'j_amp', gun: 'light', name: '连锁增幅', desc: '链跳伤害衰减 85%→60%', max: 1, cat: 'atk', rar: 'SSR', glyph: '链' },
  // 火焰枪（绿）
  { id: 'f_noz', gun: 'flame', name: '燃料喷嘴', desc: '火舌粒子 +2', max: 1, cat: 'atk', rar: 'R', glyph: '喷' },
  { id: 'f_burn', gun: 'flame', name: '灼烧地带', desc: '命中引燃：持续掉血 3 秒', max: 1, cat: 'atk', rar: 'SR', glyph: '燃' },
  { id: 'f_arc', gun: 'flame', name: '加宽扇面', desc: '射程 +20%', max: 2, cat: 'atk', rar: 'R', glyph: '扇', add: { rng: .2 } },
  { id: 'f_comp', gun: 'flame', name: '压缩气罐', desc: '弹匣 +3', max: 1, cat: 'res', rar: 'SSR', glyph: '罐', add: { clip: 3 } },
  // 骨镰回旋镖（蓝）
  { id: 's_two', gun: 'sickle', name: '双镰齐掷', desc: '同时掷出 2 把骨镰', max: 1, cat: 'atk', rar: 'SSR', glyph: '双' },
  { id: 's_bal', gun: 'sickle', name: '配重镰柄', desc: '伤害 +20%', max: 2, cat: 'atk', rar: 'R', glyph: '衡', add: { dmg: .2 } },
  { id: 's_fast', gun: 'sickle', name: '回旋加速', desc: '出手间隔 -20%', max: 2, cat: 'res', rar: 'R', glyph: '旋', add: { cd: .2 } },
  { id: 's_sharp', gun: 'sickle', name: '开刃磨镰', desc: '飞行距离 +25%', max: 2, cat: 'atk', rar: 'R', glyph: '锐', add: { rng: .25 } },
  // 罐罐雷（紫）
  { id: 'm_two', gun: 'mortar', name: '双罐齐投', desc: '一次投掷 2 罐', max: 1, cat: 'atk', rar: 'SSR', glyph: '双' },
  { id: 'm_big', gun: 'mortar', name: '大爆装药', desc: '爆炸半径 +30%', max: 1, cat: 'atk', rar: 'SR', glyph: '爆' },
  { id: 'm_ash', gun: 'mortar', name: '重罐药', desc: '伤害 +15%', max: 2, cat: 'atk', rar: 'R', glyph: '药', add: { dmg: .15 } },
  { id: 'm_quick', gun: 'mortar', name: '快速布雷', desc: '换弹 -30%', max: 2, cat: 'res', rar: 'R', glyph: '布', add: { rl: .3 } },
  // 荆棘鞭（蓝）
  { id: 'w_two', gun: 'whip', name: '二连鞭击', desc: '一次挥出两道鞭影', max: 1, cat: 'atk', rar: 'SR', glyph: '连' },
  { id: 'w_leech', gun: 'whip', name: '吸血藤', desc: '每次挥击命中回复 2 生命(上限6)', max: 1, cat: 'surv', rar: 'SSR', glyph: '吸' },
  { id: 'w_len', gun: 'whip', name: '加长鞭梢', desc: '鞭长 +35%', max: 2, cat: 'atk', rar: 'R', glyph: '长', add: { rng: .35 } },
  { id: 'w_tan', gun: 'whip', name: '缠缚倒刺', desc: '命中 12% 定身 0.6 秒', max: 1, cat: 'ctrl', rar: 'SR', glyph: '缚' },
  // 千瓣菊（绿）
  { id: 'c_reb', gun: 'chrys', name: '重绽', desc: '碎裂花瓣 +2', max: 1, cat: 'atk', rar: 'R', glyph: '绽' },
  { id: 'c_tra', gun: 'chrys', name: '寻香花瓣', desc: '花瓣带轻微追踪', max: 1, cat: 'atk', rar: 'SR', glyph: '寻' },
  { id: 'c_blo', gun: 'chrys', name: '花期延长', desc: '花瓣存在 +50% 伤害 +10%', max: 1, cat: 'atk', rar: 'R', glyph: '期', add: { dmg: .1 } },
  { id: 'c_tox', gun: 'chrys', name: '花毒', desc: '花瓣命中引燃（持续掉血）', max: 1, cat: 'atk', rar: 'SSR', glyph: '毒' },
  // 刺猬钉（蓝）
  { id: 'p_row', gun: 'pin', name: '钉阵加长', desc: '钉刺半径 +25%', max: 1, cat: 'ctrl', rar: 'SR', glyph: '阵' },
  { id: 'p_mort', gun: 'pin', name: '见血封喉', desc: '钉刺伤害 +40%', max: 1, cat: 'atk', rar: 'SR', glyph: '喉' },
  { id: 'p_burst', gun: 'pin', name: '弹射变钉', desc: '射程 +15%', max: 2, cat: 'atk', rar: 'R', glyph: '射', add: { rng: .15 } },
  { id: 'p_bar', gun: 'pin', name: '铁蒺藜', desc: '踩钉敌人减速 1 秒', max: 1, cat: 'ctrl', rar: 'R', glyph: '蒺' },
  // 穿云枪（紫）
  { id: 'r_over', gun: 'rail', name: '超载电容', desc: '伤害 +35%', max: 1, cat: 'atk', rar: 'SSR', glyph: '载', add: { dmg: .35 } },
  { id: 'r_dual', gun: 'rail', name: '双联弹仓', desc: '弹匣 +1', max: 1, cat: 'res', rar: 'SR', glyph: '联', add: { clip: 1 } },
  { id: 'r_pier', gun: 'rail', name: '穿甲弹芯', desc: '无视敌人 50% 伤害减免', max: 1, cat: 'atk', rar: 'SSR', glyph: '穿' },
  { id: 'r_chrg', gun: 'rail', name: '速充线圈', desc: '换弹 -25%', max: 2, cat: 'res', rar: 'R', glyph: '充', add: { rl: .25 } },
  // 橡皮鸭（绿）
  { id: 'd_bnc', gun: 'duck', name: '加鸭', desc: '弹跳次数 +1', max: 2, cat: 'atk', rar: 'R', glyph: '弹' },
  { id: 'd_quack', gun: 'duck', name: '嘎战吼', desc: '伤害 +15%', max: 2, cat: 'atk', rar: 'R', glyph: '嘎', add: { dmg: .15 } },
  { id: 'd_hard', gun: 'duck', name: '硬塑鸭壳', desc: '射程 +20%', max: 1, cat: 'atk', rar: 'SR', glyph: '塑', add: { rng: .2 } },
  { id: 'd_flock', gun: 'duck', name: '群鸭冲锋', desc: '出手间隔 -15%', max: 2, cat: 'res', rar: 'SSR', glyph: '群', add: { cd: .15 } },
  // 工蜂箱（蓝）
  { id: 'h_queen', gun: 'hive', name: '蜂后之怒', desc: '放蜂 +2 只', max: 1, cat: 'atk', rar: 'SR', glyph: '后' },
  { id: 'h_venom', gun: 'hive', name: '毒针', desc: '蜂叮引燃（持续掉血）', max: 1, cat: 'atk', rar: 'SSR', glyph: '针' },
  { id: 'h_loyal', gun: 'hive', name: '忠蜂', desc: '蜜蜂存在时间 +50%', max: 1, cat: 'atk', rar: 'R', glyph: '忠' },
  { id: 'h_breed', gun: 'hive', name: '速繁', desc: '出箱间隔 -20%', max: 2, cat: 'res', rar: 'R', glyph: '繁', add: { cd: .2 } },
  // 漩涡核（紫）
  { id: 'v_col', gun: 'vortex', name: '大坍缩', desc: '漩涡半径 +30%', max: 1, cat: 'ctrl', rar: 'SSR', glyph: '坍' },
  { id: 'v_suc', gun: 'vortex', name: '贪食黑洞', desc: '吸聚持续时间 +1 秒', max: 1, cat: 'ctrl', rar: 'SR', glyph: '吞' },
  { id: 'v_boom', gun: 'vortex', name: '末爆强化', desc: '塌缩爆炸伤害 ×1.5', max: 1, cat: 'atk', rar: 'SR', glyph: '崩' },
  { id: 'v_flow', gun: 'vortex', name: '双流', desc: '弹匣 +1', max: 1, cat: 'res', rar: 'R', glyph: '流', add: { clip: 1 } },
  // 双影铳（绿）
  { id: 'tw_three', gun: 'twin', name: '三连影弹', desc: '影弹数 +1', max: 1, cat: 'atk', rar: 'SSR', glyph: '三' },
  { id: 'tw_bal', gun: 'twin', name: '均衡射击', desc: '影弹伤害 0.5→0.7', max: 1, cat: 'atk', rar: 'SR', glyph: '衡' },
  { id: 'tw_feed', gun: 'twin', name: '火力延续', desc: '换弹 -20%', max: 2, cat: 'res', rar: 'R', glyph: '续', add: { rl: .2 } },
  { id: 'tw_press', gun: 'twin', name: '分身压制', desc: '伤害 +12%', max: 2, cat: 'atk', rar: 'R', glyph: '压', add: { dmg: .12 } },
  // 近战：开山刀（绿）
  { id: 'kn_arc', gun: 'knife', name: '顺劈横扫', desc: '挥击弧度 +0.6', max: 1, cat: 'atk', rar: 'R', glyph: '扫' },
  { id: 'kn_slow', gun: 'knife', name: '欺软怕硬', desc: '伤害 +20%', max: 2, cat: 'atk', rar: 'R', glyph: '欺', add: { dmg: .2 } },
  { id: 'kn_hand', gun: 'knife', name: '快手刀客', desc: '出手间隔 -15%', max: 2, cat: 'res', rar: 'R', glyph: '快', add: { cd: .15 } },
  { id: 'kn_cut', gun: 'knife', name: '利落收刀', desc: '射程 +15%', max: 1, cat: 'atk', rar: 'SR', glyph: '利', add: { rng: .15 } },
  // 近战：钢筋棒（蓝）
  { id: 'cl_knock', gun: 'club', name: '抡圆了砸', desc: '击退距离 +50%', max: 1, cat: 'ctrl', rar: 'SSR', glyph: '抡' },
  { id: 'cl_quake', gun: 'club', name: '震地', desc: '命中 20% 眩晕 0.5 秒', max: 1, cat: 'ctrl', rar: 'SR', glyph: '震' },
  { id: 'cl_brk', gun: 'club', name: '破甲重击', desc: '无视敌人 50% 伤害减免', max: 1, cat: 'atk', rar: 'SR', glyph: '破' },
  { id: 'cl_arm', gun: 'club', name: '铁腕', desc: '出手间隔 -12%', max: 2, cat: 'res', rar: 'R', glyph: '腕', add: { cd: .12 } },
  // 近战：电弧爪（蓝）
  { id: 'cw_par', gun: 'claw', name: '加强电流', desc: '麻痹概率 30%→40%', max: 1, cat: 'ctrl', rar: 'SR', glyph: '强' },
  { id: 'cw_six', gun: 'claw', name: '六连抓', desc: '每次挥击追加第二段(×0.6)', max: 1, cat: 'atk', rar: 'SSR', glyph: '六' },
  { id: 'cw_zap', gun: 'claw', name: '静电场', desc: '伤害 +15%', max: 2, cat: 'atk', rar: 'R', glyph: '电', add: { dmg: .15 } },
  { id: 'cw_gale', gun: 'claw', name: '疾风爪', desc: '出手间隔 -12%', max: 2, cat: 'res', rar: 'R', glyph: '疾', add: { cd: .12 } },
  // 近战：骨镰王（紫）
  { id: 'rp_ring', gun: 'reaper', name: '灭世环', desc: '挥击弧度接近全圆', max: 1, cat: 'atk', rar: 'SSR', glyph: '环' },
  { id: 'rp_harv', gun: 'reaper', name: '收割', desc: '击杀回复 4 生命', max: 1, cat: 'surv', rar: 'SR', glyph: '收' },
  { id: 'rp_gaze', gun: 'reaper', name: '死亡凝视', desc: '横扫范围内敌人减速', max: 1, cat: 'ctrl', rar: 'R', glyph: '凝' },
  { id: 'rp_hev', gun: 'reaper', name: '巨刃', desc: '横扫半径 +30%', max: 2, cat: 'atk', rar: 'R', glyph: '巨', add: { rng: .3 } },
];
for (const u of GUN_SKILLS) { u.c = WEAPONS[u.gun].c; if (!u.add) u.apply = () => {}; }
UPGRADES.push(...GUN_SKILLS);

function weaponDmg(p, w) {
  let d = p.dmg * w.mult * (1 + .35 * (p.weapon.lvl - 1));
  const lvMul = 1 + .35 * (p.weapon.lvl - 1);
  if (BIO && w.melee) d = Math.max(d, (w.mdmg || 0) * lvMul); // 文档近战伤害区间 15-40 保底（随 Lv 成长）
  if (BIO && !w.melee && w.rdmg) d = Math.max(d, w.rdmg * lvMul); // v5.2 远程伤害地板：血条数值尺度下保证杀得动
  if (p.gunMods) d *= 1 + p.gunMods().dmg; // v5.2 枪技能卡伤害聚合
  const q = ((Meta.load().wq || {})[w.id] || 0); // 品质：每档 +15% 基础伤
  d *= 1 + .15 * q;
  if (q >= 1 && Math.random() < .25) d *= 1.8; // 精良词条：暴击 +25% 概率 ×1.8
  return d;
}

// ── 武器库（账号拥有制）：捡到过的枪记录历史最高 Lv，随云存档 weapons 字段同步 ──
function weaponOwned(id) { const d = Meta.load(); return !!(d.weapons && d.weapons[id]); }
function ownWeapon(id, lvl) {
  const d = Meta.load();
  d.weapons = d.weapons || {};
  d.weapons.tear = Math.max(1, d.weapons.tear || 0); // 制式枪永远拥有
  d.weapons[id] = Math.max(d.weapons[id] || 0, lvl || 1);
  Meta.save();
}
// 抽卡池：SSR 6% / SR 28% / R 66%（ten-pull 保底 ≥1 SR）
const GACHA_POOL = { SSR: ['rail', 'vortex', 'mortar', 'reaper'], SR: ['sickle', 'whip', 'hive', 'pin', 'laser', 'light', 'club', 'claw'], R: ['chrys', 'duck', 'twin', 'flame', 'knife'] };
function rollGachaId() {
  const r = Math.random();
  return choice(GACHA_POOL[r < .06 ? 'SSR' : r < .34 ? 'SR' : 'R']);
}
// v5.1 武器合成（文档 3.2/7.2）：材料+金币升品质，品质=词条数
const WQ_NAMES = ['普通', '精良', '稀有', '传说'];
const WQ_C = ['#b0a08a', '#8ecbff', '#b093e8', '#e8c85e'];
function craftCost(wid) {
  const q = (Meta.load().wq || {})[wid] || 0;
  return { iron: 2 + 2 * q, core: q, coins: 200 * (q + 1), next: q + 1 };
}
function craftWeapon(wid) {
  const m = Meta.load();
  if (!weaponOwned(wid)) return 'no';
  const q = (m.wq || {})[wid] || 0;
  if (q >= 3) return 'max';
  const c = craftCost(wid);
  if ((m.mats.iron || 0) < c.iron || (m.mats.core || 0) < c.core || m.coins < c.coins) return 'poor';
  m.mats.iron -= c.iron; m.mats.core -= c.core; m.coins -= c.coins;
  m.wq = m.wq || {}; m.wq[wid] = q + 1; Meta.save();
  if (window.CloudSave) CloudSave.queue();
  return 'ok';
}
function gachaPull(n) {
  const d = Meta.load();
  const base = n === 10 ? 1200 : 150 * n;
  const tickets = Math.min(d.gachaTickets || 0, n);
  const cost = Math.max(0, base - tickets * 150);
  if (d.coins < cost) return null;
  d.coins -= cost;
  d.gachaTickets = (d.gachaTickets || 0) - tickets;
  const ids = [];
  for (let i = 0; i < n; i++) ids.push(rollGachaId());
  if (n === 10 && !ids.some(id => WEAPONS[id].rar === 'SR' || WEAPONS[id].rar === 'SSR')) ids[n - 1] = choice(GACHA_POOL.SR);
  let refund = 0;
  const results = ids.map(id => {
    const dup = weaponOwned(id);
    if (dup) refund += 80; else ownWeapon(id, 1);
    return { id, rar: WEAPONS[id].rar, dup };
  });
  if (refund) d.coins += refund;
  Meta.save();
  if (window.CloudSave) CloudSave.queue();
  SFX.play(tickets > 0 ? 'item' : 'coin');
  return { cost, tickets, refund, results };
}

// ── 被动道具池 ──
const ITEMS = [
  { id: 'eye3',    name: '第三只眼', desc: '朝同一方向连射三发', color: '#8ecbff',
    apply(p) { p.shotsPerDir = Math.max(p.shotsPerDir, 3); } },
  { id: 'big',     name: '巨泪', desc: '子弹变大 伤害+2', color: '#7fb2e8',
    apply(p) { p.tearR += 4.5; p.dmg += 2; } },
  { id: 'speed',   name: '疾行靴', desc: '移动速度提升', color: '#d9a92e',
    apply(p) { p.speed += .75; } },
  { id: 'yarn',    name: '线球', desc: '射击间隔缩短', color: '#c96f9a',
    apply(p) { p.fireDelay = Math.max(6, p.fireDelay - 4); } },
  { id: 'blood',   name: '血之契约', desc: '伤害+3', color: '#c4303a',
    apply(p) { p.dmg += 3; } },
  { id: 'homing',  name: '追魂核', desc: '子弹追踪敌人', color: '#7f7fe8',
    apply(p) { p.homing = true; } },
  { id: 'wings',   name: '褪色翅', desc: '移速+ 射程+', color: '#b8d8c9',
    apply(p) { p.speed += .45; p.tearLife += 24; } },
  { id: 'lucky',   name: '磨损念珠', desc: '生命上限+20 并回满', color: '#7fae5a',
    apply(p) { p.maxHp += 20; p.hp = p.maxHp; } },
  { id: 'polaris', name: '苍白之星', desc: '拾取范围大增 回复40生命', color: '#e8e0c9',
    apply(p) { p.pickupMag += 55; p.heal(40); } },
  { id: 'awl',     name: '腐烂锥', desc: '子弹可穿透1个敌人', color: '#b8c4cc',
    apply(p) { p.pierce += 1; } },
  { id: 'fang',    name: '蛀牙', desc: '伤害+2.2 移速略降', color: '#d9d0c0',
    apply(p) { p.dmg += 2.2; p.speed = Math.max(2.4, p.speed - .25); } },
  { id: 'spring',  name: '发条弹簧', desc: '弹速+ 射速微增', color: '#9ec4a8',
    apply(p) { p.tearSpeed += 1.4; p.fireDelay = Math.max(6, p.fireDelay - 1); } },
  { id: 'piggy',   name: '小猪钱罐', desc: '立刻获得5枚金币', color: '#d99aa8',
    apply(p) { if (BIO) { game.runCoins += 5; game.runEarned += 5; } else p.coins += 5; } },
  { id: 'halo',    name: '糖制光环', desc: '生命上限+20 回复20 移速微增', color: '#f0e2b8',
    apply(p) { p.maxHp += 20; p.heal(20); p.speed += .15; } },
];
// v5.0 搜打撤物资：4 类战利品，背包 8 格，撤离时折算入账
const LOOT = [
  { id: 'med',    name: '医疗用品', glyph: '药', c: '#7fae5a', val: 15 },
  { id: 'mat',    name: '合金材料', glyph: '材', c: '#8a9ab0', val: 10 },
  { id: 'barrel', name: '备用枪管', glyph: '铳', c: '#a8937c', val: 25 },
  { id: 'gem',    name: '紫色结晶', glyph: '结', c: '#b093e8', val: 40 },
];
// v5.1 合成材料：随身拾取，成功撤离才入局外库（死亡同样丢失）
const CRAFT_MATS = { iron: { id: 'iron', name: '废铁', glyph: '铁', c: '#8a9ab0' }, core: { id: 'core', name: '生化芯', glyph: '芯', c: '#b093e8' } };
function addToBag(it) {
  const bag = game.bag || (game.bag = []);
  const e = bag.find(b => b.id === it.id);
  if (e) { e.n++; return true; }
  if (bag.length < 8) { bag.push(Object.assign({ n: 1 }, it)); return true; }
  game.runCoins += it.val; game.runEarned += it.val; // 背包满：自动变卖
  game.hint = { text: '背包已满，物资就地变卖折金币', t: 120 };
  return false;
}
function randomItem(p) {
  const pool = ITEMS.filter(i => !p.items.some(x => x.id === i.id));
  return pool.length ? choice(pool) : null; // 池耗尽返回 null，由生成点折算金币
}
// 掉武器偏好：只在「已拥有 ∧ 未满级」的枪里随机；无可选→null（调用方降级为道具）
function pickWeaponId(p) {
  const ids = Object.keys(WEAPONS).filter(weaponOwned);
  const fresh = ids.filter(id => id !== p.weapon.id || p.weapon.lvl < WEAPONS[id].max);
  return fresh.length ? choice(fresh) : null;
}
// 初始宝箱兜底：满级也要能"开出拥有的武器"（细则1 字面语义）
function bioAnyOwnedWeapon() {
  const ids = Object.keys(WEAPONS).filter(weaponOwned);
  return ids.length ? choice(ids) : null;
}
// 奖励生成：35% 概率是武器（需有可掉枪），否则被动道具（池尽折金币由调用方兜底）
function makeRewardPickup(x, y, p, winFlag) {
  const wid = Math.random() < .35 ? pickWeaponId(p) : null;
  if (wid) return new Pickup('weapon', x, y, null, 0, wid);
  return new Pickup('item', x, y, randomItem(p));
}
Player.prototype.applyItem = function (item) {
  this.items.push(item); item.apply(this);
};

// ── 粒子 / 血渍 ──
function spawnParticles(room, x, y, n, color, spd) {
  for (let i = 0; i < n; i++) {
    const a = rand(0, TAU), s = rand(.5, spd);
    game.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - .5, life: randi(14, 30), c: color, r: rand(1.5, 3.5) });
  }
  if (game.particles.length > 300) game.particles.splice(0, game.particles.length - 300);
}
function addBlood(room, x, y, r) {
  room.blood.push({ x, y, r, a: rand(0, TAU), c: '140,25,25', al: rand(.18, .34) });
  if (room.blood.length > 45) room.blood.shift();
}

// 可破坏杂物（受冲刺/子弹摧毁）
function damageProp(room, o, d) {
  o.hp -= d;
  spawnParticles(room, o.x, o.y, 3, '#8a6b3f', 2);
  if (o.hp <= 0) {
    o.dead = true;
    spawnParticles(room, o.x, o.y, 8, '#8a6b3f', 2.6);
    if (Math.random() < .3) room.pickups.push(new Pickup('coin', o.x, o.y)); // v5.2：杂物破坏只掉金币
  }
}
