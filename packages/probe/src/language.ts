const ALIASES: Record<string, string> = {
  eng: 'en',
  english: 'en',
  fre: 'fr',
  fra: 'fr',
  french: 'fr',
  ger: 'de',
  deu: 'de',
  german: 'de',
  spa: 'es',
  spanish: 'es',
  por: 'pt',
  pob: 'pt-BR',
  'pt-br': 'pt-BR',
  pt_br: 'pt-BR',
  ita: 'it',
  jpn: 'ja',
  zho: 'zh',
  chi: 'zh',
  dut: 'nl',
  nld: 'nl',
  rus: 'ru',
  kor: 'ko',
  ara: 'ar',
  pol: 'pl',
  swe: 'sv',
  dan: 'da',
  fin: 'fi',
  nor: 'no',
  heb: 'he',
  hin: 'hi',
  tur: 'tr',
  ukr: 'uk',
  ces: 'cs',
  cze: 'cs',
  ell: 'el',
  gre: 'el',
  hun: 'hu',
  ron: 'ro',
  rum: 'ro',
}

/** A BCP 47 tag (`en`, `pt-BR`) from a container language tag such as `eng`, or null. */
export function normalizeLanguage(value: unknown): string | null {
  if (typeof value !== 'string' || !value || /^(und|unknown|mul)$/i.test(value)) return null
  const tag = ALIASES[value.toLowerCase()] ?? value.replace(/_/g, '-')
  try {
    const canonical = Intl.getCanonicalLocales(tag)[0]!
    return /^[a-z]{2}(-[A-Za-z0-9]+)*$/.test(canonical) ? canonical : null
  } catch {
    return null
  }
}
