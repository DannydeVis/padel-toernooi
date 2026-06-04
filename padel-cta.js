/*
 * padel-cta.js  (alles-in-een versie, QR ingebouwd)
 * Conversie-CTA voor de deel-link (spectator) en het presentatiescherm.
 */
(function () {
  "use strict";
  if (window.PadelCTA) return;
  var SELF = document.currentScript;

  var EMBEDDED_QR = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAC0AAAAtAQAAAAASYd83AAABRklEQVR42gE7AcT+Af8AAAAA+QIAAAAAAAAEwZZgsgioAh8MOv0nwALyEberPYACAOAFyYAAAgDzIuAgAADfSQrtN9gBwJUAAPvIAP/SBpSf+ADdBMhe4NgB/a0N7MUwBOPIkwy20QLgD2XhRSAB6jSKylnNAPGsMsxwWALvobnAVUAA1vsAvhy4Ad2FDOKLvQLwJdlgBoAA6Cu0I1NYAOrLPIpS2AD3Np3Kq/gA5bznISHYAt64H4e9AAD2/qT8WJgC5nIcYncAAeMOFjEZBwHzeULlsJUA4c1Ashb4ANAJrl7ruALz1fORyaAB83DqEw1rAPXppthN+ADKACg8wJgA/9NWqh1YAMBA7ZsU2ADfbIcSHPgB0XTOTSEXBAApGkkyXQIA+AcBNCACDhICkMNABOHPpfL6IAH/AAAAAPkCAAAAAAAAGjCFJ8IH29UAAAAASUVORK5CYII=";

  var STRINGS = {
    nl: { head: "Ook zelf een toernooi organiseren?", btn: "Gratis starten",
          presHead: "Maak gratis je eigen padeltoernooi", presSub: "Scan en speel op" },
    en: { head: "Want to run your own tournament?", btn: "Start free",
          presHead: "Create your own padel tournament, free", presSub: "Scan and play at" },
    fr: { head: "Envie d'organiser votre propre tournoi ?", btn: "Commencer gratuitement",
          presHead: "Creez votre tournoi de padel, gratuit", presSub: "Scannez et jouez sur" },
    de: { head: "Eigenes Turnier veranstalten?", btn: "Kostenlos starten",
          presHead: "Erstelle dein eigenes Padel-Turnier, gratis", presSub: "Scannen und spielen auf" },
    es: { head: "Quieres organizar tu propio torneo?", btn: "Empezar gratis",
          presHead: "Crea tu propio torneo de padel, gratis", presSub: "Escanea y juega en" },
    sv: { head: "Vill du ordna en egen turnering?", btn: "Borja gratis",
          presHead: "Skapa din egen padelturnering, gratis", presSub: "Skanna och spela pa" }
  };

  var DEFAULT_APP = "https://padel-bracket.com/app/";
  var SHOWN_DOMAIN = "padel-bracket.com";

  function detectLang(override) {
    var supported = ["nl", "en", "fr", "de", "es", "sv"];
    var c = [];
    if (override) c.push(override);
    var hl = document.documentElement.getAttribute("lang");
    if (hl) c.push(hl);
    if (navigator.language) c.push(navigator.language);
    (navigator.languages || []).forEach(function (l) { c.push(l); });
    for (var i = 0; i < c.length; i++) {
      var code = String(c[i]).toLowerCase().slice(0, 2);
      if (supported.indexOf(code) !== -1) return code;
    }
    return "en";
  }

  function buildHref(appUrl, mode) {
    var src = mode === "presentation" ? "presentation" : "share";
    var medium = mode === "presentation" ? "screen" : "cta";
    var p = "utm_source=" + src + "&utm_medium=" + medium + "&utm_campaign=viral_loop";
    return appUrl + (appUrl.indexOf("?") === -1 ? "?" : "&") + p;
  }

  function injectStyles() {
    if (document.getElementById("padel-cta-styles")) return;
    var css = ""
      + ".padel-cta{box-sizing:border-box;font-family:'Inter',-apple-system,BlinkMacSystemFont,sans-serif;z-index:2147483000;-webkit-tap-highlight-color:transparent}"
      + ".padel-cta *{box-sizing:border-box}"
      + ".padel-cta--spectator{position:fixed;left:50%;bottom:14px;transform:translateX(-50%) translateY(140%);width:calc(100% - 24px);max-width:520px;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 14px;background:#1A1F24;border:1px solid rgba(199,255,94,.2);border-radius:16px;box-shadow:0 8px 32px rgba(0,0,0,.5),0 2px 8px rgba(0,0,0,.3);animation:padel-cta-up .5s cubic-bezier(.2,.8,.2,1) .6s forwards}"
      + ".padel-cta--spectator .padel-cta__txt{font-size:16px;font-weight:700;color:#e2e8f0;line-height:1.25;letter-spacing:.2px}"
      + ".padel-cta--spectator .padel-cta__btn{flex:0 0 auto;white-space:nowrap;text-decoration:none;background:#C7FF5E;color:#0E1114;font-weight:800;font-size:13px;letter-spacing:.5px;text-transform:uppercase;padding:11px 18px;border-radius:12px;box-shadow:0 4px 12px rgba(199,255,94,.3);transition:transform .12s ease,box-shadow .12s ease}"
      + ".padel-cta--spectator .padel-cta__btn:hover{transform:translateY(-1px);box-shadow:0 6px 16px rgba(199,255,94,.45)}"
      + ".padel-cta--spectator .padel-cta__btn:active{transform:translateY(0)}"
      + ".padel-cta--presentation{position:fixed;left:0;right:0;bottom:0;display:flex;align-items:center;justify-content:center;gap:28px;padding:18px 32px;background:linear-gradient(180deg,#1A1F24 0%,#0E1114 100%);border-top:3px solid #C7FF5E;box-shadow:0 -4px 24px rgba(0,0,0,.4)}"
      + ".padel-cta--presentation .padel-cta__qr{flex:0 0 auto;width:104px;height:104px;border-radius:12px;background:#fff;padding:6px;box-shadow:0 2px 8px rgba(0,0,0,.3)}"
      + ".padel-cta--presentation .padel-cta__qr img{width:100%;height:100%;display:block;image-rendering:pixelated;image-rendering:crisp-edges}"
      + ".padel-cta--presentation .padel-cta__col{display:flex;flex-direction:column;gap:4px;text-align:left}"
      + ".padel-cta--presentation .padel-cta__head{font-size:clamp(20px,2.4vw,30px);font-weight:800;color:#f1f5f9;line-height:1.1;letter-spacing:.3px}"
      + ".padel-cta--presentation .padel-cta__sub{font-size:clamp(14px,1.4vw,18px);font-weight:600;color:#94a3b8}"
      + ".padel-cta--presentation .padel-cta__url{font-size:clamp(18px,2vw,26px);font-weight:800;color:#C7FF5E;letter-spacing:.2px}"
      + ".padel-cta--spectator .padel-cta__close{flex:0 0 auto;background:none;border:none;cursor:pointer;color:#94a3b8;font-size:20px;line-height:1;padding:4px 2px;margin-left:4px;transition:color .12s ease}"
      + ".padel-cta--spectator .padel-cta__close:hover{color:#f1f5f9}"
      + "@keyframes padel-cta-up{to{transform:translateX(-50%) translateY(0)}}"
      + "@media (max-width:380px){.padel-cta--spectator .padel-cta__txt{font-size:14px}.padel-cta--spectator .padel-cta__btn{font-size:12px;padding:10px 14px}}";
    var s = document.createElement("style");
    s.id = "padel-cta-styles";
    s.textContent = css;
    document.head.appendChild(s);
  }

  var DISMISSED_KEY = "padel-cta-dismissed";

  function mount(opts) {
    opts = opts || {};
    var mode = opts.mode === "presentation" ? "presentation" : "spectator";
    if (mode === "spectator" && sessionStorage.getItem(DISMISSED_KEY)) return;
    var id = "padel-cta-" + mode;
    if (document.getElementById(id)) return;

    var t = STRINGS[detectLang(opts.lang)] || STRINGS.en;
    var appUrl = opts.appUrl || DEFAULT_APP;
    var href = buildHref(appUrl, mode);
    injectStyles();

    var el = document.createElement("div");
    el.id = id;
    el.className = "padel-cta padel-cta--" + mode;

    if (mode === "spectator") {
      el.innerHTML = '<span class="padel-cta__txt"></span><a class="padel-cta__btn" target="_blank" rel="noopener"></a><button class="padel-cta__close" aria-label="Sluiten">&#x2715;</button>';
      el.querySelector(".padel-cta__txt").textContent = t.head;
      var a = el.querySelector(".padel-cta__btn");
      a.textContent = t.btn; a.href = href;
      a.setAttribute("aria-label", t.head + " " + t.btn);
      el.querySelector(".padel-cta__close").onclick = function(){ sessionStorage.setItem(DISMISSED_KEY, "1"); el.style.display = "none"; };
    } else {
      var qr = opts.qrSrc || EMBEDDED_QR;
      el.innerHTML =
        '<a class="padel-cta__qr" href="' + href + '" target="_blank" rel="noopener"><img alt="QR" src="' + qr + '"></a>' +
        '<div class="padel-cta__col"><div class="padel-cta__head"></div>' +
        '<div class="padel-cta__sub"><span class="padel-cta__subtxt"></span> <span class="padel-cta__url">' + SHOWN_DOMAIN + '</span></div></div>';
      el.querySelector(".padel-cta__head").textContent = t.presHead;
      el.querySelector(".padel-cta__subtxt").textContent = t.presSub;
    }

    (opts.container ? document.querySelector(opts.container) : document.body || document.documentElement).appendChild(el);
  }

  function autoMount() {
    if (!SELF) return;
    var mode = SELF.getAttribute("data-mode");
    if (!mode) return;
    mount({
      mode: mode,
      lang: SELF.getAttribute("data-lang") || undefined,
      appUrl: SELF.getAttribute("data-app-url") || undefined,
      qrSrc: SELF.getAttribute("data-qr") || undefined,
      container: SELF.getAttribute("data-container") || undefined
    });
  }

  window.PadelCTA = { mount: mount };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", autoMount);
  else autoMount();
})();
