"use strict";
// ================= Stato =================
const REGOLE_DEFAULT = { kgQuarto: 1, tetto: 5, fattoreVincitore: 0.5, minimoVincitore: 1, arrotondamento: 1 };
const BACKUP_DEFAULT = { giorni: 1, conserva: 30, dir: "" };
const ELENCHI_DEFAULT = {
  razze: ["Purosangue inglese", "Anglo-arabo", "Trottatore", "Arabo"],
  finimenti: ["Paraocchi", "Paraocchi australiani", "Paraorecchie", "Cappuccio", "Visiera", "Lingua legata"],
};
let S = nuovoArchivio();
let view = "classifica";
let dataRif = oggi();

function nuovoArchivio() {
  return { versione: 1, cavalli: {}, corse: {}, classi: {}, rettifiche: {},
    impostazioni: { regole: { ...REGOLE_DEFAULT }, backup: { ...BACKUP_DEFAULT }, elenchi: structuredClone(ELENCHI_DEFAULT) } };
}
function normalizza(d) {
  const b = nuovoArchivio();
  const out = { ...b, ...d };
  out.impostazioni = {
    regole: { ...REGOLE_DEFAULT, ...(d.impostazioni?.regole || d.regole || {}) },
    backup: { ...BACKUP_DEFAULT, ...(d.impostazioni?.backup || {}) },
    elenchi: { ...structuredClone(ELENCHI_DEFAULT), ...(d.impostazioni?.elenchi || {}) },
  };
  delete out.regole;
  return out;
}
const R = () => S.impostazioni.regole;
const haManuale = v => v !== "" && v !== null && v !== undefined && Number.isFinite(Number(v));

// ================= Utilità =================
function oggi() { const d = new Date(); return new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); }
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtData = d => d ? new Date(d + "T12:00:00").toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit", year: "numeric" }) : "";
const fmtDataOra = iso => iso ? new Date(iso).toLocaleString("it-IT", { dateStyle: "short", timeStyle: "short" }) : "mai";
const tondo = n => Math.round(n * 100) / 100;
const fmtN = n => tondo(n).toLocaleString("it-IT");
const segno = n => n > 0 ? "+" + fmtN(n) : fmtN(n);
const cls = n => n > 0 ? "up" : n < 0 ? "down" : "";
function toast(msg) { const t = document.getElementById("toast"); t.textContent = msg; t.classList.add("show"); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove("show"), 3000); }

// ================= Salvataggio =================
let timerSalva = null;
function salva() {
  clearTimeout(timerSalva);
  timerSalva = setTimeout(async () => {
    try { await window.api.salva(S); } catch (e) { console.error(e); toast("Salvataggio non riuscito: controlla lo spazio su disco"); }
  }, 250);
}
window.addEventListener("beforeunload", () => { if (timerSalva) { clearTimeout(timerSalva); window.api.salva(S); } });

// ================= Motore di rating (provvisorio) =================
function ordinaCorse(list) { return [...list].sort((a, b) => (a.data || "").localeCompare(b.data || "") || (a.creata || 0) - (b.creata || 0)); }
function arrotonda(x) { const p = Number(R().arrotondamento) || 0; return p > 0 ? Math.round(x / p) * p : x; }

// Rifà tutte le corse in ordine di data partendo dal rating iniziale. fino = data di riferimento inclusa.
function calcola(listaCorse = Object.values(S.corse), fino = null) {
  const rating = {}, storia = {}, perCorsa = {};
  Object.values(S.cavalli).forEach(c => { rating[c.id] = Number(c.ratingIniziale) || 0; storia[c.id] = []; });
  const r = R();
  const kgQ = Number(r.kgQuarto) || 0;
  const tetto = Number(r.tetto) > 0 ? Number(r.tetto) : Infinity;
  // Corse e rettifiche manuali in ordine di data; le rettifiche valgono dopo le corse dello stesso giorno.
  const eventi = [
    ...listaCorse.map(c => ({ tipo: "corsa", data: c.data || "", ord: 0, creata: c.creata || 0, corsa: c })),
    ...Object.values(S.rettifiche).map(x => ({ tipo: "rettifica", data: x.data || "", ord: 1, creata: x.creata || 0, rett: x })),
  ].sort((a, b) => a.data.localeCompare(b.data) || a.ord - b.ord || a.creata - b.creata);
  for (const ev of eventi) {
    if (fino && ev.data > fino) break;
    if (ev.tipo === "rettifica") {
      const x = ev.rett;
      if (!S.cavalli[x.cavalloId]) continue;
      const pre = rating[x.cavalloId], post = Number(x.rating);
      rating[x.cavalloId] = post;
      storia[x.cavalloId].push({ tipo: "rettifica", data: x.data, cavalloId: x.cavalloId, pre, post, delta: post - pre, rett: x });
      continue;
    }
    const corsa = ev.corsa;
    const cl = S.classi[corsa.classeId];
    const coeff = cl ? Number(cl.coeff) || 0 : 0;
    const parts = (corsa.partecipanti || []).filter(p => S.cavalli[p.cavalloId]);
    const arrivati = parts.filter(p => Number(p.posizione) > 0).sort((a, b) => Number(a.posizione) - Number(b.posizione));
    const cum = new Map(); let acc = 0;
    arrivati.forEach((p, i) => { if (i > 0) acc += (Number(p.distacco) || 0) / 0.25 * kgQ; cum.set(p, acc); });
    const out = [];
    for (const p of parts) {
      const pre = rating[p.cavalloId] ?? 0;
      const kg = cum.get(p);
      let delta = 0;
      if (kg !== undefined && arrivati.length > 1) {
        if (p === arrivati[0]) delta = Math.max(Number(r.minimoVincitore) || 0, cum.get(arrivati[1]) * (Number(r.fattoreVincitore) || 0));
        else delta = -kg;
        delta = arrotonda(Math.max(-tetto, Math.min(tetto, delta)));
      }
      const calcolato = pre + delta, manuale = haManuale(p.ratingManuale);
      const post = manuale ? Number(p.ratingManuale) : calcolato;
      out.push({ tipo: "corsa", data: corsa.data, cavalloId: p.cavalloId, pre, post, delta: post - pre, calcolato, deltaCalcolato: delta, manuale, kgCum: kg, pesoAssegnato: pre - coeff,
        fuoriClasse: !!cl && (pre < Number(cl.min) || pre > Number(cl.max)), p, corsa });
    }
    out.forEach(x => { rating[x.cavalloId] = x.post; storia[x.cavalloId]?.push(x); });
    perCorsa[corsa.id] = out;
  }
  return { rating, storia, perCorsa };
}

