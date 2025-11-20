import TIPParser from "./parser";
import { TIPICFGConverter, ControlFlowGraph } from "./tip-icfg-converter";
import {
  Program,
  FunctionDeclaration,
  Statement,
  Expression,
  FunctionCall,
  Variable,
  NumberLiteral,
} from "./types";
import * as fs from "fs";
import * as path from "path";

type Bound = number | typeof Infinity | typeof Number.NEGATIVE_INFINITY;

interface Interval {
  lo: number; // -Infinity allowed
  hi: number; // +Infinity allowed
}

const NEG_INF = Number.NEGATIVE_INFINITY;
const POS_INF = Number.POSITIVE_INFINITY;

const Interval = {
  top(): Interval {
    return { lo: NEG_INF, hi: POS_INF };
  },
  bottom(): Interval {
    return { lo: 1, hi: 0 }; // empty (lo>hi)
  },
  isBottom(i: Interval): boolean {
    return i.lo > i.hi;
  },
  ofConst(n: number): Interval {
    return { lo: n, hi: n };
  },
  join(a: Interval, b: Interval): Interval {
    if (Interval.isBottom(a)) return b;
    if (Interval.isBottom(b)) return a;
    return { lo: Math.min(a.lo, b.lo), hi: Math.max(a.hi, b.hi) };
  },
  equal(a: Interval, b: Interval): boolean {
    return a.lo === b.lo && a.hi === b.hi;
  },
  add(a: Interval, b: Interval): Interval {
    if (Interval.isBottom(a) || Interval.isBottom(b)) return Interval.bottom();
    return { lo: a.lo + b.lo, hi: a.hi + b.hi };
  },
  sub(a: Interval, b: Interval): Interval {
    if (Interval.isBottom(a) || Interval.isBottom(b)) return Interval.bottom();
    return { lo: a.lo - b.hi, hi: a.hi - b.lo };
  },
  mul(a: Interval, b: Interval): Interval {
    if (Interval.isBottom(a) || Interval.isBottom(b)) return Interval.bottom();
    const candidates = [a.lo * b.lo, a.lo * b.hi, a.hi * b.lo, a.hi * b.hi];
    return { lo: Math.min(...candidates), hi: Math.max(...candidates) };
  },
  div(a: Interval, b: Interval): Interval {
    if (Interval.isBottom(a) || Interval.isBottom(b)) return Interval.bottom();
    // conservative: if 0 in divisor, return Top
    if (b.lo <= 0 && 0 <= b.hi) return Interval.top();
    const candidates = [a.lo / b.lo, a.lo / b.hi, a.hi / b.lo, a.hi / b.hi];
    return { lo: Math.min(...candidates), hi: Math.max(...candidates) };
  },
  widen(a: Interval, b: Interval): Interval {
    // Standard interval widening: push bounds to infinities when they diverge
    if (Interval.isBottom(a)) return b;
    if (Interval.isBottom(b)) return a;
    const lo = b.lo < a.lo ? NEG_INF : b.lo;
    const hi = b.hi > a.hi ? POS_INF : b.hi;
    return { lo, hi };
  },
  narrow(a: Interval, b: Interval): Interval {
    // Standard interval narrowing: tighten bounds when possible
    if (Interval.isBottom(a)) return b;
    if (Interval.isBottom(b)) return a;
    const lo = b.lo > a.lo ? b.lo : a.lo;
    const hi = b.hi < a.hi ? b.hi : a.hi;
    return { lo, hi };
  },
};

type Env = Map<string, Interval>; // namespaced `func:var`

function ns(func: string, v: string): string {
  return `${func}:${v}`;
}

function cloneEnv(e: Env): Env {
  const m = new Map<string, Interval>();
  for (const [k, v] of e.entries()) m.set(k, { lo: v.lo, hi: v.hi });
  return m;
}

function joinEnv(a: Env, b: Env): Env {
  const out = new Map<string, Interval>(a);
  for (const [k, v] of b.entries()) {
    const prev = out.get(k);
    out.set(k, prev ? Interval.join(prev, v) : v);
  }
  return out;
}

function envEqual(a: Env, b: Env): boolean {
  if (a.size !== b.size) return false;
  for (const [k, v] of a.entries()) {
    const u = b.get(k);
    if (!u || !Interval.equal(v, u)) return false;
  }
  return true;
}

