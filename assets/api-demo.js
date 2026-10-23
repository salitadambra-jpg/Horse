// Sostituisce le funzioni del programma desktop con equivalenti nel browser.
(function () {
  const KEY = "valutazioni-cavalli-demo-v2";
  const scarica = (blob, nome) => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = nome;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  let ultimoBackup = null;

  window.api = {
    async carica() {
      try { const s = localStorage.getItem(KEY); if (s) return JSON.parse(s); } catch {}
      return structuredClone(window.DATI_ESEMPIO);
    },
    async salva(d) { try { localStorage.setItem(KEY, JSON.stringify(d)); } catch {} return true; },
    async backupInfo() {
      return { dir: "Nella versione desktop: Documenti\\Valutazioni cavalli\\Backup", giorni: 1, conserva: 30,
        ultimo: ultimoBackup, numero: ultimoBackup ? 1 : 0, fileDati: "memoria del browser (versione dimostrativa)" };
    },
    async backupOra() {
      const d = await this.carica();
      scarica(new Blob([JSON.stringify(d, null, 1)], { type: "application/json" }), `archivio-${new Date().toISOString().slice(0, 10)}.json`);
      ultimoBackup = new Date().toISOString();
      return "scaricato";
    },
    async apriBackup() { alert("Nella versione desktop si apre la cartella dei backup sul PC."); },
    async scegliCartellaBackup() { alert("Nella versione desktop qui si sceglie la cartella dei backup, anche su OneDrive o Google Drive."); return null; },
    async ripristina() { return { errore: "Nella versione dimostrativa il ripristino non è disponibile" }; },
    async mostraFile() {},
    // Sceglie un file dal computer e ne estrae le righe di testo (PDF, Excel, CSV, TXT)
    leggiIscritti() {
      return new Promise(resolve => {
        const inp = document.createElement("input");
        inp.type = "file"; inp.accept = ".pdf,.xlsx,.csv,.txt";
        inp.addEventListener("cancel", () => resolve({ annullato: true }));
        inp.addEventListener("change", async () => {
          const f = inp.files[0];
          if (!f) return resolve({ annullato: true });
          try {
            const righe = await leggiFile(f);
            resolve(righe.length ? { nome: f.name, righe } : { errore: "Nel file non c'è testo leggibile. Se il PDF è una scansione, serve la versione digitale o un Excel." });
          } catch (e) { console.error(e); resolve({ errore: "Impossibile leggere il file scelto." }); }
        });
        inp.click();
      });
    },
    async esportaExcel(doc) {
      const wb = new ExcelJS.Workbook();
      wb.creator = "Valutazioni cavalli";
      for (const f of doc.fogli) {
        const ws = wb.addWorksheet(f.nome.slice(0, 31), { views: [{ state: "frozen", ySplit: 4 }], pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
        const n = f.colonne.length;
        ws.addRow([f.titolo]).font = { bold: true, size: 14 }; ws.mergeCells(1, 1, 1, n);
        ws.addRow([f.sottotitolo || ""]).font = { italic: true, color: { argb: "FF5E6B63" } }; ws.mergeCells(2, 1, 2, n);
        ws.addRow([]);
        ws.addRow(f.colonne.map(c => c.titolo)).eachCell(c => {
          c.font = { bold: true, color: { argb: "FFFFFFFF" } };
          c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF24533D" } };
          c.alignment = { vertical: "middle", wrapText: true };
        });
        f.righe.forEach(r => ws.addRow(r.map(v => v ?? "")));
        f.colonne.forEach((c, i) => { const col = ws.getColumn(i + 1); col.width = c.larghezza || 14; if (c.num) col.alignment = { horizontal: "right" }; });
        ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: n } };
      }
      const buf = await wb.xlsx.writeBuffer();
      scarica(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), doc.nomeFile.replace(/[\\/:*?"<>|]/g, "-") + ".xlsx");
      return { file: "scaricato" };
    },
  };

  async function leggiFile(f) {
    const ext = f.name.toLowerCase().split(".").pop();
    let righe = [];
    if (ext === "pdf") {
      const base = new URL("assets/pdfjs/", location.href).href;
      const pdfjs = await import(base + "pdf.min.mjs");
      pdfjs.GlobalWorkerOptions.workerSrc = base + "pdf.worker.min.mjs";
      const doc = await pdfjs.getDocument({ data: new Uint8Array(await f.arrayBuffer()), isEvalSupported: false }).promise;
      for (let n = 1; n <= doc.numPages; n++) {
        const { items } = await (await doc.getPage(n)).getTextContent();
        const gruppi = [];
        for (const it of items) {
          if (!it.str || !it.str.trim()) continue;
          const y = it.transform[5];
          let g = gruppi.find(g => Math.abs(g.y - y) < 3);
          if (!g) { g = { y, pezzi: [] }; gruppi.push(g); }
          g.pezzi.push({ x: it.transform[4], s: it.str });
        }
        gruppi.sort((a, b) => b.y - a.y).forEach(g => righe.push(g.pezzi.sort((a, b) => a.x - b.x).map(p => p.s.trim()).join("  ")));
      }
      await doc.destroy();
    } else if (ext === "xlsx") {
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(await f.arrayBuffer());
      wb.eachSheet(ws => ws.eachRow(r => {
        const v = (r.values || []).slice(1).map(c => (c && typeof c === "object") ? (c.text ?? c.result ?? "") : (c ?? "")).map(String).filter(x => x.trim());
        if (v.length) righe.push(v.join("  "));
      }));
    } else {
      righe = (await f.text()).split(/\r?\n/).map(r => r.replace(/[;,\t]/g, "  "));
    }
    return righe.map(r => r.replace(/\s+/g, " ").trim()).filter(Boolean);
  }
  window.__leggiFileDemo = leggiFile; // usato solo per i test

  document.addEventListener("click", e => {
    if (e.target.closest("#demoReset") && confirm("Ripristinare i dati di esempio? Le modifiche fatte in questa prova andranno perse.")) {
      localStorage.removeItem(KEY); location.reload();
    }
  });
})();