// ================= Anagrafica =================
const etaAl = (c, rif = oggi()) => c.nascita ? Number(rif.slice(0, 4)) - Number(c.nascita.slice(0, 4)) : "";
const nomeCavallo = id => S.cavalli[id]?.nome || "—";
const cavalliOrdinati = () => Object.values(S.cavalli).sort((a, b) => a.nome.localeCompare(b.nome, "it"));
function ultimoDato(cavalloId, escludi) {
  for (const k of ordinaCorse(Object.values(S.corse)).reverse()) {
    if (k.id === escludi) continue;
    const p = (k.partecipanti || []).find(x => x.cavalloId === cavalloId);
    if (p) return p;
  }
  return null;
}
function aggiornaDatalist() {
  const set = { fantini: new Set(), allenatori: new Set(), proprietari: new Set(), ippodromi: new Set(),
    razze: new Set(S.impostazioni.elenchi.razze), finimenti: new Set(S.impostazioni.elenchi.finimenti) };
  Object.values(S.cavalli).forEach(c => c.razza && set.razze.add(c.razza));
  Object.values(S.corse).forEach(k => {
    if (k.ippodromo) set.ippodromi.add(k.ippodromo);
    (k.partecipanti || []).forEach(p => { p.fantino && set.fantini.add(p.fantino); p.allenatore && set.allenatori.add(p.allenatore); p.proprietario && set.proprietari.add(p.proprietario); });
  });
  for (const [k, v] of Object.entries(set)) document.getElementById("dl-" + k).innerHTML = [...v].sort((a, b) => a.localeCompare(b, "it")).map(x => `<option value="${esc(x)}">`).join("");
}

// ================= Viste =================
function render() {
  document.querySelectorAll("#nav button").forEach(b => b.setAttribute("aria-current", b.dataset.view === view ? "page" : "false"));
  document.getElementById("main").innerHTML = ({ classifica: vClassifica, corse: vCorse, cavalli: vCavalli, impostazioni: vImpostazioni })[view]();
  aggiornaDatalist();
  if (view === "impostazioni") caricaInfoBackup();
}

function datiClassifica(rif) {
  const { rating, storia } = calcola(undefined, rif);
  return cavalliOrdinati().sort((a, b) => rating[b.id] - rating[a.id] || a.nome.localeCompare(b.nome, "it"))
    .map(c => { const st = storia[c.id]; return { c, rating: rating[c.id], corse: st.filter(x => x.tipo === "corsa").length, ultima: st[st.length - 1] }; });
}
function vClassifica() {
  if (!Object.keys(S.cavalli).length) return `<div class="head"><h2>Classifica generale</h2></div><div class="empty"><p>Nessun cavallo in archivio.</p><button class="btn primary" data-act="nuovo-cavallo">Aggiungi il primo cavallo</button></div>`;
  const rows = datiClassifica(dataRif);
  const nCorse = Object.values(S.corse).filter(k => k.data <= dataRif).length;
  return `<div class="head"><div><h2>Classifica generale al ${fmtData(dataRif)}</h2><p class="hint">Rating in kg calcolati sulle ${nCorse} corse disputate fino a questa data.</p></div>
    <div class="refdate"><label>Data di riferimento<input type="date" id="dataRif" value="${dataRif}" max="9999-12-31"></label>
    <button class="btn" data-act="oggi">Oggi</button><button class="btn primary" data-act="excel-classifica">Esporta in Excel</button></div></div>
  <div class="scroll"><table><thead><tr><th class="num">#</th><th>Cavallo</th><th>Razza</th><th class="num">Età</th><th class="num">Corse</th><th class="num">Ultima variazione</th><th class="num">Rating</th></tr></thead><tbody>
  ${rows.map((x, i) => `<tr class="link" data-scheda="${x.c.id}"><td class="num">${i + 1}</td><td><b>${esc(x.c.nome)}</b></td><td>${esc(x.c.razza)}</td><td class="num">${etaAl(x.c, dataRif)}</td><td class="num">${x.corse}</td>
    <td class="num ${x.ultima ? cls(x.ultima.delta) : ""}">${x.ultima ? segno(x.ultima.delta) : "—"}</td><td class="num rating">${fmtN(x.rating)}</td></tr>`).join("")}
  </tbody></table></div>`;
}

function vCavalli() {
  const { rating, storia } = calcola();
  const rows = cavalliOrdinati();
  const head = `<div class="head"><div><h2>Cavalli</h2><p class="hint">Apri un cavallo per vedere anagrafica e storico delle corse.</p></div><button class="btn primary" data-act="nuovo-cavallo">Nuovo cavallo</button></div>`;
  if (!rows.length) return head + `<div class="empty"><p>L'archivio è vuoto.</p><button class="btn primary" data-act="nuovo-cavallo">Aggiungi il primo cavallo</button></div>`;
  return head + `<div class="scroll"><table><thead><tr><th>Nome</th><th>Razza</th><th>Nascita</th><th class="num">Età</th><th>Ultimo allenatore</th><th>Ultimo proprietario</th><th class="num">Corse</th><th class="num">Rating attuale</th></tr></thead><tbody>
  ${rows.map(c => { const u = ultimoDato(c.id) || {}; return `<tr class="link" data-scheda="${c.id}"><td><b>${esc(c.nome)}</b></td><td>${esc(c.razza)}</td><td>${fmtData(c.nascita)}</td><td class="num">${etaAl(c)}</td><td>${esc(u.allenatore)}</td><td>${esc(u.proprietario)}</td><td class="num">${storia[c.id].filter(x => x.tipo === "corsa").length}</td><td class="num rating">${fmtN(rating[c.id])}</td></tr>`; }).join("")}
  </tbody></table></div>`;
}

