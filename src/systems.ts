// Modos de rolagem por sistema, construídos em cima do motor genérico (dice.ts).
import { cryptoRng, fateLabel, fateOutcome, roll as rollExpr, stats, type Rng } from './dice';

export type Tone = 'crit' | 'good' | 'mixed' | 'bad' | 'fumble' | 'neutral';
export type DieState = 'drop' | 'crit' | 'fumble' | 'hit' | 'hope' | 'fear' | 'hunger' | 'wild' | 'ace' | 'tens' | 'units';

export interface DieView {
  value: number | string;
  sides: number | 'F';
  state?: DieState[];
}

export interface DiceGroup {
  label?: string;
  dice: DieView[];
}

export interface SystemRoll {
  groups: DiceGroup[];
  total: string;
  headline: string;
  detail?: string;
  tone: Tone;
  summary: string; // linha curta para o histórico
}

export type Field =
  | { key: string; label: string; type: 'number'; min: number; max: number; step?: number; def: number }
  | { key: string; label: string; type: 'select'; options: { value: string; label: string }[]; def: string }
  | { key: string; label: string; type: 'text'; def: string; placeholder?: string };

export type Values = Record<string, string | number>;

export interface GameSystem {
  id: string;
  name: string;
  short: string; // rótulo do cartucho
  color: string; // cor PICO-8 do cartucho
  blurb: string;
  fields: Field[];
  roll: (v: Values, rng: Rng) => SystemRoll;
}

const n = (v: Values, k: string) => Number(v[k]) || 0;
const sgn = (x: number) => (x >= 0 ? `+${x}` : `${x}`);
const d = (sides: number, rng: Rng) => rng(sides);
const pool = (count: number, sides: number, rng: Rng) => Array.from({ length: count }, () => d(sides, rng));

// ---------- Livre (notação) ----------
const livre: GameSystem = {
  id: 'livre',
  name: 'Notação livre',
  short: 'LIVRE',
  color: '#FFF1E8',
  blurb: 'Qualquer rolagem: 2d6+3, 4d6kh3, 1d6!, 5d10>=8, d%, 4dF.',
  fields: [{ key: 'expr', label: 'Rolagem', type: 'text', def: '2d6+3', placeholder: '2d6+3' }],
  roll: (v, rng) => {
    const r = rollExpr(String(v.expr), rng);
    const groups: DiceGroup[] = r.terms
      .filter((t) => t.term.kind === 'dice')
      .map((t) => ({
        label: t.term.source.replace(/^\+/, ''),
        dice: t.dice.map((x) => ({
          value: x.sides === 'F' ? (x.value > 0 ? '+' : x.value < 0 ? '−' : '·') : x.value,
          sides: x.sides,
          state: [
            ...(x.dropped ? (['drop'] as DieState[]) : []),
            ...(x.crit === 'max' ? (['crit'] as DieState[]) : []),
            ...(x.crit === 'min' ? (['fumble'] as DieState[]) : []),
            ...(x.exploded ? (['ace'] as DieState[]) : []),
            ...(x.success ? (['hit'] as DieState[]) : []),
          ],
        })),
      }));
    const s = stats(String(v.expr));
    const tone: Tone = r.natural === 'max' ? 'crit' : r.natural === 'min' ? 'fumble' : 'neutral';
    const headline =
      r.successes !== undefined
        ? `${r.successes} sucesso${r.successes === 1 ? '' : 's'}`
        : r.natural === 'max' ? '20 natural!' : r.natural === 'min' ? '1 natural...' : 'Total';
    return {
      groups,
      total: String(r.total),
      headline,
      detail: s ? `mín ${s.min} · méd ${s.avg} · máx ${s.max === Infinity ? '∞' : s.max}` : undefined,
      tone,
      summary: `${r.expression} = ${r.total}`,
    };
  },
};

