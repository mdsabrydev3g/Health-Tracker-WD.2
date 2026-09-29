/**
 * Free, keyless AI assistant for lab / x-ray reading.
 *
 * The previous implementation required a deployed Cloud Function + a PAID
 * OpenAI key. This module replaces that hard dependency with a fully free path:
 *
 *   1. OCR the uploaded image locally with Tesseract.js (Arabic + English).
 *   2. Extract text from PDFs with pdf.js.
 *   3. Summarise the extracted text via Pollinations — a free, no-API-key
 *      text model (https://pollinations.ai).
 *
 * Everything runs in the browser/Webview. No key, no server, no cost.
 * The original Cloud Function path is still honoured when configured.
 */

import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

const ARABIC_MEDICAL_PROMPT = (text: string): string =>
  `أنت مساعد طبي تعليمي (ولست طبيباً). لخّص نتائج الفحص أو التقرير الطبي التالي بلغة عربية بسيطة وواضحة. حدّد القيم غير الطبيعية واشرح ما قد تعنيه بأسلوب يفهمه غير المتخصصين. لا تعطِ تشخيصاً ولا وصفة طبية.\n\n${text.slice(0, 12000)}`;

/** Convert a data URL (as stored in localStorage) back into a File. */
export function dataUrlToFile(dataUrl: string, filename: string): File {
  const parts = dataUrl.split(',');
  const meta = parts[0] ?? '';
  const b64 = parts[1] ?? '';
  const mime = /:(.*?);/.exec(meta)?.[1] ?? 'application/octet-stream';
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new File([arr], filename, { type: mime });
}

/** OCR an image to plain text (Arabic + English). */
async function ocrImage(file: File): Promise<string> {
  const { createWorker } = await import('tesseract.js');
  const worker = await createWorker('ara+eng');
  try {
    const { data } = await worker.recognize(file);
    return data.text.trim();
  } finally {
    await worker.terminate();
  }
}

/** Extract text from a PDF using pdf.js. */
async function extractPdfText(file: File): Promise<string> {
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const buf = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: buf }).promise;
  let text = '';
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    text +=
      content.items
        .map((it) => ('str' in it ? it.str : ''))
        .join(' ')
        .trim() + '\n';
  }
  return text.trim();
}

/** Read text out of an uploaded lab image or PDF. Returns '' if nothing found. */
export async function extractText(file: File): Promise<string> {
  if (file.type === 'application/pdf') return extractPdfText(file);
  return ocrImage(file);
}

/**
 * Summarise free text with Pollinations (free, keyless). Falls back to a GET
 * if the JSON POST is rejected. Returns the model's raw text answer.
 */
export async function summariseLabText(text: string): Promise<string> {
  if (!text.trim()) return 'لم يتمكن المساعد من قراءة نص في الملف.';
  const prompt = ARABIC_MEDICAL_PROMPT(text);
  const body = JSON.stringify({ messages: [{ role: 'user', content: prompt }], model: 'openai' });

  try {
    const res = await fetch('https://text.pollinations.ai/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.text()).trim();
  } catch {
    // Fallback: encode the prompt in the URL (GET).
    const res = await fetch('https://text.pollinations.ai/' + encodeURIComponent(prompt));
    if (!res.ok) throw new Error('summary failed');
    return (await res.text()).trim();
  }
}
