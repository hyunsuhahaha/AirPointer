type PageImage = { data: Uint8Array; width: number; height: number };
const encode = (value: string) => new TextEncoder().encode(value);

async function jpeg(canvas: HTMLCanvasElement): Promise<PageImage> {
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("PDF 화면을 만들지 못했습니다.")), "image/jpeg", 0.92));
  return { data: new Uint8Array(await blob.arrayBuffer()), width: canvas.width, height: canvas.height };
}

async function textPages(value: string) {
  const width = 1240; const height = 1754; const margin = 80; const lineHeight = 40;
  const measureCanvas = document.createElement("canvas"); const measure = measureCanvas.getContext("2d")!;
  measure.font = "26px Arial, 'Malgun Gothic', sans-serif";
  const lines: string[] = [];
  for (const paragraph of value.split("\n")) {
    if (!paragraph) { lines.push(""); continue; }
    let line = "";
    for (const character of paragraph) {
      if (line && measure.measureText(line + character).width > width - margin * 2) { lines.push(line); line = character; }
      else line += character;
    }
    lines.push(line);
  }
  const perPage = Math.floor((height - margin * 2 - 60) / lineHeight);
  const pages: PageImage[] = [];
  for (let offset = 0; offset < lines.length; offset += perPage) {
    const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
    const context = canvas.getContext("2d")!; context.fillStyle = "white"; context.fillRect(0, 0, width, height);
    context.fillStyle = "#111"; context.font = "700 38px Arial, 'Malgun Gothic', sans-serif"; context.fillText("화면 맥락 기록", margin, margin + 25);
    context.font = "26px Arial, 'Malgun Gothic', sans-serif";
    lines.slice(offset, offset + perPage).forEach((line, index) => context.fillText(line.replace(/^#+\s*/, ""), margin, margin + 85 + index * lineHeight));
    pages.push(await jpeg(canvas));
  }
  return pages;
}

async function imagePage(file: File): Promise<PageImage> {
  const bitmap = await createImageBitmap(file);
  try {
    if (file.type === "image/jpeg") return { data: new Uint8Array(await file.arrayBuffer()), width: bitmap.width, height: bitmap.height };
    const canvas = document.createElement("canvas"); canvas.width = bitmap.width; canvas.height = bitmap.height;
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0); return await jpeg(canvas);
  } finally { bitmap.close(); }
}

function join(parts: Uint8Array[]) {
  const output = new Uint8Array(parts.reduce((total, part) => total + part.length, 0)); let offset = 0;
  for (const part of parts) { output.set(part, offset); offset += part.length; }
  return output;
}

function makePdf(pages: PageImage[]) {
  const objects: Uint8Array[] = [encode("<< /Type /Catalog /Pages 2 0 R >>"), encode(`<< /Type /Pages /Kids [${pages.map((_, index) => `${3 + index * 3} 0 R`).join(" ")}] /Count ${pages.length} >>`)];
  pages.forEach((page, index) => {
    const pageId = 3 + index * 3; const imageId = pageId + 1; const contentId = pageId + 2;
    const width = page.width > page.height ? 842 : 595; const height = page.width > page.height ? 595 : 842;
    const scale = Math.min((width - 36) / page.width, (height - 36) / page.height); const drawWidth = page.width * scale; const drawHeight = page.height * scale;
    const command = `q ${drawWidth.toFixed(2)} 0 0 ${drawHeight.toFixed(2)} ${((width - drawWidth) / 2).toFixed(2)} ${((height - drawHeight) / 2).toFixed(2)} cm /Image Do Q`;
    objects.push(encode(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /XObject << /Image ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>`));
    objects.push(join([encode(`<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.data.length} >>\nstream\n`), page.data, encode("\nendstream")]));
    objects.push(encode(`<< /Length ${command.length} >>\nstream\n${command}\nendstream`));
  });
  const parts: Uint8Array[] = [join([encode("%PDF-1.4\n%"), new Uint8Array([0xe2, 0xe3, 0xcf, 0xd3]), encode("\n")])]; const offsets: number[] = [];
  objects.forEach((object, index) => { offsets.push(parts.reduce((sum, part) => sum + part.length, 0)); parts.push(encode(`${index + 1} 0 obj\n`), object, encode("\nendobj\n")); });
  const xref = parts.reduce((sum, part) => sum + part.length, 0);
  parts.push(encode(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n `).join("\n")}\ntrailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`));
  return new Blob([join(parts).buffer as ArrayBuffer], { type: "application/pdf" });
}

export async function makeScreenContextPdf(files: File[]) {
  const context = files.find((file) => file.name.endsWith("context.md")); const images = files.filter((file) => file.type.startsWith("image/"));
  if (!context || !images.length) throw new Error("PDF에 넣을 화면 자료가 없습니다.");
  return makePdf([...await textPages(await context.text()), ...await Promise.all(images.map(imagePage))]);
}