// ---------- D20 (D&D 5e, Tormenta20, Pathfinder) ----------
const d20: GameSystem = {
  id: 'd20',
  name: 'D20 · D&D 5e / Tormenta20',
  short: 'D20',
  color: '#FF004D',
  blurb: 'd20 + modificador contra a CD. Vantagem rola 2 e fica com o maior.',
  fields: [
    { key: 'mod', label: 'Modificador', type: 'number', min: -10, max: 30, def: 0 },
    {
      key: 'adv', label: 'Rolagem', type: 'select', def: 'normal',
      options: [
        { value: 'normal', label: 'Normal' },
        { value: 'adv', label: 'Vantagem' },
        { value: 'dis', label: 'Desvantagem' },
      ],
    },
    { key: 'dc', label: 'CD (0 = sem)', type: 'number', min: 0, max: 40, def: 15 },
  ],
  roll: (v, rng) => {
    const mod = n(v, 'mod');
    const dc = n(v, 'dc');
    const mode = String(v.adv);
    const rolls = pool(mode === 'normal' ? 1 : 2, 20, rng);
    const kept = mode === 'adv' ? Math.max(...rolls) : mode === 'dis' ? Math.min(...rolls) : rolls[0];
    const keptIdx = rolls.indexOf(kept);
    const dice: DieView[] = rolls.map((r, i) => ({
      value: r, sides: 20,
      state: [
        ...(i !== keptIdx ? (['drop'] as DieState[]) : []),
        ...(r === 20 ? (['crit'] as DieState[]) : []),
        ...(r === 1 ? (['fumble'] as DieState[]) : []),
      ],
    }));
    const total = kept + mod;
    let tone: Tone = 'neutral';
    let headline = 'Total';
    if (kept === 20) { tone = 'crit'; headline = 'Crítico! 20 natural'; }
    else if (kept === 1) { tone = 'fumble'; headline = 'Falha crítica (1 natural)'; }
    else if (dc > 0) { tone = total >= dc ? 'good' : 'bad'; headline = total >= dc ? 'Passou!' : 'Não passou'; }
    const modeTxt = mode === 'adv' ? ' c/ vantagem' : mode === 'dis' ? ' c/ desvantagem' : '';
    return {
      groups: [{ label: `d20${modeTxt}`, dice }],
      total: String(total),
      headline,
      detail: `${kept} ${sgn(mod)}${dc > 0 ? ` vs CD ${dc}` : ''}`,
      tone,
      summary: `d20${sgn(mod)}${modeTxt} = ${total}${dc > 0 ? ` (CD ${dc})` : ''}`,
    };
  },
};

// ---------- Fate / #iHunt ----------
const fate: GameSystem = {
  id: 'fate',
  name: 'Fate / #iHunt',
  short: 'FATE',
  color: '#00E436',
  blurb: '4dF + perícia, lido na escada Fate. Usado no #iHunt.',
  fields: [
    { key: 'skill', label: 'Perícia', type: 'number', min: -2, max: 8, def: 2 },
    { key: 'diff', label: 'Dificuldade', type: 'number', min: -4, max: 8, def: 2 },
    { key: 'invoke', label: 'Invocações (+2)', type: 'number', min: 0, max: 5, def: 0 },
  ],
  roll: (v, rng) => {
    const skill = n(v, 'skill');
    const diff = n(v, 'diff');
    const inv = n(v, 'invoke') * 2;
    const vals = pool(4, 3, rng).map((x) => x - 2);
    const dice: DieView[] = vals.map((x) => ({
      value: x > 0 ? '+' : x < 0 ? '−' : '·', sides: 'F',
      state: x > 0 ? ['hit'] : x < 0 ? ['fumble'] : [],
    }));
    const sum = vals.reduce((a, b) => a + b, 0);
    const total = sum + skill + inv;
    const out = fateOutcome(total, diff);
    const shifts = total - diff;
    const label = { fail: 'Falha', tie: 'Empate', success: 'Sucesso', style: 'Sucesso com estilo!' }[out];
    const tone: Tone = { fail: 'bad', tie: 'mixed', success: 'good', style: 'crit' }[out] as Tone;
    return {
      groups: [{ label: '4dF', dice }],
      total: sgn(total),
      headline: `${fateLabel(total)} · ${label}`,
      detail: `dados ${sgn(sum)} · perícia ${sgn(skill)}${inv ? ` · invocações ${sgn(inv)}` : ''} · ${shifts >= 0 ? `${shifts} tensão(ões)` : `faltou ${-shifts}`} vs ${fateLabel(diff)}`,
      tone,
      summary: `4dF${sgn(skill + inv)} = ${sgn(total)} ${fateLabel(total)} (${label})`,
    };
  },
};