function vCorse() {
  const list = ordinaCorse(Object.values(S.corse)).reverse();
  const nCl = Object.keys(S.classi).length, nCav = Object.keys(S.cavalli).length;
  const head = `<div class="head"><div><h2>Corse</h2><p class="hint">Dalla più recente.</p></div><button class="btn primary" data-act="nuova-corsa" ${!nCl || !nCav ? "disabled" : ""}>Nuova corsa</button></div>`;
  if (!nCl || !nCav) return head + `<div class="empty"><p>Per inserire una corsa servono almeno ${!nCl ? "una classe" : ""}${!nCl && !nCav ? " e " : ""}${!nCav ? "un cavallo" : ""}.</p>
    <button class="btn primary" data-act="${!nCl ? "vai-impostazioni" : "nuovo-cavallo"}">${!nCl ? "Crea una classe" : "Aggiungi un cavallo"}</button></div>`;
  if (!list.length) return head + `<div class="empty"><p>Nessuna corsa inserita.</p><button class="btn primary" data-act="nuova-corsa">Inserisci la prima corsa</button></div>`;
  return head + `<div class="scroll"><table><thead><tr><th>Data</th><th>Corsa</th><th>Ippodromo</th><th>Classe</th><th class="num">Distanza</th><th class="num">Partenti</th><th>Vincitore</th></tr></thead><tbody>
  ${list.map(k => { const v = (k.partecipanti || []).find(p => Number(p.posizione) === 1); return `<tr class="link" data-corsa="${k.id}"><td>${fmtData(k.data)}</td><td><b>${esc(k.nome || "Senza nome")}</b></td><td>${esc(k.ippodromo)}</td><td>${esc(S.classi[k.classeId]?.nome || "—")}</td><td class="num">${k.distanza ? esc(k.distanza) + " m" : ""}</td><td class="num">${(k.partecipanti || []).length}</td><td>${v ? esc(nomeCavallo(v.cavalloId)) : "—"}</td></tr>`; }).join("")}
  </tbody></table></div>`;
}

function vImpostazioni() {
  const r = R(), b = S.impostazioni.backup, el = S.impostazioni.elenchi;
  const classi = Object.values(S.classi).sort((a, b) => a.nome.localeCompare(b.nome, "it", { numeric: true }));
  return `
  <section>
    <div class="head"><div><h2>Classi</h2><p class="hint">Peso assegnato = rating − coefficiente della classe.</p></div><button class="btn primary" data-act="nuova-classe">Nuova classe</button></div>
    ${classi.length ? `<div class="scroll"><table><thead><tr><th>Classe</th><th class="num">Rating da</th><th class="num">Rating a</th><th class="num">Coefficiente</th><th>Note</th></tr></thead><tbody>
    ${classi.map(c => `<tr class="link" data-classe="${c.id}"><td><b>${esc(c.nome)}</b></td><td class="num">${fmtN(c.min)}</td><td class="num">${fmtN(c.max)}</td><td class="num">${fmtN(c.coeff)}</td><td>${esc(c.note)}</td></tr>`).join("")}
    </tbody></table></div>` : `<div class="empty"><p>Nessuna classe definita.</p><button class="btn primary" data-act="nuova-classe">Crea la prima classe</button></div>`}
  </section>

  <section>
    <h2>Regole di calcolo del rating</h2>
    <p class="hint">Le modifiche valgono per tutte le corse, anche quelle già inserite: rating e classifiche vengono ricalcolati.</p>
    <form id="formRegole" class="panel" style="margin-top:12px">
      <div class="grid">
        <label>Kg per ogni 0,25 di distacco<input type="number" step="0.05" min="0" name="kgQuarto" value="${esc(r.kgQuarto)}"></label>
        <label>Quota del margine al vincitore<input type="number" step="0.05" min="0" name="fattoreVincitore" value="${esc(r.fattoreVincitore)}"></label>
        <label>Aumento minimo del vincitore (kg)<input type="number" step="0.5" min="0" name="minimoVincitore" value="${esc(r.minimoVincitore)}"></label>
        <label>Variazione massima per corsa (kg)<input type="number" step="0.5" min="0" name="tetto" value="${esc(r.tetto)}"></label>
        <label>Arrotonda a (kg)<select name="arrotondamento">${[[1, "1 kg"], [0.5, "0,5 kg"], [0.25, "0,25 kg"], [0, "Nessun arrotondamento"]].map(([v, t]) => `<option value="${v}" ${Number(r.arrotondamento) === v ? "selected" : ""}>${t}</option>`).join("")}</select></label>
      </div>
      <p class="hint">Il vincitore sale della quota indicata dei kg di margine sul secondo, mai meno del minimo. Gli altri scendono dei kg cumulati dal primo. Variazione massima 0 = nessun limite. I non arrivati non cambiano rating.</p>
      <div class="dlg-foot" style="margin-top:12px"><button type="button" class="btn" data-act="regole-default">Ripristina valori iniziali</button><button class="btn primary">Salva regole</button></div>
    </form>
  </section>

  <section>
    <h2>Backup</h2>
    <form id="formBackup" class="panel" style="margin-top:12px">
      <label>Cartella dei backup</label>
      <div class="path" id="bkDir">…</div>
      <div class="toolbar" style="margin-bottom:16px"><button type="button" class="btn" data-act="bk-cartella">Cambia cartella</button><button type="button" class="btn" data-act="bk-apri">Apri cartella</button></div>
      <div class="grid">
        <label>Backup automatico ogni (giorni)<input type="number" min="0" step="1" name="giorni" value="${esc(b.giorni)}"></label>
        <label>Backup da conservare<input type="number" min="1" step="1" name="conserva" value="${esc(b.conserva)}"></label>
      </div>
      <p class="hint" id="bkInfo">…</p>
      <div class="dlg-foot" style="margin-top:12px"><button type="button" class="btn" data-act="bk-ripristina">Ripristina da backup</button><button type="button" class="btn" data-act="bk-ora">Fai un backup ora</button><button class="btn primary">Salva impostazioni backup</button></div>
    </form>
  </section>

  <section>
    <h2>Elenchi suggeriti</h2>
    <form id="formElenchi" class="panel" style="margin-top:12px">
      <div class="grid">
        <label>Razze (una per riga)<textarea name="razze" rows="6">${esc(el.razze.join("\n"))}</textarea></label>
        <label>Finimenti (uno per riga)<textarea name="finimenti" rows="6">${esc(el.finimenti.join("\n"))}</textarea></label>
      </div>
      <p class="hint">Fantini, allenatori, proprietari e ippodromi vengono suggeriti in automatico da quelli già inseriti.</p>
      <div class="dlg-foot" style="margin-top:12px"><button class="btn primary">Salva elenchi</button></div>
    </form>
  </section>`;
}
async function caricaInfoBackup() {
  const i = await window.api.backupInfo();
  const d = document.getElementById("bkDir"), t = document.getElementById("bkInfo");
  if (!d) return;
  d.textContent = i.dir;
  t.textContent = `Ultimo backup: ${fmtDataOra(i.ultimo)}. Backup presenti: ${i.numero}. Con 0 giorni il backup automatico è disattivato. Archivio in uso: ${i.fileDati}`;
}

