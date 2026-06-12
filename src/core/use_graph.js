/**
 * use_graph.js — D1c use-Graph-Amplifikations-Analyse (core-rein, REGEL-4)
 * Vector Mirror v2.0
 *
 * maintainer method MD-LOOP: die SVG-`<use>`-Amplifikations-Logik (billion-laughs/
 * DoS) ist als EIGENSTÄNDIGE, gehärtete, reine Komponente isoliert — statt im
 * Renderer-Adapter weiter gepatcht zu werden. Diese Datei hat bewusst NULL
 * Imports (REGEL-4: keine adapters/ oder interface/; keine node:*-I/O) — sie
 * bekommt einen bereits GEPARSTEN DOM-Root als Argument und liefert ein reines
 * DoS-Urteil. Determinismus: keine Date, kein Math.random, kein I/O, kein LLM.
 *
 * STRATEGISCHE WURZEL (3 Triple-Runden): statische Vorhersage der Browser-
 * Render-Semantik ist fragil. Diese Komponente ist NUR best-effort-Frühabweisung
 * — die Last-Resort-Schranke bleibt der echte Render (setContent-5s-Timeout) im
 * Adapter. EHRLICHE ABDECKUNG (kein Over-Claiming): dieser STATISCHE Estimate ist
 * die PRIMÄRE Schranke (forwarder-korrekt, ≤ MAX_USE_TOTAL_EXPANSION), der
 * Timeout das Sicherheitsnetz für unbekannte Formen. Der post-render-Knoten-Cap
 * im Adapter (querySelectorAll('*') > 500) zählt QUELL-DOM-Knoten, NICHT die
 * use-Shadow-Expansion (SVG2 §5.6: Instanzen sind nicht im Light-DOM) — er ist
 * KEINE Schranke gegen die gerenderte Instanz-Zahl. Deshalb gilt hier: lieber zu
 * früh ablehnen als zu spät, NIE werfen, und JEDEN Pfad (Tiefe, Fan-out inkl.
 * Forwarder-Ketten, Zyklus, Multi-svg, Deep-Nest, Budget) als kontrolliertes
 * `{rejected:true}` enden lassen.
 *
 * Härtungs-Invarianten (jede aus einem konkreten Triple-Befund):
 *   - ITERATIV (explizite Stacks), NIE rekursiv → kein RangeError bei tiefem
 *     Nicht-use-`<g>`-Nest (3. Triple B1: depth-5000 warf ungefangen).
 *   - ALLE top-level `<svg>` zählen (nicht nur das erste) → kein Bypass durch
 *     eine Bombe im zweiten `<svg>` (3. Triple B2).
 *   - FORWARDER-HOP folgen: ein <use>, dessen Ziel selbst ein nacktes <use> ist,
 *     wird über die Forwarder-Kette zum echten Subtree-Root verfolgt (4. Triple:
 *     sonst Multiplikator verloren — CASE Y/X, ~122k/140k still durchgelassen).
 *   - HARTE Budgets (besuchte Knoten, Nest-Tiefe) → bricht jede pathologische
 *     Struktur kontrolliert ab, bevor sie teuer wird.
 *   - NEVER-THROW: jede Anomalie/Budget-Überschreitung → {rejected:true}.
 */

// ── DoS-Schranken (SSOT für die use-Amplifikation) ───────────────────────────

/**
 * Maximale same-document use-Verweis-Tiefe. KONSERVATIV: die gemessene Tiefe
 * ZÄHLT die top-level-use→Target-Kante MIT (über die synthetische __root__-Kante),
 * d.h. eine sichtbare Verschachtelung von N id-Containern ergibt Tiefe N+1.
 * Bewusst so — lieber einen zu tiefen als einen zu flachen Graphen ablehnen,
 * nie zu locker. ≤ 5 ist die ADR-L-005-Schranke.
 */
export const MAX_USE_REFERENCE_DEPTH = 5;

/**
 * Fan-out-Budget: geschätzte Gesamt-Instanz-Expansion des use-Graphen. Eine
 * depth-5-Kette (von der Tiefe erlaubt) mit hohem Fan-out (z.B. fan-40 ≈ 40^4 ≈
 * 2,5M Instanzen in ~3KB) rutscht am Tiefe-Cap vorbei → hier abgefangen. Über
 * dieser Schwelle = Ablehnung. Großzügig für legitime Sprite-Komposition, hart
 * gegen die Amplifikations-Bombe (early-bailout, kein vollständiges Aufzählen).
 */