// ---------- Powered by the Apocalypse ----------
const pbta: GameSystem = {
  id: 'pbta',
  name: 'PbtA · Apocalypse World / Dungeon World',
  short: 'PBTA',
  color: '#FF77A8',
  blurb: '2d6 + atributo. 10+ sucesso, 7–9 sucesso com custo, 6- o MC faz um movimento.',
  fields: [
    { key: 'stat', label: 'Atributo', type: 'number', min: -3, max: 4, def: 1 },
    {
      key: 'adv', label: 'Rolagem', type: 'select', def: 'normal',
      options: [
        { value: 'normal', label: '2d6' },
        { value: 'adv', label: '3d6, fica com 2 maiores' },
        { value: 'dis', label: '3d6, fica com 2 menores' },
      ],
    },
  ],
  roll: (v, rng) => {
    const stat = n(v, 'stat');
    const mode = String(v.adv);
    const rolls = pool(mode === 'normal' ? 2 : 3, 6, rng);
    const sorted = rolls.map((r, i) => ({ r, i })).sort((a, b) => a.r - b.r);
    const drop = mode === 'adv' ? sorted[0].i : mode === 'dis' ? sorted[2].i : -1;
    const sum = rolls.reduce((a, r, i) => (i === drop ? a : a + r), 0);
    const total = sum + stat;
    const [headline, tone]: [string, Tone] =
      total >= 12 ? ['12+ Sucesso total (e mais!)', 'crit'] : total >= 10 ? ['10+ Sucesso total', 'good'] : total >= 7 ? ['7–9 Sucesso com custo', 'mixed'] : ['6- Falha: o MC age', 'bad'];
    return {
      groups: [{ label: mode === 'normal' ? '2d6' : '3d6', dice: rolls.map((r, i) => ({ value: r, sides: 6, state: i === drop ? ['drop'] : [] })) }],
      total: String(total),
      headline,
      detail: `${sum} ${sgn(stat)}`,
      tone,
      summary: `2d6${sgn(stat)} = ${total} (${headline.split(' ')[0]})`,
    };
  },
};

