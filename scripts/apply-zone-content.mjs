/**
 * Apply expanded zone content: for each zone, optionally replace a text snippet
 * (e.g. swap the one-line Raising note for a full Team-notes paragraph) and
 * inject callout HTML before the zone's </div><aside. Idempotent-ish: injection
 * only runs if the zone body doesn't already contain the first callout's marker
 * text. Input JSON: [{zone, replace?:[old,new], inject?:"<html>"}]
 *
 *   node scripts/apply-zone-content.mjs <content.json>
 */
import { readFileSync, writeFileSync } from "node:fs";
const items = JSON.parse(readFileSync(process.argv[2], "utf8"));
let h = readFileSync("heart-and-soul-guide.html", "utf8");
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
let repl = 0, inj = 0;
const problems = [];
for (const it of items) {
  const zi = h.indexOf('<h4 class="zone-name">' + it.zone + "</h4>");
  if (zi < 0) { problems.push("MISSING zone: " + it.zone); continue; }
  if (it.replace) {
    const [oldT, newT] = it.replace;
    if (!h.includes(oldT)) { problems.push("replace text not found in " + it.zone); }
    else { h = h.replace(oldT, newT); repl++; }
  }
  if (it.inject) {
    const at = h.indexOf("</div><aside", zi);
    if (at < 0) { problems.push("no aside for " + it.zone); continue; }
    // guard: skip if this exact inject block already present just before aside
    const sig = it.inject.slice(0, 40);
    if (h.slice(zi, at).includes(sig)) { problems.push("inject already present in " + it.zone); continue; }
    h = h.slice(0, at) + it.inject + h.slice(at);
    inj++;
  }
}
// normalize any accidental double-close
h = h.replace(/<\/p><\/p>/g, "</p>");
writeFileSync("heart-and-soul-guide.html", h);
const o = (h.match(/<div\b/g) || []).length, c = (h.match(/<\/div>/g) || []).length;
console.log(`replaced ${repl}, injected ${inj} | div ${o}/${c} ${o === c ? "OK" : "MISMATCH ⚠"}`);
if (problems.length) console.log("NOTES:\n  " + problems.join("\n  "));
