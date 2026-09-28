/**
 * POST /api/ai/summarise
 *
 * Server-side AI proxy for lab summarisation.
 * The API key lives ONLY on the server (§11). Never shipped to the client.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';

interface SummariseBody {
  text: string;
  model?: 'gpt-4o' | 'claude-3-5-sonnet';
}

const AI_DISCLAIMER =
  'هذا التلخيص مُنشأ بواسطة ذكاء اصطناعي وليس تشخيصًا طبيًا. راجع الطبيب المعالج دائمًا.';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = req.body as SummariseBody;
  if (!body.text || body.text.length > 50_000) {
    return res.status(400).json({ error: 'Text required (max 50k chars)' });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return res.status(503).json({ error: 'AI service not configured' });
  }

  const prompt = `أنت مساعد طبي تعليمي (ولست طبيبًا). قم بتلخيص نتائج التحليل التالي بلغة بسيطة بالعربية الفصحى. حدد أي قيم خارج النطاق الطبيعي واشرح ما قد تعنيه بأسلوب يفهمه غير المتخصصين. لا تعطِ تشخيصًا أو وصفة طبية.\n\n${body.text}`;

  try {
    const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: body.model ?? 'gpt-4o',
        messages: [
          { role: 'system', content: 'أنت مساعد تعليمي طبي. لا تعطِ تشخيصًا أو وصفة.' },
          { role: 'user', content: prompt },
        ],
        temperature: 0.3,
        max_tokens: 2048,
      }),
    });

    if (!openaiRes.ok) {
      const err = await openaiRes.text();
      return res.status(502).json({ error: 'AI provider error', detail: err });
    }

    const json = await openaiRes.json();
    const summary = json.choices?.[0]?.message?.content ?? '';

    return res.status(200).json({
      summary,
      disclaimer: AI_DISCLAIMER,
      model: body.model ?? 'gpt-4o',
    });
  } catch (e) {
    return res.status(500).json({ error: 'Internal error', detail: String(e) });
  }
}
