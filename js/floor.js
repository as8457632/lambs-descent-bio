'use strict';
// ─────────────────────────────────────────────
// 楼层生成 + 房间：随机布局、死路放Boss房、宝箱房、内容物
// ─────────────────────────────────────────────

class Room {
  constructor(gx, gy, type) {
    this.gx = gx; this.gy = gy; this.id = gx + ',' + gy;
    this.type = type; // start | normal | treasure | boss
    this.links = { n: null, e: null, s: null, w: null };
    this.cleared = (type === 'start' || type === 'treasure' || type === 'shop' || type === 'reward'); // 无怪房预清：不预清会永久锁门（软锁 bug）
    this.doorCost = null; this.doorOpen = {}; // v5.1 奖励房金币门
    this.visited = false;
    this.generated = false;
    this.hasEnemiesPlanned = false;
    this.rocks = new Map();      // "gx,gy" → {x,y,seed}
    this.props = [];             // 便便等可破坏物
    this.stains = [];            // 地面污渍（装饰）
    this.blood = [];             // 血渍
    this.scorch = [];            // 罐罐雷焦土贴花（地面常驻，同 blood 用法）
    this.pins = [];              // 刺猬钉落地钉（危险区实体 {x,y,life,angle,cap,dmg,cds}）
    this.vortexes = [];          // 漩涡核坍缩场（{x,y,life,r,cds}）
    this.enemies = []; this.tears = []; this.pickups = []; this.bombs = [];
    this.boss = null; this.trapdoor = null;
    this.quota = 0; this.killed = 0; this.spawnT = 0; // 配额制持续刷怪
    this.escapedFlag = false;
  }
  solidTile(tx, ty) {
    if (tx < 0 || ty < 0 || tx >= GRID_W || ty >= GRID_H) return true;
    const border = tx === 0 || ty === 0 || tx === GRID_W - 1 || ty === GRID_H - 1;
    if (border) {
      if (this.cleared) {
        for (const d of DIRS) {
          const [dx, dy] = DOOR_CELL[d];
          if (tx === dx && ty === dy && this.links[d]) {
            if (this.doorCost && this.doorCost[d] && !this.doorOpen[d]) return true; // 金币门未付：实心
            return false; // 开门后可通行
          }
        }
      }
      return true;
    }
    return this.rocks.has(tx + ',' + ty);
  }
  // 只算墙（不含岩石）——供幽灵类穿透障碍物
  wallOnlyTile(tx, ty) {
    if (tx < 0 || ty < 0 || tx >= GRID_W || ty >= GRID_H) return true;
    const border = tx === 0 || ty === 0 || tx === GRID_W - 1 || ty === GRID_H - 1;
    if (!border) return false;
    if (this.cleared) {
      for (const d of DIRS) {
        const [dx, dy] = DOOR_CELL[d];
        if (tx === dx && ty === dy && this.links[d]) return false;
      }
    }
    return true;
  }
}

