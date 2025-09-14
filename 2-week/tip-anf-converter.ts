import TIPParser from "./parser";
import {
  Program,
  FunctionDeclaration,
  Statement,
  Expression,
  SequenceStatement,
  IfStatement,
  WhileStatement,
  BinaryExpression,
  FunctionCall,
  PropertyAccess,
  ObjectLiteral,
  AllocExpression,
  DereferenceExpression,
} from "./types";
import * as fs from "fs";

// ANF CFG 노드 타입
interface ANFNode {
  id: number;
  label: string;
  type: "entry" | "exit" | "assignment" | "condition" | "merge";
  // ANF에서는 모든 구문이 단순한 할당이나 조건으로 변환됨
  variable?: string; // 할당받는 변수
  value?: string; // 할당되는 값 (단순 표현식)
  condition?: string; // 조건 표현식 (단순해야 함)
}

// ANF CFG 엣지 타입
interface ANFEdge {
  from: number;
  to: number;
  label?: string;
}

// ANF CFG 클래스
class ANormalFormCFG {
  nodes: Map<number, ANFNode> = new Map();
  edges: ANFEdge[] = [];
  private nextId = 0;

  addNode(
    label: string,
    type: ANFNode["type"],
    variable?: string,
    value?: string,
    condition?: string
  ): ANFNode {
    const node: ANFNode = {
      id: this.nextId++,
      label,
      type,
      variable,
      value,
      condition,
    };
    this.nodes.set(node.id, node);
    return node;
  }

  addEdge(from: number, to: number, label?: string) {
    this.edges.push({ from, to, label });
  }