// ---------- Call of Cthulhu 7e ----------
const coc: GameSystem = {
  id: 'coc',
  name: 'Chamado de Cthulhu 7e',
  short: 'D100',
  color: '#29ADFF',
  blurb: 'd100 abaixo da perícia. Bônus/penalidade rolam dezenas extras.',
  fields: [
    { key: 'skill', label: 'Perícia %', type: 'number', min: 1, max: 99, def: 50 },
    { key: 'bonus', label: 'Bônus (+) / Penalidade (−)', type: 'number', min: -2, max: 2, def: 0 },
  ],
  roll: (v, rng) => {
    const skill = n(v, 'skill');
    const bonus = n(v, 'bonus');
    const units = d(10, rng) - 1;
    const tens = pool(1 + Math.abs(bonus), 10, rng).map((x) => x - 1);
    const val = (t: number) => (t === 0 && units === 0 ? 100 : t * 10 + units);
    const options = tens.map(val);
    const pick = bonus >= 0 ? Math.min(...options) : Math.max(...options);
    const pickIdx = options.indexOf(pick);
    const result = pick;
    const fumbleAt = skill < 50 ? 96 : 100;
    let headline: string; let tone: Tone;
    if (result === 1) { headline = 'Crítico!'; tone = 'crit'; }
    else if (result >= fumbleAt) { headline = 'Desastre'; tone = 'fumble'; }
    else if (result <= Math.floor(skill / 5)) { headline = 'Sucesso extremo'; tone = 'crit'; }
    else if (result <= Math.floor(skill / 2)) { headline = 'Sucesso difícil'; tone = 'good'; }
    else if (result <= skill) { headline = 'Sucesso regular'; tone = 'good'; }
    else { headline = 'Fracasso'; tone = 'bad'; }
    return {
      groups: [
        { label: 'dezenas', dice: tens.map((t, i) => ({ value: `${t}0`, sides: 10, state: i === pickIdx ? ['tens'] : ['drop', 'tens'] })) },
        { label: 'unidade', dice: [{ value: units, sides: 10, state: ['units'] }] },
      ],
      total: String(result).padStart(2, '0'),
      headline,
      detail: `perícia ${skill} · difícil ≤${Math.floor(skill / 2)} · extremo ≤${Math.floor(skill / 5)}${bonus ? ` · ${bonus > 0 ? 'bônus' : 'penalidade'} ${Math.abs(bonus)}` : ''}`,
      tone,
      summary: `d100 vs ${skill} = ${result} (${headline})`,
    };
  },
};

// ---------- Vampiro V5 ----------
const v5: GameSystem = {
  id: 'v5',
  name: 'Vampiro: A Máscara 5ª ed.',
  short: 'V5',
  color: '#7E2553',
  blurb: 'Parada de d10, 6+ é sucesso, par de 10 vale 4. Dados de Fome trazem caos.',
  fields: [
    { key: 'pool', label: 'Parada', type: 'number', min: 1, max: 20, def: 5 },
    { key: 'hunger', label: 'Fome', type: 'number', min: 0, max: 5, def: 1 },
    { key: 'diff', label: 'Dificuldade', type: 'number', min: 0, max: 10, def: 3 },
  ],
  roll: (v, rng) => {
    const size = n(v, 'pool');
    const hunger = Math.min(n(v, 'hunger'), size);
    const diff = n(v, 'diff');
    const normal = pool(size - hunger, 10, rng);
    const hung = pool(hunger, 10, rng);
    const all = [...normal, ...hung];
    const tens = all.filter((x) => x === 10).length;
    const pairs = Math.floor(tens / 2);
    const succ = all.filter((x) => x >= 6).length + pairs * 2;
    const crit = pairs > 0;
    const messy = crit && hung.includes(10);
    const win = succ >= diff;
    const bestial = !win && hung.includes(1);
    let headline: string; let tone: Tone;
    if (win && messy) { headline = 'Crítico bagunçado!'; tone = 'mixed'; }
    else if (win && crit) { headline = 'Crítico!'; tone = 'crit'; }
    else if (win) { headline = 'Sucesso'; tone = 'good'; }
    else if (bestial) { headline = 'Falha bestial'; tone = 'fumble'; }
    else { headline = 'Falha'; tone = 'bad'; }
    const view = (x: number, h: boolean): DieView => ({
      value: x, sides: 10,
      state: [
        ...(h ? (['hunger'] as DieState[]) : []),
        ...(x === 10 ? (['crit'] as DieState[]) : x >= 6 ? (['hit'] as DieState[]) : []),
        ...(h && x === 1 ? (['fumble'] as DieState[]) : []),
      ],
    });
    return {
      groups: [
        { label: 'parada', dice: normal.map((x) => view(x, false)) },
        ...(hung.length ? [{ label: 'fome', dice: hung.map((x) => view(x, true)) }] : []),
      ],
      total: String(succ),
      headline,
      detail: `${succ} sucesso(s) vs dificuldade ${diff}${pairs ? ` · ${pairs} par(es) de 10` : ''}${succ - diff > 0 ? ` · margem ${succ - diff}` : ''}`,
      tone,
      summary: `${size}d10 (fome ${hunger}) = ${succ} suc. (${headline})`,
    };
  },
};

