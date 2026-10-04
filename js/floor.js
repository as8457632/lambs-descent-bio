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
    const pools = [
      ['fly', 'fly', 'attackfly', 'gaper', 'gaper', 'spider', 'bat', 'hopper'],
      ['fly', 'attackfly', 'attackfly', 'gaper', 'pooter', 'spider', 'hopper', 'splitter', 'turret', 'ghost', 'bone', 'eye', 'bat', 'glasp'],
      ['attackfly', 'attackfly', 'gaper', 'gaper', 'pooter', 'spider', 'hopper', 'splitter', 'splitter', 'turret', 'ghost', 'spreader', 'bone', 'eye', 'mushroom', 'glasp', 'glasp'],
    ];
    // 难度门控：远端房间用更强怪池；入口侧房间降血量，避免开局撞脸劝退
    const tier = clamp(floorNum - 1 + ((room.dist || 0) >= 3 ? 1 : 0), 0, 2);
    const hpMul = BIO ? 1 : 0.55 + 0.12 * clamp(room.dist || 0, 0, 4); // v5.1.1：BIO 血线只吃文档公式（statM），隐藏浅房减免退出
    // 配额制：3 屏大房间怪量翻倍；初始刷一批，波次补刷，杀满配额后残敌必须全清
    room.quota = BIO ? Math.round(8 * (1 + .3 * ((room.dist || 0) + 1)) * (1 + .10 * ((game.stage || 1) - 1))) // 文档公式：第 N 房敌人数 = 基础×(1+0.3N)
      : Math.round((12 + 7 * floorNum + Math.min(12, Math.floor(game.runTime / 3600) * 2)) * (0.55 + 0.15 * clamp(room.dist || 0, 0, 4)) * (1 + .10 * ((game.stage || 1) - 1)) * 10); // 用户实测反馈：怪量提 10 倍才够打
    room.killed = 0;
    room.spawnT = Math.max(50, 130 - 15 * floorNum);
    room.tier = tier; room.hpMul = hpMul;
    const initial = BIO ? Math.min(room.quota, 3 + Math.ceil(((room.dist || 0) + 1) * .8)) : Math.min(room.quota, (4 + 2 * floorNum + randi(0, 3)) * 5);
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
      if (BIO && game.diffMutate && Math.random() < .3) e.mut = Math.random() < .5 ? 'armored' : 'slowshot'; // N6+ 突变词缀
      room.enemies.push(e);
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
      : (Math.random() < .05 ? 'purple' : Math.random() < .3 ? 'blue' : 'wood'); // v5.2.2：箱色=掉落表品质
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
  const n = BIO ? randi(2, 3) : randi(4, 6);
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
