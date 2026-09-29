/**
 * POST /api/ai/scan
 *
 * Server-side AI proxy for medication photo scan (OCR + structured extraction).
 * Accepts a base64 image, sends it to a vision model, returns structured fields.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { handleCors } from '../lib/cors';

interface ScanBody {
  imageBase64: string;
  model?: 'gpt-4o' | 'claude-3-5-sonnet';
}

const AI_DISCLAIMER =
  'هذه المعلومات مُنشأة بواسطة ذكاء اصطناعي. تحقق منها دائمًا مع الطبيب أو الصيدلي.';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (handleCors(req, res)) return;
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = req.body as ScanBody;
  if (!body.imageBase64 || body.imageBase64.length > 5_000_000) {
    return res.status(400).json({ error: 'imageBase64 required (max ~5MB)' });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return res.status(503).json({ error: 'AI service not configured' });
  }

  const systemPrompt = `أنت مساعد يقرأ صور أدوية. استخرج الحقول التالية بالعربية أو الإنجليزية حسب ما يظهر في الصورة، ولا تعطِ أي نصائح طبية:
- nameAr (اسم الدواء)
- nameEn (الاسم الإنجليزي إن وُجد)
- activeIngredients (مصفوفة)
- strength.value + strength.unit
- form (tablet / capsule / syrup / injection / drops / inhaler / patch / other)
- manufacturer
- packExpiry (YYYY-MM-DD إن وُجد)
- notes (أي تحذيرات ظاهرة)
أعد النتيجة كـ JSON فقط بدون تعليقات.`;

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
          { role: 'system', content: systemPrompt },
          {
            role: 'user',
            content: [
              {
                type: 'image_url',
                image_url: { url: `data:image/jpeg;base64,${body.imageBase64}` },
              },
            ],
          },
        ],
        temperature: 0.2,
        max_tokens: 2048,
      }),
    });

    if (!openaiRes.ok) {
      const err = await openaiRes.text();
      return res.status(502).json({ error: 'AI provider error', detail: err });
    }

    const json = await openaiRes.json();
    const raw = json.choices?.[0]?.message?.content ?? '{}';
    const cleaned = raw.replace(/```json\s?/i, '').replace(/```/g, '').trim();
    const extracted = JSON.parse(cleaned);

    return res.status(200).json({
      extracted,
      disclaimer: AI_DISCLAIMER,
      model: body.model ?? 'gpt-4o',
    });
  } catch (e) {
    return res.status(500).json({ error: 'Internal error', detail: String(e) });
  }
}
