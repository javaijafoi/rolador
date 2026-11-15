// Motor de rolagem: parser de notação de dados + avaliação.
// Suporta: NdX, d%, dF (Fate), kh/kl/dh/dl (manter/descartar), ! (explodir),
// !! (explosão composta), rN / r<N (rerrolar), >=N / <=N (contar sucessos),
// modificadores + - e várias parcelas: "2d6+1d4+3", "4d6kh3", "2d20kl1-1".

export type Rng = (sides: number) => number;

/** Inteiro uniforme em [1, sides] sem viés de módulo, usando crypto quando disponível. */
export const cryptoRng: Rng = (sides) => {
  if (sides <= 1) return 1;
  const c = globalThis.crypto;
  if (!c?.getRandomValues) return 1 + Math.floor(Math.random() * sides);
  const max = 0x100000000;
  const limit = max - (max % sides);
  const buf = new Uint32Array(1);
  let x: number;
  do {
    c.getRandomValues(buf);
    x = buf[0];
  } while (x >= limit);
  return 1 + (x % sides);
};

export interface DieResult {
  value: number;
  sides: number | 'F';
  dropped?: boolean;
  exploded?: boolean; // gerou dado extra
  rerolled?: boolean; // foi substituído
  success?: boolean;
  crit?: 'max' | 'min';
}

export interface DiceTerm {
  kind: 'dice';
  sign: 1 | -1;
  count: number;
  sides: number | 'F';
  keep?: { mode: 'kh' | 'kl' | 'dh' | 'dl'; n: number };
  explode?: 'normal' | 'compound';
  reroll?: { op: '=' | '<' | '>'; n: number };
  target?: { op: '>=' | '<=' | '>' | '<'; n: number };
  source: string;
}

export interface ConstTerm {
  kind: 'const';
  sign: 1 | -1;
  value: number;
  source: string;
}

export type Term = DiceTerm | ConstTerm;

export interface RolledTerm {
  term: Term;
  dice: DieResult[];
  subtotal: number; // já com sinal
}

export interface RollResult {
  expression: string;
  terms: RolledTerm[];
  total: number;
  successes?: number;
  natural?: 'max' | 'min'; // crítico/falha natural em rolagem de 1 dado (ex.: d20)
}

export class DiceError extends Error {}

const MAX_DICE = 500;
const MAX_SIDES = 100000;
const MAX_EXPLOSIONS = 100;

const TERM_RE =
  /^(\d*)d(\d+|%|f)((?:kh|kl|dh|dl|k|d)\d*)?(!!|!)?(?:r(<|>)?(\d+))?(?:(>=|<=|>|<)(\d+))?$/i;

export function parse(input: string): Term[] {
  const expr = input.replace(/\s+/g, '').toLowerCase();
  if (!expr) throw new DiceError('Digite uma rolagem, tipo 2d6+3');
  const parts = expr.match(/[+-]?[^+-]+/g);
  if (!parts || parts.join('') !== expr) throw new DiceError(`Não entendi "${input}"`);
  let totalDice = 0;
  return parts.map((raw) => {
    let sign: 1 | -1 = 1;
    let body = raw;
    if (body[0] === '+' || body[0] === '-') {
      sign = body[0] === '-' ? -1 : 1;
      body = body.slice(1);
    }
    if (/^\d+$/.test(body)) {
      return { kind: 'const', sign, value: parseInt(body, 10), source: raw } as ConstTerm;
    }
    const m = body.match(TERM_RE);
    if (!m) throw new DiceError(`Não entendi "${body}"`);
    const [, cnt, sidesRaw, keepRaw, expl, rrOp, rrN, tOp, tN] = m;
    const count = cnt === '' ? 1 : parseInt(cnt, 10);
    const sides: number | 'F' =
      sidesRaw === '%' ? 100 : sidesRaw === 'f' ? 'F' : parseInt(sidesRaw, 10);
    if (count < 1) throw new DiceError('Precisa rolar pelo menos 1 dado');
    totalDice += count;
    if (totalDice > MAX_DICE) throw new DiceError(`Máximo de ${MAX_DICE} dados por rolagem`);
    if (sides !== 'F' && (sides < 2 || sides > MAX_SIDES))
      throw new DiceError(`Dado precisa ter entre 2 e ${MAX_SIDES} lados`);
    const term: DiceTerm = { kind: 'dice', sign, count, sides, source: raw };
    if (keepRaw) {
      const km = keepRaw.match(/^(kh|kl|dh|dl|k|d)(\d*)$/)!;
      const mode = (km[1] === 'k' ? 'kh' : km[1] === 'd' ? 'dl' : km[1]) as 'kh' | 'kl' | 'dh' | 'dl';
      const n = km[2] === '' ? 1 : parseInt(km[2], 10);
      if (n > count) throw new DiceError(`Não dá para ${mode.startsWith('k') ? 'manter' : 'descartar'} ${n} de ${count} dados`);
      term.keep = { mode, n };
    }
    if (expl) {
      if (sides === 'F') throw new DiceError('Dados Fate não explodem');
      term.explode = expl === '!!' ? 'compound' : 'normal';
    }
    if (rrN !== undefined) {
      const op = (rrOp ?? '=') as '=' | '<' | '>';
      const n = parseInt(rrN, 10);
      const max = sides === 'F' ? 1 : sides;
      const min = sides === 'F' ? -1 : 1;
      const all = op === '=' ? min === max && n === min : op === '<' ? n > max : n < min;
      if (all) throw new DiceError('Essa rerrolagem nunca pararia');
      term.reroll = { op, n };
    }
    if (tOp && tN !== undefined) term.target = { op: tOp as '>=' | '<=' | '>' | '<', n: parseInt(tN, 10) };
    return term;
  });
}