// ================= Dialog: cavallo =================
function apriCavallo(id) {
  const c = id ? S.cavalli[id] : { nome: "", nascita: "", razza: "", ratingIniziale: "", note: "" };
  const d = document.getElementById("dlgCavallo");
  d.innerHTML = `<div class="dlg-head"><h2>${id ? "Modifica cavallo" : "Nuovo cavallo"}</h2><button class="btn small" data-close>Chiudi</button></div>
  <form class="dlg-body">
    <div class="grid">
      <label style="grid-column:1/-1">Nome<input name="nome" required value="${esc(c.nome)}" autocomplete="off"></label>
      <label>Data di nascita<input type="date" name="nascita" value="${esc(c.nascita)}" max="9999-12-31"></label>
      <label>Razza<input name="razza" list="dl-razze" value="${esc(c.razza)}"></label>
      <label>Rating iniziale (kg)<input type="number" step="0.25" name="ratingIniziale" required value="${esc(c.ratingIniziale)}"></label>
      <label style="grid-column:1/-1">Note<textarea name="note" rows="2">${esc(c.note)}</textarea></label>
    </div>
    <div class="dlg-foot">${id ? `<button type="button" class="btn danger" data-act="elimina-cavallo" data-id="${id}">Elimina cavallo</button>` : ""}<button class="btn primary">Salva cavallo</button></div>
  </form>`;
  d.querySelector("form").onsubmit = e => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    const nome = f.nome.trim();
    if (Object.values(S.cavalli).some(x => x.nome.toLowerCase() === nome.toLowerCase() && x.id !== id)) return toast("Esiste già un cavallo con questo nome");
    const obj = { ...(id ? S.cavalli[id] : {}), id: id || uid(), nome, nascita: f.nascita, razza: f.razza.trim(), ratingIniziale: Number(f.ratingIniziale), note: f.note.trim() };
    S.cavalli[obj.id] = obj; salva();
    d.close(); toast("Cavallo salvato"); render();
    if (document.getElementById("dlgScheda").open) apriScheda(obj.id);
  };
  d.showModal();
}

function apriScheda(id) {
  const c = S.cavalli[id]; const { rating, storia } = calcola(); const st = storia[id];
  const d = document.getElementById("dlgScheda");
  d.innerHTML = `<div class="dlg-head"><h2>${esc(c.nome)}</h2><div class="toolbar"><button class="btn small" data-act="nuova-rettifica" data-id="${id}">Rettifica rating</button><button class="btn small" data-act="modifica-cavallo" data-id="${id}">Modifica anagrafica</button><button class="btn small" data-close>Chiudi</button></div></div>
  <div class="dlg-body">
    <div class="facts">
      <div><b>${fmtN(rating[id])}</b>rating attuale</div>
      <div><b>${fmtN(c.ratingIniziale)}</b>rating iniziale</div>
      <div><b>${esc(c.razza) || "—"}</b>razza</div>
      <div><b>${c.nascita ? etaAl(c) + " anni" : "—"}</b>${c.nascita ? "nato il " + fmtData(c.nascita) : "età"}</div>
      <div><b>${st.filter(x => x.tipo === "corsa").length}</b>corse</div>
    </div>
    ${c.note ? `<p class="meta">${esc(c.note)}</p>` : ""}
    <h3>Storico corse e rettifiche</h3>
    ${st.length ? `<div class="scroll"><table><thead><tr><th>Data</th><th>Corsa</th><th>Classe</th><th class="num">Arrivo</th><th class="num">Distacco</th><th class="num">Steccato</th><th>Finimenti</th><th class="num">Peso ass.</th><th class="num">Peso fantino</th><th>Fantino</th><th>Allenatore</th><th>Proprietario</th><th class="num">Rating</th></tr></thead><tbody>
    ${[...st].reverse().map(r => { if (r.tipo === "rettifica") return `<tr class="link" data-rett="${r.rett.id}"><td>${fmtData(r.data)}</td><td colspan="11"><b>Rettifica manuale</b>${r.rett.nota ? ` <span class="meta">${esc(r.rett.nota)}</span>` : ""}</td>
      <td class="num">${fmtN(r.pre)} → <b>${fmtN(r.post)}</b> <span class="${cls(r.delta)}">(${segno(r.delta)})</span></td></tr>`;
      const p = r.p, k = r.corsa; return `<tr class="link" data-corsa="${k.id}"><td>${fmtData(k.data)}</td><td>${esc(k.nome || "—")}${k.ippodromo ? `<br><span class="meta">${esc(k.ippodromo)}</span>` : ""}</td><td>${esc(S.classi[k.classeId]?.nome || "—")}</td>
      <td class="num">${Number(p.posizione) > 0 ? `<span class="cloth pos">${esc(p.posizione)}</span>` : `<span class="cloth none">NA</span>`}</td><td class="num">${Number(p.posizione) > 1 ? fmtN(p.distacco || 0) : ""}</td>
      <td class="num">${p.steccato ? `<span class="cloth">${esc(p.steccato)}</span>` : ""}</td><td>${esc(p.finimenti)}</td><td class="num">${fmtN(r.pesoAssegnato)}</td><td class="num">${p.pesoFantino ? fmtN(p.pesoFantino) : ""}</td>
      <td>${esc(p.fantino)}</td><td>${esc(p.allenatore)}</td><td>${esc(p.proprietario)}</td>
      <td class="num">${fmtN(r.pre)} → <b>${fmtN(r.post)}</b> <span class="${cls(r.delta)}">(${segno(r.delta)})</span>${r.manuale ? `<span class="tag" title="Calcolato: ${fmtN(r.calcolato)}">a mano</span>` : ""}</td></tr>`; }).join("")}
    </tbody></table></div>` : `<p class="meta">Nessuna corsa o rettifica.</p>`}
  </div>`;
  if (!d.open) d.showModal();
}