// ---------- Storyteller clássico (Mundo das Trevas) ----------
const wod: GameSystem = {
  id: 'wod',
  name: 'Storyteller clássico · Mundo das Trevas',
  short: 'WOD',
  color: '#AB5236',
  blurb: 'Parada de d10 contra dificuldade; cada 1 anula um sucesso. Sem sucessos e com 1 = falha crítica.',
  fields: [
    { key: 'pool', label: 'Parada', type: 'number', min: 1, max: 20, def: 6 },
    { key: 'diff', label: 'Dificuldade', type: 'number', min: 2, max: 10, def: 6 },
    {
      key: 'spec', label: 'Especialização', type: 'select', def: 'no',
      options: [{ value: 'no', label: 'Não' }, { value: 'yes', label: 'Sim (10 explode)' }],
    },
  ],
  roll: (v, rng) => {
    const diff = n(v, 'diff');
    const spec = v.spec === 'yes';
    const base = pool(n(v, 'pool'), 10, rng);
    const extra: number[] = [];
    if (spec) {
      let pending = base.filter((x) => x === 10).length;
      while (pending-- > 0 && extra.length < 50) {
        const x = d(10, rng);
        extra.push(x);
        if (x === 10) pending++;
      }
    }
    const all = [...base, ...extra];
    const hits = all.filter((x) => x >= diff).length;
    const ones = base.filter((x) => x === 1).length;
    const net = hits - ones;
    let headline: string; let tone: Tone;
    if (hits === 0 && ones > 0) { headline = 'Falha crítica!'; tone = 'fumble'; }
    else if (net <= 0) { headline = 'Falha'; tone = 'bad'; }
    else if (net >= 5) { headline = 'Sucesso fenomenal'; tone = 'crit'; }
    else { headline = `${net} sucesso${net > 1 ? 's' : ''}`; tone = 'good'; }
    const view = (x: number, isExtra = false): DieView => ({
      value: x, sides: 10,
      state: [
        ...(x >= diff ? (['hit'] as DieState[]) : []),
        ...(x === 1 && !isExtra ? (['fumble'] as DieState[]) : []),
        ...(x === 10 && spec ? (['ace'] as DieState[]) : []),
      ],
    });
    return {
      groups: [
        { label: `${base.length}d10 dif. ${diff}`, dice: base.map((x) => view(x)) },
        ...(extra.length ? [{ label: 'especialização', dice: extra.map((x) => view(x, true)) }] : []),
      ],
      total: String(Math.max(net, 0)),
      headline,
      detail: `${hits} acerto(s) − ${ones} um(s)`,
      tone,
      summary: `${base.length}d10 dif ${diff} = ${Math.max(net, 0)} (${headline})`,
    };
  },
};

