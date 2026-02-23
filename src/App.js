import { fetchMetalPricesLive } from "./metals";
import { fetchPokemonPrices } from "./tcggo";
import { fetchStockPrices } from "./finnhub";
import { useState, useEffect, useCallback, useMemo } from "react";

// ============================================================
//  PortfolioX — Multi-user Investment Dashboard
//  Deploy op Vercel, ieder z'n eigen URL: /kevin, /mike, etc.
// ============================================================

const CATEGORY_CONFIG = {
  crypto: { label: "Crypto", provider: "OKX", color: "#ff9100", icon: "₿", bg: "rgba(255,145,0,0.1)" },
  stocks: { label: "Aandelen", provider: "TradeRepublic", color: "#448aff", icon: "📈", bg: "rgba(68,138,255,0.1)" },
  metals: { label: "Edelmetalen", provider: "GoldRepublic", color: "#ffd740", icon: "✦", bg: "rgba(255,215,64,0.1)" },
  pokemon: { label: "Pokémon", provider: "TCGGO", color: "#b388ff", icon: "⚡", bg: "rgba(179,136,255,0.1)" },
};

const SAMPLE_HOLDINGS = [
  { id: "s1", name: "Bitcoin", ticker: "bitcoin", category: "crypto", amount: 0.45, unit: "BTC", buyPrice: 38000, currentPrice: null },
  { id: "s2", name: "Ethereum", ticker: "ethereum", category: "crypto", amount: 3.2, unit: "ETH", buyPrice: 2200, currentPrice: null },
  { id: "s3", name: "Solana", ticker: "solana", category: "crypto", amount: 28, unit: "SOL", buyPrice: 85, currentPrice: null },
  { id: "s4", name: "Apple", ticker: "AAPL", category: "stocks", amount: 15, unit: "aandelen", buyPrice: 168, currentPrice: 228 },
  { id: "s5", name: "NVIDIA", ticker: "NVDA", category: "stocks", amount: 8, unit: "aandelen", buyPrice: 450, currentPrice: 138 },
  { id: "s6", name: "ASML", ticker: "ASML", category: "stocks", amount: 5, unit: "aandelen", buyPrice: 620, currentPrice: 710 },
  { id: "s7", name: "Goud", ticker: "XAU", category: "metals", amount: 50, unit: "gram", buyPrice: 58, currentPrice: null },
  { id: "s8", name: "Zilver", ticker: "XAG", category: "metals", amount: 500, unit: "gram", buyPrice: 0.72, currentPrice: null },
  { id: "s9", name: "Charizard 1st Ed.", ticker: "CZD-1ST", category: "pokemon", amount: 1, unit: "kaart", buyPrice: 850, currentPrice: 1850 },
  { id: "s10", name: "Pikachu Illustrator", ticker: "PIK-ILL", category: "pokemon", amount: 1, unit: "kaart", buyPrice: 600, currentPrice: 1200 },
];

// ── Helpers ──────────────────────────────────────────────────
const fmt = (v) => "€" + (v || 0).toLocaleString("nl-NL", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtPct = (v) => (v >= 0 ? "+" : "") + (v || 0).toFixed(2) + "%";
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

// ── Storage keyed per user ──────────────────────────────────
function getUser() {
  const hash = window.location.hash.replace("#", "").replace("/", "");
  return hash || "default";
}

function loadHoldings(user) {
  try {
    const raw = localStorage.getItem(`pfx_${user}_holdings`);
    if (raw) return JSON.parse(raw);
  } catch {}
  return null;
}

function saveHoldings(user, holdings) {
  localStorage.setItem(`pfx_${user}_holdings`, JSON.stringify(holdings));
}

function loadPriceCache() {
  try {
    const raw = localStorage.getItem("pfx_price_cache");
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Date.now() - parsed.timestamp < 5 * 60 * 1000) return parsed.prices;
    }
  } catch {}
  return null;
}

function savePriceCache(prices) {
  localStorage.setItem("pfx_price_cache", JSON.stringify({ prices, timestamp: Date.now() }));
}

