import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ASSETS_DIR = path.resolve(__dirname, '../../assets');
const REFERENCE_FACE_PATH = path.join(ASSETS_DIR, 'reference_face.png');
const GENERATED_DIR = path.resolve(__dirname, '../../public/photos/generated');

// Ensure generated photos directory exists
if (!fs.existsSync(GENERATED_DIR)) {
  try {
    fs.mkdirSync(GENERATED_DIR, { recursive: true });
  } catch (e) {
    console.error('Failed to create generated photos directory:', e.message);
  }
}

const LIFESTYLE_PROMPTS = [
  "A gorgeous, ultra-realistic 4K casual selfie of this woman in a cozy cafe, holding an iced coffee, warm smile, natural daylight through cafe window, authentic smartphone camera quality.",
  "A candid, beautiful lifestyle selfie of this woman in a sunlit botanical garden park, gentle afternoon breeze in her hair, radiant happy smile, realistic depth of field.",
  "An affectionate, cozy home selfie of this woman smiling warmly at the camera, wearing an oversized comfortable knit sweater, soft ambient warm lighting.",
  "A vibrant, stylish outdoor selfie of this woman by a scenic city promenade or overlook during golden hour, glowing sun highlights, genuine happy girlfriend vibe.",
  "A cute casual mirror selfie of this woman wearing an elegant casual outfit, looking radiant, cheerful expression, natural soft indoor lighting."
];

/**
 * Attempts image generation with Google Gemini using reference face
 */
async function generateWithGemini(apiKeys, promptText) {
  if (!fs.existsSync(REFERENCE_FACE_PATH)) {
    console.warn('[imageGenerator] Reference face not found at:', REFERENCE_FACE_PATH);
    return null;
  }

  const faceBuffer = fs.readFileSync(REFERENCE_FACE_PATH);
  const faceBase64 = faceBuffer.toString('base64');

  const models = ['gemini-3.1-flash-image', 'gemini-2.5-flash-image'];

  for (const model of models) {
    for (const key of apiKeys) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [
              {
                parts: [
                  {
                    inlineData: {
                      mimeType: 'image/png',
                      data: faceBase64
                    }
                  },
                  {
                    text: `${promptText} Preserve the exact facial identity, eyes, nose, and features of the woman in the reference image.`
                  }
                ]
              }
            ],
            generationConfig: {
              responseModalities: ['IMAGE', 'TEXT']
            }
          }),
          signal: AbortSignal.timeout(15000)
        });

        if (res.ok) {
          const data = await res.json();
          const parts = data.candidates?.[0]?.content?.parts || [];
          for (const part of parts) {
            const imgData = part.inlineData?.data || part.inline_data?.data;
            if (imgData) {
              const buffer = Buffer.from(imgData, 'base64');
              return buffer;
            }
          }
        }
      } catch (e) {
        // Try next key or model
      }
    }
  }
  return null;
}

/**
 * Fallback photorealistic AI generator matching Maira Dash's exact aesthetic
 */
async function generatePhotorealisticFallback(promptText) {
  try {
    const seed = Math.floor(100000 + Math.random() * 900000);
    const fullPrompt = `Photorealistic 8K authentic smartphone selfie of a stunning 23-year-old Indian woman named Maira, warm affectionate smile, expressive brown eyes, long wavy dark hair, ${promptText}, shot on iPhone 15 camera, hyperrealistic skin texture, realistic natural lighting, no distortion, no cartoon, 9:16 portrait`;
    const encoded = encodeURIComponent(fullPrompt);
    const url = `https://image.pollinations.ai/prompt/${encoded}?width=1080&height=1920&model=flux&nologo=true&seed=${seed}`;

    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
      signal: AbortSignal.timeout(25000)
    });

    if (res.ok) {
      const arrayBuffer = await res.arrayBuffer();
      return Buffer.from(arrayBuffer);
    }
  } catch (e) {
    console.error('[imageGenerator] Fallback generation error:', e.message);
  }
  return null;
}

/**
 * Main function to generate a girlfriend photo when all stored photos are exhausted
 */
export async function generateNewGirlfriendPhoto(psid, apiKeys = []) {
  const chosenPrompt = LIFESTYLE_PROMPTS[Math.floor(Math.random() * LIFESTYLE_PROMPTS.length)];
  const timestamp = Date.now();
  const filename = `maira_gen_${psid}_${timestamp}.jpg`;
  const outputPath = path.join(GENERATED_DIR, filename);

  console.log(`🎨 [imageGenerator] Generating new photo for ${psid} using reference face...`);

  // 1. Try Gemini with reference face
  let imageBuffer = await generateWithGemini(apiKeys, chosenPrompt);

  // 2. Fallback to photorealistic engine if Gemini free quota is 0
  if (!imageBuffer) {
    console.log(`🎨 [imageGenerator] Gemini quota/unavailable. Using high-definition FLUX engine fallback...`);
    imageBuffer = await generatePhotorealisticFallback(chosenPrompt);
  }

  if (imageBuffer) {
    fs.writeFileSync(outputPath, imageBuffer);
    console.log(`✅ [imageGenerator] Saved generated photo to: ${outputPath} (${imageBuffer.length} bytes)`);
    return {
      filename,
      relativeUrl: `/photos/generated/${filename}`
    };
  }

  console.warn('[imageGenerator] Could not generate new image. Returning null.');
  return null;
}
