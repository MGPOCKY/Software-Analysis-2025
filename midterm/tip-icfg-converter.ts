import {
  Program,
  FunctionDeclaration,
  Statement,
  Expression,
  SequenceStatement,
  IfStatement,
  WhileStatement,
} from "./types";

// CFG 노드 타입
interface CFGNode {
  id: number;
  label: string;
  type:
    | "entry"
    | "exit"
    | "statement"
    | "condition"
    | "merge"
    | "call"
    | "after-call";
  statement?: Statement;
  expression?: Expression;
  funcName?: string;
}

// CFG 엣지 타입
interface CFGEdge {
  from: number;
  to: number;
  label?: string; // "true", "false" 등
  dotted?: boolean;
}

// CFG 클래스
class ControlFlowGraph {
  nodes: Map<number, CFGNode> = new Map();
  edges: CFGEdge[] = [];
  private nextId = 0;

  addNode(
    label: string,
    type: CFGNode["type"],
    statement?: Statement,
    expression?: Expression
  ): CFGNode {
    const node: CFGNode = {
      id: this.nextId++,
      label,
      type,
      statement,
      expression,
    };
    this.nodes.set(node.id, node);
    return node;
  }

  addEdge(from: number, to: number, label?: string, dotted?: boolean) {
    this.edges.push({ from, to, label, dotted: dotted ?? false });
  }

  // DOT 파일 생성 (함수별 서브그래프 그룹화)
  toDot(functionName: string): string {
    let dot = `digraph "${functionName}" {\n`;
    dot += "  node [shape=box];\n";

    // 그룹화: funcName별 서브그래프
    const groups = new Map<string, CFGNode[]>();
    const ungrouped: CFGNode[] = [];
    for (const node of this.nodes.values()) {
      if (node.funcName) {
        const arr = groups.get(node.funcName) || [];
        arr.push(node);
        groups.set(node.funcName, arr);
      } else {
        ungrouped.push(node);
      }
    }

    for (const [fname, nodes] of groups.entries()) {
      dot += `  subgraph "cluster_${this.escapeLabel(fname)}" {\n`;
      dot += `    label=\"${this.escapeLabel(fname)}\";\n`;
      for (const node of nodes) {
        const shape = node.type === "condition" ? "diamond" : "box";
        const color =
          node.type === "entry"
            ? "green"
            : node.type === "exit"
            ? "red"
            : "lightblue";
        dot += `    ${node.id} [label=\"${this.escapeLabel(
          node.label
        )}\", shape=${shape}, fillcolor=${color}, style=filled];\n`;
      }
      dot += "  }\n";
    }

    for (const node of ungrouped) {
      const shape = node.type === "condition" ? "diamond" : "box";
      const color =
        node.type === "entry"
          ? "green"
          : node.type === "exit"
          ? "red"
          : "lightblue";
      dot += `  ${node.id} [label=\"${this.escapeLabel(
        node.label
      )}\", shape=${shape}, fillcolor=${color}, style=filled];\n`;
    }

    // 엣지 정의
    for (const edge of this.edges) {
      const attrs: string[] = [];
      if (edge.label) attrs.push(`label=\"${edge.label}\"`);
      if (edge.dotted) attrs.push("style=dashed");
      const attrStr = attrs.length ? ` [${attrs.join(", ")}]` : "";
      dot += `  ${edge.from} -> ${edge.to}${attrStr};\n`;
    }

    dot += "}\n";
    return dot;
  }

  private escapeLabel(label: string): string {
    return label.replace(/"/g, '\\"').replace(/\n/g, "\\n");
  }
}

// TIP AST를 ICFG로 변환하는 클래스
class TIPICFGConverter {
  private tempCounter = 0;

  generateTempVar(): string {
    return `_t${this.tempCounter++}`;
  }

  convertProgram(program: Program): Map<string, ControlFlowGraph> {
    const cfgs = new Map<string, ControlFlowGraph>();

    for (const func of program.functions) {
      this.tempCounter = 0;
      const cfg = this.convertFunction(func);
      cfgs.set(func.name, cfg);
    }

    return cfgs;
  }

