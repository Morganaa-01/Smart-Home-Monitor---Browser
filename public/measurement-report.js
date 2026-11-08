// PDF report: makes a real PDF file from the loaded measurement, without any library.
// Each page is drawn on a canvas (so letters like ő and ű look right) and put into an A4 PDF as an image.
// Page 1 is the measurement table, page 2 is the history charts (if they are loaded).
// The file can be downloaded or sent by email through the share sheet of the system.
// We work on a copy of the data, so the automatic refresh cannot change a report that is being made.
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

  // The file name contains the measurement day, so multiple reports do not get mixed up.
  function fileName(entry) {
    const date = entry && entry.created_at ? new Date(entry.created_at) : new Date();
    const day = Number.isFinite(date.getTime())
      ? new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Budapest" }).format(date)
      : "ismeretlen-datum";
    return `noveny-haz-jelentes-${day}.pdf`;
  }

  // PDF with one full-page JPEG image per page. It only contains ASCII text and the image bytes.
  // pages: [{ jpeg: Uint8Array, width, height }]
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
    // Page i uses objects 3+3i (page), 4+3i (image) and 5+3i (content stream).
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

  // A4 page at 150 dpi. Labels are drawn as plain text on the canvas, never interpreted as HTML.
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

    // Wrap the footer word by word so it fits between the margins.
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

  // Turns the loaded history feeds into one data series per field, ready to draw.
  function buildCharts(feeds) {
    const list = Array.isArray(feeds) ? feeds : [];
    return fields.map(([key, name, , unit]) => {
      const states = Array.isArray(unit) ? unit : null;
      const points = [];
      for (const feed of list) {
        const raw = feed && feed[key];
        const value = (typeof raw === "number" || typeof raw === "string") && String(raw).trim() !== ""
          ? Number(raw) : NaN;
        const time = feed && feed.created_at ? Date.parse(feed.created_at) : NaN;
        if (Number.isFinite(value) && Number.isFinite(time)) points.push({ time, value });
      }
      points.sort((a, b) => a.time - b.time);
      return { name, unit: states ? "" : unit, states, points: thin(points) };
    });
  }

  // Keeps the lowest and highest value of each bucket so peaks and state changes stay visible.
  function thin(points, maxPoints = 600) {
    if (points.length <= maxPoints) return points;
    const bucketSize = Math.ceil(points.length / (maxPoints / 2));
    const kept = [];
    for (let start = 0; start < points.length; start += bucketSize) {
      const bucket = points.slice(start, start + bucketSize);
      const low = bucket.reduce((a, b) => (b.value < a.value ? b : a));
      const high = bucket.reduce((a, b) => (b.value > a.value ? b : a));
      for (const point of [low, high].sort((a, b) => a.time - b.time)) {
        if (kept.at(-1) !== point) kept.push(point);
      }
    }
    return kept;
  }

  // Draws one line chart into the given rectangle of the canvas.
  function drawChart(ctx, chart, x, y, w, h) {
    const font = (size, weight = "normal") => `${weight} ${size}px Arial, Helvetica, sans-serif`;
    const number = (value, digits) => new Intl.NumberFormat("hu-HU", { maximumFractionDigits: digits }).format(value);
    const { points, states } = chart;
    const title = chart.unit ? `${chart.name} (${chart.unit})` : chart.name;
    const plot = { left: x + (states ? 150 : 84), right: x + w - 14, top: y + 58, bottom: y + h - 44 };

    ctx.fillStyle = "#17241b";
    ctx.textAlign = "left";
    ctx.font = font(24, "bold");
    ctx.fillText(title, x, y + 26);
    if (points.length) {
      const latest = points.at(-1).value;
      ctx.textAlign = "right";
      ctx.font = font(24);
      ctx.fillStyle = "#2c6b3c";
      ctx.fillText(states ? states[latest] ?? "—" : number(latest, 1) + (chart.unit ? " " + chart.unit : ""), x + w, y + 26);
    }

    let min = states ? 0 : Math.min(...points.map((p) => p.value));
    let max = states ? 1 : Math.max(...points.map((p) => p.value));
    if (!points.length) { min = 0; max = 1; }
    if (!states) {
      // A flat series would collapse the axis, so give it some room.
      const pad = max === min ? Math.max(Math.abs(max) * 0.05, 1) : (max - min) * 0.08;
      // Measurements that were never negative (lux, humidity) should not get a negative axis.
      const nonNegative = min >= 0;
      min -= pad;
      max += pad;
      if (nonNegative && min < 0) min = 0;
    }
    const range = max - min;

    const ticks = states ? 2 : 4;
    ctx.font = font(19);
    for (let i = 0; i < ticks; i += 1) {
      const ratio = i / (ticks - 1);
      const yy = plot.top + ratio * (plot.bottom - plot.top);
      ctx.fillStyle = "#dfe6e1";
      ctx.fillRect(plot.left, yy, plot.right - plot.left, 1.5);
      ctx.fillStyle = "#45564a";
      ctx.textAlign = "right";
      const tick = max - ratio * range;
      ctx.fillText(states ? states[Math.round(tick)] : number(tick, 1), plot.left - 10, yy + 7);
    }

    if (!points.length) {
      ctx.fillStyle = "#45564a";
      ctx.textAlign = "center";
      ctx.fillText("Nincs mérési adat", (plot.left + plot.right) / 2, (plot.top + plot.bottom) / 2);
      return;
    }

    const first = points[0].time;
    const span = points.at(-1).time - first;
    const px = (time) => (span === 0 ? (plot.left + plot.right) / 2 : plot.left + ((time - first) / span) * (plot.right - plot.left));
    const py = (value) => plot.bottom - ((value - min) / range) * (plot.bottom - plot.top);

    // Time axis: three labels, with the hour only when the period is short.
    const showHour = span < 3 * 86_400_000;
    const timeLabel = (time) => new Intl.DateTimeFormat("hu-HU", showHour
      ? { timeZone: "Europe/Budapest", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }
      : { timeZone: "Europe/Budapest", month: "short", day: "numeric" }).format(new Date(time));
    ctx.fillStyle = "#45564a";
    ctx.font = font(19);
    // A narrow plot (charts with long state labels) only has room for the two end labels.
    const labels = span === 0 ? [[0.5, "center"]]
      : plot.right - plot.left < 380 ? [[0, "left"], [1, "right"]] : [[0, "left"], [0.5, "center"], [1, "right"]];
    labels.forEach(([ratio, align]) => {
      ctx.textAlign = align;
      ctx.fillText(timeLabel(first + ratio * span), plot.left + ratio * (plot.right - plot.left), plot.bottom + 30);
    });

    const path = new Path2D();
    points.forEach((point, i) => {
      const xx = px(point.time);
      const yy = py(point.value);
      if (i === 0) {
        path.moveTo(xx, yy);
      } else {
        // On/off devices change state at a moment, so they are drawn as steps.
        if (states) path.lineTo(xx, py(points[i - 1].value));
        path.lineTo(xx, yy);
      }
    });
    ctx.strokeStyle = "#2c6b3c";
    ctx.lineWidth = 3;
    ctx.lineJoin = "round";
    ctx.stroke(path);
    ctx.fillStyle = "#2c6b3c";
    ctx.beginPath();
    ctx.arc(px(points.at(-1).time), py(points.at(-1).value), 5, 0, Math.PI * 2);
    ctx.fill();
  }

  // Second A4 page: the eight history charts in two columns.
  function drawChartsPage(charts, periodLabel) {
    const width = 1240;
    const height = 1754;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    const margin = 110;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = "#2c6b3c";
    ctx.fillRect(margin, margin, width - margin * 2, 8);
    ctx.fillStyle = "#17241b";
    ctx.textAlign = "left";
    ctx.font = "bold 44px Arial, Helvetica, sans-serif";
    ctx.fillText("Mérési előzmények", margin, margin + 70);
    ctx.font = "26px Arial, Helvetica, sans-serif";
    ctx.fillText(periodLabel, margin, margin + 114);

    const gap = 50;
    const cellW = (width - margin * 2 - gap) / 2;
    const cellH = 330;
    const top = margin + 170;
    charts.forEach((chart, i) => {
      const column = i % 2;
      const row = Math.floor(i / 2);
      drawChart(ctx, chart, margin + column * (cellW + gap), top + row * (cellH + 20), cellW, cellH);
    });
    return canvas;
  }

  function base64ToBytes(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  function toPage(canvas) {
    const jpeg = base64ToBytes(canvas.toDataURL("image/jpeg", 0.92).split(",")[1]);
    return { jpeg, width: canvas.width, height: canvas.height };
  }

  // Built synchronously so sharing still starts within the permission granted by the button click.
  // options.feeds and options.periodLabel add a second page with the history charts.
  function createFile(entry, options = {}) {
    const report = buildReport({ ...entry });
    const pages = [toPage(drawReport(report))];
    if (Array.isArray(options.feeds) && options.feeds.length) {
      pages.push(toPage(drawChartsPage(buildCharts(options.feeds), options.periodLabel || "")));
    }
    return new File([createPdf(pages)], fileName(entry), { type: "application/pdf" });
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

  function download(entry, options) {
    const file = createFile(entry, options);
    downloadFile(file);
    return file.name;
  }

  /*
  Email sending: where the browser supports it (Windows, Android, iOS), the system
  share sheet opens and the PDF is attached in the mail app.
  Elsewhere we download the PDF and open the mail client with a prefilled subject;
  a mailto: link cannot carry attachments, so there the file has to be attached by hand.
  */
  async function sendByEmail(entry, options) {
    const file = createFile(entry, options);
    const message = "Csatolva küldöm az Okos Növényház aktuális mérési jelentését.";
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: EMAIL_SUBJECT, text: message });
        return { method: "share", fileName: file.name };
      } catch (error) {
        if (error && error.name === "AbortError") return { method: "cancelled", fileName: file.name };
        // If sharing fails to start, fall back to downloading.
      }
    }
    downloadFile(file);
    const body = `${message}\n\nA jelentés letöltődött ezzel a névvel: ${file.name}\n`
      + "Kérlek, csatold ezt a fájlt a levélhez a küldés előtt.";
    window.location.href = "mailto:?subject=" + encodeURIComponent(EMAIL_SUBJECT)
      + "&body=" + encodeURIComponent(body);
    return { method: "mailto", fileName: file.name };
  }

  return { buildReport, buildCharts, createPdf, fileName, download, sendByEmail };
})();
