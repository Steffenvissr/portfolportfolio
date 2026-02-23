const GOLD_API_KEY = "goldapi-53o5smlznj5hw-io";
const BASE = "https://www.goldapi.io/api";
const HEADERS = {
  "x-access-token": GOLD_API_KEY,
  "Content-Type": "application/json",
};

export async function fetchMetalPricesLive() {
  const results = {};

  try {
    const [goldRes, silverRes] = await Promise.all([
      fetch(`${BASE}/XAU/EUR`, { headers: HEADERS }),
      fetch(`${BASE}/XAG/EUR`, { headers: HEADERS }),
    ]);

    const gold = await goldRes.json();
    const silver = await silverRes.json();

    if (gold.price_gram_24k > 0) {
      results.XAU = {
        price: gold.price_gram_24k,
        change24h: gold.chp || 0,
      };
    }

    if (silver.price_gram_24k > 0) {
      results.XAG = {
        price: silver.price_gram_24k,
        change24h: silver.chp || 0,
      };
    }
  } catch (err) {
    console.error("GoldAPI error:", err);
  }

  return results;
}
