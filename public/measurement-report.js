/*
Az aktuálisan betöltött mérésből valódi PDF-fájlt készítünk, külső könyvtár nélkül.
A jelentést vászonra rajzoljuk (így az ő, ű betűk is helyesen jelennek meg),
majd a képet egy egyoldalas A4-es PDF-be csomagoljuk.
A fájl letölthető, vagy a rendszer megosztási ablakával e-mailben elküldhető.
Másolatot használunk: az automatikus frissítés nem írja át a készülő jelentést.
*/
window.GreenhouseReport = (() => {
  const fields = [
    ["field1", "Hőmérséklet", "BME280", "°C", 1],
    ["field2", "Relatív páratartalom", "BME280", "%", 1],
    ["field3", "Légnyomás", "BME280", "hPa", 1],
    ["field4", "Megvilágítás", "TSL2561", "lux", 0],
    ["field5", "Esőérzékelő", "", ["Nem jelez esőt", "Esőt jelez"]],
    ["field6", "Ventilátor", "", ["Kikapcsolva", "Bekapcsolva"]],
    ["field7", "Kiegészítő LED", "", ["Kikapcsolva", "Bekapcsolva"]],
    ["field8", "Növényház teteje", "", ["Zárva", "Nyitva"]]
  ];
  const FOOTER = "Forrás: az oldalon legutóbb betöltött ThingSpeak-mérés. A jelentés a rögzített állapotot mutatja; "
    + "a mentés nem indít új mérést. Az esőérzékelő csapadékmennyiséget nem mér.";
  const EMAIL_SUBJECT = "Okos Növényház - mérési jelentés";

  function formatTime(value) {
    const date = value ? new Date(value) : null;
    return date && Number.isFinite(date.getTime())
      ? new Intl.DateTimeFormat("hu-HU", {
        timeZone: "Europe/Budapest", dateStyle: "medium", timeStyle: "short"
      }).format(date)
      : "Nincs megadva";
  }

  function buildReport(entry, now = new Date()) {
    if (!entry || typeof entry !== "object") throw new Error("Még nincs exportálható mérés.");
    const timestamp = entry.created_at ? Date.parse(entry.created_at) : NaN;
    const status = !Number.isFinite(timestamp) ? "A mérés időpontja ismeretlen"
      : now.getTime() - timestamp > 120_000 ? "Régi mérés" : "Friss mérés";
    const rows = fields.map(([key, name, device, unit, digits]) => {
      const raw = entry[key];
      const number = (typeof raw === "number" || typeof raw === "string") && String(raw).trim() !== ""
        ? Number(raw) : NaN;
      let value = "Nincs adat";
      if (Number.isFinite(number)) {
        value = Array.isArray(unit)
          ? unit[number] ?? "Ismeretlen állapot"
          : new Intl.NumberFormat("hu-HU", { maximumFractionDigits: digits }).format(number) + " " + unit;
      }
      return { name, device, value };
    });
    return { measuredAt: formatTime(entry.created_at), exportedAt: formatTime(now), status, rows };
  }

  // A fájlnév a mérés napját tartalmazza, hogy több jelentés ne keveredjen össze.
  function fileName(entry) {
    const date = entry && entry.created_at ? new Date(entry.created_at) : new Date();
    const day = Number.isFinite(date.getTime())
      ? new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Budapest" }).format(date)
      : "ismeretlen-datum";
    return `noveny-haz-jelentes-${day}.pdf`;
  }

  // Egyoldalas PDF egyetlen JPEG-képpel. Csak ASCII szöveg és a kép bájtjai kerülnek bele.
  function createPdf(jpeg, width, height) {
    const encoder = new TextEncoder();
    const chunks = [];
    const offsets = [];
    let length = 0;
    const push = (chunk) => {
      const bytes = typeof chunk === "string" ? encoder.encode(chunk) : chunk;
      chunks.push(bytes);
      length += bytes.length;
    };
    const object = (number, write) => {
      offsets[number] = length;
      push(`${number} 0 obj\n`);
      write();
      push("\nendobj\n");
    };
    const content = "q\n595.28 0 0 841.89 0 0 cm\n/Im0 Do\nQ\n";

    push("%PDF-1.4\n");
    push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));
    object(1, () => push("<< /Type /Catalog /Pages 2 0 R >>"));
    object(2, () => push("<< /Type /Pages /Kids [3 0 R] /Count 1 >>"));
    object(3, () => push("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] "
      + "/Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>"));
    object(4, () => {
      push(`<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB `
        + `/BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`);
      push(jpeg);
      push("\nendstream");
    });
    object(5, () => push(`<< /Length ${content.length} >>\nstream\n${content}endstream`));
    const xref = length;
    push("xref\n0 6\n0000000000 65535 f \n"
      + offsets.slice(1).map((offset) => String(offset).padStart(10, "0") + " 00000 n \n").join("")
      + `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

    const pdf = new Uint8Array(length);
    let position = 0;
    for (const chunk of chunks) {
      pdf.set(chunk, position);
      position += chunk.length;
    }
    return pdf;
  }

  // A4 lap 150 dpi felbontással. A feliratok szövegként kerülnek a vászonra, HTML-ként nem értelmeződnek.
  function drawReport(report) {
    const width = 1240;
    const height = 1754;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    const margin = 110;
    const right = width - margin;
    const font = (size, weight = "normal") => `${weight} ${size}px Arial, Helvetica, sans-serif`;
    const text = (value, x, atY, size, weight, align = "left") => {
      ctx.font = font(size, weight);
      ctx.textAlign = align;
      ctx.fillText(value, x, atY);
    };
    const line = (atY) => {
      ctx.fillStyle = "#ccd5ce";
      ctx.fillRect(margin, atY, right - margin, 2);
      ctx.fillStyle = "#17241b";
    };
    let y = margin;

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = "#2c6b3c";
    ctx.fillRect(margin, y, right - margin, 8);
    ctx.fillStyle = "#17241b";

    text("Okos Növényház", margin, y += 80, 54, "bold");
    text("Aktuális mérési jelentés", margin, y += 56, 30);
    text("Mérés időpontja: " + report.measuredAt, margin, y += 70, 26);
    text("Jelentés készítése: " + report.exportedAt, margin, y += 42, 26);
    text(report.status, margin, y += 42, 26, "bold");
    text("Mérések és eszközállapotok", margin, y += 90, 34, "bold");

    const deviceX = margin + 520;
    const rowHeight = 74;
    y += 60;
    text("Mérés / eszköz", margin + 10, y, 25, "bold");
    text("Érzékelő", deviceX, y, 25, "bold");
    text("Érték / állapot", right - 10, y, 25, "bold", "right");
    line(y += 22);
    for (const row of report.rows) {
      y += rowHeight;
      const textY = y - rowHeight / 2 + 10;
      text(row.name, margin + 10, textY, 27);
      text(row.device || "—", deviceX, textY, 27);
      text(row.value, right - 10, textY, 27, "normal", "right");
      line(y);
    }

    // A lábjegyzetet szavanként tördeljük, hogy kiférjen a margók közé.
    y += 80;
    ctx.fillStyle = "#45564a";
    ctx.font = font(22);
    ctx.textAlign = "left";
    let current = "";
    for (const word of FOOTER.split(" ")) {
      const next = current ? current + " " + word : word;
      if (current && ctx.measureText(next).width > right - margin) {
        ctx.fillText(current, margin, y);
        y += 34;
        current = word;
      } else {
        current = next;
      }
    }
    if (current) ctx.fillText(current, margin, y);
    return canvas;
  }

  function base64ToBytes(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  // Szinkron készül el, hogy a megosztás még a gombnyomáshoz kötött engedéllyel induljon.
  function createFile(entry) {
    const report = buildReport({ ...entry });
    const canvas = drawReport(report);
    const jpeg = base64ToBytes(canvas.toDataURL("image/jpeg", 0.92).split(",")[1]);
    const pdf = createPdf(jpeg, canvas.width, canvas.height);
    return new File([pdf], fileName(entry), { type: "application/pdf" });
  }

  function downloadFile(file) {
    const url = URL.createObjectURL(file);
    const link = document.createElement("a");
    link.href = url;
    link.download = file.name;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }

  function download(entry) {
    const file = createFile(entry);
    downloadFile(file);
    return file.name;
  }

  /*
  E-mailes küldés: ahol a böngésző támogatja (Windows, Android, iOS), a rendszer
  megosztási ablaka nyílik meg, és a PDF csatolmányként kerül a levelezőalkalmazásba.
  Máshol letöltjük a PDF-et, és megnyitjuk a levelezőt kitöltött tárggyal;
  a mailto: hivatkozás nem tud csatolmányt adni, ezért ott a fájlt kézzel kell hozzáadni.
  */
  async function sendByEmail(entry) {
    const file = createFile(entry);
    const message = "Csatolva küldöm az Okos Növényház aktuális mérési jelentését.";
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: EMAIL_SUBJECT, text: message });
        return { method: "share", fileName: file.name };
      } catch (error) {
        if (error && error.name === "AbortError") return { method: "cancelled", fileName: file.name };
        // Ha a megosztás mégsem indul el, a letöltéses megoldásra váltunk.
      }
    }
    downloadFile(file);
    const body = `${message}\n\nA jelentés letöltődött ezzel a névvel: ${file.name}\n`
      + "Kérlek, csatold ezt a fájlt a levélhez a küldés előtt.";
    window.location.href = "mailto:?subject=" + encodeURIComponent(EMAIL_SUBJECT)
      + "&body=" + encodeURIComponent(body);
    return { method: "mailto", fileName: file.name };
  }

  return { buildReport, createPdf, fileName, download, sendByEmail };
})();
