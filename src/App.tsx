import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SYSTEMS, defaults, rollSystem, type DieView, type Field, type GameSystem, type SystemRoll, type Values } from './systems';
import { DiceError, cryptoRng, stats } from './dice';
import { sfx } from './sound';

interface HistoryEntry {
  id: number;
  at: number;
  system: string;
  values: Values;
  summary: string;
  tone: SystemRoll['tone'];
}

const store = {
  get<T>(k: string, fallback: T): T {
    try {
      const raw = localStorage.getItem(`rolador:${k}`);
      return raw ? (JSON.parse(raw) as T) : fallback;
    } catch {
      return fallback;
    }
  },
  set(k: string, v: unknown) {
    try {
      localStorage.setItem(`rolador:${k}`, JSON.stringify(v));
    } catch {
      /* armazenamento indisponível: segue sem salvar */
    }
  },
};

const QUICK_DICE = ['d4', 'd6', 'd8', 'd10', 'd12', 'd20', 'd100', 'dF'];
const PRESETS: { label: string; expr: string }[] = [
  { label: 'Atributo 4d6kh3', expr: '4d6kh3' },
  { label: 'Vantagem', expr: '2d20kh1' },
  { label: 'Desvantagem', expr: '2d20kl1' },
  { label: 'Bola de fogo', expr: '8d6' },
  { label: 'Explode', expr: '3d6!' },
  { label: 'Sucessos d10', expr: '6d10>=8' },
];

function addDie(expr: string, die: string): string {
  const e = expr.trim();
  if (!e) return `1${die}`;
  const re = new RegExp(`(^|[+-])(\\d*)${die}(?![0-9a-z!<>=])`, 'i');
  const m = e.match(re);
  if (m && m.index !== undefined) {
    const count = (parseInt(m[2] || '1', 10) || 1) + 1;
    const start = m.index + m[1].length;
    return e.slice(0, start) + `${count}${die}` + e.slice(start + m[2].length + die.length);
  }
  // insere antes do modificador final, se houver
  const mod = e.match(/([+-]\d+)$/);
  if (mod && mod.index !== undefined && mod.index > 0) return `${e.slice(0, mod.index)}+1${die}${mod[1]}`;
  return `${e}+1${die}`;
}

function Die({ die, rolling }: { die: DieView; rolling: boolean }) {
  const [shown, setShown] = useState(die.value);
  useEffect(() => {
    if (!rolling) {
      setShown(die.value);
      return;
    }
    const faces = die.sides === 'F' ? ['+', '−', '·'] : null;
    const id = setInterval(() => {
      setShown(faces ? faces[cryptoRng(3) - 1] : cryptoRng(die.sides === 'F' ? 3 : (die.sides as number)));
    }, 60);
    return () => clearInterval(id);
  }, [rolling, die]);
  const cls = ['die', `d${die.sides}`, ...(die.state ?? []).map((s) => `is-${s}`), rolling ? 'rolling' : 'landed'].join(' ');
  return (
    <div className={cls} title={`d${die.sides === 'F' ? 'F' : die.sides}: ${die.value}`}>
      <span className="die-val">{shown}</span>
      <span className="die-tag">{die.sides === 'F' ? 'dF' : `d${die.sides}`}</span>
    </div>
  );
}

function Stepper({ field, value, onChange }: { field: Extract<Field, { type: 'number' }>; value: number; onChange: (v: number) => void }) {
  const clamp = (x: number) => Math.max(field.min, Math.min(field.max, x));
  return (
    <div className="stepper">
      <button type="button" className="px-btn small" aria-label={`Diminuir ${field.label}`} onClick={() => onChange(clamp(value - 1))}>−</button>
      <input
        type="number"
        inputMode="numeric"
        value={value}
        min={field.min}
        max={field.max}
        aria-label={field.label}
        onChange={(e) => {
          const raw = e.target.value;
          if (raw === '' || raw === '-') return;
          const v = parseInt(raw, 10);
          if (!Number.isNaN(v)) onChange(clamp(v));
        }}
      />
      <button type="button" className="px-btn small" aria-label={`Aumentar ${field.label}`} onClick={() => onChange(clamp(value + 1))}>+</button>
    </div>
  );
}

