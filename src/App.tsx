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

interface Favorite {
  id: number;
  system: string;
  values: Values;
  name: string;
}

function describe(sys: GameSystem, vals: Values): string {
  const full = { ...defaults(sys), ...vals };
  if (sys.id === 'livre') return String(full.expr).trim();
  return sys.fields
    .filter((f) => f.type !== 'text')
    .map((f) => {
      const v = full[f.key];
      if (f.type === 'select') return f.options.find((o) => o.value === v)?.label ?? String(v);
      return `${f.label.split(/[ (]/)[0]} ${v}`;
    })
    .join(' · ');
}

function favKey(sys: GameSystem, vals: Values): string {
  const full = { ...defaults(sys), ...vals };
  const norm = sys.fields.map((f) => [f.key, f.type === 'text' ? String(full[f.key]).replace(/\s+/g, '').toLowerCase() : full[f.key]]);
  return `${sys.id}|${JSON.stringify(norm)}`;
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

const HOLD_MS = 1000;
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
  const [drawer, setDrawer] = useState<null | 'config' | 'log'>(null);
  const [selFav, setSelFav] = useState<number | null>(() => store.get('selFav', null));
  const [favs, setFavs] = useState<Favorite[]>(() => store.get('favs', []));
  const [renaming, setRenaming] = useState<number | null>(null);
  const [holding, setHolding] = useState(false);
  const [shakeOn, setShakeOn] = useState(false);
  const hold = useRef<{ timer?: number; fired: boolean; x: number; y: number; t: number; moved: boolean }>({ fired: false, x: 0, y: 0, t: 0, moved: false });
  const rollRef = useRef<() => void>(() => {});
  const canShake = typeof window !== 'undefined' && 'DeviceMotionEvent' in window && window.matchMedia?.('(pointer: coarse)').matches;

  const isFav = sysId === 'fav';
  const system = SYSTEMS.find((s) => s.id === sysId) ?? SYSTEMS[0];
  const values: Values = useMemo(() => ({ ...defaults(system), ...(allValues[system.id] ?? {}) }), [system, allValues]);

  useEffect(() => store.set('system', sysId), [sysId]);
  useEffect(() => store.set('values', allValues), [allValues]);
  useEffect(() => store.set('history', history.slice(0, 60)), [history]);
  useEffect(() => store.set('sound', sound), [sound]);
  useEffect(() => store.set('favs', favs), [favs]);
  useEffect(() => store.set('selFav', selFav), [selFav]);

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

  const rollFav = (f: Favorite) => {
    const s = SYSTEMS.find((x) => x.id === f.system);
    if (!s) return;
    setSelFav(f.id);
    setDrawer(null);
    doRoll(s, { ...defaults(s), ...f.values });
  };
  const rollCurrent = () => {
    if (!isFav) return doRoll();
    const f = favs.find((x) => x.id === selFav) ?? favs[0];
    if (f) rollFav(f);
    else setError('Nenhuma favorita ainda. Escolha um sistema e toque no ♡');
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (e.key === ' ' && tag !== 'INPUT' && tag !== 'SELECT' && tag !== 'BUTTON') {
        e.preventDefault();
        rollRef.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (!drawer) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setDrawer(null);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawer]);

  // Rolar mantendo pressionado 1s, ou chacoalhando o celular. Toque curto abre os ajustes.
  useEffect(() => {
    rollRef.current = () => {
      setDrawer(null);
      rollCurrent();
      try { navigator.vibrate?.(40); } catch { /* sem vibração */ }
    };
  });

  const cancelHold = () => {
    window.clearTimeout(hold.current.timer);
    setHolding(false);
  };
  const onScreenDown = (e: React.PointerEvent) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    const h = hold.current;
    h.fired = false; h.moved = false; h.x = e.clientX; h.y = e.clientY; h.t = Date.now();
    setHolding(true);
    window.clearTimeout(h.timer);
    h.timer = window.setTimeout(() => {
      h.fired = true;
      setHolding(false);
      rollRef.current();
    }, HOLD_MS);
  };
  const onScreenMove = (e: React.PointerEvent) => {
    const h = hold.current;
    if (!h.moved && Math.hypot(e.clientX - h.x, e.clientY - h.y) > 14) {
      h.moved = true;
      cancelHold();
    }
  };
  const onScreenUp = () => {
    const h = hold.current;
    const wasHolding = !h.fired && !h.moved && h.t > 0;
    cancelHold();
    if (wasHolding && Date.now() - h.t < 300) setDrawer('config');
    h.t = 0;
  };

  // Chacoalhar: duas sacudidas fortes em menos de 0,8 s.
  useEffect(() => {
    if (!shakeOn) return;
    let last: [number, number, number] | null = null;
    let spikes: number[] = [];
    let cooldown = 0;
    const onMotion = (e: DeviceMotionEvent) => {
      const a = e.accelerationIncludingGravity;
      if (!a || a.x == null || a.y == null || a.z == null) return;
      const cur: [number, number, number] = [a.x, a.y, a.z];
      if (last) {
        const delta = Math.abs(cur[0] - last[0]) + Math.abs(cur[1] - last[1]) + Math.abs(cur[2] - last[2]);
        const now = Date.now();
        if (delta > 28 && now > cooldown) {
          spikes = [...spikes.filter((t) => now - t < 800), now];
          if (spikes.length >= 2) {
            spikes = [];
            cooldown = now + 1500;
            rollRef.current();
          }
        }
      }
      last = cur;
    };
    window.addEventListener('devicemotion', onMotion);
    return () => window.removeEventListener('devicemotion', onMotion);
  }, [shakeOn]);

  useEffect(() => {
    // Religa sozinho se estava ligado. No iOS o pedido de permissão exige um toque, então falha em silêncio.
    if (!canShake || !store.get('shake', false)) return;
    const DM = (window as unknown as { DeviceMotionEvent: { requestPermission?: () => Promise<string> } }).DeviceMotionEvent;
    if (typeof DM.requestPermission !== 'function') {
      setShakeOn(true);
      return;
    }
    DM.requestPermission().then((r) => r === 'granted' && setShakeOn(true)).catch(() => {});
  }, [canShake]);

  const toggleShake = async () => {
    if (shakeOn) {
      setShakeOn(false);
      store.set('shake', false);
      return;
    }
    const DM = (window as unknown as { DeviceMotionEvent: { requestPermission?: () => Promise<string> } }).DeviceMotionEvent;
    try {
      if (typeof DM.requestPermission === 'function') {
        const r = await DM.requestPermission();
        if (r !== 'granted') {
          setError('Sem permissão para o sensor de movimento');
          return;
        }
      }
      setShakeOn(true);
      store.set('shake', true);
      if (sound) sfx.blip();
    } catch {
      setError('Este aparelho não deixou usar o sensor de movimento');
    }
  };

  const pickSystem = (id: string) => {
    setSysId(id);
    setResult(null);
    setError(null);
    if (sound) sfx.blip();
  };

  const exprStats = system.id === 'livre' ? stats(String(values.expr)) : null;
  const summary = describe(system, values);
  const currentKey = favKey(system, values);
  const currentFav = favs.find((f) => {
    const fs = SYSTEMS.find((x) => x.id === f.system);
    return fs && favKey(fs, f.values) === currentKey;
  });
  const toggleFav = () => {
    if (currentFav) {
      setFavs((f) => f.filter((x) => x.id !== currentFav.id));
    } else {
      const used = favs.map((x) => /^Fav(\d+)$/.exec(x.name)).filter(Boolean).map((m) => Number(m![1]));
      const name = `Fav${String(Math.max(0, ...used) + 1).padStart(2, '0')}`;
      setFavs((f) => [...f, { id: Date.now(), system: system.id, values: { ...values }, name }]);
    }
    if (sound) sfx.blip();
    try { navigator.vibrate?.(15); } catch { /* sem vibração */ }
  };
  const favManager = (
    <>
      <h2 style={{ color: 'var(--pink)' }}>♥ Favoritas</h2>
      <p className="blurb">Suas rolagens salvas. Toque numa para rolar na hora; ✎ muda o nome.</p>
      {favs.length === 0 ? (
        <p className="small muted">Nenhuma ainda. Escolha um sistema, ajuste a rolagem e toque no ♡ no canto da tela.</p>
      ) : (
        <ol className="favlist">
          {favs.map((f) => {
            const s = SYSTEMS.find((x) => x.id === f.system);
            return (
              <li key={f.id} className={`fav-row${selFav === f.id ? ' sel' : ''}`}>
                {renaming === f.id ? (
                  <input
                    className="fav-name"
                    autoFocus
                    defaultValue={f.name}
                    maxLength={40}
                    aria-label="Nome da favorita"
                    onFocus={(e) => e.target.select()}
                    onBlur={(e) => {
                      const name = e.target.value.trim() || f.name;
                      setFavs((all) => all.map((x) => (x.id === f.id ? { ...x, name } : x)));
                      setRenaming(null);
                    }}
                    onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                  />
                ) : (
                  <button type="button" className="log-item fav-item" title="Rolar" onClick={() => rollFav(f)}>
                    <span className="log-sys" style={{ color: s?.color }}>{s?.short ?? f.system}</span>
                    <span className="fav-text">
                      <span className="log-sum">{f.name}</span>
                      <span className="fav-sub">{s ? describe(s, f.values) : ''}</span>
                    </span>
                  </button>
                )}
                <button type="button" className="px-btn small ghost" aria-label="Renomear" title="Renomear" onClick={() => setRenaming(f.id)}>✎</button>
                <button type="button" className="px-btn small ghost" aria-label="Remover favorita" title="Remover" onClick={() => setFavs((all) => all.filter((x) => x.id !== f.id))}>✕</button>
              </li>
            );
          })}
        </ol>
      )}
    </>
  );

  return (
    <div className="app">
      <header className="top">
        <div className="logo">
          <span className="logo-die" aria-hidden>▣</span>
          <h1>ROLADOR<span className="cursor">_</span></h1>
        </div>
        <p className="tag">dados para qualquer mesa</p>
        {canShake && (
          <button type="button" className={`px-btn small${shakeOn ? ' on' : ' ghost'}`} onClick={toggleShake} aria-pressed={shakeOn}>
            ≋ CHACOALHAR
          </button>
        )}
        <button type="button" className="px-btn small ghost" onClick={() => setSound((s) => !s)} aria-pressed={sound}>
          {sound ? '♪ SOM' : '♪ MUDO'}
        </button>
      </header>

      <nav className="carts" aria-label="Sistemas">
        {SYSTEMS.map((s) => (
          <button
            key={s.id}
            type="button"
            className={`cart${!isFav && s.id === system.id ? ' active' : ''}`}
            style={{ ['--c' as string]: s.color }}
            onClick={() => pickSystem(s.id)}
            title={s.name}
          >
            <span className="cart-label">{s.short}</span>
          </button>
        ))}
        <button
          type="button"
          className={`cart cart-fav${isFav ? ' active' : ''}`}
          style={{ ['--c' as string]: '#ff77a8' }}
          onClick={() => pickSystem('fav')}
          title="Favoritas"
        >
          <span className="cart-label">♥ FAV</span>
        </button>
      </nav>

      <main className="grid">
        <section className={`panel config sheet${drawer === 'config' ? ' open' : ''}`} aria-label="Configurar rolagem">
          <button type="button" className="px-btn small sheet-close" onClick={() => setDrawer(null)}>FECHAR ▼</button>
          {isFav ? favManager : (
            <>
          <h2 style={{ color: system.color }}>{system.name}</h2>
          <p className="blurb">{system.blurb}</p>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              setDrawer(null);
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
            </>
          )}
        </section>

        <section
          className={`panel screen tone-${result && !rolling ? result.tone : 'idle'}`}
          aria-live="polite"
          aria-label="Resultado. Toque para editar a rolagem; segure por 1 segundo ou chacoalhe para rolar"
          onPointerDown={onScreenDown}
          onPointerMove={onScreenMove}
          onPointerUp={onScreenUp}
          onPointerCancel={cancelHold}
          onPointerLeave={cancelHold}
          onContextMenu={(e) => e.preventDefault()}
        >
          {error && <p className="error">⚠ {error}</p>}
          {!result && !error && (
            <div className="idle">
              <p className="blink">INSIRA DADOS</p>
              <p className="small">escolha o sistema e role</p>
            </div>
          )}
          {!isFav && <button
            type="button"
            className={`heart${currentFav ? ' on' : ''}`}
            aria-pressed={!!currentFav}
            aria-label={currentFav ? 'Remover das favoritas' : 'Salvar nas favoritas'}
            title={currentFav ? 'Remover das favoritas' : 'Salvar esta rolagem nas favoritas'}
            onPointerDown={(e) => e.stopPropagation()}
            onPointerUp={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              toggleFav();
            }}
          >
            {currentFav ? '♥' : '♡'}
          </button>}
          <div className={`hold-bar${holding ? ' on' : ''}`} aria-hidden />
          <p className="screen-hint">
            segure 1s{shakeOn ? ' ou chacoalhe' : ''} = rolar · toque = editar
          </p>
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

        <section className={`panel log sheet${drawer === 'log' ? ' open' : ''}`} aria-label="Histórico">
          <button type="button" className="px-btn small sheet-close" onClick={() => setDrawer(null)}>FECHAR ▼</button>
          <h2 className="list-title">☰ Histórico</h2>
          {(
            <>
              {history.length > 0 && (
                <div className="log-head">
                  <span className="small muted">toque para rolar de novo</span>
                  <button type="button" className="px-btn small ghost" onClick={() => setHistory([])}>APAGAR</button>
                </div>
              )}
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
                            setDrawer(null);
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
            </>
          )}
        </section>
      </main>

      {drawer && <div className="backdrop" onClick={() => setDrawer(null)} />}

      <div className="mbar">
        {isFav ? (
          <div className="favchips" role="listbox" aria-label="Favoritas">
            {favs.length === 0 && <span className="small muted">Sem favoritas. Toque no ♡ de uma rolagem.</span>}
            {favs.map((f) => (
              <button key={f.id} type="button" role="option" aria-selected={selFav === f.id} className={`chip favchip${selFav === f.id ? ' on' : ''}`} onClick={() => rollFav(f)}>
                {f.name}
              </button>
            ))}
          </div>
        ) : system.id === 'livre' ? (
          <input
            className="expr mexpr"
            type="text"
            spellCheck={false}
            autoCapitalize="off"
            autoComplete="off"
            aria-label="Rolagem"
            value={String(values.expr)}
            placeholder="2d6+3"
            onChange={(e) => setValue('expr', e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && rollCurrent()}
          />
        ) : (
          <button type="button" className="msum" onClick={() => setDrawer('config')} aria-label="Editar rolagem">
            <span className="msum-name" style={{ color: system.color }}>{system.short}</span>
            <span className="msum-txt">{summary}</span>
            <span className="msum-edit">editar ▲</span>
          </button>
        )}
        <div className="mbtns">
          <button type="button" className="px-btn small" onClick={() => (isFav ? setDrawer('config') : pickSystem('fav'))}>{isFav ? '✎ GERIR' : `♥ FAV${favs.length ? ` ${Math.min(favs.length, 99)}` : ''}`}</button>
          <button type="button" className="px-btn roll" disabled={rolling} onClick={() => rollCurrent()}>
            {rolling ? '...' : '▶ ROLAR'}
          </button>
          <button type="button" className="px-btn small" onClick={() => setDrawer('log')}>☰ HIST.</button>
        </div>
      </div>

      <footer className="foot">
        <span>aleatoriedade via crypto.getRandomValues · nada sai do seu navegador</span>
      </footer>
    </div>
  );
}