export const MAX_USE_TOTAL_EXPANSION = 100000;

/**
 * Hartes Budget besuchter DOM-Knoten über den gesamten Lauf (alle svgs, alle
 * Walks). Bricht jede pathologisch große/tiefe Struktur kontrolliert ab, BEVOR
 * die Analyse selbst teuer wird (Schutz der Analyse, nicht nur des Renders).
 */
export const MAX_GRAPH_NODES = 200000;

/**
 * Hartes Nest-Tiefen-Budget (DOM-Verschachtelung, NICHT use-Referenz-Tiefe).
 * Ein extrem tiefer Nicht-use-`<g>`-Nest (3. Triple B1) hat use-Tiefe 0, aber
 * eine DOM-Tiefe, die eine rekursive Analyse hätte crashen lassen. Iterativ
 * crasht nichts; ab dieser Schwelle lehnen wir trotzdem ab (kein legitimes SVG
 * verschachtelt so tief — und der echte Render würde ohnehin leiden).
 */
export const MAX_DOM_NEST_DEPTH = 1000;

/**
 * canonicalizeFragment — repliziert Chromiums same-document `<use href>`-Auflösung
 * als REINE Funktion (kein IO, kein Timing, never-throw), damit Analyzer UND
 * href-Hook DASSELBE `#fragment` meinen (geteilte Kanon-SSOT).
 *
 * STRATEGISCHE WURZEL (S3/D1 R6): die Lücke war KEINE „vergessene Dekodierung",
 * sondern eine ORAKEL-DIVERGENZ. Chromium löst `<use href>` über URL-Fragment-
 * percent-decode → UTF-8 → `getElementById(decoded)` auf (SVG2 Kap.16; WHATWG-URL).
 * Der Analyzer verglich vorher den ROHEN Fragment-String (`href.slice(1)`) gegen
 * die bereits DEKODIERT gespeicherten `el.id`-Keys → jede Divergenz-Achse
 * (percent/case/whitespace) verfehlte die Kante → Unterzählung → `rejected:false`,
 * während Chromium die Bombe expandierte. Diese Funktion schließt genau diese
 * Achse: sie liefert den DEKODIERTEN Fragment-String, der gegen die (ebenfalls
 * dekodierten) `el.id`-Keys matcht.
 *
 * Regeln (gepinnt: 11/11 gegen reales Chromium, S3/D1-R6-Probe):
 *   1. nicht mit `#` beginnend ODER `length < 2` → null
 *   2. Fragment = Teil NACH dem ersten `#`
 *   3. NUR TRAILING ASCII-Whitespace strippen (führend + intern BEHALTEN);
 *      Chromium strippt trailing (`#c0 ` → HIT auf `c0`), behält leading
 *      (`# c0` → MISS) und internen Space.
 *   4. `decodeURIComponent` GENAU EINMAL in try/catch; bei Wurf (malformed `%`,
 *      z.B. `#%zz`) → den ROHEN Fragment-String zurückgeben (literal, NIE werfen).
 *   5. CASE-SENSITIV matchen (kein case-fold, keine Unicode-Normalisierung).
 *
 * ⚠️ BEKANNTE REST-DIVERGENZ (gemischt valide/invalide Prozent, z.B.
 * `#a%30%zzb`): `decodeURIComponent` ist ALL-OR-NOTHING — `%zz` lässt es werfen,
 * der Fallback liefert den GANZEN rohen String `a%30%zzb`; Chromium dekodiert
 * dagegen PER SEQUENZ → `a0%zzb` (HIT). Kanon → MISS, Chromium → HIT = Bypass-
 * Klasse. Diese Achse schließt NICHT die Kanon, sondern der fail-closed-Riegel
 * im href-Hook (jedes `%`-haltige Fragment → keepAttr=false, VOR dem Render). Die
 * Kanon liefert die Parität für die `%`-freien Überlebenden (v.a. trailing-ws).
 * KEINE der beiden allein ist sound — nur zusammen (hardening S3/D1).
 *
 * @param {string} href - der ROHE href/xlink:href-Attributwert (ungetrimmt).
 * @returns {string|null} dekodiertes Fragment (gegen `el.id` matchbar) oder null.
 */