// ── Free Price APIs ─────────────────────────────────────────
async function fetchCryptoPrices(tickers) {
  if (!tickers.length) return {};
  try {
    const ids = tickers.join(",");
    const res = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=eur&include_24hr_change=true`);
    const data = await res.json();
    const result = {};
    for (const [id, info] of Object.entries(data)) {
      result[id] = { price: info.eur, change24h: info.eur_24h_change || 0 };
    }
    return result;
  } catch (err) {
    console.error("Crypto price fetch failed:", err);
    return {};
  }
}

async function fetchMetalPrices() {
  // Using a free metals proxy — fallback to hardcoded recent prices
  try {
    const res = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=tether-gold,silver&vs_currencies=eur");
    const data = await res.json();
    // tether-gold ≈ 1 troy oz gold, silver token ≈ not reliable
    // Better: use known conversions
    const goldPerOz = data["tether-gold"]?.eur || 2750;
    const goldPerGram = goldPerOz / 31.1035;
    return {
      XAU: { price: goldPerGram, change24h: 0.3 },
      XAG: { price: goldPerGram / 87, change24h: 0.5 }, // gold/silver ratio ~87
      XPT: { price: goldPerGram * 0.35, change24h: -0.2 },
    };
  } catch {
    return {
      XAU: { price: 88.5, change24h: 0.3 },
      XAG: { price: 1.02, change24h: 0.5 },
      XPT: { price: 31, change24h: -0.2 },
    };
  }
}

async function fetchAllPrices(holdings) {
  const cryptoTickers = [...new Set(holdings.filter(h => h.category === "crypto").map(h => h.ticker))];
  const [cryptoPrices, metalPrices] = await Promise.all([
    fetchCryptoPrices(cryptoTickers),
    fetchMetalPrices(),
  ]);
  return { ...cryptoPrices, ...metalPrices };
}

// ── AI Price Fetch (for stocks & pokemon via Anthropic API) ──
async function fetchAIPrices(holdings) {
  const needAI = holdings.filter(h => h.category === "stocks" || h.category === "pokemon");
  if (!needAI.length) return {};

  try {
    const list = needAI.map(h => `- ${h.name} (${h.ticker}), categorie: ${h.category}`).join("\n");
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1000,
        tools: [{ type: "web_search_20250305", name: "web_search" }],
        messages: [{
          role: "user",
          content: `Zoek actuele prijzen op voor deze assets. Geef ALLEEN een JSON array terug, geen markdown of uitleg.\nFormat: [{"ticker":"AAPL","price":228.50},...]\n\nAandelen: prijs per aandeel in EUR\nPokémon kaarten: geschatte marktwaarde per kaart in EUR\n\n${list}`
        }]
      })
    });
    const data = await res.json();
    const text = data.content?.filter(b => b.type === "text").map(b => b.text).join("") || "";
    const cleaned = text.replace(/```json|```/g, "").trim();
    const prices = JSON.parse(cleaned);
    const result = {};
    if (Array.isArray(prices)) {
      prices.forEach(p => { result[p.ticker] = { price: p.price, change24h: 0 }; });
    }
    return result;
  } catch (err) {
    console.error("AI price fetch failed:", err);
    return {};
  }
}

// ── Chart Components ────────────────────────────────────────
function genChart(points, trend = 1, vol = 0.025, base = 100) {
  const d = []; let v = base;
  for (let i = 0; i < points; i++) { v += (Math.random() - 0.45) * vol * base * trend; v = Math.max(base * 0.3, v); d.push(v); }
  return d;
}

function Spark({ data, color, w = 100, h = 32 }) {
  if (!data?.length) return null;
  const mn = Math.min(...data), mx = Math.max(...data), r = mx - mn || 1;
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * w},${2 + (1 - (v - mn) / r) * (h - 4)}`).join(" ");
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ display: "block" }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function AreaChart({ data, color = "#00e676", h = 240 }) {
  if (!data?.length) return <div style={{ height: h, display: "flex", alignItems: "center", justifyContent: "center", color: "#4a4a5e", fontSize: 14 }}>Geen data beschikbaar</div>;
  const w = 760, p = 20, mn = Math.min(...data), mx = Math.max(...data), rng = mx - mn || 1;
  const pts = data.map((v, i) => ({ x: p + (i / (data.length - 1)) * (w - p * 2), y: p + (1 - (v - mn) / rng) * (h - p * 2) }));
  const d = pts.map((pt, i) => { if (!i) return `M ${pt.x} ${pt.y}`; const prev = pts[i - 1]; const cx = (prev.x + pt.x) / 2; return `C ${cx} ${prev.y}, ${cx} ${pt.y}, ${pt.x} ${pt.y}`; }).join(" ");
  const gridY = [0, .25, .5, .75, 1].map(pct => ({ y: p + pct * (h - p * 2), lbl: "€" + (mx - pct * rng >= 1000 ? ((mx - pct * rng) / 1000).toFixed(1) + "k" : (mx - pct * rng).toFixed(0)) }));

  return (
    <svg viewBox={`0 0 ${w} ${h}`} style={{ width: "100%", height: h }}>
      <defs>
        <linearGradient id="areaG" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity=".12" /><stop offset="100%" stopColor={color} stopOpacity="0" /></linearGradient>
      </defs>
      {gridY.map((g, i) => <g key={i}><line x1={p} y1={g.y} x2={w - p} y2={g.y} stroke="rgba(255,255,255,.04)" /><text x={p - 4} y={g.y + 4} textAnchor="end" fill="#4a4a5e" fontSize="9" fontFamily="monospace">{g.lbl}</text></g>)}
      <path d={`${d} L ${pts.at(-1).x} ${h} L ${pts[0].x} ${h} Z`} fill="url(#areaG)" />
      <path d={d} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <circle cx={pts.at(-1).x} cy={pts.at(-1).y} r="4" fill={color} />
      <circle cx={pts.at(-1).x} cy={pts.at(-1).y} r="8" fill="none" stroke={color} strokeWidth="1.5" opacity=".3" />
    </svg>
  );
}

function Donut({ segments, size = 160 }) {
  const cx = size / 2, cy = size / 2, r = size * .37, sw = size * .1, circ = 2 * Math.PI * r;
  const total = segments.reduce((a, s) => a + s.value, 0);
  let off = 0;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {segments.map((s, i) => { const pct = s.value / total; const dl = pct * circ; const el = <circle key={i} cx={cx} cy={cy} r={r} fill="none" stroke={s.color} strokeWidth={sw} strokeDasharray={`${dl} ${circ - dl}`} strokeDashoffset={-off} transform={`rotate(-90 ${cx} ${cy})`} style={{ transition: "all .5s" }} />; off += dl; return el; })}
      <text x={cx} y={cy - 4} textAnchor="middle" fill="#e8e8ef" fontFamily="monospace" fontSize="14" fontWeight="700">€{(total / 1000).toFixed(1)}k</text>
      <text x={cx} y={cy + 12} textAnchor="middle" fill="#7a7a8e" fontSize="10">Totaal</text>
    </svg>
  );
}

