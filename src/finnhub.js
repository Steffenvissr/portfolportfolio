const FINNHUB_KEY = "d6e85v9r01qh94m36120d6e85v9r01qh94m3612g";

const TICKER_MAP = {
  "AAPL": "AAPL",
  "NVDA": "NVDA",
  "ASML": "ASML.AS",
  "MSFT": "MSFT",
  "TSLA": "TSLA",
  "GOOGL": "GOOGL",
  "VWCE": "VWCE.DE",
  "CSPX": "CSPX.L",
};

export async function fetchStockPrices(holdings) {
  const stocks = holdings.filter(h => h.category === "stocks");
  if (!stocks.length) return {};
  
  const results = {};
  
  for (const stock of stocks) {
    const symbol = TICKER_MAP[stock.ticker] || stock.ticker;
    try {
      const res = await fetch(
        `https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${FINNHUB_KEY}`
      );
      const data = await res.json();
      if (data.c && data.c > 0) {
        results[stock.ticker] = {
          price: data.c * 0.92,
          change24h: data.dp || 0,
        };
      }
    } catch (err) {
      console.error(`Finnhub error for ${symbol}:`, err);
    }
  }
  
  return results;
}
