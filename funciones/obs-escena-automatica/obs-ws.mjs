// Cliente mínimo de obs-websocket v5 para probar y automatizar OBS desde la terminal (Node.js 22+).
// Uso: node obs-ws.mjs '[["GetVersion"],["GetSceneList"],["SetCurrentProgramScene",{"sceneName":"Carrera"}]]'
// Variables: OBS_URL (por defecto ws://127.0.0.1:4455), OBS_PASSWORD (OBS → Herramientas → Ajustes del servidor WebSocket).
import crypto from "node:crypto";
const URL = process.env.OBS_URL || "ws://127.0.0.1:4455";
const PASS = process.env.OBS_PASSWORD || "";
const reqs = JSON.parse(process.argv[2] || "[]");
const ws = new WebSocket(URL, "obswebsocket.json");
const pending = new Map(); let n = 0;
const sha = (s) => crypto.createHash("sha256").update(s).digest("base64");
ws.onmessage = async (ev) => {
  const m = JSON.parse(ev.data);
  if (m.op === 0) {
    const d = { rpcVersion: 1 };
    if (m.d.authentication) {
      if (!PASS) { console.log(JSON.stringify({ needsAuth: true, obsWebSocketVersion: m.d.obsWebSocketVersion })); process.exit(2); }
      d.authentication = sha(sha(PASS + m.d.authentication.salt) + m.d.authentication.challenge);
    }
    ws.send(JSON.stringify({ op: 1, d }));
  } else if (m.op === 2) {
    const out = [];
    for (const [type, data] of reqs) {
      const id = String(++n);
      const p = new Promise((r) => pending.set(id, r));
      ws.send(JSON.stringify({ op: 6, d: { requestType: type, requestId: id, requestData: data || {} } }));
      const res = await p;
      out.push({ type, ok: res.requestStatus.result, code: res.requestStatus.code, comment: res.requestStatus.comment, data: res.responseData });
    }
    console.log(JSON.stringify(out, null, 1));
    ws.close(); process.exit(0);
  } else if (m.op === 7) pending.get(m.d.requestId)?.(m.d);
};
ws.onerror = (e) => { console.log("error", e.message || e); process.exit(1); };
ws.onclose = (e) => { if (e.code !== 1000 && e.code !== 1005) { console.log("cerrado", e.code, e.reason); process.exit(1); } };
