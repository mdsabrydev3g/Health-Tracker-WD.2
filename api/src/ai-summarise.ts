/**
 * POST /api/ai/summarise  (route depends on your Vercel config)
 *
 * Server-side AI proxy for lab summarisation.
 *
 * KEY PRINCIPLE (§11): the assistant must be FREE and keyless by default.
 *   - No API key set  → Pollinations (free, no key).
 *   - GEMINI_API_KEY   → Gemini (supports vision via imageBase64).
 *   - OPENAI_API_KEY   → GPT-4o (text only).
 *
 * The client always extracts TEXT locally first (Tesseract/pdf.js), so even
 * the free path gets real text to summarise — no key, no cost, no server
 * strictly required (the client can talk to Pollinations directly).
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';

const AI_DISCLAIMER =
  'هذا التلخيص مُنشأ بواسطة ذكاء اصطناعي وليس تشخيصًا طبيًا. راجع الطبيب المعالج دائمًا.';

interface SummariseBody {
  text?: string;
  imageBase64?: string;
  labType?: string;
  labDate?: string;
  lang?: string;
  model?: string;
}

function buildPrompt(text: string, labType?: string, lang = 'ar'): string {
  const typeLine = labType ? `نوع الفحص: ${labType}.\n` : '';
  return `أنت مساعد طبي تعليمي (ولست طبيباً). لخّص نتائج الفحص التالي بلغة عربية بسيطة وواضحة. حدّد القيم غير الطبيعية واشرح ما قد تعنيه بأسلوب يفهمه غير المتخصصين. لا تعطِ تشخيصاً ولا وصفة طبية.\n\n${typeLine}${text.slice(0, 12000)}`;
}

async function pollinationsSummarise(prompt: string): Promise<string> {
  const res = await fetch('https://text.pollinations.ai/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'user', content: prompt }], model: 'openai' }),
  });
  if (!res.ok) throw new Error(`Pollinations HTTP ${res.status}`);
  return (await res.text()).trim();
}

async function openaiSummarise(prompt: string, apiKey: string): Promise<string> {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: 'أنت مساعد تعليمي طبي. لا تعطِ تشخيصًا أو وصفة.' },
        { role: 'user', content: prompt },
      ],
      temperature: 0.3,
      max_tokens: 2048,
    }),
  });
  if (!res.ok) throw new Error(`OpenAI HTTP ${res.status}`);
  const json = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return json.choices?.[0]?.message?.content?.trim() ?? '';
}

async function geminiSummarise(opts: {
  text: string;
  imageBase64?: string;
  prompt: string;
  key: string;
}): Promise<string> {
  const parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> = [];
  if (opts.imageBase64) {
    const mime = opts.imageBase64.startsWith('data:') ? opts.imageBase64.split(';')[0]!.replace('data:', '') : 'image/jpeg';
    parts.push({ inlineData: { mimeType: mime, data: opts.imageBase64.split(',')[1] ?? opts.imageBase64 } });
  }
  parts.push({ text: opts.prompt });

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${opts.key}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts }], generationConfig: { temperature: 0.3 } }),
  });
  if (!res.ok) throw new Error(`Gemini HTTP ${res.status}`);
  const json = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  return json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('').trim() ?? '';
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = (req.body ?? {}) as SummariseBody;
  const text = typeof body.text === 'string' ? body.text : '';
  const imageBase64 = typeof body.imageBase64 === 'string' ? body.imageBase64 : '';

  if (!text && !imageBase64) {
    return res.status(400).json({ error: 'text or imageBase64 required' });
  }
  if (text.length > 50_000) {
    return res.status(400).json({ error: 'Text too long (max 50k chars)' });
  }

  const prompt = buildPrompt(text, body.labType, body.lang ?? 'ar');

  try {
    const geminiKey = process.env.GEMINI_API_KEY;
    const openaiKey = process.env.OPENAI_API_KEY;

    let summary: string;
    let modelUsed: string;

    if (geminiKey) {
      summary = await geminiSummarise({ text, imageBase64, prompt, key: geminiKey });
      modelUsed = 'gemini-1.5-flash';
    } else if (openaiKey) {
      summary = await openaiSummarise(prompt, openaiKey);
      modelUsed = 'gpt-4o';
    } else {
      // FREE, keyless default.
      summary = await pollinationsSummarise(prompt);
      modelUsed = 'pollinations-free';
    }

    return res.status(200).json({ summary, model: modelUsed, disclaimer: AI_DISCLAIMER });
  } catch (e) {
    return res.status(500).json({ error: 'Internal error', detail: String(e) });
  }
}