// ================= Dialog: rettifica manuale =================
function apriRettifica(cavalloId, rettId) {
  const c = S.cavalli[cavalloId];
  const x = rettId ? S.rettifiche[rettId] : null;
  const data0 = x ? x.data : oggi();
  const ratingAllaData = d => { const altre = { ...S.rettifiche }; if (x) delete altre[x.id]; const salvate = S.rettifiche; S.rettifiche = altre; const r = calcola(undefined, d).rating[cavalloId]; S.rettifiche = salvate; return r; };
  const d = document.getElementById("dlgRettifica");
  d.innerHTML = `<div class="dlg-head"><h2>Rettifica rating: ${esc(c.nome)}</h2><button class="btn small" data-close>Chiudi</button></div>
  <form class="dlg-body"><div class="grid">
    <label>Data<input type="date" name="data" required value="${esc(data0)}" max="9999-12-31"></label>
    <label>Nuovo rating (kg)<input type="number" step="0.25" name="rating" required value="${esc(x ? x.rating : ratingAllaData(data0))}"></label>
    <label style="grid-column:1/-1">Motivo<input name="nota" value="${esc(x?.nota)}" placeholder="Es. revisione di fine stagione"></label>
  </div>
  <p class="hint" id="rettPrima"></p>
  <p class="hint">La rettifica vale dopo le eventuali corse dello stesso giorno. Le corse successive partono dal nuovo valore.</p>
  <div class="dlg-foot">${x ? `<button type="button" class="btn danger" data-act="elimina-rettifica" data-id="${x.id}">Elimina rettifica</button>` : ""}<button class="btn primary">Salva rettifica</button></div></form>`;
  const f = d.querySelector("form");
  const info = () => { const v = f.data.value; document.getElementById("rettPrima").textContent = v ? `Rating al ${fmtData(v)} prima della rettifica: ${fmtN(ratingAllaData(v))} kg.` : ""; };
  f.data.addEventListener("change", info); info();
  f.onsubmit = e => {
    e.preventDefault(); const v = Object.fromEntries(new FormData(f));
    const obj = { id: x?.id || uid(), creata: x?.creata || Date.now(), cavalloId, data: v.data, rating: Number(v.rating), nota: v.nota.trim() };
    S.rettifiche[obj.id] = obj; salva(); d.close(); toast("Rettifica salvata"); render();
    if (document.getElementById("dlgScheda").open) apriScheda(cavalloId);
  };
  d.showModal();
}

// ================= Dialog: classe =================
function apriClasse(id) {
  const c = id ? S.classi[id] : { nome: "", min: "", max: "", coeff: "", note: "" };
  const d = document.getElementById("dlgClasse");
  d.innerHTML = `<div class="dlg-head"><h2>${id ? "Modifica classe" : "Nuova classe"}</h2><button class="btn small" data-close>Chiudi</button></div>
  <form class="dlg-body"><div class="grid">
    <label style="grid-column:1/-1">Nome<input name="nome" required value="${esc(c.nome)}" placeholder="Classe 4"></label>
    <label>Rating da<input type="number" step="0.25" name="min" required value="${esc(c.min)}"></label>
    <label>Rating a<input type="number" step="0.25" name="max" required value="${esc(c.max)}"></label>
    <label>Coefficiente<input type="number" step="0.25" name="coeff" required value="${esc(c.coeff)}"></label>
    <label style="grid-column:1/-1">Note<input name="note" value="${esc(c.note)}"></label>
  </div>
  ${id ? `<p class="hint">Cambiare il coefficiente ricalcola i pesi assegnati di tutte le corse di questa classe.</p>` : ""}
  <div class="dlg-foot">${id ? `<button type="button" class="btn danger" data-act="elimina-classe" data-id="${id}">Elimina classe</button>` : ""}<button class="btn primary">Salva classe</button></div></form>`;
  d.querySelector("form").onsubmit = e => {
    e.preventDefault(); const f = Object.fromEntries(new FormData(e.target));
    if (Number(f.min) > Number(f.max)) return toast("Il rating minimo supera il massimo");
    const obj = { id: id || uid(), nome: f.nome.trim(), min: Number(f.min), max: Number(f.max), coeff: Number(f.coeff), note: f.note.trim() };
    S.classi[obj.id] = obj; salva(); d.close(); toast("Classe salvata"); render();
  };
  d.showModal();
}

