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
  meet(a: Interval, b: Interval): Interval {
    const lo = Math.max(a.lo, b.lo);
    const hi = Math.min(a.hi, b.hi);
    return { lo, hi };
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

function meetEnv(a: Env, b: Env): Env {
  const out = new Map<string, Interval>();
  const keys = new Set<string>([...a.keys(), ...b.keys()]);
  for (const k of keys) {
    const av = a.get(k);
    const bv = b.get(k);
    if (av && bv) {
      out.set(k, Interval.meet(av, bv));
    } else if (av && !bv) {
      // meet with Top = av
      out.set(k, av);
    } else if (!av && bv) {
      out.set(k, bv);
    }
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

// 임계값-기반 스냅: 주어진 값 이상인 첫 번째 임계값으로 상한을 끌어올림
function thresholdBumpUp(x: number, thresholds: number[]): number {
  for (const t of thresholds) {
    if (x <= t) return t;
  }
  return POS_INF;
}
// 임계값-기반 스냅: 주어진 값 이하인 마지막 임계값으로 하한을 끌어내림
function thresholdBumpDown(x: number, thresholds: number[]): number {
  for (let i = thresholds.length - 1; i >= 0; i--) {
    const t = thresholds[i];
    if (x >= t) return t;
  }
  return NEG_INF;
}
// 임계값-기반 widening: 증가/감소가 관측될 때 다음 임계값으로만 점프
function thresholdWiden(
  a: Interval,
  b: Interval,
  thresholds: number[]
): Interval {
  // bottom 보존: widen 시 한 쪽이 bottom이면 다른 쪽을 그대로 사용
  if (Interval.isBottom(a)) return b;
  if (Interval.isBottom(b)) return b; // 새로운 정보가 bottom이면 그대로 반영
  const lo = b.lo < a.lo ? thresholdBumpDown(b.lo, thresholds) : b.lo;
  const hi = b.hi > a.hi ? thresholdBumpUp(b.hi, thresholds) : b.hi;
  return { lo, hi };
}
// 환경 단위 임계값-기반 widening
function thresholdWidenEnv(
  oldEnv: Env,
  newEnv: Env,
  thresholds: number[]
): Env {
  const out = new Map<string, Interval>();
  const keys = new Set<string>([...oldEnv.keys(), ...newEnv.keys()]);
  for (const k of keys) {
    const a = oldEnv.get(k);
    const b = newEnv.get(k);
    if (a && b) out.set(k, thresholdWiden(a, b, thresholds));
    else if (!a && b) out.set(k, b);
    else if (a && !b) out.set(k, a);
  }
  return out;
}
// 임계값 정규화(스냅): 모든 경계를 {-inf, ..., +inf} 임계값 격자에 맞춤
function normalizeInterval(i: Interval, thresholds: number[]): Interval {
  // bottom은 보존
  if (Interval.isBottom(i)) return i;
  // 유한 경계는 스냅하지 않고 그대로 유지해 정밀도 보존
  if (Number.isFinite(i.lo) && Number.isFinite(i.hi)) return i;
  return {
    lo: thresholdBumpDown(i.lo, thresholds),
    hi: thresholdBumpUp(i.hi, thresholds),
  };
}
function normalizeEnv(env: Env, thresholds: number[]): Env {
  // 환경 전체에 대해 정규화를 적용
  const out = new Map<string, Interval>();
  for (const [k, v] of env.entries())
    out.set(k, normalizeInterval(v, thresholds));
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
        case ">":
        case "==":
          // 비교식의 값은 불리언이지만 수치 구간으로 표현 불가 -> Top 반환
          return Interval.top();
        default:
          return Interval.top();
      }
    }
    case "FunctionCall":
      return Interval.top();
    case "InputExpression":
      return Interval.top();
    default:
      return Interval.top();
  }
}