export function canonicalizeFragment(href) {
  // Regel 1: nur same-document `#fragment`. NIE werfen bei Nicht-String.
  if (typeof href !== 'string' || href.length < 2 || href.charCodeAt(0) !== 35)
    return null;
  // Regel 2: Fragment = alles NACH dem ersten `#` (charCodeAt(0) ist `#` = 35).
  let frag = href.slice(1);
  // Regel 3: NUR trailing ASCII-Whitespace strippen (TAB/LF/FF/CR/SPACE).
  // Führender + interner Whitespace bleibt (Chromium-Parität, Probe-gepinnt).
  let end = frag.length;
  while (end > 0) {
    const c = frag.charCodeAt(end - 1);
    if (c === 0x09 || c === 0x0a || c === 0x0c || c === 0x0d || c === 0x20)
      end -= 1;
    else break;
  }
  if (end !== frag.length) frag = frag.slice(0, end);
  // Regel 4: decodeURIComponent GENAU EINMAL; bei malformed `%` → roher Frag-
  // String (literal). never-throw — auch bei pathologischen Eingaben (überlange
  // %-Sequenzen, isolierte Surrogate): decodeURIComponent wirft kontrolliert
  // URIError, der hier gefangen wird; alles andere bliebe der äußere try/catch.
  try {
    return decodeURIComponent(frag);
  } catch {
    return frag;
  }
}

/**
 * Löst das `#fragment`-Target eines `<use>` auf die id-Map auf. Nutzt die geteilte
 * Kanon-SSOT `canonicalizeFragment`, damit der Analyzer GENAU das Fragment auflöst,
 * das Chromium beim Render auflöst (Orakel-Divergenz geschlossen). Die `byId`-Keys
 * sind bereits dekodiert (`el.id`), daher matcht der dekodierte Kanon direkt.
 * @param {Element} useEl
 * @param {Map<string, Element>} byId
 * @returns {Element|null}
 */
function resolveUseTarget(useEl, byId) {
  const rawHref =
    useEl.getAttribute('href') || useEl.getAttribute('xlink:href') || '';
  const target = canonicalizeFragment(rawHref);
  if (target === null) return null;
  return byId.get(target) || null;
}

/**
 * Folgt einer Kette nackter `<use>`-Forwarder bis zum ERSTEN Nicht-use-Ziel
 * (dem echten Subtree-Root) — UNTER demselben Pfad-Set-Zyklus-Guard. Ein nackter
 * Forwarder (`<use id="f" href="#g"/>`) hat keine Element-Kinder; ohne dieses
 * Chasing würde der multiplikative Abstieg an ihm enden und die Fan-out-Bombe
 * unterzählen (4. Triple HIGH: `<use href="#fwd">` → fwd ist selbst `<use>` →
 * tgt.children=0 → Multiplikator verloren).
 *
 * Markiert jede besuchte use-Ziel-id im `onPath`-Set (für die Zyklus-Erkennung
 * über Forwarder-Ketten) und legt sie in `addedToPath` ab, damit der Aufrufer
 * sie beim Frame-Pop wieder freigibt. Knoten-Budget wird pro Hop verbraucht.
 *
 * @param {Element} startTarget - das (evtl. Forwarder-)Ziel eines <use>.
 * @param {Map<string, Element>} byId
 * @param {Set<string>} onPath - aktuell offene use-Ziel-ids (Pfad-Set).
 * @param {{nodesLeft:number}} budget
 * @returns {{terminal:(Element|null), hops:number, cyclic:boolean,
 *   budgetExceeded:boolean, addedToPath:string[]}}
 */
function chaseForwarders(startTarget, byId, onPath, budget) {
  let node = startTarget;
  let hops = 0;
  const addedToPath = [];
  let guard = 0;
  while (node && (node.tagName || '').toLowerCase() === 'use') {
    if (++guard > MAX_DOM_NEST_DEPTH) {
      return {
        terminal: null,
        hops,
        cyclic: true,
        budgetExceeded: false,
        addedToPath,
      };
    }
    if (budget.nodesLeft <= 0) {
      return {
        terminal: null,
        hops,
        cyclic: false,
        budgetExceeded: true,
        addedToPath,
      };
    }
    budget.nodesLeft -= 1;
    const fid = node.id || '';
    if (onPath.has(fid)) {
      // Zyklus über Forwarder (z.B. f→g→f) → unendliche Expansion.
      return {
        terminal: null,
        hops,
        cyclic: true,
        budgetExceeded: false,
        addedToPath,
      };
    }
    onPath.add(fid);
    addedToPath.push(fid);
    hops += 1; // der Forwarder-Knoten selbst zählt als 1 Instanz
    const nextTarget = resolveUseTarget(node, byId);
    if (!nextTarget) {
      // Forwarder ohne auflösbares #fragment-Ziel → Kette endet hier.
      return {
        terminal: null,
        hops,
        cyclic: false,
        budgetExceeded: false,
        addedToPath,
      };
    }
    node = nextTarget;
  }
  return {
    terminal: node || null,
    hops,
    cyclic: false,
    budgetExceeded: false,
    addedToPath,
  };
}