// ── Main App ────────────────────────────────────────────────
export default function App() {
  const [user, setUser] = useState("default");
  const [holdings, setHoldings] = useState([]);
  const [initialized, setInitialized] = useState(false);
  const [tab, setTab] = useState("all");
  const [timeRange, setTimeRange] = useState("1W");
  const [showAdd, setShowAdd] = useState(false);
  const [showDetail, setShowDetail] = useState(null);
  const [showSetup, setShowSetup] = useState(false);
  const [showShare, setShowShare] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [lastRefresh, setLastRefresh] = useState(null);
  const [chartData, setChartData] = useState([]);
  const [detailChartData, setDetailChartData] = useState([]);
  const [newH, setNewH] = useState({ name: "", ticker: "", category: "crypto", amount: "", unit: "", buyPrice: "", currentPrice: "" });
  const [setupName, setSetupName] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [editValues, setEditValues] = useState({});

  // Init: read user from URL hash
  useEffect(() => {
    const u = getUser();
    setUser(u);
    const saved = loadHoldings(u);
    if (saved) {
      setHoldings(saved);
    } else if (u === "default") {
      setShowSetup(true);
    } else {
      // New user from shared link — show empty state with samples option
      setShowSetup(true);
    }
    setInitialized(true);

    const onHash = () => { const nu = getUser(); setUser(nu); const s = loadHoldings(nu); if (s) setHoldings(s); else setShowSetup(true); };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  // Save on change
  useEffect(() => {
    if (initialized && holdings.length > 0) saveHoldings(user, holdings);
  }, [holdings, user, initialized]);

  // Chart data
  const totalVal = useMemo(() => holdings.reduce((a, h) => a + h.amount * (h.currentPrice || h.buyPrice), 0), [holdings]);
  useEffect(() => {
    const pts = { "1D": 24, "1W": 56, "1M": 30, "3M": 90, "1Y": 52, ALL: 120 };
    if (totalVal > 0) setChartData(genChart(pts[timeRange] || 56, 1.06, 0.02, totalVal));
  }, [timeRange, totalVal]);

  // Category totals
  const catTotals = useMemo(() => Object.keys(CATEGORY_CONFIG).map(cat => {
    const items = holdings.filter(h => h.category === cat);
    const val = items.reduce((a, h) => a + h.amount * (h.currentPrice || h.buyPrice), 0);
    const cost = items.reduce((a, h) => a + h.amount * h.buyPrice, 0);
    return { cat, val, cost, pnl: val - cost, pnlPct: cost > 0 ? ((val - cost) / cost) * 100 : 0, n: items.length };
  }), [holdings]);

  const totalCost = holdings.reduce((a, h) => a + h.amount * h.buyPrice, 0);
  const totalPnL = totalVal - totalCost;
  const totalPnLPct = totalCost > 0 ? (totalPnL / totalCost) * 100 : 0;

  const filtered = tab === "all" ? holdings : holdings.filter(h => h.category === tab);
  const sorted = [...filtered].sort((a, b) => (b.amount * (b.currentPrice || b.buyPrice)) - (a.amount * (a.currentPrice || a.buyPrice)));

  // ── Refresh Prices ──────────────────────────
  const refreshPrices = useCallback(async () => {
    setRefreshing(true);
    try {
      // 1. Fetch free API prices (crypto + metals)
      const freePrices = await fetchAllPrices(holdings);
      const metalPricesLive = await fetchMetalPricesLive();
      const stockPrices = await fetchStockPrices(holdings);
      const pokemonPrices = await fetchPokemonPrices(holdings);

      // 2. Fetch AI prices for stocks + pokemon
      const aiPrices = await fetchAIPrices(holdings);

      const allPrices = { ...freePrices, ...metalPricesLive, ...stockPrices, ...pokemonPrices, ...aiPrices };
      savePriceCache(allPrices);

      setHoldings(prev => prev.map(h => {
        const p = allPrices[h.ticker];
        if (p?.price > 0) return { ...h, currentPrice: p.price };
        return h;
      }));
      setLastRefresh(new Date());
    } catch (err) {
      console.error("Price refresh error:", err);
    }
    setRefreshing(false);
  }, [holdings]);

  // Auto-refresh on first load if we have cached prices
  useEffect(() => {
    if (initialized && holdings.length > 0) {
      const cached = loadPriceCache();
      if (cached) {
        setHoldings(prev => prev.map(h => {
          const p = cached[h.ticker];
          if (p?.price > 0 && !h.currentPrice) return { ...h, currentPrice: p.price };
          return h;
        }));
      }
    }
  }, [initialized]);

  // ── Add / Remove / Edit ─────────────────────
  const addHolding = () => {
    if (!newH.name || !newH.amount) return;
    const ticker = newH.ticker || newH.name.toLowerCase().replace(/\s+/g, "-");
    setHoldings(prev => [...prev, {
      id: uid(), name: newH.name, ticker, category: newH.category,
      amount: parseFloat(newH.amount), unit: newH.unit || "stuks",
      buyPrice: parseFloat(newH.buyPrice) || 0,
      currentPrice: parseFloat(newH.currentPrice) || null,
    }]);
    setNewH({ name: "", ticker: "", category: "crypto", amount: "", unit: "", buyPrice: "", currentPrice: "" });
    setShowAdd(false);
  };

  const removeHolding = (id) => setHoldings(prev => prev.filter(h => h.id !== id));

  const startEdit = (h) => {
    setEditingId(h.id);
    setEditValues({ amount: h.amount.toString(), buyPrice: h.buyPrice.toString(), currentPrice: (h.currentPrice || "").toString() });
  };

  const saveEdit = (id) => {
    setHoldings(prev => prev.map(h => h.id === id ? {
      ...h,
      amount: parseFloat(editValues.amount) || h.amount,
      buyPrice: parseFloat(editValues.buyPrice) || h.buyPrice,
      currentPrice: editValues.currentPrice ? parseFloat(editValues.currentPrice) : h.currentPrice,
    } : h));
    setEditingId(null);
  };

  const setupUser = (useSamples) => {
    const name = setupName.trim().toLowerCase().replace(/[^a-z0-9]/g, "") || "default";
    if (name !== "default") window.location.hash = name;
    setUser(name);
    if (useSamples) {
      setHoldings(SAMPLE_HOLDINGS);
      saveHoldings(name, SAMPLE_HOLDINGS);
    } else {
      setHoldings([]);
    }
    setShowSetup(false);
  };

  const openDetail = (h) => {
    const val = h.amount * (h.currentPrice || h.buyPrice);
    setDetailChartData(genChart(56, (h.currentPrice || h.buyPrice) > h.buyPrice ? 1.12 : 0.88, 0.035, val));
    setShowDetail(h);
  };

  const shareUrl = typeof window !== "undefined" ? window.location.origin + window.location.pathname + "#" : "";

  // ── Styles ────────────────────────────────────
  const S = {
    app: { display: "flex", minHeight: "100vh", background: "#0a0a0f", color: "#e8e8ef", fontFamily: "'DM Sans', system-ui, sans-serif" },
    sidebar: { width: 232, background: "#111118", borderRight: "1px solid #1a1a28", padding: "20px 14px", display: "flex", flexDirection: "column", position: "sticky", top: 0, height: "100vh", flexShrink: 0, overflowY: "auto" },
    main: { flex: 1, padding: "28px 32px", overflowY: "auto", maxHeight: "100vh" },
    card: { background: "#14141d", border: "1px solid #1c1c2c", borderRadius: 12, padding: 20, marginBottom: 14 },
    btn: { padding: "9px 15px", borderRadius: 8, border: "1px solid #1c1c2c", background: "#14141d", color: "#e8e8ef", fontSize: 13, fontWeight: 500, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 6, fontFamily: "inherit", transition: "all .15s" },
    btnG: { background: "#00e676", color: "#000", border: "none", fontWeight: 600 },
    inp: { padding: "9px 12px", borderRadius: 8, border: "1px solid #1c1c2c", background: "#0a0a0f", color: "#e8e8ef", fontSize: 13, fontFamily: "inherit", width: "100%", outline: "none", transition: "border .15s" },
    sel: { padding: "9px 12px", borderRadius: 8, border: "1px solid #1c1c2c", background: "#0a0a0f", color: "#e8e8ef", fontSize: 13, fontFamily: "inherit", width: "100%", outline: "none" },
    ov: { position: "fixed", inset: 0, background: "rgba(0,0,0,.75)", backdropFilter: "blur(8px)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center" },
    modal: { background: "#14141d", border: "1px solid #1c1c2c", borderRadius: 16, width: "92%", maxWidth: 560, padding: 28, maxHeight: "90vh", overflowY: "auto" },
    close: { width: 34, height: 34, borderRadius: 8, border: "1px solid #1c1c2c", background: "#111118", color: "#7a7a8e", cursor: "pointer", fontSize: 18, display: "flex", alignItems: "center", justifyContent: "center" },
    navI: (active, color) => ({ display: "flex", alignItems: "center", gap: 9, padding: "9px 11px", borderRadius: 8, cursor: "pointer", fontSize: 13, fontWeight: 500, background: active ? (color ? `${color}15` : "rgba(0,230,118,.1)") : "transparent", color: active ? (color || "#00e676") : "#6a6a7e", transition: "all .15s", userSelect: "none" }),
    badge: (color) => ({ fontSize: 10, padding: "2px 7px", borderRadius: 8, background: `${color}18`, color, fontWeight: 600 }),
  };

  // ── Setup Modal ────────────────────────────────
  if (showSetup) return (
    <div style={{ ...S.ov, background: "#0a0a0f" }}>
      <div style={{ ...S.modal, maxWidth: 440, textAlign: "center" }}>
        <div style={{ width: 56, height: 56, background: "linear-gradient(135deg, #00e676, #448aff)", borderRadius: 14, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 24, color: "#000", margin: "0 auto 20px" }}>P</div>
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: "0 0 6px" }}>Welkom bij PortfolioX</h1>
        <p style={{ color: "#7a7a8e", fontSize: 14, margin: "0 0 24px" }}>Al je investeringen op één plek</p>
        <div style={{ marginBottom: 20 }}>
          <label style={{ fontSize: 12, color: "#7a7a8e", display: "block", marginBottom: 6, textAlign: "left" }}>Jouw naam (wordt je persoonlijke URL)</label>
          <input style={S.inp} placeholder="bijv. kevin" value={setupName} onChange={e => setSetupName(e.target.value)} onKeyDown={e => e.key === "Enter" && setupUser(false)} autoFocus />
          {setupName && <p style={{ fontSize: 12, color: "#4a4a5e", margin: "6px 0 0", textAlign: "left" }}>Je URL wordt: <span style={{ color: "#00e676", fontFamily: "monospace" }}>{shareUrl}{setupName.toLowerCase().replace(/[^a-z0-9]/g, "")}</span></p>}
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <button style={{ ...S.btn, ...S.btnG, flex: 1, justifyContent: "center", padding: 12 }} onClick={() => setupUser(false)}>Start met leeg portfolio</button>
          <button style={{ ...S.btn, flex: 1, justifyContent: "center", padding: 12 }} onClick={() => setupUser(true)}>Laad voorbeelddata</button>
        </div>
      </div>
    </div>
  );

  return (
    <div style={S.app}>
      {/* ── Sidebar ── */}
      <aside style={S.sidebar}>
        <div style={{ display: "flex", alignItems: "center", gap: 9, paddingBottom: 20, borderBottom: "1px solid #1a1a28", marginBottom: 20 }}>
          <div style={{ width: 32, height: 32, background: "linear-gradient(135deg, #00e676, #448aff)", borderRadius: 9, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 14, color: "#000" }}>P</div>
          <span style={{ fontWeight: 700, fontSize: 16, letterSpacing: -.5 }}>PortfolioX</span>
          <span style={{ marginLeft: "auto", fontSize: 11, padding: "3px 8px", borderRadius: 6, background: "rgba(0,230,118,.1)", color: "#00e676", fontWeight: 600 }}>{user}</span>
        </div>

        <div style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: 1.2, color: "#4a4a5e", padding: "0 11px", marginBottom: 6 }}>Overzicht</div>
        <div style={S.navI(tab === "all")} onClick={() => setTab("all")}>📊 Dashboard</div>

        <div style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: 1.2, color: "#4a4a5e", padding: "0 11px", margin: "16px 0 6px" }}>Categorieën</div>
        {Object.entries(CATEGORY_CONFIG).map(([k, c]) => (
          <div key={k} style={S.navI(tab === k, c.color)} onClick={() => setTab(k)}>
            <span>{c.icon}</span>
            <span style={{ flex: 1 }}>{c.provider}</span>
            <span style={S.badge(c.color)}>{holdings.filter(h => h.category === k).length}</span>
          </div>
        ))}

        <div style={{ fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: 1.2, color: "#4a4a5e", padding: "0 11px", margin: "16px 0 6px" }}>Acties</div>
        <div style={S.navI(false)} onClick={() => setShowAdd(true)}>➕ Toevoegen</div>
        <div style={S.navI(false)} onClick={() => setShowShare(true)}>🔗 Delen</div>

        <div style={{ marginTop: "auto", paddingTop: 14, borderTop: "1px solid #1a1a28" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 11, color: "#5a5a6e" }}>
            <div style={{ width: 7, height: 7, borderRadius: "50%", background: refreshing ? "#ffd740" : "#00e676" }} />
            {lastRefresh ? `${lastRefresh.toLocaleTimeString("nl-NL")}` : "Nog niet bijgewerkt"}
          </div>
        </div>
      </aside>

      {/* ── Main ── */}
      <main style={S.main}>
        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 28, flexWrap: "wrap", gap: 12 }}>
          <div>
            <h1 style={{ fontSize: 26, fontWeight: 700, letterSpacing: -.5, margin: 0 }}>
              {tab === "all" ? "Portfolio Dashboard" : `${CATEGORY_CONFIG[tab]?.label} — ${CATEGORY_CONFIG[tab]?.provider}`}
            </h1>
            <p style={{ color: "#6a6a7e", fontSize: 13, margin: "4px 0 0" }}>
              {user !== "default" ? `${user}'s portfolio` : "Persoonlijk portfolio"} — {holdings.length} investeringen
            </p>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button style={S.btn} onClick={refreshPrices} disabled={refreshing}>
              {refreshing ? "⏳ Ophalen..." : "🔄 Live prijzen"}
            </button>
            <button style={{ ...S.btn, ...S.btnG }} onClick={() => setShowAdd(true)}>+ Toevoegen</button>
          </div>
        </div>

        {/* Empty State */}
        {holdings.length === 0 ? (
          <div style={{ ...S.card, padding: 60, textAlign: "center" }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>📊</div>
            <h2 style={{ fontSize: 20, fontWeight: 700, margin: "0 0 8px" }}>Je portfolio is nog leeg</h2>
            <p style={{ color: "#6a6a7e", fontSize: 14, margin: "0 0 24px" }}>Voeg je eerste investering toe om te beginnen.</p>
            <button style={{ ...S.btn, ...S.btnG, padding: "12px 24px", fontSize: 15 }} onClick={() => setShowAdd(true)}>+ Eerste investering toevoegen</button>
          </div>
        ) : (
          <>
            {/* Total Value Card */}
            <div style={{ ...S.card, padding: 28, position: "relative", overflow: "hidden" }}>
              <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 1, background: "linear-gradient(90deg, transparent, #00e676, transparent)" }} />
              <div style={{ fontSize: 12, color: "#6a6a7e", fontWeight: 500, marginBottom: 6 }}>Totale Portfoliowaarde</div>
              <div style={{ fontSize: 42, fontWeight: 700, letterSpacing: -2, fontFamily: "monospace", marginBottom: 8 }}>{fmt(totalVal)}</div>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "3px 10px", borderRadius: 16, fontSize: 13, fontWeight: 600, background: totalPnL >= 0 ? "rgba(0,230,118,.1)" : "rgba(255,82,82,.1)", color: totalPnL >= 0 ? "#00e676" : "#ff5252" }}>
                {totalPnL >= 0 ? "↗" : "↘"} {fmt(Math.abs(totalPnL))} ({fmtPct(totalPnLPct)})
              </span>
              <div style={{ display: "flex", gap: 3, margin: "20px 0 12px" }}>
                {Object.entries({ "1D": "24U", "1W": "1W", "1M": "1M", "3M": "3M", "1Y": "1J", ALL: "Alles" }).map(([k, l]) => (
                  <button key={k} onClick={() => setTimeRange(k)} style={{ padding: "5px 12px", borderRadius: 6, border: "none", cursor: "pointer", fontSize: 11, fontWeight: 600, fontFamily: "inherit", background: timeRange === k ? "rgba(0,230,118,.1)" : "transparent", color: timeRange === k ? "#00e676" : "#5a5a6e" }}>{l}</button>
                ))}
              </div>
              <AreaChart data={chartData} h={220} />
            </div>

            {/* Category Cards */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 14 }}>
              {catTotals.filter(ct => ct.n > 0).map(ct => {
                const c = CATEGORY_CONFIG[ct.cat];
                return (
                  <div key={ct.cat} style={{ ...S.card, padding: 16, cursor: "pointer", transition: "all .15s" }} onClick={() => setTab(ct.cat)}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                      <div style={{ width: 34, height: 34, borderRadius: 9, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, background: c.bg, color: c.color }}>{c.icon}</div>
                      <span style={{ fontSize: 12, fontWeight: 600, color: ct.pnl >= 0 ? "#00e676" : "#ff5252" }}>{fmtPct(ct.pnlPct)}</span>
                    </div>
                    <div style={{ fontSize: 12, color: "#6a6a7e", marginBottom: 3 }}>{c.label}</div>
                    <div style={{ fontSize: 19, fontWeight: 700, fontFamily: "monospace", letterSpacing: -.5 }}>{fmt(ct.val)}</div>
                    <div style={{ fontSize: 10, color: "#4a4a5e", marginTop: 2 }}>{ct.n} positie{ct.n !== 1 ? "s" : ""}</div>
                    <div style={{ height: 3, borderRadius: 2, background: "#1c1c2c", marginTop: 10, overflow: "hidden" }}>
                      <div style={{ height: "100%", borderRadius: 2, background: c.color, width: `${totalVal > 0 ? (ct.val / totalVal) * 100 : 0}%`, transition: "width .5s" }} />
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Holdings Table + Donut */}
            <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr", gap: 14, marginBottom: 14 }}>
              <div style={{ ...S.card, padding: 0, overflow: "hidden" }}>
                {/* Tabs */}
                <div style={{ display: "flex", borderBottom: "1px solid #1c1c2c", padding: "0 4px", overflowX: "auto" }}>
                  {[{ k: "all", l: "Alles" }, ...Object.entries(CATEGORY_CONFIG).map(([k, v]) => ({ k, l: v.label }))].map(t => (
                    <button key={t.k} onClick={() => setTab(t.k)} style={{ padding: "12px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer", border: "none", background: "none", fontFamily: "inherit", color: tab === t.k ? "#00e676" : "#5a5a6e", borderBottom: tab === t.k ? "2px solid #00e676" : "2px solid transparent", whiteSpace: "nowrap" }}>{t.l}</button>
                  ))}
                </div>
                {/* Table */}
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>{["Asset", "Waarde", "P&L", "Grafiek", ""].map((h, i) => <th key={i} style={{ textAlign: "left", padding: "10px 16px", fontSize: 10, fontWeight: 600, textTransform: "uppercase", letterSpacing: 1, color: "#4a4a5e", borderBottom: "1px solid #1c1c2c" }}>{h}</th>)}</tr>
                  </thead>
                  <tbody>
                    {sorted.map(h => {
                      const price = h.currentPrice || h.buyPrice;
                      const val = h.amount * price;
                      const pnl = h.buyPrice > 0 ? ((price - h.buyPrice) / h.buyPrice) * 100 : 0;
                      const c = CATEGORY_CONFIG[h.category];
                      const isEditing = editingId === h.id;

                      return (
                        <tr key={h.id} style={{ cursor: "pointer" }} onClick={() => !isEditing && openDetail(h)}>
                          <td style={{ padding: "12px 16px", borderBottom: "1px solid #1c1c2c" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                              <div style={{ width: 30, height: 30, borderRadius: 7, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 700, background: c.bg, color: c.color, flexShrink: 0 }}>{h.ticker.slice(0, 2).toUpperCase()}</div>
                              <div>
                                <div style={{ fontWeight: 600, fontSize: 13 }}>{h.name}</div>
                                <div style={{ fontSize: 11, color: "#5a5a6e" }}>{h.amount} {h.unit}</div>
                              </div>
                            </div>
                          </td>
                          <td style={{ padding: "12px 16px", borderBottom: "1px solid #1c1c2c", fontFamily: "monospace", fontWeight: 600, fontSize: 13 }}>
                            {fmt(val)}
                            {!h.currentPrice && <span style={{ fontSize: 10, color: "#4a4a5e", display: "block" }}>aankoopprijs</span>}
                          </td>
                          <td style={{ padding: "12px 16px", borderBottom: "1px solid #1c1c2c" }}>
                            <span style={{ fontSize: 12, fontWeight: 600, color: pnl >= 0 ? "#00e676" : "#ff5252" }}>{fmtPct(pnl)}</span>
                          </td>
                          <td style={{ padding: "12px 16px", borderBottom: "1px solid #1c1c2c" }}>
                            <Spark data={genChart(20, pnl >= 0 ? 1.1 : .9, .04)} color={pnl >= 0 ? "#00e676" : "#ff5252"} w={70} h={26} />
                          </td>
                          <td style={{ padding: "12px 16px", borderBottom: "1px solid #1c1c2c" }}>
                            <div style={{ display: "flex", gap: 4 }}>
                              <button onClick={e => { e.stopPropagation(); startEdit(h); }} style={{ background: "none", border: "none", color: "#4a4a5e", cursor: "pointer", fontSize: 12, padding: 3 }} title="Bewerken">✏️</button>
                              <button onClick={e => { e.stopPropagation(); removeHolding(h.id); }} style={{ background: "none", border: "none", color: "#4a4a5e", cursor: "pointer", fontSize: 12, padding: 3 }} title="Verwijderen">✕</button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Donut */}
              <div style={S.card}>
                <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 18 }}>Verdeling</div>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 20 }}>
                  <Donut segments={catTotals.filter(c => c.val > 0).map(c => ({ value: c.val, color: CATEGORY_CONFIG[c.cat].color }))} />
                  <div style={{ width: "100%", display: "flex", flexDirection: "column", gap: 10 }}>
                    {catTotals.filter(c => c.val > 0).map(ct => (
                      <div key={ct.cat} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                        <div style={{ width: 9, height: 9, borderRadius: 2, background: CATEGORY_CONFIG[ct.cat].color, flexShrink: 0 }} />
                        <span style={{ color: "#6a6a7e", flex: 1 }}>{CATEGORY_CONFIG[ct.cat].label}</span>
                        <span style={{ fontWeight: 600, fontFamily: "monospace" }}>{fmt(ct.val)}</span>
                        <span style={{ color: "#4a4a5e", fontSize: 11 }}>{totalVal > 0 ? ((ct.val / totalVal) * 100).toFixed(1) : 0}%</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* How it works */}
            <div style={{ ...S.card, background: "rgba(68,138,255,.04)", borderColor: "rgba(68,138,255,.15)", display: "flex", alignItems: "flex-start", gap: 14 }}>
              <span style={{ fontSize: 22, flexShrink: 0 }}>💡</span>
              <div>
                <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 3 }}>Hoe werkt het?</div>
                <div style={{ fontSize: 12, color: "#6a6a7e", lineHeight: 1.7 }}>
                  Voeg investeringen toe met de "+" knop. Klik "Live prijzen" om actuele marktprijzen op te halen via CoinGecko (crypto/metalen) en AI (aandelen/pokémon).
                  Deel je URL met vrienden zodat zij ook hun eigen portfolio kunnen maken. Klik op een rij voor details.
                </div>
              </div>
            </div>
          </>
        )}
      </main>

      {/* ── Add Modal ── */}
      {showAdd && (
        <div style={S.ov} onClick={() => setShowAdd(false)}>
          <div style={S.modal} onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 22 }}>
              <h2 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>Investering Toevoegen</h2>
              <button style={S.close} onClick={() => setShowAdd(false)}>✕</button>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
              <div><label style={{ fontSize: 11, color: "#5a5a6e", display: "block", marginBottom: 3 }}>Naam *</label><input style={S.inp} placeholder="bijv. Bitcoin" value={newH.name} onChange={e => setNewH(p => ({ ...p, name: e.target.value }))} autoFocus /></div>
              <div><label style={{ fontSize: 11, color: "#5a5a6e", display: "block", marginBottom: 3 }}>Ticker / ID</label><input style={S.inp} placeholder="bijv. bitcoin (CoinGecko ID)" value={newH.ticker} onChange={e => setNewH(p => ({ ...p, ticker: e.target.value }))} /><div style={{ fontSize: 10, color: "#3a3a4e", marginTop: 2 }}>Crypto: gebruik CoinGecko ID (bitcoin, ethereum, solana)</div></div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
              <div><label style={{ fontSize: 11, color: "#5a5a6e", display: "block", marginBottom: 3 }}>Categorie</label>
                <select style={S.sel} value={newH.category} onChange={e => setNewH(p => ({ ...p, category: e.target.value }))}>
                  {Object.entries(CATEGORY_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.icon} {v.label} — {v.provider}</option>)}
                </select>
              </div>
              <div><label style={{ fontSize: 11, color: "#5a5a6e", display: "block", marginBottom: 3 }}>Eenheid</label><input style={S.inp} placeholder="bijv. BTC / gram / kaart / aandelen" value={newH.unit} onChange={e => setNewH(p => ({ ...p, unit: e.target.value }))} /></div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 22 }}>
              <div><label style={{ fontSize: 11, color: "#5a5a6e", display: "block", marginBottom: 3 }}>Aantal *</label><input style={S.inp} type="number" step="any" placeholder="0.45" value={newH.amount} onChange={e => setNewH(p => ({ ...p, amount: e.target.value }))} /></div>
              <div><label style={{ fontSize: 11, color: "#5a5a6e", display: "block", marginBottom: 3 }}>Aankoopprijs €/eenheid</label><input style={S.inp} type="number" step="any" placeholder="38000" value={newH.buyPrice} onChange={e => setNewH(p => ({ ...p, buyPrice: e.target.value }))} /></div>
              <div><label style={{ fontSize: 11, color: "#5a5a6e", display: "block", marginBottom: 3 }}>Huidige prijs €/eenheid</label><input style={S.inp} type="number" step="any" placeholder="Leeg = ophalen" value={newH.currentPrice} onChange={e => setNewH(p => ({ ...p, currentPrice: e.target.value }))} /></div>
            </div>
            <button onClick={addHolding} style={{ ...S.btn, ...S.btnG, width: "100%", justifyContent: "center", padding: 12, fontSize: 14 }}>✓ Toevoegen aan Portfolio</button>
          </div>
        </div>
      )}

      {/* ── Edit Modal ── */}
      {editingId && (
        <div style={S.ov} onClick={() => setEditingId(null)}>
          <div style={{ ...S.modal, maxWidth: 420 }} onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <h2 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>Bewerken</h2>
              <button style={S.close} onClick={() => setEditingId(null)}>✕</button>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 20 }}>
              <div><label style={{ fontSize: 11, color: "#5a5a6e", display: "block", marginBottom: 3 }}>Aantal</label><input style={S.inp} type="number" step="any" value={editValues.amount} onChange={e => setEditValues(p => ({ ...p, amount: e.target.value }))} /></div>
              <div><label style={{ fontSize: 11, color: "#5a5a6e", display: "block", marginBottom: 3 }}>Aankoopprijs €/eenheid</label><input style={S.inp} type="number" step="any" value={editValues.buyPrice} onChange={e => setEditValues(p => ({ ...p, buyPrice: e.target.value }))} /></div>
              <div><label style={{ fontSize: 11, color: "#5a5a6e", display: "block", marginBottom: 3 }}>Huidige prijs €/eenheid</label><input style={S.inp} type="number" step="any" value={editValues.currentPrice} onChange={e => setEditValues(p => ({ ...p, currentPrice: e.target.value }))} /></div>
            </div>
            <button onClick={() => saveEdit(editingId)} style={{ ...S.btn, ...S.btnG, width: "100%", justifyContent: "center", padding: 12 }}>💾 Opslaan</button>
          </div>
        </div>
      )}

      {/* ── Detail Modal ── */}
      {showDetail && (
        <div style={S.ov} onClick={() => setShowDetail(null)}>
          <div style={{ ...S.modal, maxWidth: 680 }} onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
              <div>
                <h2 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>{showDetail.name}</h2>
                <div style={{ color: "#6a6a7e", fontSize: 13, marginTop: 3 }}>{CATEGORY_CONFIG[showDetail.category].provider} — {showDetail.ticker}</div>
              </div>
              <button style={S.close} onClick={() => setShowDetail(null)}>✕</button>
            </div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 16 }}>
              <span style={{ fontSize: 32, fontWeight: 700, fontFamily: "monospace" }}>{fmt(showDetail.amount * (showDetail.currentPrice || showDetail.buyPrice))}</span>
              {(() => { const p = showDetail.buyPrice > 0 ? ((showDetail.currentPrice || showDetail.buyPrice) - showDetail.buyPrice) / showDetail.buyPrice * 100 : 0; return <span style={{ padding: "3px 10px", borderRadius: 14, fontSize: 13, fontWeight: 600, background: p >= 0 ? "rgba(0,230,118,.1)" : "rgba(255,82,82,.1)", color: p >= 0 ? "#00e676" : "#ff5252" }}>{fmtPct(p)}</span>; })()}
            </div>
            <AreaChart data={detailChartData} color={CATEGORY_CONFIG[showDetail.category].color} h={200} />
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, marginTop: 18, paddingTop: 18, borderTop: "1px solid #1c1c2c" }}>
              {[
                ["Aantal", `${showDetail.amount} ${showDetail.unit}`],
                ["Prijs/eenheid", fmt(showDetail.currentPrice || showDetail.buyPrice)],
                ["Aankoopprijs", fmt(showDetail.buyPrice)],
                ["Winst/Verlies", fmt(showDetail.amount * ((showDetail.currentPrice || showDetail.buyPrice) - showDetail.buyPrice))],
              ].map(([l, v], i) => (
                <div key={i}>
                  <div style={{ fontSize: 10, color: "#4a4a5e", textTransform: "uppercase", letterSpacing: .5, marginBottom: 3 }}>{l}</div>
                  <div style={{ fontSize: 14, fontWeight: 600, fontFamily: i > 0 ? "monospace" : "inherit" }}>{v}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Share Modal ── */}
      {showShare && (
        <div style={S.ov} onClick={() => setShowShare(false)}>
          <div style={{ ...S.modal, maxWidth: 480 }} onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <h2 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>Delen met Vrienden</h2>
              <button style={S.close} onClick={() => setShowShare(false)}>✕</button>
            </div>
            <p style={{ fontSize: 13, color: "#6a6a7e", margin: "0 0 16px", lineHeight: 1.7 }}>
              Elke vriend krijgt z'n eigen URL. Ze openen de link, kiezen een naam, en kunnen meteen hun eigen portfolio beheren. Alle data wordt lokaal in hun browser opgeslagen.
            </p>
            <div style={{ background: "#0a0a0f", border: "1px solid #1c1c2c", borderRadius: 8, padding: 14, marginBottom: 12, display: "flex", alignItems: "center", gap: 10 }}>
              <code style={{ flex: 1, fontSize: 13, color: "#00e676", wordBreak: "break-all" }}>
                {typeof window !== "undefined" ? window.location.origin + window.location.pathname : "https://jouw-app.vercel.app/"}
              </code>
              <button style={{ ...S.btn, padding: "6px 12px", fontSize: 12 }} onClick={() => { navigator.clipboard?.writeText(window.location.origin + window.location.pathname); }}>📋 Kopieer</button>
            </div>
            <p style={{ fontSize: 12, color: "#4a4a5e", margin: 0 }}>
              💡 Tip: stuur de link naar je vrienden. Ze kiezen dan hun eigen naam (bijv. #kevin) en hun portfolio wordt apart opgeslagen in hun browser.
            </p>
          </div>
        </div>
      )}

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        ::-webkit-scrollbar { width: 5px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #1c1c2c; border-radius: 3px; }
        tr:hover td { background: rgba(255,255,255,.02) !important; }
        button:hover { filter: brightness(1.08); }
        input:focus, select:focus { border-color: #448aff !important; }
        @media (max-width: 900px) {
          .pfx-grid4 { grid-template-columns: 1fr 1fr !important; }
          .pfx-grid2 { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  );
}
