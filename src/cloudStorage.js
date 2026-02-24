const JSONBIN_KEY = "$2a$10$WxyV1ltcWe62YGSkHMhgyujCkEa6UAdt56afNvbRLOqtg0LHKiNIC";
const BASE = "https://api.jsonbin.io/v3";
const BIN_ID = "699d52ca43b1c97be998c11d";

export async function cloudSave(user, holdings) {
  try {
    const res = await fetch(BASE + "/b/" + BIN_ID, {
      method: "GET",
      headers: { "X-Master-Key": JSONBIN_KEY },
    });
    const existing = await res.json();
    var allData = (existing.record && typeof existing.record === "object") ? existing.record : {};
    allData[user] = { holdings: holdings, t: Date.now() };
    await fetch(BASE + "/b/" + BIN_ID, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "X-Master-Key": JSONBIN_KEY },
      body: JSON.stringify(allData),
    });
    console.log("Cloud save OK for " + user);
  } catch (err) { console.error("Cloud save error:", err); }
}

export async function cloudLoad(user) {
  try {
    const res = await fetch(BASE + "/b/" + BIN_ID + "/latest", {
      headers: { "X-Master-Key": JSONBIN_KEY },
    });
    const data = await res.json();
    if (data.record && data.record[user] && data.record[user].holdings) {
      console.log("Cloud load OK for " + user);
      return data.record[user].holdings;
    }
  } catch (err) { console.error("Cloud load error:", err); }
  return null;
}