  // 단일 ICFG를 생성해 반환
  convertProgramUnified(program: Program): ControlFlowGraph {
    const global = new ControlFlowGraph();
    const funcToLocal: Map<string, ControlFlowGraph> = new Map();
    const funcEntryExit: Map<string, { entry: number; exit: number }> =
      new Map();
    const localToGlobal: Map<string, number> = new Map(); // `${funcName}:${localId}` -> globalId

    // 1) 각 함수 로컬 그래프 생성 후 글로벌에 복사
    for (const func of program.functions) {
      this.tempCounter = 0;
      const local = this.convertFunction(func);
      funcToLocal.set(func.name, local);

      let entryId: number | undefined;
      let exitId: number | undefined;

      for (const node of local.nodes.values()) {
        const newNode = global.addNode(
          `${node.label}`,
          node.type,
          node.statement as any,
          node.expression as any
        );
        newNode.funcName = func.name;
        localToGlobal.set(`${func.name}:${node.id}`, newNode.id);
        if (node.type === "entry") entryId = newNode.id;
        if (node.type === "exit") exitId = newNode.id;
      }

      if (entryId === undefined || exitId === undefined) {
        throw new Error(
          `Function ${func.name} missing entry/exit in ICFG conversion`
        );
      }

      funcEntryExit.set(func.name, { entry: entryId, exit: exitId });

      for (const edge of local.edges) {
        const gFrom = localToGlobal.get(`${func.name}:${edge.from}`)!;
        const gTo = localToGlobal.get(`${func.name}:${edge.to}`)!;
        global.addEdge(gFrom, gTo, edge.label, edge.dotted);
      }
    }

    // 2) interprocedural 엣지 추가 (call-to-return 확장)
    const getCalleeNameFromCall = (callExpr: any): string | undefined => {
      let c = callExpr && callExpr.callee;
      while (c && c.type === "FunctionCall") c = c.callee;
      if (c && c.type === "Variable") return c.name;
      return undefined;
    };

    for (const [callerName, local] of funcToLocal) {
      for (const edge of local.edges) {
        if (edge.label === "call-to-return") {
          const callNode = local.nodes.get(edge.from);
          const afterLocalId = edge.to;
          let calleeName: string | undefined;
          if (callNode && callNode.statement) {
            const stmt: any = callNode.statement;
            if (
              stmt.type === "AssignmentStatement" &&
              stmt.expression &&
              stmt.expression.type === "FunctionCall"
            ) {
              calleeName = getCalleeNameFromCall(stmt.expression);
            } else if (
              stmt.type === "CallStatement" &&
              stmt.expression &&
              stmt.expression.type === "FunctionCall"
            ) {
              calleeName = getCalleeNameFromCall(stmt.expression);
            }
          }
          if (!calleeName) continue;
          const entryExit = funcEntryExit.get(calleeName);
          if (!entryExit) continue;

          const gFrom = localToGlobal.get(`${callerName}:${edge.from}`)!;
          const gAfter = localToGlobal.get(`${callerName}:${afterLocalId}`)!;
          const calleeEntry = entryExit.entry;
          const calleeExit = entryExit.exit;

          global.addEdge(gFrom, calleeEntry, "call");
          global.addEdge(calleeExit, gAfter, "return");
        }
      }
    }

    return global;
  }

  convertFunction(func: FunctionDeclaration): ControlFlowGraph {
    const cfg = new ControlFlowGraph();

    // Entry 노드
    const entryNode = cfg.addNode(`Entry: ${func.name}`, "entry");

    // 함수 본문 변환
    const { entryId, exitIds } = this.convertStatement(cfg, func.body);

    // Entry에서 함수 본문으로 연결
    cfg.addEdge(entryNode.id, entryId);

    // Return 문 처리 (실제 ReturnStatement를 statement로 부착)
    const returnNode = cfg.addNode(
      `@ret = ${this.expressionToString(func.returnExpression)}`,
      "statement",
      {
        type: "ReturnStatement",
        expression: func.returnExpression,
      } as any
    );

    // 모든 exit에서 return으로 연결
    for (const exitId of exitIds) {
      cfg.addEdge(exitId, returnNode.id);
    }

    // Exit 노드
    const exitNode = cfg.addNode(`Exit: ${func.name}`, "exit");
    cfg.addEdge(returnNode.id, exitNode.id);

    return cfg;
  }

