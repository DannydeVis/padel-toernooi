// push-round: sends a real Web Push notification (RFC 8030/8291/8292) to every
// subscribed player of a tournament when a new round starts or the tournament
// finishes. Self-contained: no npm/JSR web-push dependency (npm:web-push does
// not work in the Supabase Edge Runtime), no @supabase/supabase-js either.
// Only Deno's built-in Web Crypto API and the PostgREST REST endpoint.
//
// Env vars (Supabase secrets):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY  (auto-provided by Supabase)
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT  (set manually)

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

function base64UrlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(str: string): Uint8Array {
  str = str.replace(/-/g, "+").replace(/_/g, "/");
  while (str.length % 4) str += "=";
  const bin = atob(str);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function concatBytes(...arrs: Uint8Array[]): Uint8Array {
  const total = arrs.reduce((a, b) => a + b.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrs) { out.set(a, off); off += a.length; }
  return out;
}

async function hmacSha256(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, data);
  return new Uint8Array(sig);
}

// Single-block HKDF-Expand (fine here: every derived key we need is <= 32 bytes)
async function hkdfExpand(prk: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  const input = concatBytes(info, new Uint8Array([1]));
  const t = await hmacSha256(prk, input);
  return t.slice(0, length);
}

// RFC 8292: sign a VAPID JWT for this push endpoint's origin.
async function buildVapidAuthHeader(
  endpoint: string,
  vapidPrivateKeyB64: string,
  vapidPublicKeyB64: string,
  subject: string,
): Promise<string> {
  const url = new URL(endpoint);
  const aud = `${url.protocol}//${url.host}`;
  const pubBytes = base64UrlDecode(vapidPublicKeyB64); // 65 bytes: 0x04 + X(32) + Y(32)
  const x = pubBytes.slice(1, 33), y = pubBytes.slice(33, 65);
  const d = base64UrlDecode(vapidPrivateKeyB64); // 32 bytes
  const jwk = { kty: "EC", crv: "P-256", d: base64UrlEncode(d), x: base64UrlEncode(x), y: base64UrlEncode(y), ext: true };
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);

  const header = { typ: "JWT", alg: "ES256" };
  const now = Math.floor(Date.now() / 1000);
  const payload = { aud, exp: now + 12 * 3600, sub: subject };
  const encHeader = base64UrlEncode(new TextEncoder().encode(JSON.stringify(header)));
  const encPayload = base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const signingInput = `${encHeader}.${encPayload}`;
  // Web Crypto ECDSA signatures are raw r||s (IEEE P1363), exactly what JWS ES256 needs.
  const sigBuf = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(signingInput));
  const jwt = `${signingInput}.${base64UrlEncode(new Uint8Array(sigBuf))}`;
  return `vapid t=${jwt}, k=${vapidPublicKeyB64}`;
}

// RFC 8291 + RFC 8188 (aes128gcm): encrypt the notification payload for one subscriber.
async function encryptPayload(payloadBytes: Uint8Array, p256dhB64: string, authB64: string): Promise<Uint8Array> {
  const uaPublicRaw = base64UrlDecode(p256dhB64); // client's public key, 65 bytes
  const authSecret = base64UrlDecode(authB64); // 16 bytes

  const uaPublicKey = await crypto.subtle.importKey("raw", uaPublicRaw, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const asKeyPair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const asPublicRaw = new Uint8Array(await crypto.subtle.exportKey("raw", asKeyPair.publicKey));

  const sharedSecret = new Uint8Array(
    await crypto.subtle.deriveBits({ name: "ECDH", public: uaPublicKey } as EcdhKeyDeriveParams, asKeyPair.privateKey, 256),
  );

  const prkKey = await hmacSha256(authSecret, sharedSecret);
  const keyInfo = concatBytes(new TextEncoder().encode("WebPush: info\0"), uaPublicRaw, asPublicRaw);
  const ikm = await hkdfExpand(prkKey, keyInfo, 32);

  const salt = crypto.getRandomValues(new Uint8Array(16));
  const prk = await hmacSha256(salt, ikm);

  const cek = await hkdfExpand(prk, new TextEncoder().encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdfExpand(prk, new TextEncoder().encode("Content-Encoding: nonce\0"), 12);

  const record = concatBytes(payloadBytes, new Uint8Array([2])); // single-record delimiter, no extra padding needed
  const aesKey = await crypto.subtle.importKey("raw", cek, { name: "AES-GCM" }, false, ["encrypt"]);
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aesKey, record));

  const rs = 4096;
  const header = new Uint8Array(16 + 4 + 1 + asPublicRaw.length);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, rs, false);
  header[20] = asPublicRaw.length;
  header.set(asPublicRaw, 21);

  return concatBytes(header, encrypted);
}

function fillTemplate(tpl: string, vars: Record<string, string | number>): string {
  return tpl.replace(/\{(\w+)\}/g, (_m, k) => (vars[k] !== undefined && vars[k] !== null && vars[k] !== "") ? String(vars[k]) : "");
}

interface PlayerStatusInput {
  name?: string;
  status?: string;
  round?: number;
  court?: number | string | null;
  partner?: string | null;
  opponents?: string[];
  rank?: number | string | null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY");
  const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY");
  const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT");
  if (!SUPABASE_URL || !SERVICE_KEY || !VAPID_PUBLIC_KEY || !VAPID_PRIVATE_KEY || !VAPID_SUBJECT) {
    return json({ error: "missing_configuration" }, 500);
  }