// ================= Dialog: corsa =================
let bozza = null;
const nuovoPartente = () => ({ cavalloId: "", posizione: "", distacco: "", steccato: "", finimenti: "", pesoFantino: "", fantino: "", allenatore: "", proprietario: "", ratingManuale: "" });
function apriCorsa(id) {
  bozza = id ? structuredClone(S.corse[id]) : { id: uid(), creata: Date.now(), nuova: true, data: oggi(), nome: "", ippodromo: "", classeId: Object.keys(S.classi)[0] || "", distanza: "", partecipanti: [nuovoPartente(), nuovoPartente(), nuovoPartente()] };
  const d = document.getElementById("dlgCorsa");
  d.innerHTML = `<div class="dlg-head"><h2>${id ? "Modifica corsa" : "Nuova corsa"}</h2><div class="toolbar"><button type="button" class="btn small" data-act="excel-corsa">Esporta in Excel</button><button class="btn small" data-close>Chiudi</button></div></div>
  <form class="dlg-body">
    <div class="grid">
      <label>Data<input type="date" data-f="data" required value="${esc(bozza.data)}" max="9999-12-31"></label>
      <label>Nome corsa<input data-f="nome" value="${esc(bozza.nome)}"></label>
      <label>Ippodromo<input data-f="ippodromo" list="dl-ippodromi" value="${esc(bozza.ippodromo)}"></label>
      <label>Classe<select data-f="classeId" required>${Object.values(S.classi).map(c => `<option value="${c.id}" ${c.id === bozza.classeId ? "selected" : ""}>${esc(c.nome)} (coeff. ${fmtN(c.coeff)})</option>`).join("")}</select></label>
      <label>Distanza (m)<input type="number" data-f="distanza" value="${esc(bozza.distanza)}"></label>
    </div>
    <h3>Partenti e ordine d'arrivo</h3>
    <p class="hint">Distacco in lunghezze dal cavallo che precede (multipli di 0,25). Lascia vuoto l'arrivo per i non arrivati.</p>
    <div class="scroll"><table class="runners"><thead><tr><th>Cavallo</th><th>Arrivo</th><th>Distacco</th><th>Steccato</th><th>Finimenti</th><th>Peso fantino</th><th>Fantino</th><th>Allenatore</th><th>Proprietario</th><th></th></tr></thead><tbody id="righe"></tbody></table></div>
    <div class="toolbar" style="margin-top:10px"><button type="button" class="btn" data-act="aggiungi-partente">Aggiungi partente</button><button type="button" class="btn" data-act="ordina-arrivo">Ordina per arrivo</button></div>
    <h3>Effetto sul rating</h3>
    <div id="anteprima"></div>
    <div class="dlg-foot">${!bozza.nuova ? `<button type="button" class="btn danger" data-act="elimina-corsa">Elimina corsa</button>` : ""}<button class="btn primary">Salva corsa</button></div>
  </form>`;
  renderRighe(); renderAnteprima();
  const f = d.querySelector("form");
  f.addEventListener("input", e => {
    const t = e.target;
    if (t.dataset.f) bozza[t.dataset.f] = t.value;
    if (t.dataset.p) {
      const i = Number(t.closest("tr").dataset.i); bozza.partecipanti[i][t.dataset.p] = t.value;
      if (t.dataset.p === "cavalloId" && t.value) {
        const u = ultimoDato(t.value, bozza.id);
        if (u) { const r = bozza.partecipanti[i]; ["fantino", "allenatore", "proprietario", "finimenti"].forEach(k => { if (!r[k]) r[k] = u[k] || ""; }); renderRighe(); }
      }
    }
  });
  f.addEventListener("change", renderAnteprima);
  f.onsubmit = salvaCorsa;
  d.showModal();
}
function renderRighe() {
  const opts = cavalliOrdinati();
  document.getElementById("righe").innerHTML = bozza.partecipanti.map((p, i) => `<tr data-i="${i}">
    <td><select data-p="cavalloId" class="wide" aria-label="Cavallo"><option value="">Scegli…</option>${opts.map(c => `<option value="${c.id}" ${c.id === p.cavalloId ? "selected" : ""}>${esc(c.nome)}</option>`).join("")}</select></td>
    <td><input type="number" min="1" data-p="posizione" value="${esc(p.posizione)}" aria-label="Posizione d'arrivo"></td>
    <td><input type="number" min="0" step="0.25" data-p="distacco" value="${esc(p.distacco)}" aria-label="Distacco"></td>
    <td><input type="number" min="1" data-p="steccato" value="${esc(p.steccato)}" aria-label="Numero steccato"></td>
    <td><input data-p="finimenti" list="dl-finimenti" class="wide" value="${esc(p.finimenti)}" aria-label="Finimenti"></td>
    <td><input type="number" step="0.5" data-p="pesoFantino" value="${esc(p.pesoFantino)}" aria-label="Peso fantino"></td>
    <td><input data-p="fantino" list="dl-fantini" class="wide" value="${esc(p.fantino)}" aria-label="Fantino"></td>
    <td><input data-p="allenatore" list="dl-allenatori" class="wide" value="${esc(p.allenatore)}" aria-label="Allenatore"></td>
    <td><input data-p="proprietario" list="dl-proprietari" class="wide" value="${esc(p.proprietario)}" aria-label="Proprietario"></td>
    <td><button type="button" class="btn small danger" data-act="rimuovi-partente" aria-label="Rimuovi partente">✕</button></td></tr>`).join("");
}
function risultatiBozza() {
  const altre = Object.values(S.corse).filter(k => k.id !== bozza.id);
  const { perCorsa } = calcola([...altre, bozza]);
  return (perCorsa[bozza.id] || []).sort((a, b) => (Number(a.p.posizione) || 999) - (Number(b.p.posizione) || 999));
}
function renderAnteprima() {
  const res = risultatiBozza();
  const el = document.getElementById("anteprima");
  if (!res.length) { el.innerHTML = `<p class="meta">Scegli i cavalli per vedere pesi e variazioni.</p>`; return; }
  el.innerHTML = `<p class="hint" style="margin:0 0 8px">Il rating dopo è proposto dal calcolo. Scrivi un valore per deciderlo tu; svuota il campo per tornare al calcolo.</p>
  <div class="scroll"><table><thead><tr><th>Arrivo</th><th>Cavallo</th><th class="num">Rating prima</th><th class="num">Peso assegnato</th><th class="num">Kg dal 1°</th><th class="num">Calcolato</th><th class="num">Rating dopo</th><th class="num">Variazione</th></tr></thead><tbody>
  ${res.map(r => `<tr data-i="${bozza.partecipanti.indexOf(r.p)}"><td>${Number(r.p.posizione) > 0 ? `<span class="cloth pos">${esc(r.p.posizione)}</span>` : `<span class="cloth none">NA</span>`}</td><td>${esc(nomeCavallo(r.cavalloId))}${r.fuoriClasse ? `<span class="warn">Rating fuori dai limiti della classe</span>` : ""}</td>
  <td class="num">${fmtN(r.pre)}</td><td class="num">${fmtN(r.pesoAssegnato)}</td><td class="num">${r.kgCum !== undefined ? fmtN(r.kgCum) : "—"}</td>
  <td class="num">${fmtN(r.calcolato)} <span class="meta">(${segno(r.deltaCalcolato)})</span></td>
  <td class="num"><input type="number" step="0.25" class="manuale${r.manuale ? " attivo" : ""}" data-p="ratingManuale" value="${esc(r.manuale ? r.p.ratingManuale : "")}" placeholder="${fmtN(r.calcolato)}" aria-label="Rating dopo deciso a mano">${r.manuale ? `<span class="tag">a mano</span>` : ""}</td>
  <td class="num ${cls(r.delta)}">${segno(r.delta)}</td></tr>`).join("")}</tbody></table></div>`;
}
function salvaCorsa(e) {
  e.preventDefault();
  const parts = bozza.partecipanti.filter(p => p.cavalloId);
  if (!bozza.data || !bozza.classeId) return toast("Indica data e classe");
  if (!parts.length) return toast("Aggiungi almeno un cavallo");
  const ids = parts.map(p => p.cavalloId);
  if (new Set(ids).size !== ids.length) return toast("Un cavallo compare due volte");
  const stecc = parts.map(p => p.steccato).filter(Boolean);
  if (new Set(stecc).size !== stecc.length) return toast("Due cavalli hanno lo stesso steccato");
  const obj = { ...bozza, partecipanti: parts }; delete obj.nuova;
  S.corse[obj.id] = obj; bozza = { ...obj }; salva();
  document.getElementById("dlgCorsa").close(); toast("Corsa salvata"); render();
}