// 楼层布局：BIO=实验室1→7+BOSS 线性链；桌面=网格随机生长，BFS 距离最远的死路放 Boss 房
function genFloor(n) {
  if (BIO) {
    const diff = BIO_DIFFS[Meta.load().bioDiff || 0];
    const len = 8 + diff.extra; // 实验室数随难度 8→13，BOSS 恒为最后一间
    const rooms = new Map();
    const chain = [];
    for (let i = 0; i < len; i++) {
      const type = i === 0 ? 'start' : i === len - 1 ? 'boss' : i === 3 ? 'treasure' : i === 5 ? 'shop' : 'normal';
      const r = new Room(1 + i, 3, type);
      r.dist = i;
      rooms.set(r.id, r); chain.push(r);
    }
    for (let i = 0; i < len - 1; i++) { chain[i].links.e = chain[i + 1].id; chain[i + 1].links.w = chain[i].id; }
    // 奖励房（文档：金币开门的可选侧房，跳过不阻塞主线）：每 3 间挂一间
    chain.forEach((r, i) => {
      if (i === 0 || i >= len - 1 || (i + 1) % 3 !== 0) return;
      const rr = new Room(r.gx, 4, 'reward');
      rr.dist = i; rr.cleared = true;
      rooms.set(rr.id, rr);
      r.links.s = rr.id; rr.links.n = r.id;
      r.doorCost = { s: 30 + 20 * (i + 1) }; // 开门价随深度涨
    });
    const distMap = {}; chain.forEach((r, i) => distMap[r.id] = i);
    return { rooms, distMap, startId: chain[0].id, bossId: chain[len - 1].id, n: 1, chain: true };
  }
  const GW = 7, GH = 7;
  const rooms = new Map();
  const key = (x, y) => x + ',' + y;
  const start = new Room(3, 3, 'start');
  rooms.set(start.id, start);

  const normalCount = 6 + 2 * n;
  const adj = (x, y) => DIRS.map(d => [x + DVEC[d][0], y + DVEC[d][1]])
    .filter(([ax, ay]) => ax > 0 && ay > 0 && ax < GW - 1 && ay < GH - 1);

  let guard = 500;
  while (rooms.size < normalCount + 1 && guard-- > 0) {
    const cand = [];
    for (const r of rooms.values()) for (const [ax, ay] of adj(r.gx, r.gy)) {
      if (!rooms.has(key(ax, ay))) {
        const deg = adj(ax, ay).filter(([bx, by]) => rooms.has(key(bx, by))).length;
        if (deg <= 2) cand.push([ax, ay]);
      }
    }
    if (!cand.length) break;
    const [cx, cy] = choice(cand);
    rooms.set(key(cx, cy), new Room(cx, cy, 'normal'));
  }

  // 连线（相邻即有门）
  for (const r of rooms.values()) for (const d of DIRS) {
    const nb = key(r.gx + DVEC[d][0], r.gy + DVEC[d][1]);
    if (rooms.has(nb)) r.links[d] = nb;
  }

  // BFS 距离
  const distMap = { [start.id]: 0 };
  const queue = [start.id];
  while (queue.length) {
    const cur = rooms.get(queue.shift());
    for (const d of DIRS) {
      const nb = cur.links[d];
      if (nb && distMap[nb] === undefined) { distMap[nb] = distMap[cur.id] + 1; queue.push(nb); }
    }
  }

  for (const r of rooms.values()) r.dist = distMap[r.id] || 0; // 距起点越远，怪越强

  const leaves = [...rooms.values()].filter(r =>
    r !== start && DIRS.filter(d => r.links[d]).length === 1);
  const far = arr => arr.slice().sort((a, b) => distMap[b.id] - distMap[a.id])[0];

  let bossRoom = leaves.length ? far(leaves) : far([...rooms.values()].filter(r => r !== start));
  bossRoom.type = 'boss'; bossRoom.cleared = false;
  const rest = leaves.filter(r => r !== bossRoom && r !== start);
  let treasureRoom = rest.length ? choice(rest) :
    [...rooms.values()].find(r => r !== start && r !== bossRoom && distMap[r.id] >= 2);
  if (treasureRoom) { treasureRoom.type = 'treasure'; treasureRoom.cleared = true; }

  // 商店房：再挑一个死路（不与宝箱房重复）
  const rest2 = rest.filter(r => r !== treasureRoom);
  let shopRoom = rest2.length ? choice(rest2) :
    [...rooms.values()].find(r => r !== start && r !== bossRoom && r !== treasureRoom && distMap[r.id] >= 2);
  if (shopRoom) { shopRoom.type = 'shop'; shopRoom.cleared = true; }

  return { rooms, distMap, startId: start.id, bossId: bossRoom.id, n };
}

function roomCenterFree(room, tx, ty) {
  // 出生点/门附近不放石头
  for (const d of DIRS) {
    const [dx, dy] = DOOR_CELL[d];
    if (Math.abs(tx - dx) <= 1 && Math.abs(ty - dy) <= 1) return false;
  }
  if (tx === (GRID_W >> 1) && ty === (GRID_H >> 1)) return false;
  return true;
}