  convertStatement(
    cfg: ControlFlowGraph,
    stmt: Statement
  ): { entryId: number; exitIds: number[] } {
    switch (stmt.type) {
      case "AssignmentStatement":
        if (stmt.expression.type === "FunctionCall") {
          const callNode = cfg.addNode(
            `${stmt.variable} = ${this.expressionToString(stmt.expression)}`,
            "call",
            stmt
          );
          const afterCallNode = cfg.addNode(
            `${stmt.variable} = ${this.expressionToString(stmt.expression)}`,
            "after-call",
            stmt
          );
          cfg.addEdge(callNode.id, afterCallNode.id, "call-to-return", true);
          return { entryId: callNode.id, exitIds: [afterCallNode.id] };
        } else {
          const assignNode = cfg.addNode(
            `${stmt.variable} = ${this.expressionToString(stmt.expression)}`,
            "statement",
            stmt
          );
          return { entryId: assignNode.id, exitIds: [assignNode.id] };
        }

      case "OutputStatement":
        const outputNode = cfg.addNode(
          `output ${this.expressionToString(stmt.expression)}`,
          "statement",
          stmt
        );
        return { entryId: outputNode.id, exitIds: [outputNode.id] };

      case "SequenceStatement":
        return this.convertSequence(cfg, stmt);

      case "IfStatement":
        return this.convertIf(cfg, stmt);

      case "WhileStatement":
        return this.convertWhile(cfg, stmt);

      case "ReturnStatement":
        const returnNode = cfg.addNode(
          `@ret = ${this.expressionToString(stmt.expression)}`,
          "statement",
          stmt
        );
        return { entryId: returnNode.id, exitIds: [returnNode.id] };

      case "CallStatement":
        const variable = this.generateTempVar();
        const callNode = cfg.addNode(
          `${variable} = ${this.expressionToString(stmt.expression)}`,
          "call",
          stmt
        );
        const afterCallNode = cfg.addNode(
          `${variable} = ${this.expressionToString(stmt.expression)}`,
          "after-call",
          stmt
        );
        cfg.addEdge(callNode.id, afterCallNode.id, "call-to-return", true);
        return { entryId: callNode.id, exitIds: [afterCallNode.id] };

      case "AssertStatement":
        // assert는 단일 statement 노드로 표현 (제약은 해석기에서 적용)
        const assertNode = cfg.addNode(
          `assert(${this.expressionToString(stmt.condition)})`,
          "statement",
          stmt,
          stmt.condition
        );
        return { entryId: assertNode.id, exitIds: [assertNode.id] };

      default:
        const unknownNode = cfg.addNode(
          `Unknown: ${(stmt as any).type}`,
          "statement",
          stmt
        );
        return { entryId: unknownNode.id, exitIds: [unknownNode.id] };
    }
  }

  convertSequence(
    cfg: ControlFlowGraph,
    stmt: SequenceStatement
  ): { entryId: number; exitIds: number[] } {
    if (stmt.statements.length === 0) {
      const emptyNode = cfg.addNode("(empty)", "statement");
      return { entryId: emptyNode.id, exitIds: [emptyNode.id] };
    }

    let currentExitIds: number[] = [];
    let entryId: number | undefined;

    for (let i = 0; i < stmt.statements.length; i++) {
      const { entryId: stmtEntry, exitIds: stmtExits } = this.convertStatement(
        cfg,
        stmt.statements[i]
      );

      if (i === 0) {
        entryId = stmtEntry;
      } else {
        // 이전 구문의 모든 exit에서 현재 구문의 entry로 연결
        for (const exitId of currentExitIds) {
          cfg.addEdge(exitId, stmtEntry);
        }
      }

      currentExitIds = stmtExits;
    }

    return { entryId: entryId!, exitIds: currentExitIds };
  }