// ---------- Shadowrun ----------
const sr: GameSystem = {
  id: 'sr',
  name: 'Shadowrun 5e / 6e',
  short: 'SR',
  color: '#FFA300',
  blurb: 'Parada de d6, 5 e 6 são acertos. Mais da metade de 1s = falha (glitch).',
  fields: [
    { key: 'pool', label: 'Parada', type: 'number', min: 1, max: 30, def: 8 },
    { key: 'threshold', label: 'Limiar', type: 'number', min: 0, max: 10, def: 2 },
    {
      key: 'edge', label: 'Regra do 6 (Edge)', type: 'select', def: 'no',
      options: [{ value: 'no', label: 'Não' }, { value: 'yes', label: 'Sim, 6 explode' }],
    },
  ],
  roll: (v, rng) => {
    const size = n(v, 'pool');
    const thr = n(v, 'threshold');
    const edge = v.edge === 'yes';
    const base = pool(size, 6, rng);
    const extra: number[] = [];
    if (edge) {
      let pending = base.filter((x) => x === 6).length;
      while (pending-- > 0 && extra.length < 60) {
        const x = d(6, rng);
        extra.push(x);
        if (x === 6) pending++;
      }
    }
    const all = [...base, ...extra];
    const hits = all.filter((x) => x >= 5).length;
    const ones = base.filter((x) => x === 1).length;
    const glitch = ones > size / 2;
    let headline: string; let tone: Tone;
    if (glitch && hits === 0) { headline = 'Falha crítica (critical glitch)!'; tone = 'fumble'; }
    else if (glitch) { headline = `Glitch! ${hits} acerto(s)`; tone = 'mixed'; }
    else if (thr > 0) { headline = hits >= thr ? `Sucesso · ${hits - thr} extra` : 'Falha'; tone = hits >= thr ? 'good' : 'bad'; }
    else { headline = `${hits} acerto${hits === 1 ? '' : 's'}`; tone = hits > 0 ? 'good' : 'bad'; }
    const view = (x: number): DieView => ({ value: x, sides: 6, state: x >= 5 ? (x === 6 && edge ? ['hit', 'ace'] : ['hit']) : x === 1 ? ['fumble'] : [] });
    return {
      groups: [
        { label: `${size}d6`, dice: base.map(view) },
        ...(extra.length ? [{ label: 'regra do 6', dice: extra.map(view) }] : []),
      ],
      total: String(hits),
      headline,
      detail: `${ones} um(s)${thr ? ` · limiar ${thr}` : ''}`,
      tone,
      summary: `${size}d6 = ${hits} acerto(s)${glitch ? ' GLITCH' : ''}`,
    };
  },
};

// ---------- Savage Worlds ----------
const swade: GameSystem = {
  id: 'swade',
  name: 'Savage Worlds',
  short: 'SWADE',
  color: '#FFEC27',
  blurb: 'Dado de característica + dado selvagem d6, ambos explodem. Fica com o maior; 4 é sucesso, cada +4 é ampliação.',
  fields: [
    {
      key: 'die', label: 'Dado', type: 'select', def: '8',
      options: ['4', '6', '8', '10', '12'].map((x) => ({ value: x, label: `d${x}` })),
    },
    { key: 'mod', label: 'Modificador', type: 'number', min: -6, max: 6, def: 0 },
    {
      key: 'wild', label: 'Personagem', type: 'select', def: 'yes',
      options: [{ value: 'yes', label: 'Carta Selvagem' }, { value: 'no', label: 'Extra' }],
    },
    { key: 'tn', label: 'Número-alvo', type: 'number', min: 2, max: 12, def: 4 },
  ],
  roll: (v, rng) => {
    const sides = n(v, 'die');
    const mod = n(v, 'mod');
    const tn = n(v, 'tn');
    const wild = v.wild === 'yes';
    const ace = (s: number) => {
      const rolls = [d(s, rng)];
      while (rolls[rolls.length - 1] === s && rolls.length < 30) rolls.push(d(s, rng));
      return rolls;
    };
    const trait = ace(sides);
    const wildR = wild ? ace(6) : [];
    const tSum = trait.reduce((a, b) => a + b, 0);
    const wSum = wildR.reduce((a, b) => a + b, 0);
    const best = Math.max(tSum, wSum);
    const total = best + mod;
    const snake = wild && trait[0] === 1 && wildR[0] === 1;
    const raises = Math.floor((total - tn) / 4);
    let headline: string; let tone: Tone;
    if (snake) { headline = 'Olhos de cobra! Falha crítica'; tone = 'fumble'; }
    else if (total < tn) { headline = 'Falha'; tone = 'bad'; }
    else if (raises >= 1) { headline = `Sucesso com ${raises} ampliação${raises > 1 ? 'ões' : ''}!`; tone = 'crit'; }
    else { headline = 'Sucesso'; tone = 'good'; }
    const view = (rolls: number[], s: number, extra: DieState[], used: boolean): DieView[] =>
      rolls.map((x) => ({ value: x, sides: s, state: [...extra, ...(x === s ? (['ace'] as DieState[]) : []), ...(!used ? (['drop'] as DieState[]) : [])] }));
    const traitUsed = tSum >= wSum;
    return {
      groups: [
        { label: `d${sides}${trait.length > 1 ? ' (explodiu)' : ''}`, dice: view(trait, sides, [], traitUsed) },
        ...(wild ? [{ label: `selvagem d6${wildR.length > 1 ? ' (explodiu)' : ''}`, dice: view(wildR, 6, ['wild'], !traitUsed) }] : []),
      ],
      total: String(total),
      headline,
      detail: `${best} ${sgn(mod)} vs ${tn}`,
      tone,
      summary: `d${sides}${wild ? '+selvagem' : ''}${sgn(mod)} = ${total} (${headline})`,
    };
  },
};

