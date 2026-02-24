const JSONBIN_KEY = "$2a$10$WxyV1ltcWe62YGSkHMhgyujCkEa6UAdt56afNvbRLOqtg0LHKiNIC";
const BASE = "https://api.jsonbin.io/v3";

function getBinId(user) {
  try { return localStorage.getItem("pfx_" + user + "_binId"); } catch { return null; }
}
function setBinId(user, id) {
  try { localStorage.setItem("pfx_" + user + "_binId", id); } catch {}
}

export async function cloudSave(user, holdings) {
  try {
    let binId = getBinId(user);
    if (!binId) {
      const res = await fetch(BASE + "/b", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Master-Key": JSONBIN_KEY, "X-Bin-Name": "pfx_" + user },
        body: JSON.stringify({ user: user, holdings: holdings, t: Date.now() }),
      });
      const data = await res.json();
      if (data.metadata && data.metadata.id) setBinId(user, data.metadata.id);
      return;
    }
    await fetch(BASE + "/b/" + binId, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "X-Master-Key": JSONBIN_KEY },
      body: JSON.stringify({ user: user, holdings: holdings, t: Date.now() }),
    });
  } catch (err) { console.error("Cloud save error:", err); }
}

export async function cloudLoad(user) {
  try {
    var binId = getBinId(user);
    if (!binId) {
      var res = await fetch(BASE + "/c/uncategorized/bins", {
        headers: { "X-Master-Key": JSONBIN_KEY },
      });
      var bins = await res.json();
      if (Array.isArray(bins)) {
        var match = bins.find(function(b) { return b.snippetMeta && b.snippetMeta.name === "pfx_" + user; });
        if (match) { binId = match.id; setBinId(user, binId); }
      }
      if (!binId) return null;
    }
    var r = await fetch(BASE + "/b/" + binId + "/latest", {
      headers: { "X-Master-Key": JSONBIN_KEY },
    });
    var data = await r.json();
    if (data.record && data.record.holdings) return data.record.holdings;
  } catch (err) { console.error("Cloud load error:", err); }
  return null;
}