// 进入房间时生成内容（岩石、便便、敌人、Boss、道具）
// ── v5.3 房间战力预算（用户反馈：关卡之间要有差异；后期靠"怪更硬、更多"，而不是让玩家挨更多打）──
// 每种怪按能力定分数 CP = 基血 × 威胁系数 ÷ 10；远程怪分数≈近战 2.4 倍，低预算房自然"买不起"
const MOB_THREAT = {
  fly: 1.0, attackfly: 1.3, gaper: 1.15, spider: 1.35, hopper: 1.5, splitter: 1.9, minifly: .8,
  bat: 1.4, bone: 1.5, glasp: 1.79, // 格拉斯波：坦克，受击减伤 30% → 等效血 ×1.43
  pooter: 2.6, turret: 2.4, spreader: 3.0, ghost: 2.8, mushroom: 2.2, eye: 2.6, // 远程弹幕：压制走位
};
const RANGED_MOBS = new Set(['pooter', 'turret', 'spreader', 'ghost', 'mushroom', 'eye']);
const MOB_POOLS = [
  ['fly', 'fly', 'attackfly', 'gaper', 'gaper', 'spider', 'bat', 'hopper'],
  ['fly', 'attackfly', 'attackfly', 'gaper', 'pooter', 'spider', 'hopper', 'splitter', 'turret', 'ghost', 'bone', 'eye', 'bat', 'glasp'],
  ['attackfly', 'attackfly', 'gaper', 'gaper', 'pooter', 'spider', 'hopper', 'splitter', 'splitter', 'turret', 'ghost', 'spreader', 'bone', 'eye', 'mushroom', 'glasp', 'glasp'],
];
const mobCP = (id, elite) => (BIO_HPBASE[id] || ETYPE[id].hp) * (MOB_THREAT[id] || 1) * (elite ? 2.4 : 1) / 10; // 保留小数：格拉斯波 35.8 不能被四舍五入成 4
const SPAWN_WARN = 45; // 预警 0.75s：玩家看得见刷怪口再决定走位（用户："方便站位和走位"）
// 本房预算：24 + 每关 +26 + 每房 +3.5，跨关只增不减（修掉旧版 statM 进新关归零的难度倒挂）
// 首关前三个房序（r=1 是无怪起始房，实际护住 r2/r3 两个战斗房）×0.65：新手没枪先学走位
const roomBudget = (stage, r) => Math.round((24 + 26 * (stage - 1) + 3.5 * (r - 1)) * (stage === 1 && r <= 3 ? .65 : 1));
const hpScale = stage => Math.min(5.5, 1 + .55 * (stage - 1)); // 唯一血量乘区：只吃关卡，不吃房内序号
const mobEliteChance = stage => Math.min(.38, .08 + .045 * (stage - 1) + (isGate(stage) ? .1 : 0));
const spawnGapFrames = (stage, r) => Math.round(clamp(70 - 2 * stage - 1.5 * r, 26, 70));
const aliveCapFor = room => Math.max(5, Math.min(10, Math.round(4 + (room.budget || 24) / 12)));
// v5.3 箱色随关卡：关1-2 木70/蓝30，关3-4 木45/蓝40/紫15，关5+ 木25/蓝45/紫30
function chestTierForStage(stage) {
  const w = stage <= 2 ? [.70, .30] : stage <= 4 ? [.45, .40] : [.25, .45];
  const r = Math.random();
  return r < w[0] ? 'wood' : r < w[0] + w[1] ? 'blue' : 'purple';
}
// v5.3 修正：BIO 下 floorNum 恒为 1（通关只 +stage），怪池 tier 必须吃 stage，否则 tier2 永不可达、关与关怪种完全相同
const mobPoolTier = (stageOrFloor, dist) => clamp((stageOrFloor | 0) - 1 + ((dist || 0) >= 3 ? 1 : 0), 0, 2);
function buildSpawnQueue(room, floorNum) {
  const stage = game.stage || 1, B = room.budget;
  const tier = mobPoolTier(stage, room.dist);
  const pool = MOB_POOLS[tier];
  const melee = pool.filter(id => !RANGED_MOBS.has(id));
  const ranged = pool.filter(id => RANGED_MOBS.has(id));
  const ec = mobEliteChance(stage);
  const mut = () => game.diffMutate && Math.random() < .3 ? (Math.random() < .5 ? 'armored' : 'slowshot') : null;
  const q = [];
  let used = 0, usedRanged = 0;
  const meleeBudget = B * .78, totalBudget = B * 1.06;
  const rangedCap = (stage === 1 && (room.dist || 0) <= 2) ? 0 : Math.max(B * .18, 13); // 首关前三个房序纯近战；浅预算房也留得下 1 只远程；深房按 18% 封顶
  for (let guard = 0; guard < 120; guard++) { // 相位 1：近战铺底（贵怪买不起就换便宜的，别把整房饿死）
    const elite = Math.random() < ec;
    const can = melee.filter(id => mobCP(id, elite) <= meleeBudget - used);
    if (!can.length) break;
    const id = choice(can);
    used += mobCP(id, elite);
    q.push({ id, elite, mut: mut(), ranged: false });
  }
  for (let guard = 0; guard < 24 && ranged.length; guard++) { // 相位 2：远程点缀（近战之后才刷，玩家可放风筝）
    const elite = Math.random() < ec * .5;
    const room0 = Math.min(rangedCap - usedRanged, totalBudget - used);
    const can = ranged.filter(id => mobCP(id, elite) <= room0);
    if (!can.length) break;
    const id = choice(can);
    const cost = mobCP(id, elite);
    used += cost; usedRanged += cost;
    q.push({ id, elite, mut: mut(), ranged: true });
  }
  if (!q.length) q.push({ id: choice(melee), elite: false, mut: mut(), ranged: false }); // 四舍五入吃光预算也要有怪可打
  q.sort((a, b) => (a.ranged ? 1 : 0) - (b.ranged ? 1 : 0)); // 出怪顺序：近战先、远程后
  return q;
}
function pickSpawnPorts(room, entryX, entryY) {
  const ports = [];
  for (let i = 0; i < 3; i++) {
    for (let t = 0; t < 24; t++) {
      const x = rand(TILE * 1.4, WORLD_W - TILE * 1.4), y = rand(TILE * 1.4, WORLD_H - TILE * 1.4);
      if (dist2(x, y, entryX, entryY) < 170 || dist2(x, y, WORLD_W / 2, WORLD_H / 2) < 60) continue;
      if (room.solidTile(Math.floor(x / TILE), Math.floor(y / TILE))) continue;
      if (ports.some(p => dist2(p.x, p.y, x, y) < 90)) continue;
      ports.push({ x, y }); break;
    }
  }
  if (!ports.length) ports.push({ x: WORLD_W / 2, y: TILE * 1.6 });
  return ports;
}
// 每帧驱动：预警到期落怪 → 未满并发上限则从队列取下一只（远程满员先跳过取近战）
function drainSpawnQueue(room, floorNum) {
  for (let i = room.spawnPending.length - 1; i >= 0; i--) {
    const w = room.spawnPending[i];
    if (--w.t > 0) continue;
    room.spawnPending.splice(i, 1);
    const e = new Enemy(w.id, w.x, w.y, floorNum, { elite: w.elite, instant: true });
    if (w.mut) e.mut = w.mut;
    room.enemies.push(e);
  }
  if (!room.spawnQueue.length) return;
  if (room.enemies.length + room.spawnPending.length >= aliveCapFor(room)) return; // 背压：场上够挤就压住队列
  if (--room.spawnT > 0) return;
  room.spawnT = room.spawnGap;
  const maxRanged = (game.stage || 1) === 1 ? 2 : 3;
  const fieldRanged = room.enemies.filter(e => !e.dead && RANGED_MOBS.has(e.cfg.id)).length + room.spawnPending.filter(w => w.ranged).length;
  const idx = room.spawnQueue.findIndex(m => !m.ranged || fieldRanged < maxRanged);
  if (idx < 0) return;
  const m = room.spawnQueue.splice(idx, 1)[0];
  const port = choice(room.spawnPorts);
  room.spawnPending.push({ id: m.id, elite: m.elite, mut: m.mut, ranged: m.ranged, x: port.x, y: port.y, t: SPAWN_WARN });
}