function widenEnv(oldEnv: Env, newEnv: Env): Env {
  const out = new Map<string, Interval>();
  const keys = new Set<string>([...oldEnv.keys(), ...newEnv.keys()]);
  for (const k of keys) {
    const a = oldEnv.get(k);
    const b = newEnv.get(k);
    if (a && b) out.set(k, Interval.widen(a, b));
    else if (!a && b) out.set(k, b);
    else if (a && !b) out.set(k, a);
  }
  return out;
}

function narrowEnv(oldEnv: Env, newEnv: Env): Env {
  const out = new Map<string, Interval>();
  const keys = new Set<string>([...oldEnv.keys(), ...newEnv.keys()]);
  for (const k of keys) {
    const a = oldEnv.get(k);
    const b = newEnv.get(k);
    if (a && b) out.set(k, Interval.narrow(a, b));
    else if (!a && b) out.set(k, b);
    else if (a && !b) out.set(k, a);
  }
  return out;
}

function evalExpr(expr: Expression, env: Env, funcName: string): Interval {
  switch (expr.type) {
    case "NumberLiteral":
      return Interval.ofConst((expr as NumberLiteral).value);
    case "Variable": {
      const name = (expr as Variable).name;
      return env.get(ns(funcName, name)) ?? Interval.top();
    }
    case "BinaryExpression": {
      const l = evalExpr(expr.left, env, funcName);
      const r = evalExpr(expr.right, env, funcName);
      switch (expr.operator) {
        case "+":
          return Interval.add(l, r);
        case "-":
          return Interval.sub(l, r);
        case "*":
          return Interval.mul(l, r);
        case "/":
          return Interval.div(l, r);
        default:
          return Interval.top();
      }
    }
    case "FunctionCall":
      // 값 자체는 알 수 없으니 Top. 실제 반환은 callee에서 @ret로 제공됨
      return Interval.top();
    case "InputExpression":
      return Interval.top();
    default:
      return Interval.top();
  }
}

interface AnalysisResult {
  nodeIn: Map<number, Env>;
  nodeOut: Map<number, Env>;
}

