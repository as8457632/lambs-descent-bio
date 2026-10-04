'use strict';
// ─────────────────────────────────────────────
// v4.0 平台适配层：登录三通道（微信/抖音/游客）+ 云存档
// 模式参考 speedStream 问题反馈：无状态 HTTP POST + 设备 ID + 失败重试队列
// 原则：游戏永远先写本地 localStorage，异步上云；断网零阻塞
// ─────────────────────────────────────────────
function mergeMax(a, b) { // 逐键取大的合并（离线积压快照合并 / 云端武器库找回共用）
  const o = Object.assign({}, a || {});
  for (const k of Object.keys(b || {})) o[k] = Math.max(+o[k] || 0, +b[k] || 0);
  return o;
}
// ── 云存档后端地址解析（v5.3 登录接线）──
// 生产 API 域（nginx 反代 → 内网 28989，TLS 在 nginx 终结）
const PROD_API = 'https://lambs.znseed.top';
// 优先级：URL ?api= > 手动设置(localStorage) > 按页面协议推断 > 纯本地
//   http:  → 同源（局域网 lan.js 一体化调试：静态 + /api 反代在同一端口，无需跨域）
//   https: → 生产 API 域（游戏静态托管在 Pages/EdgeOne，与 API 不同源，必须显式指过去）
//   file:  → 空（纯本地存档，不联网）
// 旧实现直接取 location.origin，导致游戏一上 https 就去请求"游戏自己的域/api/login"→404→静默退回本地档
function resolveApi(protocol, origin, search, stored) {
  const q = (search.match(/[?&]api=([^&]+)/) || [])[1];
  if (q) return decodeURIComponent(q).replace(/\/+$/, '');
  if (stored) return stored.replace(/\/+$/, '');
  if (protocol === 'file:') return '';
  if (protocol === 'http:') return origin; // 局域网/本机 http：同源直连
  return PROD_API;
}
const CloudSave = {
  api: resolveApi(location.protocol, location.origin, location.search, localStorage.getItem('tr_api')),
  token: localStorage.getItem('tr_token') || null,
  profile: null,
  online: false,
  deviceId: null,
  platform: 'guest',

  detect() {
    if (typeof wx !== 'undefined' && wx.login) this.platform = 'wechat';
    else if (typeof tt !== 'undefined' && tt.login) this.platform = 'douyin';
    if (!this.deviceId) {
      this.deviceId = localStorage.getItem('tr_device_id');
      if (!this.deviceId) {
        this.deviceId = 'd-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
        try { localStorage.setItem('tr_device_id', this.deviceId); } catch (e) { }
      }
    }
  },
  platformCode() { // 小游戏平台静默换 code；guest 直接用设备 ID
    return new Promise(res => {
      if (this.platform === 'guest') return res(null);
      const P = this.platform === 'wechat' ? wx : tt;
      try { P.login({ success: r => res(r.code || null), fail: () => res(null) }); } catch (e) { res(null); }
    });
  },
  boot() { // 冷启动/恢复在线自动补传（修复"积压只能等 reload 触发点"）
    setInterval(() => { if (this.token && !this.online) this.login().then(ok => ok && this.flushQueue()); }, 30000);
    addEventListener('online', () => this.login().then(ok => ok && this.flushQueue()));
  },
  async login() {
    if (!this.api) { this.online = false; return false; } // 公网默认离线模式：纯本地存档
    this.detect();
    const code = await this.platformCode();
    try {
      const r = await fetch(this.api + '/api/login', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ platform: this.platform, deviceId: this.deviceId, code }),
      });
      if (!r.ok) throw 0;
      const j = await r.json();
      this.token = j.token; this.profile = j.profile; this.online = true;
      localStorage.setItem('tr_token', j.token);
      this.applyProfile(j.profile); // 登录即云端 max 合并（换设备找回进度）
      await this.flushQueue();
      return true;
    } catch (e) { this.online = false; return false; } // 离线照常本地玩
  },
  applyProfile(p) { // v5.1.1：经济(金币/材料)按 econRev last-writer-wins 拉取，不再 max(本地, 云+pending)（消费防复活/防双计）
    const m = Meta.load();
    const crev = Math.floor(+p.econRev || 0);
    if (crev > (m.econRev || 0)) {
      m.coins = Math.max(0, Math.floor(+p.coins || 0));
      if (p.mats && typeof p.mats === 'object') { m.mats.iron = Math.min(999, Math.max(0, p.mats.iron | 0)); m.mats.core = Math.min(999, Math.max(0, p.mats.core | 0)); }
      m.econRev = crev;
    }
    Meta.syncFp(); // 拉取引起的数值变化不是本地新改动，不 bump rev
    m.maxStage = Math.max(m.maxStage || 0, p.maxStage || 0);
    m.bioBest = Math.max(m.bioBest || 0, Math.min(999, p.bioBest || 0)); m.bioEscapes = Math.max(m.bioEscapes || 0, p.bioEscapes || 0);
    if (p.heroes && typeof p.heroes === 'object') // 英雄解锁/突破阶：白名单 + [0,3] 钳制
      for (const k of Object.keys(p.heroes)) {
        if (CHARS.some(c => c.id === k)) m.heroes[k] = Math.max(m.heroes[k] || 0, Math.min(3, p.heroes[k] | 0));
      }
    for (const k of Object.keys(m.up)) { // 白名单键 + 不超工坊上限：脏云端数据拉爆本地
      const def = META_UPS.find(u => u.id === k);
      m.up[k] = Math.min(def ? def.max : 0, Math.max(m.up[k], (p.upgrades || {})[k] || 0));
    }
    if (p.weapons && typeof p.weapons === 'object') // v4.3 武器库找回：白名单 + [0,5] 钳制，脏值不入本地
      for (const k of Object.keys(p.weapons)) {
        if (typeof WEAPONS !== 'undefined' && WEAPONS[k]) m.weapons[k] = Math.max(m.weapons[k] || 0, Math.min(5, p.weapons[k] | 0));
      }
    if (p.wq && typeof p.wq === 'object') // v5.1.1 复核P2：武器强化级跨设备找回（累进项 max 合并）；v5.3 品质扩档 → [0,4] 钳制
      for (const k of Object.keys(p.wq)) {
        if (typeof WEAPONS !== 'undefined' && WEAPONS[k]) m.wq[k] = Math.max(m.wq[k] || 0, Math.min(4, p.wq[k] | 0));
      }
    if (p.charId >= 0 && p.charId < CHARS.length) m.char = p.charId; // 钳制，防脏档崩渲染
    Meta.save();
  },
  snapshot() { // v5.1.1：经济改全量快照 + econRev LWW：消费/入账都真实覆盖云端，重登与积压重试都幂等
    const m = Meta.load();
    return { coins: m.coins, econRev: m.econRev || 0, maxStage: m.maxStage, upgrades: m.up, weapons: m.weapons || null, wq: m.wq || null, charId: m.char, nickname: m.nickname || '', bioBest: m.bioBest || 0, bioEscapes: m.bioEscapes || 0, mats: m.mats || null, heroes: m.heroes || null };
  },
  async queue() { // 结算点调用：通关/死亡/撤离/工坊购买/合成
    const body = this.snapshot();
    if (!this.token) { this.pushQueue(body); return; }
    try {
      const r = await fetch(this.api + '/api/sync', {
        method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + this.token },
        body: JSON.stringify(body),
      });
      if (!r.ok) throw 0;
      this.online = true;
      this.flushQueue();
    } catch (e) { this.online = false; this.pushQueue(body); }
  },
  pushQueue(body) { // 积压只保留 1 条最新快照：经济取 rev 更高者，累进项逐键 max
    try {
      let q = [];
      try { q = JSON.parse(localStorage.getItem('tr_sync_q') || '[]'); } catch (e) { }
      const old = q[0];
      const merged = old ? {
        ...((old.econRev || 0) > (body.econRev || 0) ? { ...body, ...old } : { ...old, ...body }),
        maxStage: Math.max(old.maxStage || 0, body.maxStage || 0),
        upgrades: mergeMax(old.upgrades, body.upgrades),
        weapons: mergeMax(old.weapons, body.weapons),
        nickname: body.nickname || old.nickname,
      } : body;
      localStorage.setItem('tr_sync_q', JSON.stringify([merged]));
    } catch (e) { }
  },
  async flushQueue() {
    if (!this.token) return;
    let q = [];
    try { q = JSON.parse(localStorage.getItem('tr_sync_q') || '[]'); } catch (e) { }
    while (q.length) {
      const head = q[0];
      try {
        const r = await fetch(this.api + '/api/sync', {
          method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + this.token },
          body: JSON.stringify(head),
        });
        if (!r.ok) { if (r.status === 400) q.shift(); break; } // 400=内容被服务端拒绝（刷币拦截），丢弃防堵队列
        q.shift();
        localStorage.setItem('tr_sync_q', JSON.stringify(q));
      } catch (e) { break; } // 仍离线，留队下次
    }
  },
  statusText() {
    if (!this.token) return '未登录（本地存档）';
    if (this.online) return `账号 #${this.profile && this.profile.id} · 云同步✓`;
    return `账号 #${this.profile && this.profile.id} · 离线（积压${(JSON.parse(localStorage.getItem('tr_sync_q') || '[]')).length}）`;
  },
};
window.CloudSave = CloudSave;