// ---------- Blades in the Dark / Forged in the Dark ----------
const fitd: GameSystem = {
  id: 'fitd',
  name: 'Blades in the Dark (Forged in the Dark)',
  short: 'BLADES',
  color: '#C2C3C7',
  blurb: 'Parada de d6, vale o maior. 6 sucesso, 4–5 com consequência, dois 6 é crítico. Parada 0 = 2d6 pega o menor.',
  fields: [{ key: 'pool', label: 'Dados', type: 'number', min: 0, max: 10, def: 2 }],
  roll: (v, rng) => {
    const size = n(v, 'pool');
    const zero = size === 0;
    const rolls = pool(zero ? 2 : size, 6, rng);
    const top = zero ? Math.min(...rolls) : Math.max(...rolls);
    const sixes = rolls.filter((x) => x === 6).length;
    const topIdx = rolls.indexOf(top);
    let headline: string; let tone: Tone;
    if (!zero && sixes >= 2) { headline = 'Crítico! Efeito aumentado'; tone = 'crit'; }
    else if (top === 6) { headline = 'Sucesso total'; tone = 'good'; }
    else if (top >= 4) { headline = 'Sucesso parcial, com consequência'; tone = 'mixed'; }
    else { headline = 'Resultado ruim'; tone = 'bad'; }
    return {
      groups: [{ label: zero ? '0 dados: 2d6, pega o menor' : `${size}d6, pega o maior`, dice: rolls.map((x, i) => ({ value: x, sides: 6, state: (i === topIdx || (!zero && sixes >= 2 && x === 6)) ? (x === 6 ? ['crit'] : []) : ['drop'] })) }],
      total: String(top),
      headline,
      tone,
      summary: `${zero ? '0' : size}d6 = ${top} (${headline})`,
    };
  },
};