function refineEnvByCondition(
  cond: Expression | undefined,
  env: Env,
  funcName: string,
  truthy: boolean
): Env {
  if (!cond || cond.type !== "BinaryExpression") return env;
  const be = cond as any;
  const out = cloneEnv(env);

  const isVar = (e: Expression): e is Variable => e.type === "Variable";
  const isNum = (e: Expression): e is NumberLiteral =>
    e.type === "NumberLiteral";

  if (be.operator === ">") {
    // 형태 1) x > c
    if (isVar(be.left) && isNum(be.right)) {
      const vName = ns(funcName, be.left.name);
      const cur = out.get(vName) ?? Interval.top();
      if (truthy) {
        out.set(vName, {
          lo: Math.max(cur.lo, be.right.value + 1),
          hi: cur.hi,
        });
      } else {
        out.set(vName, { lo: cur.lo, hi: Math.min(cur.hi, be.right.value) });
      }
      return out;
    }
    // 형태 2) c > x  ⇔  x < c
    if (isNum(be.left) && isVar(be.right)) {
      const vName = ns(funcName, be.right.name);
      const cur = out.get(vName) ?? Interval.top();
      if (truthy) {
        // x <= c-1
        out.set(vName, { lo: cur.lo, hi: Math.min(cur.hi, be.left.value - 1) });
      } else {
        // x >= c
        out.set(vName, { lo: Math.max(cur.lo, be.left.value), hi: cur.hi });
      }
      return out;
    }
    return out;
  }

  if (be.operator === "==") {
    // 형태 1) x == c
    if (isVar(be.left) && isNum(be.right)) {
      const vName = ns(funcName, be.left.name);
      const cur = out.get(vName) ?? Interval.top();
      if (truthy) {
        const meet = Interval.meet(cur, Interval.ofConst(be.right.value));
        out.set(vName, meet);
      } else {
        // 단일 점을 제외하는 것은 구간 도메인에서 표현 불가 → 보수적으로 유지
        // 단, 현재가 정확히 [c,c]이면 모순이므로 bottom으로 정제
        if (cur.lo === be.right.value && cur.hi === be.right.value) {
          out.set(vName, Interval.bottom());
        }
      }
      return out;
    }
    // 형태 2) c == x
    if (isNum(be.left) && isVar(be.right)) {
      const vName = ns(funcName, be.right.name);
      const cur = out.get(vName) ?? Interval.top();
      if (truthy) {
        const meet = Interval.meet(cur, Interval.ofConst(be.left.value));
        out.set(vName, meet);
      } else {
        if (cur.lo === be.left.value && cur.hi === be.left.value) {
          out.set(vName, Interval.bottom());
        }
      }
      return out;
    }
    return out;
  }

  return out;
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

  // Threshold extraction
  const thresholds = (() => {
    const nums = new Set<number>();
    function visitExpr(e: Expression) {
      switch (e.type) {
        case "NumberLiteral":
          nums.add((e as NumberLiteral).value);
          break;
        case "BinaryExpression":
          visitExpr(e.left);
          visitExpr(e.right);
          break;
        case "FunctionCall":
          visitExpr(e.callee);
          {
            const args: any[] = Array.isArray((e as any).arguments)
              ? ((e as any).arguments as any[]).flat()
              : (e as any).arguments;
            for (const a of args) visitExpr(a);
          }
          break;
        default:
          break;
      }
    }
    function visitStmt(s: Statement) {
      switch (s.type) {
        case "AssignmentStatement":
          visitExpr((s as any).expression);
          break;
        case "OutputStatement":
          visitExpr((s as any).expression);
          break;
        case "AssertStatement":
          // assert의 조건식에 등장하는 상수들도 임계값으로 포함
          visitExpr((s as any).condition);
          break;
        case "IfStatement":
          visitExpr((s as any).condition);
          visitStmt((s as any).thenStatement);
          if ((s as any).elseStatement) visitStmt((s as any).elseStatement);
          break;
        case "WhileStatement":
          visitExpr((s as any).condition);
          visitStmt((s as any).body);
          break;
        case "SequenceStatement":
          for (const st of (s as any).statements) visitStmt(st);
          break;
        case "ReturnStatement":
          visitExpr((s as any).expression);
          break;
        default:
          break;
      }
    }
    for (const f of program.functions) {
      if (f.body) visitStmt(f.body);
      if (f.returnExpression) visitExpr(f.returnExpression);
    }
    const arr = Array.from(nums.values()).sort((a, b) => a - b);
    return [NEG_INF, ...arr, POS_INF];
  })();

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

  // 진입 노드들 초기화
  for (const node of icfg.nodes.values()) {
    if (node.type === "entry" && node.funcName) {
      const env: Env = new Map();
      const f = funcMap.get(node.funcName);
      if (f) {
        // parameters: string[][] → flatten
        const params = f.parameters.reduce(
          (acc, arr) => acc.concat(arr),
          [] as string[]
        );
        // 호출자가 있는 entry의 경우 파라미터는 초기화하지 않음 (call edge에서 바인딩)
        // 프레드가 없는 경우(프로그램 시작점 등)만 Top으로 설정
        const hasPred = (preds.get(node.id) || []).length > 0;
        if (!hasPred) {
          for (const p of params) env.set(ns(f.name, p), Interval.top());
        }
        if (f.localVariables) {
          // 호출자가 없는 경우에만 로컬 변수를 Top으로 초기화
          if (!hasPred) {
            for (const vs of f.localVariables) {
              for (const v of vs) {
                env.set(ns(f.name, v), Interval.top());
              }
            }
          }
        }
        env.set(ns(f.name, "@ret"), Interval.bottom());
      }
      inMap.set(node.id, env);
    }
  }

  const worklist: number[] = Array.from(icfg.nodes.keys());
  const trace: any[] = [];

  function transfer(nodeId: number, inEnv: Env): Env {
    const node = icfg.nodes.get(nodeId)!;
    const func = node.funcName || "";
    const env = cloneEnv(inEnv);

    if (node.type === "after-call" && node.statement) {
      const stmt = node.statement as any;
      if (stmt.type === "AssignmentStatement") {
        let retVal: Interval | undefined;
        for (const [k, v] of env.entries()) {
          if (k.endsWith(":@ret"))
            retVal = retVal ? Interval.join(retVal, v) : v;
        }
        env.set(ns(func, stmt.variable), retVal ?? Interval.top());
      }
    } else if (node.statement) {
      const stmt = node.statement as Statement;
      switch (stmt.type) {
        case "AssignmentStatement": {
          const isCall = (stmt as any).expression?.type === "FunctionCall";
          if (!isCall) {
            const val = evalExpr((stmt as any).expression, env, func);
            env.set(ns(func, (stmt as any).variable), val);
          }
          break;
        }
        case "AssertStatement": {
          const refined = refineEnvByCondition(
            (stmt as any).condition,
            env,
            func,
            true
          );
          return refined;
        }
        case "ReturnStatement": {
          const val = evalExpr((stmt as any).expression, env, func);
          env.set(ns(func, "@ret"), val);
          break;
        }
        default:
          break;
      }
    }

    return env;
  }

  function edgeTransfer(from: number, to: number, outEnv: Env): Env {
    const edgeList = succs.get(from) || [];
    const label = edgeList.find((e) => e.to === to)?.label;
    const fromNode = icfg.nodes.get(from)!;
    if (label === "true" || label === "false") {
      const condExpr = fromNode.expression; // condition node carries expression
      const funcName = fromNode.funcName || "";
      const truthy = label === "true";
      return refineEnvByCondition(condExpr as any, outEnv, funcName, truthy);
    }
    // 라벨이 없더라도, assert 노드에서 나가는 엣지는 조건이 항상 참이므로 필터를 적용
    if (
      !label &&
      fromNode.statement &&
      (fromNode.statement as any).type === "AssertStatement"
    ) {
      const funcName = fromNode.funcName || "";
      const condExpr = fromNode.expression;
      return refineEnvByCondition(condExpr as any, outEnv, funcName, true);
    }
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

      let c: Expression = callExpr.callee;
      while ((c as any).type === "FunctionCall") c = (c as any).callee;
      if (c.type !== "Variable") return outEnv;
      const calleeName = (c as Variable).name;
      const fd = funcMap.get(calleeName);
      if (!fd) return outEnv;

      // 호출자 환경을 들고 가지 않고, 피호출자 전용 환경을 새로 시작
      const env: Env = new Map();
      const params = fd.parameters.reduce(
        (acc, arr) => acc.concat(arr),
        [] as string[]
      );
      const args = Array.isArray((callExpr as any).arguments)
        ? ((callExpr as any).arguments as any[]).flat()
        : (callExpr as any).arguments;
      for (let i = 0; i < params.length; i++) {
        const p = params[i];
        const argExpr = args[i];
        const val = argExpr ? evalExpr(argExpr, outEnv, func) : Interval.top();
        env.set(ns(calleeName, p), val);
      }
      if (fd.localVariables) {
        for (const v of fd.localVariables) {
          for (const vv of v) {
            env.set(ns(calleeName, vv), Interval.top());
          }
        }
      }
      env.set(ns(calleeName, "@ret"), Interval.bottom());
      return env;
    }
    if (label === "return") {
      // 반환 시에는 피호출자의 반환값(@ret)만 전달
      const env = new Map<string, Interval>();
      for (const [k, v] of outEnv.entries()) {
        if (k.endsWith(":@ret")) env.set(k, v);
      }
      return env;
    }
    return outEnv;
  }

  while (worklist.length) {
    const n = worklist.shift()!;
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

    const rawOut0 = transfer(n, inEnv);
    const rawOut = normalizeEnv(rawOut0, thresholds);
    const oldOut = outMap.get(n);
    const newOut0 = oldOut
      ? thresholdWidenEnv(oldOut, rawOut, thresholds)
      : rawOut;
    const newOut = normalizeEnv(newOut0, thresholds);
    if (!oldOut || !envEqual(oldOut, newOut)) {
      // trace entry (간소화: 방문/원시 out 기록 제거)
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
        func: nodeMeta.funcName || null,
        type: nodeMeta.type,
        label: nodeMeta.label,
        in: ser(inEnv),
        out: ser(newOut),
      });
      outMap.set(n, newOut);
      for (const s of succs.get(n) || []) worklist.push(s.to);
    }
  }

  // Narrowing phase: when widening reached a fixed point, re-run without widening
  // until a (potentially) more precise fixed point is reached.
  let changed = true;
  while (changed) {
    changed = false;
    const queue: number[] = Array.from(icfg.nodes.keys());
    while (queue.length) {
      const n = queue.shift()!;

      // Recompute IN with current OUTs (may-join only, no widening)
      let inEnv: Env | undefined = undefined;
      const ps = preds.get(n) || [];
      let accum: Env | undefined = undefined;
      for (const { from } of ps) {
        const outEnv = outMap.get(from) || new Map<string, Interval>();
        const afterEdge = edgeTransfer(from, n, outEnv);
        accum = accum ? joinEnv(accum, afterEdge) : cloneEnv(afterEdge);
      }
      inEnv = accum ?? new Map();
      inMap.set(n, inEnv);

      // Standard transfer (no widen, no threshold snap)
      const nextOut = transfer(n, inEnv);
      const curOut = outMap.get(n);
      const narrowedOut = curOut ? meetEnv(nextOut, curOut) : nextOut;
      if (!curOut || !envEqual(curOut, narrowedOut)) {
        // trace narrowing step
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
          phase: "narrowing",
          node: n,
          func: nodeMeta.funcName || null,
          type: nodeMeta.type,
          label: nodeMeta.label,
          in: ser(inEnv),
          out: ser(narrowedOut),
        });

        outMap.set(n, narrowedOut);
        changed = true;
        for (const s of succs.get(n) || []) queue.push(s.to);
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
    const toBound = (x: number) =>
      x === POS_INF ? "inf" : x === NEG_INF ? "-inf" : x;
    for (const [k, v] of env.entries()) {
      entry[k] = [toBound(v.lo), toBound(v.hi)];
    }
    const nodeMeta = graph.nodes.get(nid)! as any;
    outJson[nid] = {
      func: nodeMeta?.funcName ?? null,
      type: nodeMeta?.type ?? null,
      label: nodeMeta?.label ?? null,
      out: entry,
    };
  }
  const outPath = path.join(outputDir, "intervals.json");
  fs.writeFileSync(outPath, JSON.stringify(outJson, null, 2));
  const tracePath = path.join(outputDir, "intervals_trace.json");
  fs.writeFileSync(tracePath, JSON.stringify(trace, null, 2));
  return outPath;
}

export default analyzeIntervals;
