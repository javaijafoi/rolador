import { describe, expect, it } from 'vitest';
import { SYSTEMS, rollSystem } from './systems';
import type { Rng } from './dice';

const seq = (...vals: number[]): Rng => {
  let i = 0;
  return () => vals[i++ % vals.length];
};
const sys = (id: string) => SYSTEMS.find((s) => s.id === id)!;

describe('sistemas', () => {
  it('todos rolam com valores padrão sem quebrar', () => {
    for (const s of SYSTEMS) {
      for (let i = 0; i < 200; i++) {
        const r = rollSystem(s, {});
        expect(r.total).toBeTruthy();
        expect(r.headline).toBeTruthy();
      }
    }
  });
  it('d20 com vantagem fica com o maior e marca crítico', () => {
    const r = rollSystem(sys('d20'), { mod: 3, adv: 'adv', dc: 15 }, seq(4, 20));
    expect(r.total).toBe('23');
    expect(r.tone).toBe('crit');
  });
  it('d20 contra CD', () => {
    expect(rollSystem(sys('d20'), { mod: 2, dc: 15 }, seq(12)).tone).toBe('bad');
    expect(rollSystem(sys('d20'), { mod: 3, dc: 15 }, seq(12)).tone).toBe('good');
  });
  it('fate soma perícia e invocação', () => {
    const r = rollSystem(sys('fate'), { skill: 3, diff: 2, invoke: 1 }, seq(2, 2, 2, 2));
    expect(r.total).toBe('+5');
    expect(r.tone).toBe('crit'); // 3 tensões = estilo
  });
  it('pbta faixas', () => {
    expect(rollSystem(sys('pbta'), { stat: 1 }, seq(3, 3)).headline).toMatch(/^7–9/);
    expect(rollSystem(sys('pbta'), { stat: 1 }, seq(5, 4)).headline).toMatch(/^10\+/);
    expect(rollSystem(sys('pbta'), { stat: 0 }, seq(1, 2)).headline).toMatch(/^6-/);
  });
  it('cthulhu níveis e bônus', () => {
    // unidades 5 (rng 6), dezenas 0 (rng 1) => 05
    expect(rollSystem(sys('coc'), { skill: 50 }, seq(6, 1)).headline).toBe('Sucesso extremo');
    // bônus: dezenas 7 e 2 → fica 25
    expect(rollSystem(sys('coc'), { skill: 50, bonus: 1 }, seq(6, 8, 3)).total).toBe('25');
    // penalidade: fica 75
    expect(rollSystem(sys('coc'), { skill: 50, bonus: -1 }, seq(6, 8, 3)).total).toBe('75');
    // 00 + 0 = 100 desastre
    expect(rollSystem(sys('coc'), { skill: 60 }, seq(1, 1)).headline).toBe('Desastre');
  });
  it('v5 par de 10 e fome', () => {
    const r = rollSystem(sys('v5'), { pool: 3, hunger: 1, diff: 2 }, seq(10, 3, 10));
    expect(r.total).toBe('4');
    expect(r.headline).toBe('Crítico bagunçado!');
    expect(rollSystem(sys('v5'), { pool: 2, hunger: 1, diff: 3 }, seq(7, 1)).headline).toBe('Falha bestial');
  });
  it('storyteller: 1 anula e falha crítica', () => {
    expect(rollSystem(sys('wod'), { pool: 3, diff: 6 }, seq(7, 1, 3)).headline).toBe('Falha');
    expect(rollSystem(sys('wod'), { pool: 2, diff: 6 }, seq(1, 3)).tone).toBe('fumble');
  });
  it('shadowrun glitch', () => {
    expect(rollSystem(sys('sr'), { pool: 3, threshold: 0 }, seq(1, 1, 2)).tone).toBe('fumble');
    expect(rollSystem(sys('sr'), { pool: 3, threshold: 0 }, seq(1, 1, 5)).tone).toBe('mixed');
  });
  it('savage worlds explode e ampliação', () => {
    const r = rollSystem(sys('swade'), { die: '6', mod: 0, wild: 'yes', tn: 4 }, seq(6, 3, 2));
    expect(r.total).toBe('9');
    expect(r.headline).toMatch(/ampliação/);
    expect(rollSystem(sys('swade'), { die: '8', wild: 'yes' }, seq(1, 1)).tone).toBe('fumble');
  });
  it('blades crítico com dois 6', () => {
    expect(rollSystem(sys('fitd'), { pool: 3 }, seq(6, 2, 6)).tone).toBe('crit');
    expect(rollSystem(sys('fitd'), { pool: 0 }, seq(6, 2)).total).toBe('2');
  });
  it('daggerheart dualidade', () => {
    expect(rollSystem(sys('dh'), { mod: 0, dc: 10 }, seq(8, 3)).headline).toBe('Sucesso com Esperança');
    expect(rollSystem(sys('dh'), { mod: 0, dc: 10 }, seq(5, 5)).tone).toBe('crit');
  });
  it('gurps decisivo e falha crítica', () => {
    expect(rollSystem(sys('gurps'), { skill: 12 }, seq(1, 1, 2)).tone).toBe('crit');
    expect(rollSystem(sys('gurps'), { skill: 12 }, seq(6, 6, 6)).tone).toBe('fumble');
  });
});