// ---------- Daggerheart ----------
const dh: GameSystem = {
  id: 'dh',
  name: 'Daggerheart',
  short: 'DUALITY',
  color: '#83769C',
  blurb: 'Dados da Dualidade: d12 de Esperança + d12 de Medo. O maior diz quem ganha o momento; iguais é crítico.',
  fields: [
    { key: 'mod', label: 'Modificador', type: 'number', min: -5, max: 10, def: 1 },
    { key: 'dc', label: 'Dificuldade', type: 'number', min: 0, max: 30, def: 12 },
    {
      key: 'adv', label: 'Vantagem', type: 'select', def: 'none',
      options: [{ value: 'none', label: 'Nenhuma' }, { value: 'adv', label: '+d6 vantagem' }, { value: 'dis', label: '−d6 desvantagem' }],
    },
  ],
  roll: (v, rng) => {
    const mod = n(v, 'mod');
    const dc = n(v, 'dc');
    const hope = d(12, rng);
    const fear = d(12, rng);
    const advDie = v.adv === 'none' ? 0 : d(6, rng);
    const advVal = v.adv === 'dis' ? -advDie : advDie;
    const total = hope + fear + mod + advVal;
    const crit = hope === fear;
    const withHope = hope > fear;
    let headline: string; let tone: Tone;
    if (crit) { headline = 'Crítico! (+1 Esperança, alivia 1 Estresse)'; tone = 'crit'; }
    else if (dc > 0 && total >= dc) { headline = withHope ? 'Sucesso com Esperança' : 'Sucesso com Medo'; tone = withHope ? 'good' : 'mixed'; }
    else if (dc > 0) { headline = withHope ? 'Falha com Esperança' : 'Falha com Medo'; tone = withHope ? 'mixed' : 'bad'; }
    else { headline = withHope ? 'Com Esperança' : 'Com Medo'; tone = withHope ? 'good' : 'mixed'; }
    return {
      groups: [
        { label: 'esperança', dice: [{ value: hope, sides: 12, state: ['hope'] }] },
        { label: 'medo', dice: [{ value: fear, sides: 12, state: ['fear'] }] },
        ...(advDie ? [{ label: v.adv === 'adv' ? 'vantagem' : 'desvantagem', dice: [{ value: advDie, sides: 6 }] }] : []),
      ],
      total: String(total),
      headline,
      detail: `${hope} + ${fear}${advDie ? ` ${sgn(advVal)}` : ''} ${sgn(mod)}${dc ? ` vs ${dc}` : ''}`,
      tone,
      summary: `Dualidade${sgn(mod)} = ${total} (${headline})`,
    };
  },
};

// ---------- GURPS ----------
const gurps: GameSystem = {
  id: 'gurps',
  name: 'GURPS',
  short: '3D6',
  color: '#008751',
  blurb: '3d6 igual ou abaixo do NH. 3–4 sempre é crítico; 18 sempre é falha crítica.',
  fields: [
    { key: 'skill', label: 'NH', type: 'number', min: 3, max: 25, def: 12 },
    { key: 'mod', label: 'Modificador', type: 'number', min: -10, max: 10, def: 0 },
  ],
  roll: (v, rng) => {
    const eff = n(v, 'skill') + n(v, 'mod');
    const rolls = pool(3, 6, rng);
    const r = rolls.reduce((a, b) => a + b, 0);
    const critS = r <= 4 || (r === 5 && eff >= 15) || (r === 6 && eff >= 16);
    const critF = r === 18 || (r === 17 && eff <= 15) || r - eff >= 10;
    const ok = !critF && (critS || (r <= eff && r <= 16));
    let headline: string; let tone: Tone;
    if (critS) { headline = 'Sucesso decisivo!'; tone = 'crit'; }
    else if (critF) { headline = 'Falha crítica!'; tone = 'fumble'; }
    else if (ok) { headline = `Sucesso por ${eff - r}`; tone = 'good'; }
    else { headline = `Falha por ${r - eff}`; tone = 'bad'; }
    return {
      groups: [{ label: '3d6', dice: rolls.map((x) => ({ value: x, sides: 6 })) }],
      total: String(r),
      headline,
      detail: `NH efetivo ${eff}`,
      tone,
      summary: `3d6 vs ${eff} = ${r} (${headline})`,
    };
  },
};

export const SYSTEMS: GameSystem[] = [livre, d20, fate, pbta, coc, v5, wod, sr, swade, fitd, dh, gurps];

export function defaults(sys: GameSystem): Values {
  return Object.fromEntries(sys.fields.map((f) => [f.key, f.def]));
}

export function rollSystem(sys: GameSystem, values: Values, rng: Rng = cryptoRng): SystemRoll {
  return sys.roll({ ...defaults(sys), ...values }, rng);
}
