// PDF-jelentés: a betöltött mérésből valódi PDF-fájlt készít, külső könyvtár nélkül.
// Minden oldalt egy vászonra (canvas) rajzol, hogy az ő és ű betűk is helyesen jelenjenek meg, majd képként egy A4-es PDF-be csomagolja.
// Az 1. oldal a mérések táblázata. Ha van szűrés, a következő oldalakon az oldalon látható grafikonok is szerepelnek.
// A fájl letölthető, vagy a rendszer megosztási ablakával e-mailben is elküldhető.
// Az adatokról másolatot használunk, így az automatikus frissítés nem írhatja át a készülő jelentést.
window.GreenhouseReport = (() => {
  // A jelentés sorai. Egy sor jelentése: [ThingSpeak-mező, megnevezés, érzékelő, egység vagy az állapotok nevei, tizedesjegyek száma].
  // Az állapotmezőknél (eső, ventilátor, LED, tető) a lista első eleme a 0, a második az 1 értékhez tartozó szöveg.
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

  // Egy időpontot olvasható, budapesti idejű szöveggé alakít (pl. 2026. nov. 8. 19:33). Hiányzó adatnál 'Nincs megadva'.
  function formatTime(value) {
    const date = value ? new Date(value) : null;
    return date && Number.isFinite(date.getTime())
      ? new Intl.DateTimeFormat("hu-HU", {
        timeZone: "Europe/Budapest", dateStyle: "medium", timeStyle: "short"
      }).format(date)
      : "Nincs megadva";
  }

  // Összeállítja a jelentés adatait: a sorokat (megnevezés, érzékelő, érték), az időpontokat és azt, hogy a mérés friss vagy régi (2 percnél régebbi).
  // Csak adatot ad vissza, a DOM-hoz nem nyúl, ezért Node-ban is tesztelhető. A hiányzó érték 'Nincs adat' lesz, nem 0.
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

  // A fájlnevet a mérés napjából képezi (pl. noveny-haz-jelentes-2026-11-08.pdf), így több jelentés nem keveredik össze.
  function fileName(entry) {
    const date = entry && entry.created_at ? new Date(entry.created_at) : new Date();
    const day = Number.isFinite(date.getTime())
      ? new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Budapest" }).format(date)
      : "ismeretlen-datum";
    return `noveny-haz-jelentes-${day}.pdf`;
  }

  // Egy PDF-fájlt állít össze bájtonként: minden oldalon egyetlen, az egész oldalt kitöltő JPEG-kép van.
  // pages: oldalak listája, mindegyik { jpeg: bájtok, width: szélesség, height: magasság }.
  // A PDF-ben csak sima szöveges vezérlősorok és a kép bájtjai vannak, ezért nincs szükség külső könyvtárra.
  function createPdf(pages) {
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
    // Az i. oldal objektumai: 3+3i (oldal), 4+3i (kép) és 5+3i (tartalom).
    object(2, () => push(`<< /Type /Pages /Kids [${pages.map((_, i) => `${3 + 3 * i} 0 R`).join(" ")}] /Count ${pages.length} >>`));
    pages.forEach(({ jpeg, width, height }, i) => {
      const page = 3 + 3 * i;
      object(page, () => push("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595.28 841.89] "
        + `/Resources << /XObject << /Im0 ${page + 1} 0 R >> >> /Contents ${page + 2} 0 R >>`));
      object(page + 1, () => {
        push(`<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB `
          + `/BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`);
        push(jpeg);
        push("\nendstream");
      });
      object(page + 2, () => push(`<< /Length ${content.length} >>\nstream\n${content}endstream`));
    });
    const objectCount = 2 + 3 * pages.length;
    const xref = length;
    push(`xref\n0 ${objectCount + 1}\n0000000000 65535 f \n`
      + offsets.slice(1).map((offset) => String(offset).padStart(10, "0") + " 00000 n \n").join("")
      + `trailer\n<< /Size ${objectCount + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

    const pdf = new Uint8Array(length);
    let position = 0;
    for (const chunk of chunks) {
      pdf.set(chunk, position);
      position += chunk.length;
    }
    return pdf;
  }

  // Megrajzolja az 1. oldalt egy A4-es vászonra (150 dpi): cím, időpontok, állapot, mérések táblázata, lábjegyzet.
  // A feliratokat sima szövegként rajzoljuk a vászonra, így HTML-ként soha nem értelmeződnek.
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
    // Csak akkor van beállítva, ha a grafikonok is a PDF-ben vannak, így az 1. oldalon is látszik a szűrt időszak.
    if (report.periodLabel) text(report.periodLabel, margin, y += 42, 26);
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

  // Azok a stílustulajdonságok, amelyek miatt az SVG-grafikon az oldalon kívül is ugyanúgy néz ki.
  const CHART_STYLE_PROPERTIES = [
    "fill", "fill-opacity", "stroke", "stroke-width", "stroke-opacity", "stroke-dasharray", "stroke-linecap",
    "stroke-linejoin", "opacity", "display", "visibility", "font-family", "font-size", "font-weight",
    "text-anchor", "letter-spacing"
  ];

  // Megkeresi az elem alatti első nem átlátszó háttérszínt, felfelé haladva az oldalig. A grafikon hátteréhez kell.
  function findBackground(element) {
    for (let node = element; node; node = node.parentElement) {
      const color = getComputedStyle(node).backgroundColor;
      if (color && color !== "transparent" && !/rgba\(.*,\s*0\)$/.test(color)) return color;
    }
    return "#ffffff";
  }

  // Egy, az oldalon lévő grafikont (SVG) vászonra rajzol ugyanazokkal a színekkel és betűkkel, mint a képernyőn.
  // Az SVG-képek nem látják az oldal stíluslapjait, ezért a CSS-szabályokat beírjuk közvetlenül az elemekre (inline stílus).
  function chartToCanvas(svg) {
    const box = svg.viewBox && svg.viewBox.baseVal && svg.viewBox.baseVal.width
      ? svg.viewBox.baseVal
      : svg.getBoundingClientRect();
    const width = Math.round(box.width);
    const height = Math.round(box.height);
    const clone = svg.cloneNode(true);
    const originals = [svg, ...svg.querySelectorAll("*")];
    const copies = [clone, ...clone.querySelectorAll("*")];
    originals.forEach((original, i) => {
      const computed = getComputedStyle(original);
      copies[i].setAttribute("style", CHART_STYLE_PROPERTIES.map((name) => `${name}:${computed.getPropertyValue(name)}`).join(";"));
    });
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    clone.setAttribute("width", String(width));
    clone.setAttribute("height", String(height));
    const background = findBackground(svg.parentElement || svg);
    const scale = 2;
    const markup = new XMLSerializer().serializeToString(clone);
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = width * scale;
        canvas.height = height * scale;
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = background;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas);
      };
      image.onerror = () => reject(new Error("A grafikon nem alakítható képpé."));
      image.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(markup);
    });
  }

  // Egy A4-es oldalra ennyi grafikon fér el egymás alatt.
  const CHARTS_PER_PAGE = 4;

  // A grafikonokat A4-es oldalakra rendezi egymás alá (oldalanként CHARTS_PER_PAGE darab).
  // Az első oldal tetején a cím és a szűrt időszak is szerepel.
  async function drawChartPages(svgs, periodLabel) {
    const width = 1240;
    const height = 1754;
    const margin = 110;
    const gap = 24;
    const images = [];
    for (const svg of svgs) images.push(await chartToCanvas(svg));

    const pages = [];
    for (let start = 0; start < images.length; start += CHARTS_PER_PAGE) {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, width, height);
      ctx.fillStyle = "#2c6b3c";
      ctx.fillRect(margin, margin, width - margin * 2, 8);
      ctx.fillStyle = "#17241b";
      ctx.textAlign = "left";
      let y = margin + 40;
      if (start === 0) {
        ctx.font = "bold 44px Arial, Helvetica, sans-serif";
        ctx.fillText("Mérési előzmények", margin, y + 30);
        ctx.font = "26px Arial, Helvetica, sans-serif";
        ctx.fillText(periodLabel, margin, y + 74);
        y += 110;
      }
      const cellWidth = width - margin * 2;
      const cellHeight = (height - margin - y - gap * (CHARTS_PER_PAGE - 1)) / CHARTS_PER_PAGE;
      images.slice(start, start + CHARTS_PER_PAGE).forEach((image) => {
        const scale = Math.min(cellWidth / image.width, cellHeight / image.height);
        const w = image.width * scale;
        const h = image.height * scale;
        ctx.drawImage(image, margin + (cellWidth - w) / 2, y, w, h);
        y += h + gap;
      });
      pages.push(canvas);
    }
    return pages;
  }

  // A canvas.toDataURL base64 szöveget ad, a PDF-nek viszont a JPEG nyers bájtjai kellenek.
  function base64ToBytes(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  // Egy vászonból egy JPEG-oldalt készít a PDF-hez.
  function toPage(canvas) {
    const jpeg = base64ToBytes(canvas.toDataURL("image/jpeg", 0.92).split(",")[1]);
    return { jpeg, width: canvas.width, height: canvas.height };
  }

  // Elkészíti a teljes PDF-fájlt: az 1. oldal a mérések, utána (ha van szűrés) a grafikonok.
  // options.charts az oldalon lévő SVG-grafikonok, options.periodLabel pedig a szűrt időszak felirata.
  async function createFile(entry, options = {}) {
    const report = buildReport({ ...entry });
    const withCharts = Array.isArray(options.charts) && options.charts.length > 0;
    if (withCharts) report.periodLabel = options.periodLabel || "";
    const pages = [toPage(drawReport(report))];
    if (withCharts) {
      for (const canvas of await drawChartPages(options.charts, options.periodLabel || "")) pages.push(toPage(canvas));
    }
    return new File([createPdf(pages)], fileName(entry), { type: "application/pdf" });
  }

  // Elindítja a fájl letöltését egy ideiglenes hivatkozással. A hivatkozást pár másodperc múlva felszabadítjuk, hogy ne foglalja a memóriát.
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

  // PDF mentése a számítógépre. Visszaadja a fájl nevét, amit az eseménynaplóba írunk.
  async function download(entry, options) {
    const file = await createFile(entry, options);
    downloadFile(file);
    return file.name;
  }

  /*
  Email sending: where the browser supports it (Windows, Android, iOS), the system
  share sheet opens and the PDF is attached in the mail app.
  Elsewhere we download the PDF and open the mail client with a prefilled subject;
  a mailto: link cannot carry attachments, so there the file has to be attached by hand.
  */
  // E-mailes küldés. Ahol a böngésző támogatja (Windows, Android, iOS), megnyílik a rendszer megosztási ablaka,
  // és a PDF csatolva kerül a levelezőalkalmazásba. Máshol letöltjük a PDF-et, és megnyitjuk a levelezőt kitöltött tárggyal.
  // A mailto: hivatkozás nem tud csatolmányt átadni, ezért ilyenkor a fájlt kézzel kell csatolni.
  async function sendByEmail(entry, options) {
    const file = await createFile(entry, options);
    const message = "Csatolva küldöm az Okos Növényház aktuális mérési jelentését.";
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: EMAIL_SUBJECT, text: message });
        return { method: "share", fileName: file.name };
      } catch (error) {
        if (error && error.name === "AbortError") return { method: "cancelled", fileName: file.name };
        // Ha a megosztás mégsem indul el, letöltésre váltunk.
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