/**
 * Iterative längste use→Target-Kette über die id→id-Kanten (Tarjan-frei, expliziter
 * Stack mit Farb-Markierung für Zyklus-Erkennung). NIE rekursiv.
 *
 * @param {Map<string, Set<string>>} edges
 * @returns {{maxDepth:number}}
 */
function computeMaxDepthIterative(edges) {
  // 0 = ungesehen, 1 = auf dem Stack (grau), 2 = fertig (schwarz).
  const color = new Map();
  const depth = new Map(); // längste Kette ab Knoten (memoized)
  let maxDepth = 0;

  for (const start of edges.keys()) {
    if (color.get(start) === 2) continue;
    // Explizite DFS mit (node, childIterator)-Frames.
    const stack = [
      { node: start, it: (edges.get(start) || new Set()).values() },
    ];
    color.set(start, 1);
    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      const next = frame.it.next();
      if (next.done) {
        // Alle Kinder fertig → längste Kette berechnen.
        let best = 0;
        const outs = edges.get(frame.node);
        if (outs) {
          for (const t of outs) {
            const dt = depth.get(t) || 0;
            if (dt + 1 > best) best = dt + 1;
          }
        }
        depth.set(frame.node, best);
        color.set(frame.node, 2);
        if (best > maxDepth) maxDepth = best;
        stack.pop();
        continue;
      }
      const child = next.value;
      const c = color.get(child) || 0;
      if (c === 1) continue; // Rückkante — azyklische Länge weiterrechnen, NICHT Infinity
      if (c === 2) continue; // schwarz = bereits fertig, memoized
      color.set(child, 1);
      stack.push({
        node: child,
        it: (edges.get(child) || new Set()).values(),
      });
    }
  }
  return { maxDepth };
}

/**
 * Iterative Instanz-Expansions-Schätzung für EINEN Subtree-Root. KEINE Rekursion:
 * ein expliziter Arbeits-Stack aus (element, childIterator)-Frames plus ein
 * Pfad-Set (die aktuell „offenen" use-Ziele) für die Zyklus-Erkennung beim
 * use→Target-Abstieg. Jeder besuchte Kind-Knoten zählt 1; ein `<use>`
 * instanziiert zusätzlich sein Ziel (+1 Ziel-Wurzel + Subtree). Early-bailout bei
 * `> expansionCap`. Hartes Knoten-/Tiefen-Budget bricht pathologische Strukturen
 * kontrolliert ab.
 *
 * @param {Element} svgRoot
 * @param {Map<string, Element>} byId
 * @param {number} expansionCap
 * @param {{nodesLeft:number}} budget - geteiltes, über alle svgs laufendes Knoten-Budget.
 * @returns {{count:number, bailed:boolean, budgetExceeded:boolean,
 *   depthExceeded:boolean}}
 */