export default function App() {
  const [sysId, setSysId] = useState<string>(() => {
    const fromHash = decodeURIComponent(location.hash.slice(1));
    if (fromHash) return 'livre';
    return store.get('system', 'livre');
  });
  const [allValues, setAllValues] = useState<Record<string, Values>>(() => {
    const saved = store.get<Record<string, Values>>('values', {});
    const fromHash = decodeURIComponent(location.hash.slice(1));
    if (fromHash) saved.livre = { expr: fromHash };
    return saved;
  });
  const [result, setResult] = useState<SystemRoll | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rolling, setRolling] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>(() => store.get('history', []));
  const [sound, setSound] = useState<boolean>(() => store.get('sound', true));
  const [rollKey, setRollKey] = useState(0);
  const timer = useRef<number>();

  const system = SYSTEMS.find((s) => s.id === sysId) ?? SYSTEMS[0];
  const values: Values = useMemo(() => ({ ...defaults(system), ...(allValues[system.id] ?? {}) }), [system, allValues]);

  useEffect(() => store.set('system', sysId), [sysId]);
  useEffect(() => store.set('values', allValues), [allValues]);
  useEffect(() => store.set('history', history.slice(0, 60)), [history]);
  useEffect(() => store.set('sound', sound), [sound]);

  const setValue = (k: string, v: string | number) => {
    setAllValues((prev) => ({ ...prev, [system.id]: { ...values, [k]: v } }));
    setError(null);
  };

  const doRoll = useCallback(
    (sys: GameSystem = system, vals: Values = values) => {
      let r: SystemRoll;
      try {
        r = rollSystem(sys, vals);
      } catch (e) {
        setError(e instanceof DiceError ? e.message : 'Rolagem inválida');
        if (sound) sfx.error();
        return;
      }
      setError(null);
      setResult(r);
      setRolling(true);
      setRollKey((k) => k + 1);
      if (sound) sfx.roll();
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => {
        setRolling(false);
        if (sound) sfx.land(r.tone);
      }, 520);
      setHistory((h) => [
        { id: Date.now() + Math.random(), at: Date.now(), system: sys.id, values: vals, summary: r.summary, tone: r.tone },
        ...h,
      ].slice(0, 60));
      if (sys.id === 'livre') window.history.replaceState(null, '', `#${encodeURIComponent(String(vals.expr))}`);
    },
    [system, values, sound],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (e.key === ' ' && tag !== 'INPUT' && tag !== 'SELECT' && tag !== 'BUTTON') {
        e.preventDefault();
        doRoll();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [doRoll]);

  const pickSystem = (id: string) => {
    setSysId(id);
    setResult(null);
    setError(null);
    if (sound) sfx.blip();
  };

  const exprStats = system.id === 'livre' ? stats(String(values.expr)) : null;

  return (
    <div className="app">
      <header className="top">
        <div className="logo">
          <span className="logo-die" aria-hidden>▣</span>
          <h1>ROLADOR<span className="cursor">_</span></h1>
        </div>
        <p className="tag">dados para qualquer mesa</p>
        <button type="button" className="px-btn small ghost" onClick={() => setSound((s) => !s)} aria-pressed={sound}>
          {sound ? '♪ SOM' : '♪ MUDO'}
        </button>
      </header>

      <nav className="carts" aria-label="Sistemas">
        {SYSTEMS.map((s) => (
          <button
            key={s.id}
            type="button"
            className={`cart${s.id === system.id ? ' active' : ''}`}
            style={{ ['--c' as string]: s.color }}
            onClick={() => pickSystem(s.id)}
            title={s.name}
          >
            <span className="cart-label">{s.short}</span>
          </button>
        ))}
      </nav>

      <main className="grid">
        <section className="panel config" aria-label="Configurar rolagem">
          <h2 style={{ color: system.color }}>{system.name}</h2>
          <p className="blurb">{system.blurb}</p>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              doRoll();
            }}
          >
            {system.fields.map((f) => (
              <label key={f.key} className="field">
                <span className="field-label">{f.label}</span>
                {f.type === 'number' && <Stepper field={f} value={Number(values[f.key])} onChange={(v) => setValue(f.key, v)} />}
                {f.type === 'select' && (
                  <div className="seg" role="radiogroup" aria-label={f.label}>
                    {f.options.map((o) => (
                      <button
                        key={o.value}
                        type="button"
                        role="radio"
                        aria-checked={values[f.key] === o.value}
                        className={`px-btn small${values[f.key] === o.value ? ' on' : ''}`}
                        onClick={() => setValue(f.key, o.value)}
                      >
                        {o.label}
                      </button>
                    ))}
                  </div>
                )}
                {f.type === 'text' && (
                  <input
                    className="expr"
                    type="text"
                    spellCheck={false}
                    autoCapitalize="off"
                    autoComplete="off"
                    value={String(values[f.key])}
                    placeholder={f.placeholder}
                    onChange={(e) => setValue(f.key, e.target.value)}
                  />
                )}
              </label>
            ))}

            {system.id === 'livre' && (
              <>
                <div className="quick" aria-label="Adicionar dado">
                  {QUICK_DICE.map((q) => (
                    <button key={q} type="button" className="px-btn small" onClick={() => setValue('expr', addDie(String(values.expr), q === 'd100' ? 'd100' : q.toLowerCase()))}>
                      +{q}
                    </button>
                  ))}
                  <button type="button" className="px-btn small ghost" onClick={() => setValue('expr', '')}>LIMPAR</button>
                </div>
                <div className="presets">
                  {PRESETS.map((p) => (
                    <button key={p.expr} type="button" className="chip" onClick={() => setValue('expr', p.expr)}>
                      {p.label} <code>{p.expr}</code>
                    </button>
                  ))}
                </div>
                {exprStats && (
                  <p className="stats">
                    mín {exprStats.min} · média {exprStats.avg} · máx {exprStats.max === Infinity ? '∞' : exprStats.max}
                  </p>
                )}
                <details className="help">
                  <summary>Como escrever rolagens</summary>
                  <ul>
                    <li><code>2d6+3</code> soma dados e modificador</li>
                    <li><code>4d6kh3</code> mantém os 3 maiores · <code>kl</code> menores · <code>dl1</code> descarta o menor</li>
                    <li><code>2d20kh1</code> vantagem · <code>2d20kl1</code> desvantagem</li>
                    <li><code>3d6!</code> explode no máximo · <code>1d6!!</code> explosão somada</li>
                    <li><code>1d20r1</code> rerrola 1 · <code>4d6r&lt;3</code> rerrola abaixo de 3</li>
                    <li><code>8d10&gt;=7</code> conta sucessos</li>
                    <li><code>d%</code> = d100 · <code>4dF</code> dados Fate</li>
                  </ul>
                </details>
              </>
            )}

            <button type="submit" className="px-btn roll" disabled={rolling}>
              {rolling ? 'ROLANDO...' : '▶ ROLAR'}
            </button>
            <p className="hint">ou aperte espaço</p>
          </form>
        </section>

        <section className={`panel screen tone-${result && !rolling ? result.tone : 'idle'}`} aria-live="polite" aria-label="Resultado">
          {error && <p className="error">⚠ {error}</p>}
          {!result && !error && (
            <div className="idle">
              <p className="blink">INSIRA DADOS</p>
              <p className="small">escolha o sistema e role</p>
            </div>
          )}
          {result && (
            <div className="result" key={rollKey}>
              <div className="groups">
                {result.groups.map((g, i) => (
                  <div className="group" key={i}>
                    {g.label && <span className="group-label">{g.label}</span>}
                    <div className="dice">
                      {g.dice.map((d, j) => (
                        <Die key={j} die={d} rolling={rolling} />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              <div className={`total${rolling ? ' hidden' : ''}`}>{result.total}</div>
              <div className={`headline${rolling ? ' hidden' : ''}`}>{result.headline}</div>
              {result.detail && <div className={`detail${rolling ? ' hidden' : ''}`}>{result.detail}</div>}
            </div>
          )}
        </section>

        <section className="panel log" aria-label="Histórico">
          <div className="log-head">
            <h2>Histórico</h2>
            {history.length > 0 && (
              <button type="button" className="px-btn small ghost" onClick={() => setHistory([])}>APAGAR</button>
            )}
          </div>
          {history.length === 0 ? (
            <p className="small muted">Nenhuma rolagem ainda. Fica salvo só neste navegador.</p>
          ) : (
            <ol>
              {history.map((h) => {
                const s = SYSTEMS.find((x) => x.id === h.system);
                return (
                  <li key={h.id} className={`tone-${h.tone}`}>
                    <button
                      type="button"
                      className="log-item"
                      title="Rolar de novo"
                      onClick={() => {
                        if (!s) return;
                        setSysId(s.id);
                        setAllValues((prev) => ({ ...prev, [s.id]: h.values }));
                        doRoll(s, h.values);
                      }}
                    >
                      <span className="log-sys" style={{ color: s?.color }}>{s?.short ?? h.system}</span>
                      <span className="log-sum">{h.summary}</span>
                      <span className="log-time">{new Date(h.at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>
                    </button>
                  </li>
                );
              })}
            </ol>
          )}
        </section>
      </main>

      <footer className="foot">
        <span>aleatoriedade via crypto.getRandomValues · nada sai do seu navegador</span>
      </footer>
    </div>
  );
}
