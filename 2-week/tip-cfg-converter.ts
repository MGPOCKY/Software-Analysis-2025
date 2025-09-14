import TIPParser from "./parser";
import {
  Program,
  FunctionDeclaration,
  Statement,
  Expression,
  SequenceStatement,
  IfStatement,
  WhileStatement,
} from "./types";
import * as fs from "fs";

// CFG 노드 타입
interface CFGNode {
  id: number;
  label: string;
  type: "entry" | "exit" | "statement" | "condition" | "merge";
  statement?: Statement;
  expression?: Expression;
}

// CFG 엣지 타입
interface CFGEdge {
  from: number;
  to: number;
  label?: string; // "true", "false" 등
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

  addEdge(from: number, to: number, label?: string) {
    this.edges.push({ from, to, label });
  }

  // DOT 파일 생성
  toDot(functionName: string): string {
    let dot = `digraph "${functionName}" {\n`;
    dot += "  node [shape=box];\n";

    // 노드 정의
    for (const node of this.nodes.values()) {
      const shape = node.type === "condition" ? "diamond" : "box";
      const color =
        node.type === "entry"
          ? "green"
          : node.type === "exit"
          ? "red"
          : "lightblue";

      dot += `  ${node.id} [label="${this.escapeLabel(
        node.label
      )}", shape=${shape}, fillcolor=${color}, style=filled];\n`;
    }

    // 엣지 정의
    for (const edge of this.edges) {
      const label = edge.label ? ` [label="${edge.label}"]` : "";
      dot += `  ${edge.from} -> ${edge.to}${label};\n`;
    }

    dot += "}\n";
    return dot;
  }

  private escapeLabel(label: string): string {
    return label.replace(/"/g, '\\"').replace(/\n/g, "\\n");
  }
}

// TIP AST를 CFG로 변환하는 클래스
class TIPCFGConverter {
  convertProgram(program: Program): Map<string, ControlFlowGraph> {
    const cfgs = new Map<string, ControlFlowGraph>();

    for (const func of program.functions) {
      const cfg = this.convertFunction(func);
      cfgs.set(func.name, cfg);
    }

    return cfgs;
  }

  convertFunction(func: FunctionDeclaration): ControlFlowGraph {
    const cfg = new ControlFlowGraph();

    // Entry 노드
    const entryNode = cfg.addNode(`Entry: ${func.name}`, "entry");

    // 함수 본문 변환
    const { entryId, exitIds } = this.convertStatement(cfg, func.body);

    // Entry에서 함수 본문으로 연결
    cfg.addEdge(entryNode.id, entryId);

    // Return 문 처리
    const returnNode = cfg.addNode(
      `return ${this.expressionToString(func.returnExpression)}`,
      "statement"
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
        const assignNode = cfg.addNode(
          `${stmt.variable} = ${this.expressionToString(stmt.expression)}`,
          "statement",
          stmt
        );
        return { entryId: assignNode.id, exitIds: [assignNode.id] };

      case "OutputStatement":
        const outputNode = cfg.addNode(
          `output ${this.expressionToString(stmt.expression)}`,
          "statement",
          stmt
        );
        return { entryId: outputNode.id, exitIds: [outputNode.id] };

      case "DirectPropertyAssignmentStatement":
        const propAssignNode = cfg.addNode(
          `${stmt.object}.${stmt.property} = ${this.expressionToString(
            stmt.value
          )}`,
          "statement",
          stmt
        );
        return { entryId: propAssignNode.id, exitIds: [propAssignNode.id] };

      case "PointerAssignmentStatement":
        const ptrAssignNode = cfg.addNode(
          `*${this.expressionToString(
            stmt.pointer
          )} = ${this.expressionToString(stmt.value)}`,
          "statement",
          stmt
        );
        return { entryId: ptrAssignNode.id, exitIds: [ptrAssignNode.id] };

      case "PropertyAssignmentStatement":
        const objPropAssignNode = cfg.addNode(
          `(*${this.expressionToString(stmt.object)}).${
            stmt.property
          } = ${this.expressionToString(stmt.value)}`,
          "statement",
          stmt
        );
        return {
          entryId: objPropAssignNode.id,
          exitIds: [objPropAssignNode.id],
        };

      case "SequenceStatement":
        return this.convertSequence(cfg, stmt);

      case "IfStatement":
        return this.convertIf(cfg, stmt);

      case "WhileStatement":
        return this.convertWhile(cfg, stmt);

      case "ReturnStatement":
        const returnNode = cfg.addNode(
          `return ${this.expressionToString(stmt.expression)}`,
          "statement",
          stmt
        );
        return { entryId: returnNode.id, exitIds: [returnNode.id] };

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
      case "PropertyAccess":
        return `${this.expressionToString(expr.object)}.${expr.property}`;
      case "ObjectLiteral":
        const props = expr.properties
          .flat()
          .map((prop) => `${prop.key}: ${this.expressionToString(prop.value)}`)
          .join(", ");
        return `{${props}}`;
      case "AllocExpression":
        return `alloc ${this.expressionToString(expr.expression)}`;
      case "DereferenceExpression":
        return `*${this.expressionToString(expr.expression)}`;
      case "AddressExpression":
        return `&${expr.variable}`;
      case "NullLiteral":
        return "null";
      case "InputExpression":
        return "input";
      default:
        return `Unknown(${(expr as any).type})`;
    }
  }
}

// 메인 함수
async function generateTIPCFG(
  tipCode: string,
  outputName: string = "tip-program"
) {
  console.log("=== TIP AST to CFG Converter ===\n");

  // 1. TIP 코드 파싱
  const parser = new TIPParser();
  const parseResult = parser.parse(tipCode);

  if (!parseResult.success) {
    console.error("TIP 파싱 실패:", parseResult.error);
    return;
  }

  console.log("✅ TIP 파싱 성공");

  // 2. AST를 CFG로 변환
  const converter = new TIPCFGConverter();
  const cfgs = converter.convertProgram(parseResult.ast!);

  console.log(`\n✅ CFG 생성 완료 (${cfgs.size}개 함수)`);

  // 3. DOT 파일 생성
  for (const [funcName, cfg] of cfgs.entries()) {
    const dotContent = cfg.toDot(funcName);
    const dotFileName = `${outputName}-${funcName}.dot`;
    fs.writeFileSync(dotFileName, dotContent);
    console.log(`✅ DOT 파일 생성: ${dotFileName}`);

    console.log(`\n--- ${funcName} CFG 정보 ---`);
    console.log(`노드 수: ${cfg.nodes.size}`);
    console.log(`엣지 수: ${cfg.edges.length}`);
  }

  console.log("\n=== 완료 ===");
  console.log("DOT 파일을 Graphviz로 시각화하려면:");
  console.log(`dot -Tpng ${outputName}-*.dot -o {함수명}.png`);
}

// 테스트 실행
if (require.main === module) {
  const testTipCode = `
  iterate (n) { var f; f = 1; while (n > 0) { f = f * n; n = n - 1; } return f; }
  `;

  generateTIPCFG(testTipCode, "factorial-example");
}

export { TIPCFGConverter, ControlFlowGraph, generateTIPCFG };