  // DOT 파일 생성
  toDot(functionName: string): string {
    let dot = `digraph "${functionName}_ANF" {\n`;
    dot += "  node [shape=box];\n";

    // 노드 정의
    for (const node of this.nodes.values()) {
      const shape = node.type === "condition" ? "diamond" : "box";
      const color =
        node.type === "entry"
          ? "green"
          : node.type === "exit"
          ? "red"
          : node.type === "assignment"
          ? "lightblue"
          : node.type === "condition"
          ? "yellow"
          : "lightgray";

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

// TIP AST를 ANF CFG로 변환하는 클래스
class TIPANFConverter {
  private tempCounter = 0;

  generateTempVar(): string {
    return `_t${this.tempCounter++}`;
  }

  convertProgram(program: Program): Map<string, ANormalFormCFG> {
    const cfgs = new Map<string, ANormalFormCFG>();

    for (const func of program.functions) {
      this.tempCounter = 0; // 함수마다 리셋
      const cfg = this.convertFunction(func);
      cfgs.set(func.name, cfg);
    }

    return cfgs;
  }

  convertFunction(func: FunctionDeclaration): ANormalFormCFG {
    const cfg = new ANormalFormCFG();

    // Entry 노드
    const entryNode = cfg.addNode(`Entry: ${func.name}`, "entry");

    // 함수 본문을 ANF로 변환
    const { entryId, exitIds, resultVar } = this.convertStatementToANF(
      cfg,
      func.body
    );

    // Entry에서 함수 본문으로 연결
    cfg.addEdge(entryNode.id, entryId);

    // Return 표현식을 ANF로 변환
    const { nodes: returnNodes, resultVar: returnVar } =
      this.convertExpressionToANF(cfg, func.returnExpression);

    // Return 노드들 연결
    let currentExitIds = exitIds;
    for (const returnNode of returnNodes) {
      for (const exitId of currentExitIds) {
        cfg.addEdge(exitId, returnNode.id);
      }
      currentExitIds = [returnNode.id];
    }

    // Final return 노드
    const returnNode = cfg.addNode(`return ${returnVar}`, "assignment");
    for (const exitId of currentExitIds) {
      cfg.addEdge(exitId, returnNode.id);
    }

    // Exit 노드
    const exitNode = cfg.addNode(`Exit: ${func.name}`, "exit");
    cfg.addEdge(returnNode.id, exitNode.id);

    return cfg;
  }

  convertStatementToANF(
    cfg: ANormalFormCFG,
    stmt: Statement
  ): { entryId: number; exitIds: number[]; resultVar?: string } {
    switch (stmt.type) {
      case "AssignmentStatement":
        const { nodes: assignNodes, resultVar: assignResult } =
          this.convertExpressionToANF(cfg, stmt.expression);

        // 표현식 계산 노드들
        let currentIds = assignNodes.length > 0 ? [assignNodes[0].id] : [];
        for (let i = 1; i < assignNodes.length; i++) {
          for (const id of currentIds) {
            cfg.addEdge(id, assignNodes[i].id);
          }
          currentIds = [assignNodes[i].id];
        }

        // 최종 할당 노드
        const finalAssignNode = cfg.addNode(
          `${stmt.variable} = ${assignResult}`,
          "assignment",
          stmt.variable,
          assignResult
        );

        if (assignNodes.length > 0) {
          for (const id of currentIds) {
            cfg.addEdge(id, finalAssignNode.id);
          }
        }

        return {
          entryId:
            assignNodes.length > 0 ? assignNodes[0].id : finalAssignNode.id,
          exitIds: [finalAssignNode.id],
          resultVar: stmt.variable,
        };

      case "OutputStatement":
        const { nodes: outputNodes, resultVar: outputResult } =
          this.convertExpressionToANF(cfg, stmt.expression);

        let outputCurrentIds =
          outputNodes.length > 0 ? [outputNodes[0].id] : [];
        for (let i = 1; i < outputNodes.length; i++) {
          for (const id of outputCurrentIds) {
            cfg.addEdge(id, outputNodes[i].id);
          }
          outputCurrentIds = [outputNodes[i].id];
        }

        const outputNode = cfg.addNode(`output ${outputResult}`, "assignment");

        if (outputNodes.length > 0) {
          for (const id of outputCurrentIds) {
            cfg.addEdge(id, outputNode.id);
          }
        }

        return {
          entryId: outputNodes.length > 0 ? outputNodes[0].id : outputNode.id,
          exitIds: [outputNode.id],
        };

      case "DirectPropertyAssignmentStatement":
        const { nodes: propNodes, resultVar: propResult } =
          this.convertExpressionToANF(cfg, stmt.value);

        let propCurrentIds = propNodes.length > 0 ? [propNodes[0].id] : [];
        for (let i = 1; i < propNodes.length; i++) {
          for (const id of propCurrentIds) {
            cfg.addEdge(id, propNodes[i].id);
          }
          propCurrentIds = [propNodes[i].id];
        }

        const propAssignNode = cfg.addNode(
          `${stmt.object}.${stmt.property} = ${propResult}`,
          "assignment"
        );

        if (propNodes.length > 0) {
          for (const id of propCurrentIds) {
            cfg.addEdge(id, propAssignNode.id);
          }
        }

        return {
          entryId: propNodes.length > 0 ? propNodes[0].id : propAssignNode.id,
          exitIds: [propAssignNode.id],
        };

      case "SequenceStatement":
        return this.convertSequenceToANF(cfg, stmt);

      case "IfStatement":
        return this.convertIfToANF(cfg, stmt);

      case "WhileStatement":
        return this.convertWhileToANF(cfg, stmt);

      default:
        const unknownNode = cfg.addNode(
          `Unknown: ${(stmt as any).type}`,
          "assignment"
        );
        return { entryId: unknownNode.id, exitIds: [unknownNode.id] };
    }
  }

  convertExpressionToANF(
    cfg: ANormalFormCFG,
    expr: Expression
  ): { nodes: ANFNode[]; resultVar: string } {
    switch (expr.type) {
      case "NumberLiteral":
        return { nodes: [], resultVar: expr.value.toString() };

      case "Variable":
        return { nodes: [], resultVar: expr.name };

      case "NullLiteral":
        return { nodes: [], resultVar: "null" };

      case "InputExpression":
        const inputTemp = this.generateTempVar();
        const inputNode = cfg.addNode(
          `${inputTemp} = input`,
          "assignment",
          inputTemp,
          "input"
        );
        return { nodes: [inputNode], resultVar: inputTemp };

      case "BinaryExpression":
        const leftResult = this.convertExpressionToANF(cfg, expr.left);
        const rightResult = this.convertExpressionToANF(cfg, expr.right);
        const binaryTemp = this.generateTempVar();

        const binaryNode = cfg.addNode(
          `${binaryTemp} = ${leftResult.resultVar} ${expr.operator} ${rightResult.resultVar}`,
          "assignment",
          binaryTemp,
          `${leftResult.resultVar} ${expr.operator} ${rightResult.resultVar}`
        );

        const allNodes = [
          ...leftResult.nodes,
          ...rightResult.nodes,
          binaryNode,
        ];

        return { nodes: allNodes, resultVar: binaryTemp };

      case "FunctionCall":
        const calleeResult = this.convertExpressionToANF(cfg, expr.callee);
        const argResults = expr.arguments
          .flat()
          .map((arg) => this.convertExpressionToANF(cfg, arg));

        const callTemp = this.generateTempVar();
        const argVars = argResults.map((result) => result.resultVar).join(", ");

        const callNode = cfg.addNode(
          `${callTemp} = ${calleeResult.resultVar}(${argVars})`,
          "assignment",
          callTemp,
          `${calleeResult.resultVar}(${argVars})`
        );

        const callNodes = [
          ...calleeResult.nodes,
          ...argResults.flatMap((result) => result.nodes),
          callNode,
        ];

        return { nodes: callNodes, resultVar: callTemp };

      case "PropertyAccess":
        const objResult = this.convertExpressionToANF(cfg, expr.object);
        const accessTemp = this.generateTempVar();

        const accessNode = cfg.addNode(
          `${accessTemp} = ${objResult.resultVar}.${expr.property}`,
          "assignment",
          accessTemp,
          `${objResult.resultVar}.${expr.property}`
        );

        return {
          nodes: [...objResult.nodes, accessNode],
          resultVar: accessTemp,
        };

      case "ObjectLiteral":
        const propResults = expr.properties.flat().map((prop) => ({
          key: prop.key,
          result: this.convertExpressionToANF(cfg, prop.value),
        }));

        const objTemp = this.generateTempVar();
        const propStrs = propResults
          .map((prop) => `${prop.key}: ${prop.result.resultVar}`)
          .join(", ");

        const objNode = cfg.addNode(
          `${objTemp} = {${propStrs}}`,
          "assignment",
          objTemp,
          `{${propStrs}}`
        );

        const objNodes = [
          ...propResults.flatMap((prop) => prop.result.nodes),
          objNode,
        ];

        return { nodes: objNodes, resultVar: objTemp };

      case "AllocExpression":
        const allocResult = this.convertExpressionToANF(cfg, expr.expression);
        const allocTemp = this.generateTempVar();

        const allocNode = cfg.addNode(
          `${allocTemp} = alloc ${allocResult.resultVar}`,
          "assignment",
          allocTemp,
          `alloc ${allocResult.resultVar}`
        );

        return {
          nodes: [...allocResult.nodes, allocNode],
          resultVar: allocTemp,
        };

      case "DereferenceExpression":
        const derefResult = this.convertExpressionToANF(cfg, expr.expression);
        const derefTemp = this.generateTempVar();

        const derefNode = cfg.addNode(
          `${derefTemp} = *${derefResult.resultVar}`,
          "assignment",
          derefTemp,
          `*${derefResult.resultVar}`
        );

        return {
          nodes: [...derefResult.nodes, derefNode],
          resultVar: derefTemp,
        };

      case "AddressExpression":
        const addrTemp = this.generateTempVar();
        const addrNode = cfg.addNode(
          `${addrTemp} = &${expr.variable}`,
          "assignment",
          addrTemp,
          `&${expr.variable}`
        );

        return { nodes: [addrNode], resultVar: addrTemp };

      default:
        const unknownTemp = this.generateTempVar();
        const unknownNode = cfg.addNode(
          `${unknownTemp} = Unknown(${(expr as any).type})`,
          "assignment",
          unknownTemp,
          `Unknown(${(expr as any).type})`
        );
        return { nodes: [unknownNode], resultVar: unknownTemp };
    }
  }

  convertSequenceToANF(
    cfg: ANormalFormCFG,
    stmt: SequenceStatement
  ): { entryId: number; exitIds: number[]; resultVar?: string } {
    if (stmt.statements.length === 0) {
      const emptyNode = cfg.addNode("(empty)", "assignment");
      return { entryId: emptyNode.id, exitIds: [emptyNode.id] };
    }

    let currentExitIds: number[] = [];
    let entryId: number | undefined;
    let lastResultVar: string | undefined;

    for (let i = 0; i < stmt.statements.length; i++) {
      const {
        entryId: stmtEntry,
        exitIds: stmtExits,
        resultVar,
      } = this.convertStatementToANF(cfg, stmt.statements[i]);

      if (i === 0) {
        entryId = stmtEntry;
      } else {
        for (const exitId of currentExitIds) {
          cfg.addEdge(exitId, stmtEntry);
        }
      }

      currentExitIds = stmtExits;
      if (resultVar) {
        lastResultVar = resultVar;
      }
    }

    return {
      entryId: entryId!,
      exitIds: currentExitIds,
      resultVar: lastResultVar,
    };
  }

  convertIfToANF(
    cfg: ANormalFormCFG,
    stmt: IfStatement
  ): { entryId: number; exitIds: number[]; resultVar?: string } {
    // 조건을 ANF로 변환
    const { nodes: condNodes, resultVar: condVar } =
      this.convertExpressionToANF(cfg, stmt.condition);

    // 조건 계산 노드들 연결
    let currentIds = condNodes.length > 0 ? [condNodes[0].id] : [];
    for (let i = 1; i < condNodes.length; i++) {
      for (const id of currentIds) {
        cfg.addEdge(id, condNodes[i].id);
      }
      currentIds = [condNodes[i].id];
    }

    // 조건 노드
    const conditionNode = cfg.addNode(
      condVar,
      "condition",
      undefined,
      undefined,
      condVar
    );

    if (condNodes.length > 0) {
      for (const id of currentIds) {
        cfg.addEdge(id, conditionNode.id);
      }
    }

    // Then 분기
    const { entryId: thenEntry, exitIds: thenExits } =
      this.convertStatementToANF(cfg, stmt.thenStatement);
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
          this.convertStatementToANF(cfg, elseStmt);
        cfg.addEdge(conditionNode.id, elseEntry, "false");
        allExitIds.push(...elseExits);
      } else {
        // else가 비어있으면 조건이 false일 때 바로 다음으로
        const falseNode = cfg.addNode("(skip)", "assignment");
        cfg.addEdge(conditionNode.id, falseNode.id, "false");
        allExitIds.push(falseNode.id);
      }
    } else {
      // else가 없으면 조건이 false일 때 바로 다음으로
      // false 라벨을 명시적으로 표시하기 위해 더미 노드 생성
      const falseNode = cfg.addNode("(skip)", "assignment");
      cfg.addEdge(conditionNode.id, falseNode.id, "false");
      allExitIds.push(falseNode.id);
    }

    return {
      entryId: condNodes.length > 0 ? condNodes[0].id : conditionNode.id,
      exitIds: allExitIds,
    };
  }

  convertWhileToANF(
    cfg: ANormalFormCFG,
    stmt: WhileStatement
  ): { entryId: number; exitIds: number[]; resultVar?: string } {
    // 조건을 ANF로 변환
    const { nodes: condNodes, resultVar: condVar } =
      this.convertExpressionToANF(cfg, stmt.condition);

    // 조건 계산 노드들 연결
    let currentIds = condNodes.length > 0 ? [condNodes[0].id] : [];
    for (let i = 1; i < condNodes.length; i++) {
      for (const id of currentIds) {
        cfg.addEdge(id, condNodes[i].id);
      }
      currentIds = [condNodes[i].id];
    }

    // 조건 노드
    const conditionNode = cfg.addNode(
      condVar,
      "condition",
      undefined,
      undefined,
      condVar
    );

    if (condNodes.length > 0) {
      for (const id of currentIds) {
        cfg.addEdge(id, conditionNode.id);
      }
    }

    // 루프 본문
    const { entryId: bodyEntry, exitIds: bodyExits } =
      this.convertStatementToANF(cfg, stmt.body);

    // 루프 종료 노드 (false 경로를 명시적으로 표시)
    const exitLoopNode = cfg.addNode("exit loop", "assignment");

    // 조건 -> 본문 (true)
    cfg.addEdge(conditionNode.id, bodyEntry, "true");

    // 조건 -> 루프 종료 (false)
    cfg.addEdge(conditionNode.id, exitLoopNode.id, "false");

    // 본문의 모든 exit -> 조건 (루프백)
    for (const exitId of bodyExits) {
      cfg.addEdge(
        exitId,
        condNodes.length > 0 ? condNodes[0].id : conditionNode.id
      );
    }

    return {
      entryId: condNodes.length > 0 ? condNodes[0].id : conditionNode.id,
      exitIds: [exitLoopNode.id],
    };
  }
}

// 메인 함수
async function generateTIPANF(
  tipCode: string,
  outputName: string = "tip-program"
) {
  console.log("=== TIP AST to ANF CFG Converter ===\n");

  // 1. TIP 코드 파싱
  const parser = new TIPParser();
  const parseResult = parser.parse(tipCode);

  if (!parseResult.success) {
    console.error("TIP 파싱 실패:", parseResult.error);
    return;
  }

  console.log("✅ TIP 파싱 성공");

  // 2. AST를 ANF CFG로 변환
  const converter = new TIPANFConverter();
  const cfgs = converter.convertProgram(parseResult.ast!);

  console.log(`\n✅ ANF CFG 생성 완료 (${cfgs.size}개 함수)`);

  // 3. DOT 파일 생성
  for (const [funcName, cfg] of cfgs.entries()) {
    const dotContent = cfg.toDot(funcName);
    const dotFileName = `${outputName}-${funcName}-anf.dot`;
    fs.writeFileSync(dotFileName, dotContent);
    console.log(`✅ ANF DOT 파일 생성: ${dotFileName}`);

    console.log(`\n--- ${funcName} ANF CFG 정보 ---`);
    console.log(`노드 수: ${cfg.nodes.size}`);
    console.log(`엣지 수: ${cfg.edges.length}`);
  }

  console.log("\n=== 완료 ===");
  console.log("ANF DOT 파일을 Graphviz로 시각화하려면:");
  console.log(`dot -Tpng ${outputName}-*-anf.dot -o {함수명}-anf.png`);
}

// 테스트 실행
if (require.main === module) {
  const testTipCode = `
   iterate (n) { var f; f = 1; while (n > 0) { f = f * n; n = n - 1; } return f; }
   `;

  generateTIPANF(testTipCode, "iterate-example");
}

export { TIPANFConverter, ANormalFormCFG, generateTIPANF };