function cmp(op: string, a: number, b: number) {
  switch (op) {
    case '>=': return a >= b;
    case '<=': return a <= b;
    case '>': return a > b;
    case '<': return a < b;
    default: return a === b;
  }
}

function rollOne(sides: number | 'F', rng: Rng): number {
  return sides === 'F' ? rng(3) - 2 : rng(sides);
}

function rollDiceTerm(t: DiceTerm, rng: Rng): RolledTerm {
  const dice: DieResult[] = [];
  const maxFace = t.sides === 'F' ? 1 : t.sides;
  const minFace = t.sides === 'F' ? -1 : 1;
  for (let i = 0; i < t.count; i++) {
    let v = rollOne(t.sides, rng);
    if (t.reroll) {
      let guard = 0;
      while (cmp(t.reroll.op, v, t.reroll.n) && guard++ < MAX_EXPLOSIONS) {
        dice.push({ value: v, sides: t.sides, rerolled: true, dropped: true });
        v = rollOne(t.sides, rng);
      }
    }
    if (t.explode === 'compound') {
      let total = v;
      let last = v;
      let guard = 0;
      while (last === maxFace && guard++ < MAX_EXPLOSIONS) {
        last = rollOne(t.sides, rng);
        total += last;
      }
      dice.push({ value: total, sides: t.sides, exploded: total > maxFace });
    } else {
      dice.push({ value: v, sides: t.sides });
      if (t.explode === 'normal') {
        let last = v;
        let guard = 0;
        while (last === maxFace && guard++ < MAX_EXPLOSIONS) {
          dice[dice.length - 1].exploded = true;
          last = rollOne(t.sides, rng);
          dice.push({ value: last, sides: t.sides });
        }
      }
    }
  }
  const live = dice.filter((d) => !d.dropped);
  if (t.keep) {
    const sorted = [...live].sort((a, b) => a.value - b.value);
    const { mode, n } = t.keep;
    let drop: DieResult[];
    if (mode === 'kh') drop = sorted.slice(0, Math.max(0, sorted.length - n));
    else if (mode === 'kl') drop = sorted.slice(n);
    else if (mode === 'dh') drop = sorted.slice(Math.max(0, sorted.length - n));
    else drop = sorted.slice(0, n);
    drop.forEach((d) => (d.dropped = true));
  }
  for (const d of dice) {
    if (d.dropped || t.sides === 'F') continue;
    if (d.value === maxFace && !t.explode) d.crit = 'max';
    else if (d.value === minFace) d.crit = 'min';
  }
  const kept = dice.filter((d) => !d.dropped);
  let subtotal: number;
  if (t.target) {
    kept.forEach((d) => (d.success = cmp(t.target!.op, d.value, t.target!.n)));
    subtotal = kept.filter((d) => d.success).length;
  } else {
    subtotal = kept.reduce((s, d) => s + d.value, 0);
  }
  return { term: t, dice, subtotal: subtotal * t.sign };
}