export function analyzeIntervals(program: Program): {
  graph: ControlFlowGraph;
  result: AnalysisResult;
  trace: any[];
} {
  const icfg = new TIPICFGConverter().convertProgramUnified(program);

  // 함수 이름 → 선언 매핑
  const funcMap = new Map<string, FunctionDeclaration>();
  for (const f of program.functions) funcMap.set(f.name, f);

  // 워크리스트 초기화
  const inMap = new Map<number, Env>();
  const outMap = new Map<number, Env>();

  // 인접 리스트 구성
  const preds = new Map<number, { from: number; label?: string }[]>();
  const succs = new Map<number, { to: number; label?: string }[]>();
  for (const e of icfg.edges) {
    const s = succs.get(e.from) || [];
    s.push({ to: e.to, label: e.label });
    succs.set(e.from, s);
    const p = preds.get(e.to) || [];
    p.push({ from: e.from, label: e.label });
    preds.set(e.to, p);
  }

  // 진입 노드들: 각 함수 entry의 in을 Top으로 초기화
  for (const node of icfg.nodes.values()) {
    if (node.type === "entry" && node.funcName) {
      const env: Env = new Map();
      const f = funcMap.get(node.funcName);
      if (f) {
        const params = f.parameters.reduce(
          (acc, arr) => acc.concat(arr),
          [] as string[]
        );
        for (const p of params) env.set(ns(f.name, p), Interval.top());
        if (f.localVariables) {
          for (const vs of f.localVariables) {
            for (const v of vs) {
              env.set(ns(f.name, v), Interval.top());
            }
          }
        }
        env.set(ns(f.name, "@ret"), Interval.bottom());
      }
      inMap.set(node.id, env);
    }
  }

  const worklist: number[] = Array.from(icfg.nodes.keys());
  const visitCount = new Map<number, number>();
  const trace: any[] = [];

  function transfer(nodeId: number, inEnv: Env): Env {
    const node = icfg.nodes.get(nodeId)!;
    const func = node.funcName || "";
    const env = cloneEnv(inEnv);

    // Node-level transfer (edge-level은 아래에서 처리)
    if (node.statement) {
      const stmt = node.statement as Statement;
      switch (stmt.type) {
        case "AssignmentStatement": {
          // 단순 할당만 처리 (호출은 call/after-call로 분리됨)
          const isCall = (stmt as any).expression?.type === "FunctionCall";
          if (!isCall) {
            const val = evalExpr((stmt as any).expression, env, func);
            env.set(ns(func, (stmt as any).variable), val);
          }
          break;
        }
        case "ReturnStatement": {
          // 노드가 명시적 ReturnStatement를 가진 경우: 해당 식으로 @ret 설정
          const val = evalExpr((stmt as any).expression, env, func);
          env.set(ns(func, "@ret"), val);
          break;
        }
        default:
          break;
      }
    } else if (node.type === "after-call" && node.statement) {
      const stmt = node.statement as any;
      if (stmt.type === "AssignmentStatement") {
        // callee 의 @ret 값을 caller 변수에 복사
        // callee 이름은 전 단계 edge에서 확인되므로, edge transfer에서 처리되어 이미 env에 섞여 있음
        // 여기서는 가장 최근 ret 값을 사용 (보수적으로 join되어 있음)
        // 어떤 callee인지 특정하지 않고, env의 모든 "*: @ret"을 join하여 사용
        let retVal: Interval | undefined;
        for (const [k, v] of env.entries()) {
          if (k.endsWith(":@ret"))
            retVal = retVal ? Interval.join(retVal, v) : v;
        }
        env.set(ns(func, stmt.variable), retVal ?? Interval.top());
      }
    }

    return env;
  }

  function edgeTransfer(from: number, to: number, outEnv: Env): Env {
    const edgeList = succs.get(from) || [];
    const label = edgeList.find((e) => e.to === to)?.label;
    if (!label) return outEnv;
    if (label === "call") {
      // 인자 → 파라미터 바인딩
      const callerNode = icfg.nodes.get(from)!;
      const func = callerNode.funcName || "";
      const stmt = callerNode.statement as any;
      const callExpr: FunctionCall | undefined =
        stmt?.expression?.type === "FunctionCall"
          ? (stmt.expression as FunctionCall)
          : stmt?.expression;
      if (!callExpr || callExpr.type !== "FunctionCall") return outEnv;

      // callee 이름 찾기
      let c: Expression = callExpr.callee;
      while ((c as any).type === "FunctionCall") c = (c as any).callee;
      if (c.type !== "Variable") return outEnv;
      const calleeName = (c as Variable).name;
      const fd = funcMap.get(calleeName);
      if (!fd) return outEnv;

      const env = cloneEnv(outEnv);
      // 파라미터 초기화 (string[][] → string[])
      const params = fd.parameters.reduce(
        (acc, arr) => acc.concat(arr),
        [] as string[]
      );
      for (let i = 0; i < params.length; i++) {
        const p = params[i];
        const argExpr = callExpr.arguments[i];
        const val = argExpr ? evalExpr(argExpr, outEnv, func) : Interval.top();
        env.set(ns(calleeName, p), val);
      }
      // 로컬 변수는 Top으로 유지, @ret 초기화
      if (fd.localVariables) {
        for (const v of fd.localVariables) {
          for (const vv of v) {
            env.set(
              ns(calleeName, vv),
              env.get(ns(calleeName, vv)) ?? Interval.top()
            );
          }
        }
      }
      env.set(
        ns(calleeName, "@ret"),
        env.get(ns(calleeName, "@ret")) ?? Interval.bottom()
      );
      return env;
    }
    // return 엣지는 특별 처리 불필요 (callee 내부에서 @ret 설정됨)
    return outEnv;
  }

  while (worklist.length) {
    const n = worklist.shift()!;
    const cnt = (visitCount.get(n) || 0) + 1;
    visitCount.set(n, cnt);
    // in[n] = join_{p in preds[n]} edgeTransfer(p->n, out[p])
    let inEnv: Env | undefined = inMap.get(n);
    const ps = preds.get(n) || [];
    let accum: Env | undefined = undefined;
    for (const { from, label } of ps) {
      const outEnv = outMap.get(from) || new Map<string, Interval>();
      const afterEdge = edgeTransfer(from, n, outEnv);
      accum = accum ? joinEnv(accum, afterEdge) : cloneEnv(afterEdge);
    }
    if (accum) inEnv = inEnv ? joinEnv(inEnv, accum) : accum;
    if (!inEnv) inEnv = new Map();
    inMap.set(n, inEnv);

    const rawOut = transfer(n, inEnv);
    const oldOut = outMap.get(n);
    const newOut = oldOut && cnt >= 2 ? widenEnv(oldOut, rawOut) : rawOut;
    // newOut is not equal to oldOut -> Fixed point가 아닌경우
    if (!oldOut || !envEqual(oldOut, newOut)) {
      // trace entry (갱신 시점만 기록)
      const toBound = (x: number) =>
        x === POS_INF ? "inf" : x === NEG_INF ? "-inf" : x;
      const ser = (env: Env | undefined) => {
        if (!env) return null;
        const o: any = {};
        for (const [k, v] of env.entries())
          o[k] = [toBound(v.lo), toBound(v.hi)];
        return o;
      };
      const nodeMeta = icfg.nodes.get(n)!;
      trace.push({
        node: n,
        visit: cnt,
        func: nodeMeta.funcName || null,
        type: nodeMeta.type,
        label: nodeMeta.label,
        in: ser(inEnv),
        rawOut: ser(rawOut),
        oldOut: ser(oldOut),
        newOut: ser(newOut),
        widened: !!oldOut && cnt >= 2,
      });
      outMap.set(n, newOut);
      for (const s of succs.get(n) || []) worklist.push(s.to);
    }
  }

  // Narrowing phase: limited iterations to refine widened bounds
  const narrowingIterations = 2;
  for (let iter = 1; iter <= narrowingIterations; iter++) {
    const q: number[] = Array.from(icfg.nodes.keys());
    while (q.length) {
      const n = q.shift()!;
      // recompute IN with current OUTs
      let inEnv: Env | undefined = inMap.get(n);
      const ps = preds.get(n) || [];
      let accum: Env | undefined = undefined;
      for (const { from } of ps) {
        const outEnv = outMap.get(from) || new Map<string, Interval>();
        const afterEdge = edgeTransfer(from, n, outEnv);
        accum = accum ? joinEnv(accum, afterEdge) : cloneEnv(afterEdge);
      }
      if (accum) inEnv = inEnv ? joinEnv(inEnv, accum) : accum;
      if (!inEnv) inEnv = new Map();
      inMap.set(n, inEnv);

      const rawOut = transfer(n, inEnv);
      const oldOut = outMap.get(n) || new Map<string, Interval>();
      const newOut = narrowEnv(oldOut, rawOut);
      if (!envEqual(oldOut, newOut)) {
        const toBound = (x: number) =>
          x === POS_INF ? "inf" : x === NEG_INF ? "-inf" : x;
        const ser = (env: Env | undefined) => {
          if (!env) return null;
          const o: any = {};
          for (const [k, v] of env.entries())
            o[k] = [toBound(v.lo), toBound(v.hi)];
          return o;
        };
        const nodeMeta = icfg.nodes.get(n)!;
        trace.push({
          node: n,
          visit: `narrow-${iter}`,
          func: nodeMeta.funcName || null,
          type: nodeMeta.type,
          label: nodeMeta.label,
          in: ser(inEnv),
          rawOut: ser(rawOut),
          oldOut: ser(oldOut),
          newOut: ser(newOut),
          widened: false,
          narrowed: true,
        });
        outMap.set(n, newOut);
        for (const s of succs.get(n) || []) q.push(s.to);
      }
    }
  }

  return { graph: icfg, result: { nodeIn: inMap, nodeOut: outMap }, trace };
}

export function runIntervalAnalysisFromFile(
  inputPath: string,
  outputDir = "output"
) {
  const code = fs.readFileSync(inputPath, "utf-8");
  const parser = new TIPParser();
  const parsed = parser.parse(code);
  if (!parsed.success) throw new Error(parsed.error || "Parse failed");
  const { graph, result, trace } = analyzeIntervals(parsed.ast!);

  const outJson: any = {};
  for (const [nid, env] of result.nodeOut.entries()) {
    const entry: any = {};
    for (const [k, v] of env.entries()) {
      const toBound = (x: number) =>
        x === POS_INF ? "inf" : x === NEG_INF ? "-inf" : x;
      entry[k] = [toBound(v.lo), toBound(v.hi)];
    }
    outJson[nid] = entry;
  }
  const outPath = path.join(outputDir, "intervals.json");
  fs.writeFileSync(outPath, JSON.stringify(outJson, null, 2));
  const tracePath = path.join(outputDir, "intervals_trace.json");
  fs.writeFileSync(tracePath, JSON.stringify(trace, null, 2));
  return outPath;
}

export default analyzeIntervals;
