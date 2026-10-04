// Nagebootste supabase-js voor scripts/test-account.mjs. Alleen het stukje dat
// de app gebruikt, met de eigenschappen die ertoe doen:
// - de sessie staat in localStorage onder de storageKey van de client, net als
//   bij supabase-js, dus een nieuwe browsercontext is echt een ander toestel;
// - PKCE: de sleutel om een ?code= in te wisselen staat in de browser die de
//   inlog aanvroeg, dus een maillink in een andere browser werkt niet;
// - alleen een client met detectSessionInUrl wisselt een ?code= in.
// De "server" zit in de test (/__fake-supabase/... op hetzelfde adres).
(function () {
  const API = location.origin + '/__fake-supabase';
  const post = (path, body) => fetch(API + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    .then(r => r.json());
  const err = e => Object.assign(new Error(e.message), e);

  function makeAuth(opts) {
    const a = opts || {};
    const key = a.storageKey || 'sb-fake-auth-token';
    const persist = a.persistSession !== false;
    const listeners = [];
    let mem = null;
    const read = () => { if (!persist) return mem; try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; } };
    const write = s => { if (!persist) { mem = s; return; } if (s) localStorage.setItem(key, JSON.stringify(s)); else localStorage.removeItem(key); };
    const emit = (ev, s) => listeners.forEach(cb => { try { cb(ev, s); } catch {} });
    const verifierKey = key + '-code-verifier';
    const newVerifier = () => { const v = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2); localStorage.setItem(verifierKey, v); return v; };

    const init = (async () => {
      if (!a.detectSessionInUrl) return;
      const code = new URLSearchParams(location.search).get('code');
      if (!code) return;
      const res = await post('/exchange', { code, verifier: localStorage.getItem(verifierKey) });
      if (res.user) { write({ user: res.user }); localStorage.removeItem(verifierKey); emit('SIGNED_IN', read()); }
    })().catch(() => {});

    return {
      async getSession() { await init; return { data: { session: read() }, error: null }; },
      onAuthStateChange(cb) { listeners.push(cb); return { data: { subscription: { unsubscribe() {} } } }; },
      async signInWithOtp({ email, options }) {
        const res = await post('/otp', { email, verifier: newVerifier(), redirectTo: options && options.emailRedirectTo,
          shouldCreateUser: !options || options.shouldCreateUser !== false });
        return { data: {}, error: res.error ? err(res.error) : null };
      },
      async verifyOtp({ email, token }) {
        const res = await post('/verify', { email, token });
        if (res.error) return { data: {}, error: err(res.error) };
        write({ user: res.user }); emit('SIGNED_IN', read());
        return { data: { user: res.user, session: read() }, error: null };
      },
      async signInWithOAuth({ provider, options }) {
        const res = await post('/oauth', { provider, verifier: newVerifier(), redirectTo: options && options.redirectTo,
          queryParams: options && options.queryParams });
        if (res.error) return { data: {}, error: err(res.error) };
        location.assign(res.url);
        return { data: { url: res.url }, error: null };
      },
      async signOut() { write(null); emit('SIGNED_OUT', null); return { error: null }; },
      _uid() { const s = read(); return s && s.user ? s.user.id : null; },
    };
  }

  // Tabelvragen: de keten onthoudt welke methodes er met welke argumenten
  // aangeroepen werden (select, eq, insert, ...) en stuurt dat naar de
  // server als /from. Een test die niets met tabellen doet, antwoordt daar
  // gewoon { data: null }.
  function chain(table, headers, uid) {
    const calls = [];
    let result = null;
    const run = () => result || (result = post('/from', { table, calls, headers: headers || {}, uid })
      .then(res => ({ data: res.data === undefined ? null : res.data, error: res.error ? err(res.error) : null }))
      .catch(e => ({ data: null, error: err({ message: String(e) }) })));
    const p = new Proxy(function () {}, {
      get(_, prop) {
        if (prop === 'then') return (a, b) => run().then(a, b);
        if (prop === 'catch') return b => run().catch(b);
        return (...args) => { calls.push([prop, ...args]); return p; };
      },
    });
    return p;
  }

  window.supabase = {
    createClient(url, keyArg, opts) {
      const auth = makeAuth(opts && opts.auth);
      return {
        auth,
        from(table) { return chain(table, opts && opts.global && opts.global.headers, auth._uid()); },
        channel() { return { on() { return this; }, subscribe() { return this; } }; },
        removeChannel() {},
        functions: { invoke: async () => ({ data: null, error: null }) },
        async rpc(name, params) {
          const res = await post('/rpc/' + name, { uid: auth._uid(), params: params || {} });
          return { data: res.data === undefined ? null : res.data, error: res.error ? err(res.error) : null };
        },
      };
    },
  };
})();