// ================= Export Excel =================
async function esporta(doc) {
  const r = await window.api.esportaExcel(doc);
  if (r.errore) return toast(r.errore);
  if (r.file) { toast("File Excel salvato"); window.api.mostraFile(r.file); }
}
function excelClassifica() {
  const rows = datiClassifica(dataRif);
  esporta({
    nomeFile: `Classifica generale al ${fmtData(dataRif).replace(/\//g, "-")}`,
    fogli: [{
      nome: "Classifica", titolo: `Classifica generale al ${fmtData(dataRif)}`,
      sottotitolo: `Corse considerate: ${Object.values(S.corse).filter(k => k.data <= dataRif).length}. Esportata il ${fmtDataOra(new Date().toISOString())}.`,
      colonne: [{ titolo: "Pos.", larghezza: 6, num: 1 }, { titolo: "Cavallo", larghezza: 26 }, { titolo: "Razza", larghezza: 20 }, { titolo: "Data di nascita", larghezza: 15 }, { titolo: "Età", larghezza: 6, num: 1 },
        { titolo: "Corse", larghezza: 8, num: 1 }, { titolo: "Ultima variazione il", larghezza: 13 }, { titolo: "Ultima variazione (kg)", larghezza: 12, num: 1 }, { titolo: "Rating (kg)", larghezza: 11, num: 1 }],
      righe: rows.map((x, i) => [i + 1, x.c.nome, x.c.razza, fmtData(x.c.nascita), etaAl(x.c, dataRif), x.corse, x.ultima ? fmtData(x.ultima.data) : "", x.ultima ? tondo(x.ultima.delta) : "", tondo(x.rating)]),
    }],
  });
}
function excelCorsa() {
  const res = risultatiBozza();
  if (!res.length) return toast("Aggiungi almeno un cavallo per esportare");
  const cl = S.classi[bozza.classeId];
  const titolo = [bozza.nome || "Corsa", bozza.ippodromo].filter(Boolean).join(", ");
  esporta({
    nomeFile: `Corsa ${fmtData(bozza.data).replace(/\//g, "-")} ${bozza.nome || ""}`.trim(),
    fogli: [{
      nome: "Corsa", titolo,
      sottotitolo: [fmtData(bozza.data), cl ? `${cl.nome} (coefficiente ${fmtN(cl.coeff)})` : "", bozza.distanza ? `${bozza.distanza} m` : "", `${res.length} partenti`].filter(Boolean).join(", "),
      colonne: [{ titolo: "Arrivo", larghezza: 7, num: 1 }, { titolo: "Cavallo", larghezza: 24 }, { titolo: "Distacco (lungh.)", larghezza: 10, num: 1 }, { titolo: "Kg dal 1°", larghezza: 9, num: 1 },
        { titolo: "Steccato", larghezza: 9, num: 1 }, { titolo: "Finimenti", larghezza: 18 }, { titolo: "Peso assegnato (kg)", larghezza: 11, num: 1 }, { titolo: "Peso fantino (kg)", larghezza: 11, num: 1 },
        { titolo: "Fantino", larghezza: 20 }, { titolo: "Allenatore", larghezza: 20 }, { titolo: "Proprietario", larghezza: 22 },
        { titolo: "Rating prima", larghezza: 10, num: 1 }, { titolo: "Rating calcolato", larghezza: 10, num: 1 }, { titolo: "Rating dopo", larghezza: 10, num: 1 }, { titolo: "Deciso a mano", larghezza: 9 }, { titolo: "Variazione", larghezza: 10, num: 1 }],
      righe: res.map(r => { const p = r.p, arr = Number(p.posizione) > 0;
        return [arr ? Number(p.posizione) : "N.A.", nomeCavallo(r.cavalloId), arr && Number(p.posizione) > 1 ? Number(p.distacco) || 0 : "", r.kgCum !== undefined ? tondo(r.kgCum) : "",
          p.steccato ? Number(p.steccato) : "", p.finimenti, tondo(r.pesoAssegnato), p.pesoFantino ? Number(p.pesoFantino) : "", p.fantino, p.allenatore, p.proprietario, tondo(r.pre), tondo(r.calcolato), tondo(r.post), r.manuale ? "Sì" : "", tondo(r.delta)]; }),
    }],
  });
}

