export async function fetchMetalPricesLive() {
  const results = {};
  try {
    const res = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=gram-silver,tether-gold&vs_currencies=eur&include_24hr_change=true"
    );
    const data = await res.json();

    if (data["tether-gold"]?.eur > 0) {
      const goldPerOz = data["tether-gold"].eur;
      results.XAU = {
        price: goldPerOz / 31.1035,
        change24h: data["tether-gold"].eur_24h_change || 0,
      };
    }

    if (data["gram-silver"]?.eur > 0) {
      results.XAG = {
        price: data["gram-silver"].eur,
        change24h: data["gram-silver"].eur_24h_change || 0,
      };
    }
  } catch (err) {
    console.error("Metal price error:", err);
  }
  return results;
}
