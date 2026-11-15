import { describe, expect, it } from 'vitest';
import { roll, parse, stats, fateLabel, fateOutcome, DiceError, cryptoRng, type Rng } from './dice';

const seq = (...vals: number[]): Rng => {
  let i = 0;
  return () => vals[i++ % vals.length];
};

describe('parse', () => {
  it('entende notação básica', () => {
    const t = parse('2d6 + 3');
    expect(t).toHaveLength(2);
    expect(t[0]).toMatchObject({ kind: 'dice', count: 2, sides: 6 });
    expect(t[1]).toMatchObject({ kind: 'const', value: 3, sign: 1 });
  });
  it('d% vira d100 e dF é Fate', () => {
    expect(parse('d%')[0]).toMatchObject({ sides: 100, count: 1 });
    expect(parse('4dF')[0]).toMatchObject({ sides: 'F', count: 4 });
  });
  it('rejeita lixo e limites', () => {
    expect(() => parse('')).toThrow(DiceError);
    expect(() => parse('abc')).toThrow(DiceError);
    expect(() => parse('2d1')).toThrow(DiceError);
    expect(() => parse('1000d6')).toThrow(DiceError);
    expect(() => parse('2d6kh3')).toThrow(DiceError);
    expect(() => parse('1d6r<7')).toThrow(DiceError);
  });
});

describe('roll', () => {
  it('soma dados e modificador', () => {
    const r = roll('2d6+3', seq(4, 5));
    expect(r.total).toBe(12);
  });
  it('subtrai parcelas', () => {
    expect(roll('1d8-1d4-2', seq(6, 3)).total).toBe(1);
  });
  it('vantagem: 2d20kh1', () => {
    const r = roll('2d20kh1', seq(7, 15));
    expect(r.total).toBe(15);
    expect(r.terms[0].dice.filter((d) => d.dropped)).toHaveLength(1);
  });
  it('desvantagem: 2d20kl1', () => {
    expect(roll('2d20kl1', seq(7, 15)).total).toBe(7);
  });
  it('4d6 descarta o menor', () => {
    expect(roll('4d6dl1', seq(1, 6, 3, 4)).total).toBe(13);
    expect(roll('4d6k3', seq(1, 6, 3, 4)).total).toBe(13);
  });
  it('explosão normal', () => {
    const r = roll('1d6!', seq(6, 6, 2));
    expect(r.total).toBe(14);
    expect(r.terms[0].dice).toHaveLength(3);
  });
  it('explosão composta', () => {
    const r = roll('1d6!!', seq(6, 3));
    expect(r.total).toBe(9);
    expect(r.terms[0].dice).toHaveLength(1);
  });
  it('rerrolagem de 1', () => {
    const r = roll('1d6r1', seq(1, 1, 4));
    expect(r.total).toBe(4);
    expect(r.terms[0].dice.filter((d) => d.rerolled)).toHaveLength(2);
  });
  it('conta sucessos', () => {
    const r = roll('5d10>=8', seq(8, 2, 10, 7, 9));
    expect(r.total).toBe(3);
    expect(r.successes).toBe(3);
  });
  it('dados Fate somam -1..+1', () => {
    // rng(3): 1 -> -1, 2 -> 0, 3 -> +1
    expect(roll('4dF+2', seq(3, 3, 2, 1)).total).toBe(3);
  });
  it('marca 20 e 1 naturais no d20', () => {
    expect(roll('1d20+5', seq(20)).natural).toBe('max');
    expect(roll('1d20+5', seq(1)).natural).toBe('min');
    expect(roll('2d20kh1', seq(1, 20)).natural).toBe('max');
    expect(roll('1d20+5', seq(10)).natural).toBeUndefined();
  });
});

describe('stats', () => {
  it('calcula min/max/média', () => {
    expect(stats('2d6+3')).toEqual({ min: 5, max: 15, avg: 10 });
    expect(stats('4dF')).toEqual({ min: -4, max: 4, avg: 0 });
  });
  it('vantagem tem média exata', () => {
    expect(stats('2d20kh1')!.avg).toBeCloseTo(13.825, 1);
  });
  it('inválido devolve null', () => {
    expect(stats('xx')).toBeNull();
  });
});

describe('fate', () => {
  it('escada e resultado', () => {
    expect(fateLabel(4)).toBe('Ótimo');
    expect(fateLabel(-2)).toBe('Terrível');
    expect(fateOutcome(3, 2)).toBe('success');
    expect(fateOutcome(2, 2)).toBe('tie');
    expect(fateOutcome(5, 2)).toBe('style');
    expect(fateOutcome(1, 2)).toBe('fail');
  });
});

describe('cryptoRng', () => {
  it('fica no intervalo e cobre todas as faces', () => {
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) {
      const v = cryptoRng(6);
      expect(v).toBeGreaterThanOrEqual(1);
      expect(v).toBeLessThanOrEqual(6);
      seen.add(v);
    }
    expect(seen.size).toBe(6);
  });
});