  convertIf(
    cfg: ControlFlowGraph,
    stmt: IfStatement
  ): { entryId: number; exitIds: number[] } {
    // 조건 노드
    const conditionNode = cfg.addNode(
      this.expressionToString(stmt.condition),
      "condition",
      undefined,
      stmt.condition
    );

    // Then 분기
    const { entryId: thenEntry, exitIds: thenExits } = this.convertStatement(
      cfg,
      stmt.thenStatement
    );
    cfg.addEdge(conditionNode.id, thenEntry, "true");

    let allExitIds = [...thenExits];

    // Else 분기 (선택적)
    if (stmt.elseStatement) {
      // elseStatement가 배열인 경우 처리
      let elseStmt: Statement | undefined = stmt.elseStatement;
      if (Array.isArray(elseStmt)) {
        if (elseStmt.length === 1) {
          elseStmt = elseStmt[0];
        } else if (elseStmt.length > 1) {
          elseStmt = {
            type: "SequenceStatement",
            statements: elseStmt,
          } as any;
        } else {
          elseStmt = undefined;
        }
      }

      if (elseStmt) {
        const { entryId: elseEntry, exitIds: elseExits } =
          this.convertStatement(cfg, elseStmt);
        cfg.addEdge(conditionNode.id, elseEntry, "false");
        allExitIds.push(...elseExits);
      } else {
        // else가 비어있으면 조건이 false일 때 바로 다음으로
        const falseNode = cfg.addNode("(skip)", "statement");
        cfg.addEdge(conditionNode.id, falseNode.id, "false");
        allExitIds.push(falseNode.id);
      }
    } else {
      // else가 없으면 조건이 false일 때 바로 다음으로
      // false 라벨을 명시적으로 표시하기 위해 더미 노드 생성
      const falseNode = cfg.addNode("(skip)", "statement");
      cfg.addEdge(conditionNode.id, falseNode.id, "false");
      allExitIds.push(falseNode.id);
    }

    return { entryId: conditionNode.id, exitIds: allExitIds };
  }

  convertWhile(
    cfg: ControlFlowGraph,
    stmt: WhileStatement
  ): { entryId: number; exitIds: number[] } {
    // 조건 노드
    const conditionNode = cfg.addNode(
      this.expressionToString(stmt.condition),
      "condition",
      undefined,
      stmt.condition
    );

    // 루프 본문
    const { entryId: bodyEntry, exitIds: bodyExits } = this.convertStatement(
      cfg,
      stmt.body
    );

    // 루프 종료 노드 (false 경로를 명시적으로 표시)
    const exitLoopNode = cfg.addNode("exit loop", "statement");

    // 조건 -> 본문 (true)
    cfg.addEdge(conditionNode.id, bodyEntry, "true");

    // 조건 -> 루프 종료 (false)
    cfg.addEdge(conditionNode.id, exitLoopNode.id, "false");

    // 본문의 모든 exit -> 조건 (루프백)
    for (const exitId of bodyExits) {
      cfg.addEdge(exitId, conditionNode.id);
    }

    return { entryId: conditionNode.id, exitIds: [exitLoopNode.id] };
  }

  expressionToString(expr: Expression): string {
    switch (expr.type) {
      case "NumberLiteral":
        return expr.value.toString();
      case "Variable":
        return expr.name;
      case "BinaryExpression":
        return `(${this.expressionToString(expr.left)} ${
          expr.operator
        } ${this.expressionToString(expr.right)})`;
      case "FunctionCall":
        const args = expr.arguments
          .flat()
          .map((arg) => this.expressionToString(arg))
          .join(", ");
        return `${this.expressionToString(expr.callee)}(${args})`;
      case "InputExpression":
        return "input";
      default:
        return `Unknown(${(expr as any).type})`;
    }
  }
}

export { TIPICFGConverter, ControlFlowGraph };
