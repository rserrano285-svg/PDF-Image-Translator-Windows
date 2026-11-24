import { translate } from '@vitalets/google-translate-api';

export async function translateText(text: string, to: string): Promise<string> {
  if (!text.trim()) {
    return '';
  }
  const { text: translated } = await translate(text, { to });
  return translated;
}