function computeExpansionIterative(svgRoot, byId, expansionCap, budget) {
  let count = 0;
  let bailed = false;
  let budgetExceeded = false;
  let depthExceeded = false;

  // Frame: { el, it (children-Iterator), pathIds (für Pfad-Set-Cleanup) }.
  // Das Pfad-Set (onPath) enthält die use-Ziel-/Forwarder-ids, deren Subtree
  // gerade EXPANDIERT wird (für die multiplikative Zyklus-Erkennung beim
  // use→Target-Abstieg — inkl. Forwarder-Ketten). Ein Frame kann MEHRERE ids
  // tragen (Forwarder-Hops + Terminal), die beim Pop gemeinsam freigegeben werden.
  const onPath = new Set();
  const stack = [
    { el: svgRoot, it: svgRoot.children[Symbol.iterator](), pathIds: null },
  ];

  while (stack.length > 0) {
    if (stack.length > MAX_DOM_NEST_DEPTH) {
      depthExceeded = true;
      break;
    }
    const frame = stack[stack.length - 1];
    const next = frame.it.next();
    if (next.done) {
      if (frame.pathIds) for (const id of frame.pathIds) onPath.delete(id);
      stack.pop();
      continue;
    }
    const child = next.value;
    if (budget.nodesLeft <= 0) {
      budgetExceeded = true;
      break;
    }
    budget.nodesLeft -= 1;
    count += 1; // der Kind-Knoten selbst = 1 Instanz
    if (count > expansionCap) {
      bailed = true;
      break;
    }
    const tag = (child.tagName || '').toLowerCase();
    if (tag === 'use') {
      const tgt = resolveUseTarget(child, byId);
      if (tgt) {
        // 4. Triple-FIX: das Ziel kann SELBST ein nackter <use>-Forwarder sein
        // (oder eine Forwarder-Kette). chaseForwarders folgt der Kette bis zum
        // ersten Nicht-use-Subtree-Root, zählt jeden Hop, guarded Zyklen über das
        // gemeinsame onPath-Set. OHNE das endete der Abstieg am kinderlosen
        // Forwarder → Fan-out-Multiplikator verloren (CASE Y/X, ~125k/140k still).
        const chase = chaseForwarders(tgt, byId, onPath, budget);
        if (chase.budgetExceeded) {
          budgetExceeded = true;
          break;
        }
        if (chase.cyclic) {
          for (const id of chase.addedToPath) onPath.delete(id);
          continue;
        }
        // Jeder Forwarder-Hop ist eine instanziierte Wurzel (mind. 1 Instanz).
        count += chase.hops;
        if (count > expansionCap) {
          // onPath-Cleanup der gerade hinzugefügten Forwarder-ids (Bombe → bail).
          for (const id of chase.addedToPath) onPath.delete(id);
          bailed = true;
          break;
        }
        const terminal = chase.terminal;
        if (terminal) {
          const tid = terminal.id || '';
          if (onPath.has(tid)) {
            for (const id of chase.addedToPath) onPath.delete(id);
            continue;
          }
          count += 1; // die instanziierte terminale Ziel-Wurzel
          if (count > expansionCap) {
            for (const id of chase.addedToPath) onPath.delete(id);
            bailed = true;
            break;
          }
          onPath.add(tid);
          // Frame trägt ALLE auf diesem Hop hinzugefügten Pfad-ids (Forwarder +
          // Terminal), damit der Pop sie gemeinsam freigibt.
          stack.push({
            el: terminal,
            it: terminal.children[Symbol.iterator](),
            pathIds: [...chase.addedToPath, tid],
          });
        } else if (chase.addedToPath.length > 0) {
          // Forwarder-Kette endete ohne Nicht-use-Terminal (z.B. Sackgasse) →
          // die Forwarder-ids wieder freigeben (kein Frame trägt sie).
          for (const id of chase.addedToPath) onPath.delete(id);
        }
      }
      // <use> selbst hat keine geometrie-tragenden Kinder, die wir zählen.
    } else {
      // Normaler Container/Leaf — in seinen Subtree absteigen.
      stack.push({
        el: child,
        it: child.children[Symbol.iterator](),
        pathIds: null,
      });
    }
  }

  return { count, bailed, budgetExceeded, depthExceeded };
}

/**
 * Sammelt die zu analysierenden Subtree-Roots: ALLE top-level `<svg>`. Der
 * sanitisierte DOM kommt als Body-Wrapper (DOMPurify RETURN_DOM) ODER als
 * einzelnes `<svg>`. Multi-svg (mehrere Geschwister-svgs) ist der 3.-Triple-B2-
 * Bypass — wir zählen JEDES. Fällt auf alle deszendenten `<svg>` zurück, falls
 * keine direkten gefunden werden (defensiv, deckt unerwartete Wrapper-Schichten).
 * @param {Element} root
 * @returns {Element[]}
 */
function collectSvgRoots(root) {
  if ((root.tagName || '').toLowerCase() === 'svg') return [root];
  const direct = [];
  for (const child of root.children) {
    if ((child.tagName || '').toLowerCase() === 'svg') direct.push(child);
  }
  if (direct.length > 0) return direct;
  // Defensiv: keine direkten svg-Kinder → alle deszendenten svgs (nie weniger
  // abdecken als der frühere querySelector — aber jetzt ALLE, nicht nur das erste).
  return [...root.querySelectorAll('svg')];
}