export function roll(input: string, rng: Rng = cryptoRng): RollResult {
  const terms = parse(input);
  const rolled = terms.map((t) =>
    t.kind === 'const' ? { term: t, dice: [], subtotal: t.value * t.sign } : rollDiceTerm(t, rng),
  );
  const total = rolled.reduce((s, r) => s + r.subtotal, 0);
  const hasTarget = terms.some((t) => t.kind === 'dice' && t.target);
  const result: RollResult = { expression: normalize(input), terms: rolled, total };
  if (hasTarget) result.successes = rolled.filter((r) => r.term.kind === 'dice' && r.term.target).reduce((s, r) => s + r.subtotal, 0);
  // Crítico natural: exatamente um dado mantido de d20 (ou outro) e ele saiu no máximo/mínimo
  const diceTerms = rolled.filter((r) => r.term.kind === 'dice');
  if (diceTerms.length === 1) {
    const kept = diceTerms[0].dice.filter((d) => !d.dropped);
    if (kept.length === 1 && kept[0].sides === 20) {
      if (kept[0].value === 20) result.natural = 'max';
      else if (kept[0].value === 1) result.natural = 'min';
    }
  }
  return result;
}

export function normalize(input: string): string {
  return input.replace(/\s+/g, '').toLowerCase().replace(/d%/g, 'd100').replace(/([+-])/g, ' $1 ').trim();
}

/** Mínimo, máximo e média aproximada (ignora explosões e contagem de sucessos). */
export function stats(input: string): { min: number; max: number; avg: number } | null {
  let terms: Term[];
  try {
    terms = parse(input);
  } catch {
    return null;
  }
  if (terms.some((t) => t.kind === 'dice' && t.target)) return null;
  let min = 0, max = 0, avg = 0;
  for (const t of terms) {
    if (t.kind === 'const') {
      min += t.sign * t.value; max += t.sign * t.value; avg += t.sign * t.value;
      continue;
    }
    const lo = t.sides === 'F' ? -1 : 1;
    const hi = t.sides === 'F' ? 1 : t.sides;
    let n = t.count;
    if (t.keep) n = t.keep.mode.startsWith('k') ? t.keep.n : t.count - t.keep.n;
    const tMin = lo * n, tMax = hi * n;
    let tAvg = ((lo + hi) / 2) * n;
    if (t.keep && t.sides !== 'F') tAvg = keepAverage(t.count, t.sides, t.keep);
    if (t.explode && t.sides !== 'F') tAvg = tAvg * (t.sides / (t.sides - 1));
    if (t.sign === 1) { min += tMin; max += t.explode ? Infinity : tMax; }
    else { min -= t.explode ? Infinity : tMax; max -= tMin; }
    avg += t.sign * tAvg;
  }
  return { min, max, avg: Math.round(avg * 100) / 100 };
}

// Média exata por enumeração para poucos dados; Monte Carlo determinístico acima disso.
function keepAverage(count: number, sides: number, keep: NonNullable<DiceTerm['keep']>): number {
  const pick = (vals: number[]) => {
    const s = [...vals].sort((a, b) => a - b);
    const { mode, n } = keep;
    const kept = mode === 'kh' ? s.slice(s.length - n) : mode === 'kl' ? s.slice(0, n) : mode === 'dh' ? s.slice(0, s.length - n) : s.slice(n);
    return kept.reduce((a, b) => a + b, 0);
  };
  if (Math.pow(sides, count) <= 200000) {
    let sum = 0, cnt = 0;
    const vals = new Array(count).fill(1);
    for (;;) {
      sum += pick(vals); cnt++;
      let i = 0;
      while (i < count && vals[i] === sides) { vals[i] = 1; i++; }
      if (i === count) break;
      vals[i]++;
    }
    return sum / cnt;
  }
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) % sides) + 1;
  let sum = 0;
  const N = 20000;
  for (let k = 0; k < N; k++) sum += pick(Array.from({ length: count }, rnd));
  return sum / N;
}

// Escada Fate (usada em Fate Core e #iHunt)
export const FATE_LADDER: Record<number, string> = {
  8: 'Lendário', 7: 'Épico', 6: 'Fantástico', 5: 'Excepcional', 4: 'Ótimo', 3: 'Bom',
  2: 'Razoável', 1: 'Regular', 0: 'Medíocre', [-1]: 'Ruim', [-2]: 'Terrível', [-3]: 'Catastrófico', [-4]: 'Horripilante',
};

export function fateLabel(n: number): string {
  if (n > 8) return `Além de Lendário (+${n})`;
  if (n < -4) return `Abismal (${n})`;
  return FATE_LADDER[n];
}

export type FateOutcome = 'fail' | 'tie' | 'success' | 'style';
export function fateOutcome(total: number, difficulty: number): FateOutcome {
  const shifts = total - difficulty;
  if (shifts < 0) return 'fail';
  if (shifts === 0) return 'tie';
  if (shifts >= 3) return 'style';
  return 'success';
}