// ================= Eventi =================
document.getElementById("nav").onclick = e => { const b = e.target.closest("button"); if (b) { view = b.dataset.view; render(); } };
document.addEventListener("change", e => { if (e.target.id === "dataRif" && e.target.value) { dataRif = e.target.value; render(); } });
document.addEventListener("click", async e => {
  const t = e.target;
  if (t.closest("[data-close]")) return t.closest("dialog").close();
  const a = t.closest("[data-act]");
  if (a) {
    const act = a.dataset.act, $ = id => document.getElementById(id);
    switch (act) {
      case "nuovo-cavallo": return apriCavallo();
      case "modifica-cavallo": return apriCavallo(a.dataset.id);
      case "nuova-rettifica": return apriRettifica(a.dataset.id);
      case "nuova-corsa": return apriCorsa();
      case "nuova-classe": return apriClasse();
      case "vai-impostazioni": view = "impostazioni"; return render();
      case "oggi": dataRif = oggi(); return render();
      case "excel-classifica": return excelClassifica();
      case "excel-corsa": return excelCorsa();
      case "aggiungi-partente": bozza.partecipanti.push(nuovoPartente()); return renderRighe();
      case "rimuovi-partente": bozza.partecipanti.splice(Number(a.closest("tr").dataset.i), 1); renderRighe(); return renderAnteprima();
      case "ordina-arrivo": bozza.partecipanti.sort((x, y) => (Number(x.posizione) || 999) - (Number(y.posizione) || 999)); return renderRighe();
      case "elimina-corsa":
        if (confirm("Eliminare questa corsa? I rating verranno ricalcolati.")) { delete S.corse[bozza.id]; salva(); $("dlgCorsa").close(); toast("Corsa eliminata"); render(); }
        return;
      case "elimina-classe": {
        const id = a.dataset.id;
        if (Object.values(S.corse).some(k => k.classeId === id)) return toast("La classe è usata in alcune corse");
        if (confirm("Eliminare questa classe?")) { delete S.classi[id]; salva(); $("dlgClasse").close(); render(); }
        return;
      }
      case "elimina-cavallo": {
        const id = a.dataset.id;
        if (Object.values(S.corse).some(k => (k.partecipanti || []).some(p => p.cavalloId === id))) return toast("Il cavallo ha corse in archivio: eliminale prima");
        if (Object.values(S.rettifiche).some(x => x.cavalloId === id)) return toast("Il cavallo ha rettifiche di rating: eliminale prima");
        if (confirm("Eliminare questo cavallo?")) { delete S.cavalli[id]; salva(); $("dlgCavallo").close(); $("dlgScheda").close(); toast("Cavallo eliminato"); render(); }
        return;
      }
      case "elimina-rettifica": {
        const x = S.rettifiche[a.dataset.id];
        if (x && confirm("Eliminare questa rettifica? I rating verranno ricalcolati.")) { delete S.rettifiche[x.id]; salva(); $("dlgRettifica").close(); toast("Rettifica eliminata"); render(); if ($("dlgScheda").open) apriScheda(x.cavalloId); }
        return;
      }
      case "regole-default":
        if (confirm("Ripristinare le regole iniziali? I rating verranno ricalcolati.")) { S.impostazioni.regole = { ...REGOLE_DEFAULT }; salva(); toast("Regole ripristinate"); render(); }
        return;
      case "bk-cartella": {
        const dir = await window.api.scegliCartellaBackup();
        if (dir) { S.impostazioni.backup.dir = dir; await window.api.salva(S); toast("Cartella dei backup aggiornata"); caricaInfoBackup(); }
        return;
      }
      case "bk-apri": return window.api.apriBackup();
      case "bk-ora": { await window.api.salva(S); const f = await window.api.backupOra(); toast(f ? "Backup eseguito" : "Backup non riuscito"); return caricaInfoBackup(); }
      case "bk-ripristina": {
        if (!confirm("Il ripristino sostituisce l'archivio attuale con quello del backup. Prima viene salvata una copia dell'archivio attuale. Continuare?")) return;
        await window.api.salva(S);
        const r = await window.api.ripristina();
        if (r.errore) return toast(r.errore);
        if (r.dati) { S = normalizza(r.dati); toast("Archivio ripristinato"); render(); }
        return;
      }
    }
    return;
  }
  const row = t.closest("tr[data-scheda],tr[data-corsa],tr[data-classe],tr[data-rett]");
  if (row && !t.closest("#dlgCorsa")) {
    if (row.dataset.scheda) apriScheda(row.dataset.scheda);
    else if (row.dataset.corsa) { document.getElementById("dlgScheda").close(); apriCorsa(row.dataset.corsa); }
    else if (row.dataset.classe) apriClasse(row.dataset.classe);
    else if (row.dataset.rett) { const x = S.rettifiche[row.dataset.rett]; if (x) apriRettifica(x.cavalloId, x.id); }
  }
});
document.addEventListener("submit", async e => {
  const f = Object.fromEntries(new FormData(e.target));
  if (e.target.id === "formRegole") {
    e.preventDefault();
    S.impostazioni.regole = { kgQuarto: Number(f.kgQuarto), tetto: Number(f.tetto), fattoreVincitore: Number(f.fattoreVincitore), minimoVincitore: Number(f.minimoVincitore), arrotondamento: Number(f.arrotondamento) };
    salva(); toast("Regole salvate, rating ricalcolati"); render();
  } else if (e.target.id === "formBackup") {
    e.preventDefault();
    S.impostazioni.backup = { ...S.impostazioni.backup, giorni: Math.max(0, Math.round(Number(f.giorni))), conserva: Math.max(1, Math.round(Number(f.conserva))) };
    await window.api.salva(S); toast("Impostazioni backup salvate"); caricaInfoBackup();
  } else if (e.target.id === "formElenchi") {
    e.preventDefault();
    const lista = s => [...new Set(s.split("\n").map(x => x.trim()).filter(Boolean))];
    S.impostazioni.elenchi = { razze: lista(f.razze), finimenti: lista(f.finimenti) };
    salva(); toast("Elenchi salvati"); render();
  }
});

// ================= Avvio =================
(async () => {
  try {
    const d = await window.api.carica();
    if (d) S = normalizza(d);
  } catch (e) { console.error(e); toast("Impossibile leggere l'archivio"); }
  render();
})();