  const bodyText = await req.text();
  if (bodyText.length > 200_000) return json({ error: "payload_too_large" }, 413);

  let body: { tournament_code?: string; round?: number; kind?: string; statuses?: Record<string, PlayerStatusInput> };
  try { body = JSON.parse(bodyText); } catch { return json({ error: "invalid_json" }, 400); }

  const { tournament_code, round, kind, statuses } = body;
  if (
    !tournament_code || typeof tournament_code !== "string" ||
    typeof round !== "number" || !Number.isFinite(round) ||
    (kind !== "round" && kind !== "finish") ||
    !statuses || typeof statuses !== "object"
  ) {
    return json({ error: "invalid_input" }, 400);
  }

  const rest = (path: string, init: RequestInit = {}) =>
    fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
      ...init,
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        "Content-Type": "application/json",
        ...(init.headers as Record<string, string> || {}),
      },
    });

  try {
    // 1. tournament code must exist
    const codeRes = await rest(`tournaments?code=eq.${encodeURIComponent(tournament_code)}&select=code`);
    const codeRows = await codeRes.json();
    if (!Array.isArray(codeRows) || codeRows.length === 0) return json({ error: "code_not_found" }, 404);

    // 2. dedupe: this exact (code, round, kind) already sent?
    const dupRes = await rest(
      `push_log?tournament_code=eq.${encodeURIComponent(tournament_code)}&round=eq.${round}&kind=eq.${kind}&select=id`,
    );
    const dupRows = await dupRes.json();
    if (Array.isArray(dupRows) && dupRows.length > 0) return json({ ok: true, skipped: "duplicate" });

    // 3. rate limit: max 1 send per tournament code per minute
    const recentRes = await rest(
      `push_log?tournament_code=eq.${encodeURIComponent(tournament_code)}&select=sent_at&order=sent_at.desc&limit=1`,
    );
    const recentRows = await recentRes.json();
    if (Array.isArray(recentRows) && recentRows.length > 0) {
      const lastMs = new Date(recentRows[0].sent_at).getTime();
      if (Date.now() - lastMs < 60_000) return json({ ok: true, skipped: "rate_limited" });
    }

    // 4. claim this (code, round, kind) slot before sending, so concurrent calls dedupe cleanly
    const claimRes = await rest("push_log", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ tournament_code, round, kind }),
    });
    if (!claimRes.ok) return json({ ok: true, skipped: "duplicate" });

    // 5. load subscriptions and send
    const subsRes = await rest(
      `push_subscriptions?tournament_code=eq.${encodeURIComponent(tournament_code)}&select=id,player_id,endpoint,p256dh,auth,msg_templates`,
    );
    const subs = await subsRes.json();

    let sent = 0, removed = 0;
    if (Array.isArray(subs)) {
      for (const sub of subs) {
        const st = statuses[String(sub.player_id)];
        if (!st) continue;
        const templateKey = kind === "finish" ? "done" : (st.status === "resting" ? "resting" : "playing");
        const template = sub.msg_templates?.[templateKey];
        if (!template) continue;

        const notifBody = fillTemplate(template, {
          round: st.round ?? round,
          court: st.court ?? "",
          partner: st.partner ?? "",
          opp1: (st.opponents && st.opponents[0]) || "",
          opp2: (st.opponents && st.opponents[1]) || "",
          rank: st.rank ?? "",
        });
        const url = `https://padel-bracket.com/app/?view=${encodeURIComponent(tournament_code)}&player=${encodeURIComponent(st.name || "")}`;
        const payload = JSON.stringify({ title: "PadelBracket", body: notifBody, tag: `padel-${tournament_code}-${round}-${kind}`, url });

        try {
          const encrypted = await encryptPayload(new TextEncoder().encode(payload), sub.p256dh, sub.auth);
          const vapidAuth = await buildVapidAuthHeader(sub.endpoint, VAPID_PRIVATE_KEY, VAPID_PUBLIC_KEY, VAPID_SUBJECT);
          const pushRes = await fetch(sub.endpoint, {
            method: "POST",
            headers: {
              Authorization: vapidAuth,
              "Content-Type": "application/octet-stream",
              "Content-Encoding": "aes128gcm",
              TTL: "2419200",
            },
            body: encrypted,
          });
          if (pushRes.status === 404 || pushRes.status === 410) {
            await rest(`push_subscriptions?id=eq.${sub.id}`, { method: "DELETE" });
            removed++;
          } else if (pushRes.ok) {
            sent++;
          }
        } catch {
          // one subscriber failing must not stop the others
        }
      }
    }

    // 6. after a finish push: this tournament's subscriptions are done, and sweep old rows globally
    if (kind === "finish") {
      await rest(`push_subscriptions?tournament_code=eq.${encodeURIComponent(tournament_code)}`, { method: "DELETE" });
      const cutoff = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
      await rest(`push_subscriptions?created_at=lt.${encodeURIComponent(cutoff)}`, { method: "DELETE" });
    }

    return json({ ok: true, sent, removed });
  } catch (e) {
    return json({ error: "internal_error", message: String(e) }, 500);
  }
});