function createRoomContents(room, floorNum, entryX, entryY) {
  if (room.generated) return;
  room.generated = true;

  const pal = themePal(game.theme || THEMES[0], floorNum);
  const stainN = BIO ? randi(8, 13) : IS_MOBILE ? randi(14, 22) : randi(30, 48); // 手机端减装饰保帧率；BIO 单屏房再减
  for (let i = 0; i < stainN; i++) {
    room.stains.push({
      x: rand(TILE * 1.5, WORLD_W - TILE * 1.5),
      y: rand(TILE * 1.5, WORLD_H - TILE * 1.5),
      r: rand(10, 46), a: rand(0, TAU), c: pal.stain
    });
  }
  // 颗粒噪点：打散棋盘网格
  room.grains = [];
  for (let i = 0; i < (BIO ? 34 : 100); i++) {
    room.grains.push({
      x: rand(TILE, WORLD_W - TILE), y: rand(TILE, WORLD_H - TILE),
      r: rand(1, 2.6),
      c: Math.random() < .5 ? 'rgba(255,240,220,.045)' : 'rgba(0,0,0,.10)'
    });
  }

  // 主题障碍（占格碰撞不变，外观随本局主题；密度按 3 屏面积放大）
  const theme = game.theme || THEMES[0];
  const rockN = room.type === 'boss' ? randi(3, 6) : room.type === 'shop' ? randi(1, 3) : BIO ? randi(4, 8) : randi(10, 18);
  for (let i = 0; i < rockN; i++) {
    const tx = randi(2, GRID_W - 3), ty = randi(2, GRID_H - 3);
    if (!roomCenterFree(room, tx, ty) || room.rocks.has(tx + ',' + ty)) continue;
    if (room.type === 'shop' && ty === (GRID_H >> 1)) continue; // 货架行留空
    if (dist2(tx * TILE + 24, ty * TILE + 24, entryX, entryY) < 90) continue;
    if (room.type === 'boss' && dist2(tx * TILE, ty * TILE, WORLD_W / 2, WORLD_H / 2) < 160) continue;
    room.rocks.set(tx + ',' + ty, { x: tx * TILE + 24, y: ty * TILE + 24, seed: randi(0, 3), sp: choice(theme.solids) });
  }

  if (room.type === 'normal') {
    const poopN = BIO ? randi(1, 3) : randi(2, 5);
    for (let i = 0; i < poopN; i++) {
      const tx = randi(2, GRID_W - 3), ty = randi(2, GRID_H - 3);
      if (!roomCenterFree(room, tx, ty) || room.rocks.has(tx + ',' + ty)) continue;
      room.props.push({ kind: 'junk', x: tx * TILE + 24, y: ty * TILE + 24, hp: 5, maxHp: 5, dead: false, sp: theme.junk });
    }
    // 敌人
    const pools = MOB_POOLS;
    // 难度门控：远端房间用更强怪池；入口侧房间降血量，避免开局撞脸劝退
    const tier = mobPoolTier(BIO ? (game.stage || 1) : floorNum, room.dist);
    const hpMul = BIO ? 1 : 0.55 + 0.12 * clamp(room.dist || 0, 0, 4); // v5.1.1：BIO 血线只吃文档公式（statM），隐藏浅房减免退出
    room.tier = tier; room.hpMul = hpMul;
    if (BIO) { // v5.3：战力预算 + 渐进刷怪（进房 0 怪，预警口一只只出）
      const r = (room.dist || 0) + 1;
      room.budget = roomBudget(game.stage || 1, r);
      room.spawnQueue = buildSpawnQueue(room, floorNum);
      room.spawnPending = [];
      room.spawnPorts = pickSpawnPorts(room, entryX, entryY);
      room.spawnT = 40; // 首只出现前的准备时间
      room.spawnGap = spawnGapFrames(game.stage || 1, r);
      room.quota = room.spawnQueue.length; // 清房口径不变：预算里的怪必须全清
      room.killed = 0;
    } else {
      // 配额制：3 屏大房间怪量翻倍；初始刷一批，波次补刷，杀满配额后残敌必须全清
      room.quota = Math.round((12 + 7 * floorNum + Math.min(12, Math.floor(game.runTime / 3600) * 2)) * (0.55 + 0.15 * clamp(room.dist || 0, 0, 4)) * (1 + .10 * ((game.stage || 1) - 1)) * 10); // 用户实测反馈：怪量提 10 倍才够打
      room.killed = 0;
      room.spawnT = Math.max(50, 130 - 15 * floorNum);
      const initial = Math.min(room.quota, (4 + 2 * floorNum + randi(0, 3)) * 5);
      for (let i = 0; i < initial; i++) {
        let x, y, tries = 0;
        do {
          x = rand(TILE * 2, WORLD_W - TILE * 2);
          y = rand(TILE * 2, WORLD_H - TILE * 2);
          tries++;
        } while (tries < 30 && (
          dist2(x, y, entryX, entryY) < 150 ||
          dist2(x, y, WORLD_W / 2, WORLD_H / 2) < 60 ||
          room.solidTile(Math.floor(x / TILE), Math.floor(y / TILE))));
        const e = new Enemy(choice(pools[tier]), x, y, floorNum);
        e.hp = e.maxHp = Math.max(2, Math.ceil(e.hp * hpMul));
        room.enemies.push(e);
      }
    }
    room.hasEnemiesPlanned = true;
  }

  if (room.type === 'treasure') {
    if (BIO) { // v5.2.1：藏品室=清房后开箱选技能（统一 bioInit 宝箱，见下）；此处不再直出
    } else {
      const rp = makeRewardPickup(WORLD_W / 2, WORLD_H / 2, game.player);
      if (rp.kind === 'item' && !rp.item)
        for (let i = 0; i < 3; i++) room.pickups.push(new Pickup('coin', WORLD_W / 2 + rand(-30, 30), WORLD_H / 2 + rand(-20, 20)));
      else room.pickups.push(rp);
    }
  }

  if (room.type === 'shop') {
    // 货架：1 件道具/武器 + 2 件消耗品，明码标价
    const rp = makeRewardPickup(WORLD_W / 2, WORLD_H / 2 - 26, game.player);
    rp.price = rp.kind === 'weapon' ? 5 : 6;
    if (rp.kind === 'item' && !rp.item) {
      room.pickups.push(new Pickup('coin', WORLD_W / 2, WORLD_H / 2 - 26, null, 2));
    } else {
      room.pickups.push(rp); room.shelf = (room.shelf || []).concat([rp]);
    }
    if (BIO) { // 文档 7.1 波间消费：消耗品与临时强化（花随身金币）
      const inj = new Pickup('item', WORLD_W / 2 - 130, WORLD_H / 2 + 40, { id: 'inject', name: '肾上腺针剂', desc: '立刻回复 40 生命', color: '#c4303a', apply(pp) { pp.heal(40); } }, 40);
      const turbo = new Pickup('item', WORLD_W / 2 + 130, WORLD_H / 2 + 40, { id: 'turbo', name: '击发助器', desc: '本局攻速 +15%', color: '#e8a83a', apply(pp) { pp.fireDelay = Math.max(4, Math.round(pp.fireDelay * .85)); } }, 60);
      room.pickups.push(inj, turbo); room.shelf = (room.shelf || []).concat([inj, turbo]);
    }
    const g2 = new Pickup(choice(['medkit', 'coin']), WORLD_W / 2 - 130, WORLD_H / 2 - 26, null, 8); // v5.2：货架心→药膏 8 币
    const g3 = new Pickup(choice(['medkit', 'coin']), WORLD_W / 2 + 130, WORLD_H / 2 - 26, null, 5);
    room.pickups.push(g2, g3); room.shelf = (room.shelf || []).concat([g2, g3]);
  }

  if (room.type === 'boss') {
    // v5.1.1：生化模式关底恒为杜尔加（the_maw：触手横扫/召唤/P2 狂暴）
    const cfg = BIO ? (BOSSES.find(b => b.id === 'the_maw') || BOSSES[BOSSES.length - 1]) : BOSSES[Math.min(floorNum, BOSSES.length) - 1];
    room.boss = new Boss(cfg, WORLD_W / 2, WORLD_H * .42, floorNum);
  }

  if (BIO && room.type === 'reward') { // 奖励房：付币开门的富矿，2 宝箱（同初始箱规则）+ 物资堆，无怪
    const c1 = new Pickup('chest', WORLD_W / 2 - 70, WORLD_H / 2); c1.bioInit = true; c1.tier = 'blue';   // v5.2.2：奖励房=蓝箱+紫箱
    const c2 = new Pickup('chest', WORLD_W / 2 + 70, WORLD_H / 2); c2.bioInit = true; c2.tier = 'purple';
    room.pickups.push(c1, c2);
    for (let i = 0; i < 3; i++) room.pickups.push(new Pickup('loot', WORLD_W / 2 + rand(-40, 40), WORLD_H / 2 + rand(-70, -40), choice(LOOT)));
    room.pickups.push(new Pickup('save', WORLD_W / 2, WORLD_H / 2 + 110)); // 奖励房必出幸存者
  }

  if (BIO && (room.type === 'normal' || room.type === 'boss' || room.type === 'start' || room.type === 'treasure')) { // v5.2.1：每房一箱（含藏品室）；清房后可开
    let bx = WORLD_W / 2, by = TILE * 3, bd = -1;
    for (let i = 0; i < 60; i++) {
      const x = rand(TILE * 2.2, WORLD_W - TILE * 2.2), y = rand(TILE * 2.2, WORLD_H - TILE * 2.2);
      if (room.solidTile(Math.floor(x / TILE), Math.floor(y / TILE))) continue;
      if (room.enemies.some(e => dist2(x, y, e.x, e.y) < 60)) continue;
      if (room.boss && dist2(x, y, room.boss.x, room.boss.y) < 140) continue;
      const d = dist2(x, y, entryX, entryY);
      if (d < 130) continue;
      if (d > bd) { bd = d; bx = x; by = y; }
    }
    const ch = new Pickup('chest', bx, by); ch.bioInit = true;
    ch.tier = room.type === 'boss' ? 'purple' : room.type === 'treasure' ? 'blue' : room.type === 'start' ? 'wood'
      : chestTierForStage(game.stage || 1); // v5.3：箱色随关卡上移（高级货后期才见，与技能品质门控同调）
    room.pickups.push(ch);
  }

  // v4.0 撤离点：桌面每层起点房都有；v5.0 搜打撤：起点房不许白嫖，每 3 间实验室布一个撤离点
  if (BIO) {
    if ((room.dist + 1) % 3 === 0 && room.type !== 'start' && room.type !== 'boss' && room.type !== 'reward') // 3、6 号房各一个撤离点（含商店房）；左下布点避开冲刺按钮
      room.pickups.push(new Pickup('extract', WORLD_W / 2, WORLD_H - 96)); // v5.2 复核P2：撤离坪移到底部中央，避开左下移动摇杆与背包按钮
    if (room.type === 'normal' && Math.random() < .22) // 被困幸存者：救出结算 +100/人
      room.pickups.push(new Pickup('save', rand(TILE * 2, WORLD_W - TILE * 2), rand(TILE * 2, WORLD_H - TILE * 2)));
  } else if (room.type === 'start')
    room.pickups.push(new Pickup('extract', WORLD_W / 2 + 300, WORLD_H / 2 + 150));
}

