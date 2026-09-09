#!/usr/bin/env node
/**
 * Apply reviewed pt-BR fixes to mcc-codes.pt-overrides.json (manual + airline/car rules).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const mccPath = path.join(root, 'src/data/mcc-codes.json');
const overridesPath = path.join(root, 'src/data/mcc-codes.pt-overrides.json');

const { codes: mccCodes } = JSON.parse(readFileSync(mccPath, 'utf8'));
const overrides = JSON.parse(readFileSync(overridesPath, 'utf8'));

const MANUAL_FIXES = {
  '0742': 'Serviços veterinários',
  1711: 'Instalação de ar-condicionado, aquecimento e encanamento',
  1740: 'Empreiteiras de isolamento, alvenaria, pedraria e revestimento',
  3351: 'Locadoras de veículos afiliadas',
  5411: 'Supermercados e mercearias',
  5541: 'Postos de gasolina',
  5812: 'Restaurantes e lanchonetes',
  5813: 'Bares, casas noturnas e discotecas',
  5814: 'Restaurantes fast-food',
  5816: 'Jogos digitais',
  5817: 'Aplicativos de software (exceto jogos)',
  5818: 'Serviços digitais e assinaturas',
  5912: 'Farmácias e drogarias',
  5941: 'Lojas de artigos esportivos',
  5945: 'Lojas de brinquedos e hobbies',
  5961: 'Vendas por catálogo e clubes de assinatura',
  6300: 'Seguros — vendas e prêmios',
  7298: 'Salões de beleza e spas',
  7542: 'Lavagem automática de veículos',
  7933: 'Pistas de boliche',
  7997: 'Academias e clubes esportivos',
  8044: 'Ópticas e artigos ópticos',
  3011: 'Aeroflot',
  3034: 'Australian Airlines',
  4815: 'Telefone Visa',
};

const ENGLISH_NAME_FIXES = {
  AEORFLOT: 'Aeroflot',
  'AUSTRAINLIAN AIRLINES': 'Australian Airlines',
  'AIR-INDIA': 'Air India',
  'PAN AMERICAN': 'Pan American',
};

const KEEP_UPPER = new Set(['KLM', 'THY', 'TAP', 'UTA', 'LAB', 'EVA', 'USA', 'VASP']);

function titleCaseWords(text) {
  if (typeof text !== 'string' || text.length === 0) {
    return text ?? '';
  }
  const fixed = ENGLISH_NAME_FIXES[text] ?? text;
  return fixed.replace(/[\w']+/g, (word) => {
    const upper = word.toUpperCase();
    if (KEEP_UPPER.has(upper)) {
      return upper;
    }
    if (word.length <= 3 && word === word.toUpperCase() && !/[a-z]/i.test(word)) {
      return word;
    }
    if (word.includes('/')) {
      return word
        .split('/')
        .map((part) => (part.length > 0 ? titleCaseWords(part) : part))
        .join('/');
    }
    return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
  });
}

function titleCaseAirline(en) {
  return titleCaseWords(en);
}

function titleCaseCarRentalBrand(en) {
  let brand = en
    .replace(/\bRENT[- ]?A[- ]?CAR\b/gi, '')
    .replace(/\bAUTO RENTAL\b/gi, '')
    .trim();
  brand = brand.replace(/^AFFILIATED\s+/i, '').trim();
  if (brand.length === 0) {
    return null;
  }
  return titleCaseWords(brand);
}

function applyAirlineRules(en) {
  if (en === 'Airlines') {
    return 'Companhias aéreas';
  }
  return titleCaseAirline(en);
}

function applyHotelRules(en) {
  if (en === 'Hotels/Motels/Inns/Resorts' || en === 'Hotels') {
    return 'Hotéis, motéis e resorts';
  }
  return titleCaseWords(en);
}

function applyCarRentalRules(en) {
  if (en === 'Car Rental') {
    return 'Locadoras de veículos';
  }
  const brand = titleCaseCarRentalBrand(en);
  return brand ? `Locadora de veículos — ${brand}` : 'Locadora de veículos';
}

let changed = 0;

for (const [mcc, entry] of Object.entries(mccCodes)) {
  const { en } = entry;
  if (typeof en !== 'string' || en.length === 0) {
    continue;
  }
  const code = Number(mcc);
  let next = overrides[mcc];

  if (code >= 3000 && code <= 3299) {
    next = applyAirlineRules(en);
  } else if (code >= 3351 && code <= 3441) {
    next = applyCarRentalRules(en);
  } else if (code >= 3500 && code <= 3999) {
    next = applyHotelRules(en);
  }

  if (next && overrides[mcc] !== next) {
    overrides[mcc] = next;
    changed += 1;
  }
}

for (const [mcc, fix] of Object.entries(MANUAL_FIXES)) {
  if (overrides[mcc] !== fix) {
    overrides[mcc] = fix;
    changed += 1;
  }
}

for (const [mcc, { en }] of Object.entries(mccCodes)) {
  const pt = overrides[mcc];
  if (typeof pt !== 'string' || pt !== en) {
    continue;
  }
  const code = Number(mcc);
  let next = null;
  if (code >= 3000 && code <= 3299) {
    next = `Companhia aérea — ${titleCaseWords(en)}`;
  } else if (code >= 3500 && code <= 3999) {
    next = applyHotelRules(en);
  } else if (mcc === '4815') {
    next = 'Telefone Visa';
  }
  if (next && next !== en && overrides[mcc] !== next) {
    overrides[mcc] = next;
    changed += 1;
  }
}

const sorted = Object.fromEntries(
  Object.keys(overrides)
    .sort((a, b) => a.localeCompare(b))
    .map((mcc) => [mcc, overrides[mcc]]),
);

writeFileSync(overridesPath, `${JSON.stringify(sorted, null, 2)}\n`);
console.log(`Updated ${changed} pt overrides in ${overridesPath}`);
