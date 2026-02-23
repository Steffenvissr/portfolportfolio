const RAPID_KEY = "1ddc503dc8msh048f9e0f77cc20bp13365ejsna988e184abd1";
const BASE = "https://pokemon-tcg-api.p.rapidapi.com";
const HEADERS = {
  "x-rapidapi-host": "pokemon-tcg-api.p.rapidapi.com",
  "x-rapidapi-key": RAPID_KEY,
};

export async function fetchPokemonPrices(holdings) {
  const pokemon = holdings.filter(h => h.category === "pokemon");
  if (!pokemon.length) return {};

  const results = {};

  for (const item of pokemon) {
    try {
      const query = encodeURIComponent(item.name);
      const res = await fetch(
        `${BASE}/cards?search=${query}&per_page=5&page=1&sort=relevance`,
        { headers: HEADERS }
      );
      const data = await res.json();

      if (data.data && data.data.length > 0) {
        const card = data.data[0];
        const cmPrice =
          card.prices?.cardmarket?.["30d_average"] ||
          card.prices?.cardmarket?.lowest_near_mint ||
          null;
        if (cmPrice && cmPrice > 0) {
          results[item.ticker] = {
            price: cmPrice,
            change24h: 0,
          };
        }
      }
    } catch (err) {
      console.error(`TCGGO error for ${item.name}:`, err);
    }
  }

  return results;
}