// 清房奖励：保底 1 金币，35% 掉武器，另掷 55% 随机补给
function rollClearReward(room, floorNum) {
  const cx = WORLD_W / 2, cy = WORLD_H / 2;
  room.pickups.push(new Pickup('coin', cx + rand(-60, 60), cy + rand(-40, 40)));
  room.pickups.push(new Pickup('coin', cx + rand(-60, 60), cy + rand(-40, 40))); // 保底2币
  if (Math.random() > .55) {
    const kind = Math.random() < .2 ? 'medkit' : 'coin'; // v5.2：清房补给=金币为主，20% 药膏
    room.pickups.push(new Pickup(kind, cx + rand(-90, 90), cy + rand(-50, 50)));
  }
}

// 波次补刷：配额未满时从远离玩家的边缘位置放怪，间隔随层数/时间收紧
function waveSpawn(room, floorNum) {
  const pools = [
    ['fly', 'attackfly', 'gaper', 'bat', 'mushroom', 'spider'],
    ['attackfly', 'gaper', 'pooter', 'bone', 'eye', 'bat', 'hopper', 'mushroom'],
    ['attackfly', 'gaper', 'splitter', 'bone', 'eye', 'ghost', 'turret', 'bat', 'spreader'],
  ];
  const n = randi(4, 6); // v5.3：BIO 补刷改走 drainSpawnQueue（预算队列 + 预警口），此函数仅桌面模式使用
  for (let i = 0; i < n; i++) {
    let x, y, tries = 0;
    do {
      const side = randi(0, 3);
      if (side === 0) { x = rand(TILE * 1.6, WORLD_W - TILE * 1.6); y = TILE * 1.6; }
      else if (side === 1) { x = rand(TILE * 1.6, WORLD_W - TILE * 1.6); y = WORLD_H - TILE * 1.6; }
      else if (side === 2) { x = TILE * 1.6; y = rand(TILE * 1.6, WORLD_H - TILE * 1.6); }
      else { x = WORLD_W - TILE * 1.6; y = rand(TILE * 1.6, WORLD_H - TILE * 1.6); }
      tries++;
    } while (tries < 12 && (dist2(x, y, game.player.x, game.player.y) < 260 ||
      room.solidTile(Math.floor(x / TILE), Math.floor(y / TILE))));
    const e = new Enemy(choice(pools[room.tier != null ? room.tier : clamp(floorNum - 1, 0, 2)]), x, y, floorNum);
    if (room.hpMul) e.hp = e.maxHp = Math.max(2, Math.ceil(e.hp * room.hpMul));
    room.enemies.push(e);
  }
  room.spawnT = Math.max(24, 90 - 10 * floorNum - Math.floor(game.runTime / 3600) * 8); // 间隔随层数/分钟收紧
}
