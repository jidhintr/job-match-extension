const MAX_CHARS = 20000;

export async function parseResumeFile(file) {
  const name = (file.name || "").toLowerCase();

  if (name.endsWith(".pdf") || file.type === "application/pdf") {
    return (await parsePdf(file)).slice(0, MAX_CHARS);
  }
  if (name.endsWith(".docx")) {
    return (await parseDocx(file)).slice(0, MAX_CHARS);
  }
  if (name.endsWith(".doc")) {
    throw new Error("Old .doc format isn't supported — save it as .docx or PDF and try again.");
  }
  throw new Error("Unsupported file type — upload a .pdf or .docx file.");
}

async function parsePdf(file) {
  const pdfjsLib = await import(chrome.runtime.getURL("lib/pdfjs/pdf.min.mjs"));
  pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL("lib/pdfjs/pdf.worker.min.mjs");

  const data = new Uint8Array(await file.arrayBuffer());
  const doc = await pdfjsLib.getDocument({ data }).promise;

  const pageTexts = [];
  for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
    const page = await doc.getPage(pageNum);
    const content = await page.getTextContent();
    pageTexts.push(content.items.map((item) => item.str || "").join(" "));
  }

  const text = pageTexts.join("\n\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!text) throw new Error("Couldn't find any text in that PDF — is it a scanned image?");
  return text;
}

async function parseDocx(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const xml = await extractZipEntryText(bytes, "word/document.xml");
  if (!xml) throw new Error("Couldn't find document content in that .docx file.");

  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.querySelector("parsererror")) throw new Error("Couldn't parse that .docx file's contents.");

  const paragraphs = [];
  doc.querySelectorAll("w\\:p, p").forEach((p) => {
    let text = "";
    p.querySelectorAll("w\\:t, w\\:tab, w\\:br, t, tab, br").forEach((node) => {
      const tag = node.tagName.toLowerCase();
      if (tag.endsWith(":t") || tag === "t") text += node.textContent;
      else if (tag.endsWith(":tab") || tag === "tab") text += "\t";
      else if (tag.endsWith(":br") || tag === "br") text += "\n";
    });
    if (text.trim()) paragraphs.push(text.trim());
  });

  const result = paragraphs.join("\n").trim();
  if (!result) throw new Error("Couldn't find any text in that .docx file.");
  return result;
}

async function extractZipEntryText(bytes, entryName) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  const EOCD_SIG = 0x06054b50;
  let eocdOffset = -1;
  const searchStart = Math.max(0, bytes.length - 22 - 65535);
  for (let i = bytes.length - 22; i >= searchStart; i--) {
    if (view.getUint32(i, true) === EOCD_SIG) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset === -1) throw new Error("Not a valid .docx (zip) file.");

  const cdEntryCount = view.getUint16(eocdOffset + 10, true);
  const cdOffset = view.getUint32(eocdOffset + 16, true);

  const CD_SIG = 0x02014b50;
  const decoder = new TextDecoder("utf-8");
  let pos = cdOffset;

  for (let i = 0; i < cdEntryCount; i++) {
    if (view.getUint32(pos, true) !== CD_SIG) break;

    const compMethod = view.getUint16(pos + 10, true);
    const compSize = view.getUint32(pos + 20, true);
    const nameLen = view.getUint16(pos + 28, true);
    const extraLen = view.getUint16(pos + 30, true);
    const commentLen = view.getUint16(pos + 32, true);
    const localHeaderOffset = view.getUint32(pos + 42, true);
    const name = decoder.decode(bytes.subarray(pos + 46, pos + 46 + nameLen));

    if (name === entryName) {
      return await readZipEntryData(bytes, view, localHeaderOffset, compMethod, compSize);
    }
    pos += 46 + nameLen + extraLen + commentLen;
  }
  return null;
}

async function readZipEntryData(bytes, view, localHeaderOffset, compMethod, compSize) {
  const LOCAL_SIG = 0x04034b50;
  if (view.getUint32(localHeaderOffset, true) !== LOCAL_SIG) {
    throw new Error("Malformed .docx (zip) local header.");
  }
  const nameLen = view.getUint16(localHeaderOffset + 26, true);
  const extraLen = view.getUint16(localHeaderOffset + 28, true);
  const dataStart = localHeaderOffset + 30 + nameLen + extraLen;
  const compressedData = bytes.subarray(dataStart, dataStart + compSize);

  if (compMethod === 0) {
    return new TextDecoder("utf-8").decode(compressedData);
  }
  if (compMethod === 8) {
    const stream = new Blob([compressedData]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    const outBytes = new Uint8Array(await new Response(stream).arrayBuffer());
    return new TextDecoder("utf-8").decode(outBytes);
  }
  throw new Error("Unsupported compression in .docx file.");
}