/**
 * analyzeUseGraph — das gehärtete reine DoS-Urteil über den use-Graphen.
 *
 * WIRFT NIE. Bei jeder Anomalie (kein gültiger Root, interner Fehler) oder
 * Schranken-/Budget-Überschreitung → `{rejected:true, reason:'SECURITY_VIOLATION'}`.
 * Der Caller (resolve) macht daraus den dokumentierten `{error:'SECURITY_VIOLATION'}`.
 *
 * @param {Element} root - sanitisierte DOM-Wurzel (Body-Wrapper o. <svg>).
 * @param {{maxDepth?:number, maxExpansion?:number, maxNodes?:number}} [opts]
 * @returns {{maxDepth:number, totalExpansion:number, cyclic:boolean,
 *   rejected:boolean, reason:(string|null)}}
 */
export function analyzeUseGraph(root, opts = {}) {
  const maxDepthCap = opts.maxDepth ?? MAX_USE_REFERENCE_DEPTH;
  const expansionCap = opts.maxExpansion ?? MAX_USE_TOTAL_EXPANSION;
  const nodeBudget = opts.maxNodes ?? MAX_GRAPH_NODES;

  const SAFE = {
    maxDepth: 0,
    totalExpansion: 0,
    cyclic: false,
    rejected: false,
    reason: null,
  };
  const REJECT = (reason) => ({
    maxDepth: Number.POSITIVE_INFINITY,
    totalExpansion: Number.POSITIVE_INFINITY,
    cyclic: false,
    rejected: true,
    reason: reason || 'SECURITY_VIOLATION',
  });

  try {
    if (!root || typeof root.querySelectorAll !== 'function') return SAFE;

    // id → Element-Map (erste id gewinnt, wie der Browser bei dup-ids).
    const byId = new Map();
    let idCount = 0;
    for (const el of root.querySelectorAll('[id]')) {
      idCount += 1;
      if (idCount > nodeBudget) return REJECT('USE_GRAPH_NODE_BUDGET');
      if (!byId.has(el.id)) byId.set(el.id, el);
    }

    // ── (1) maxDepth über die id→id-Kanten (iterativ, Zyklus-erkennend) ──────
    const edges = new Map();
    const addEdge = (from, to) => {
      if (!edges.has(from)) edges.set(from, new Set());
      edges.get(from).add(to);
    };
    let useCount = 0;
    for (const useEl of root.querySelectorAll('use')) {
      useCount += 1;
      if (useCount > nodeBudget) return REJECT('USE_GRAPH_NODE_BUDGET');
      const rawHref =
        useEl.getAttribute('href') || useEl.getAttribute('xlink:href') || '';
      // Geteilte Kanon-SSOT: dasselbe `#fragment`, das Chromium auflöst (kein
      // Roh-vs-dekodiert-Vergleich mehr → Orakel-Divergenz geschlossen).
      const target = canonicalizeFragment(rawHref);
      if (target === null) continue;
      let anc = useEl;
      let from = '__root__';
      let guard = 0;
      while (anc) {
        if (++guard > MAX_DOM_NEST_DEPTH) return REJECT('USE_GRAPH_NEST_DEPTH');
        if (anc.id) {
          from = anc.id;
          break;
        }
        anc = anc.parentElement;
      }
      addEdge(from, target);
    }
    const { maxDepth } = computeMaxDepthIterative(edges);

    // ── (2) totalExpansion über ALLE top-level svgs (iterativ, never-throw) ──
    const svgRoots = collectSvgRoots(root);
    const budget = { nodesLeft: nodeBudget };
    let totalExpansion = 0;
    let bailed = false;
    for (const svgRoot of svgRoots) {
      const res = computeExpansionIterative(
        svgRoot,
        byId,
        expansionCap,
        budget,
      );
      if (res.budgetExceeded) return REJECT('USE_GRAPH_NODE_BUDGET');
      if (res.depthExceeded) return REJECT('USE_GRAPH_NEST_DEPTH');
      totalExpansion += res.count;
      if (res.bailed || totalExpansion > expansionCap) {
        bailed = true;
        totalExpansion = Math.max(totalExpansion, expansionCap + 1);
        break;
      }
    }

    const rejected =
      maxDepth > maxDepthCap || totalExpansion > expansionCap || bailed;
    return {
      maxDepth,
      totalExpansion,
      cyclic: false,
      rejected,
      reason: rejected ? 'SECURITY_VIOLATION' : null,
    };
  } catch {
    // never-throw-Vertrag: jeder unerwartete Fehler → kontrollierte Ablehnung.
    return REJECT('USE_GRAPH_INTERNAL');
  }
}
