const GPT_IMAGE_SIZES: Record<string, string> = {
  "1024x1024": "1024x1024",
  "1024x1536": "1024x1536",
  "1536x1024": "1536x1024",
  "1080x1080": "1024x1024",
  "512x512": "1024x1024",
  "2048x2048": "1024x1024",
  "1920x1080": "1536x1024",
  "3840x2160": "1536x1024",
};

export function normalizeImageSize(size: string, model: string): string {
  const compact = size.trim().toLowerCase().replace(/\s+/g, "");
  if (!/gpt-image/i.test(model)) {
    return size.trim();
  }
  return GPT_IMAGE_SIZES[compact] ?? "1024x1024";
}
