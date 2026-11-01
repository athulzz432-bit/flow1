// Flow Tracker: shares a device's live location with your other devices.
// Needs a free Redis database. In Vercel: Storage -> Create Database -> Upstash Redis -> connect to this project -> Redeploy.
// (The env vars UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN or KV_REST_API_URL / KV_REST_API_TOKEN are added for you.)
// Each person's devices live under a secret pair code, which is only ever stored as a hash. Data expires after 24 hours.
import crypto from "node:crypto";

const DAY = 86400;
const conf = () => ({
  url: process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || "",
  token: process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || "",
});

async function redis(cmds) {
  const { url, token } = conf();
  const r = await fetch(url.replace(/\/$/, "") + "/pipeline", {
    method: "POST",
    headers: { authorization: "Bearer " + token, "content-type": "application/json" },
    body: JSON.stringify(cmds),
  });
  if (!r.ok) throw new Error("storage " + r.status);
  const d = await r.json();
  return d.map(x => { if (x && x.error) throw new Error(x.error); return x ? x.result : null; });
}

const num = (v, lo, hi) => { v = Number(v); return Number.isFinite(v) && v >= lo && v <= hi ? v : null; };
const clean = (s, n) => String(s || "").replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, n);
function distM(a, b, c, d) {
  const t = x => x * Math.PI / 180, dLa = t(c - a), dLo = t(d - b);
  const x = Math.sin(dLa / 2) ** 2 + Math.cos(t(a)) * Math.cos(t(c)) * Math.sin(dLo / 2) ** 2;
  return 12742000 * Math.asin(Math.sqrt(x));
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const gate = process.env.ACCESS_CODE;
  if (gate && req.headers["x-access-code"] !== gate) return res.status(401).json({ error: "Wrong access code." });

  if (!conf().url || !conf().token)
    return res.status(501).json({ error: "Tracking storage isn't set up yet. In Vercel go to Storage, create an Upstash Redis database, connect it to this project, then Redeploy." });

  const b = req.body || {};
  const action = String(b.action || "");
  const code = String(b.code || "");
  if (!/^[A-Za-z0-9-]{10,64}$/.test(code)) return res.status(400).json({ error: "That pair code doesn't look right." });
  const h = crypto.createHash("sha256").update(code.toUpperCase()).digest("hex").slice(0, 32);
  const K = {
    devs: "ft:" + h + ":devs",
    dev: id => "ft:" + h + ":dev:" + id,
    trail: id => "ft:" + h + ":trail:" + id,
    cmd: id => "ft:" + h + ":cmd:" + id,
    rl: "ft:" + h + ":rl:" + Math.floor(Date.now() / 60000),
  };
  const idOf = v => (/^[A-Za-z0-9_-]{1,40}$/.test(String(v || "")) ? String(v) : null);

  try {
    // light rate limit per pair code
    const rl = await redis([["INCR", K.rl], ["EXPIRE", K.rl, 70]]);
    if (rl[0] > 300) return res.status(429).json({ error: "Too many requests. Slow down for a minute." });

    if (action === "update") {
      const id = idOf(b.device), lat = num(b.lat, -90, 90), lon = num(b.lon, -180, 180);
      if (!id || lat === null || lon === null) return res.status(400).json({ error: "Bad location update." });
      const now = Date.now();
      let ts = Number(b.ts); if (!Number.isFinite(ts) || ts < now - 3600000 || ts > now + 300000) ts = now;
      const [prevRaw, cmd] = await redis([["GET", K.dev(id)], ["GET", K.cmd(id)], ["DEL", K.cmd(id)]]);
      let prev = null; try { prev = prevRaw ? JSON.parse(prevRaw) : null; } catch (e) { /* ignore */ }
      const state = {
        name: clean(b.name, 40) || (prev && prev.name) || "Device",
        lat: +lat.toFixed(6), lon: +lon.toFixed(6),
        acc: Math.round(num(b.acc, 0, 100000) ?? 0),
        spd: Math.round((num(b.spd, 0, 400) ?? 0) * 10) / 10,
        hdg: Math.round(num(b.hdg, 0, 360) ?? 0),
        bat: num(b.bat, 0, 100) === null ? null : Math.round(num(b.bat, 0, 100)),
        chg: b.chg ? 1 : 0,
        ts, rx: now,
      };
      const writes = [["SET", K.dev(id), JSON.stringify(state), "EX", DAY], ["SADD", K.devs, id], ["EXPIRE", K.devs, DAY * 7]];
      if (!prev || distM(prev.lat, prev.lon, state.lat, state.lon) >= 8 || ts - (prev.ts || 0) >= 60000) {
        writes.push(["LPUSH", K.trail(id), state.lat + "," + state.lon + "," + ts], ["LTRIM", K.trail(id), 0, 299], ["EXPIRE", K.trail(id), DAY]);
      }
      await redis(writes);
      return res.status(200).json({ ok: true, cmd: cmd || null, now });
    }

    if (action === "list") {
      const [ids] = await redis([["SMEMBERS", K.devs]]);
      const list = (ids || []).slice(0, 12);
      if (!list.length) return res.status(200).json({ devices: [], now: Date.now() });
      const rows = await redis(list.flatMap(id => [["GET", K.dev(id)], ["LRANGE", K.trail(id), 0, 149]]));
      const devices = [], dead = [];
      list.forEach((id, i) => {
        let s = null; try { s = rows[i * 2] ? JSON.parse(rows[i * 2]) : null; } catch (e) { /* ignore */ }
        if (!s) { dead.push(id); return; }
        const trail = (rows[i * 2 + 1] || []).map(t => t.split(",").map(Number)).reverse();
        devices.push({ id, ...s, trail });
      });
      if (dead.length) await redis(dead.map(id => ["SREM", K.devs, id]));
      return res.status(200).json({ devices, now: Date.now() });
    }

    if (action === "ring") {
      const id = idOf(b.device); if (!id) return res.status(400).json({ error: "Which device?" });
      await redis([["SET", K.cmd(id), "ring", "EX", 180]]);
      return res.status(200).json({ ok: true });
    }

    if (action === "remove") {
      const id = idOf(b.device); if (!id) return res.status(400).json({ error: "Which device?" });
      await redis([["DEL", K.dev(id)], ["DEL", K.trail(id)], ["DEL", K.cmd(id)], ["SREM", K.devs, id]]);
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: "Unknown action." });
  } catch (e) {
    return res.status(502).json({ error: "The tracking storage didn't answer. Try again in a moment." });
  }
}
