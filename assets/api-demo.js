// Sostituisce le funzioni del programma desktop con equivalenti nel browser.
(function () {
  const KEY = "valutazioni-cavalli-demo";
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

  document.addEventListener("click", e => {
    if (e.target.closest("#demoReset") && confirm("Ripristinare i dati di esempio? Le modifiche fatte in questa prova andranno perse.")) {
      localStorage.removeItem(KEY); location.reload();
    }
  });
})();
