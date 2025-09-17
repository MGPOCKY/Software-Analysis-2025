import TIPParser from "./parser";
import { TIPANFConverter } from "./tip-anf-converter";
import {
  AddressType,
  AllocType,
  AssignmentType,
  BinaryType,
  DereferenceType,
  EqualType,
  Expression,
  FunctionDeclaration,
  FunctionDeclarationType,
  IfElseType,
  IfType,
  InputType,
  NullType,
  NumberType,
  OutputType,
  PointerAssignmentType,
  Program,
  Statement,
  TypeConstraint,
  Variable,
  WhileType,
} from "./types";
import * as fs from "fs";

const constraints: TypeConstraint[] = [];

// Unification을 위한 타입 정의
interface TypeNode {
  id: string;
  kind: "expression" | "concrete";
  value: Expression | ConcreteType;
}

interface ConcreteType {
  type: "int" | "pointer" | "function";
  pointsTo?: ConcreteType;
  parameters?: ConcreteType[];
  returnType?: ConcreteType;
}

// Union-Find 자료구조
class UnionFind {
  private parent: Map<string, string> = new Map();
  private rank: Map<string, number> = new Map();
  private typeInfo: Map<string, ConcreteType | null> = new Map();

  makeSet(id: string, concreteType?: ConcreteType | null): void {
    this.parent.set(id, id);
    this.rank.set(id, 0);
    this.typeInfo.set(id, concreteType || null);
  }

  find(id: string): string {
    if (!this.parent.has(id)) {
      this.makeSet(id);
    }

    const parentId = this.parent.get(id)!;
    if (parentId !== id) {
      // Path compression
      this.parent.set(id, this.find(parentId));
      return this.parent.get(id)!;
    }
    return id;
  }

  union(id1: string, id2: string): boolean {
    const root1 = this.find(id1);
    const root2 = this.find(id2);

    if (root1 === root2) return true;

    // 타입 충돌 검사
    const type1 = this.typeInfo.get(root1);
    const type2 = this.typeInfo.get(root2);

    if (type1 && type2) {
      if (!this.isCompatible(type1, type2)) {
        return false; // 타입 오류
      }
    }

    // Union by rank
    const rank1 = this.rank.get(root1)!;
    const rank2 = this.rank.get(root2)!;

    if (rank1 < rank2) {
      this.parent.set(root1, root2);
      this.typeInfo.set(root2, type2 || type1 || null);
    } else if (rank1 > rank2) {
      this.parent.set(root2, root1);
      this.typeInfo.set(root1, type1 || type2 || null);
    } else {
      this.parent.set(root2, root1);
      this.rank.set(root1, rank1 + 1);
      this.typeInfo.set(root1, type1 || type2 || null);
    }

    return true;
  }

  private isCompatible(type1: ConcreteType, type2: ConcreteType): boolean {
    if (type1.type !== type2.type) return false;

    switch (type1.type) {
      case "int":
        return true;
      case "pointer":
        if (!type1.pointsTo || !type2.pointsTo) return true;
        return this.isCompatible(type1.pointsTo, type2.pointsTo);
      case "function":
        if (type1.parameters?.length !== type2.parameters?.length) return false;

        // 매개변수 타입들 검사
        if (type1.parameters && type2.parameters) {
          for (let i = 0; i < type1.parameters.length; i++) {
            if (!this.isCompatible(type1.parameters[i], type2.parameters[i])) {
              return false;
            }
          }
        }

        // 반환 타입 검사
        if (type1.returnType && type2.returnType) {
          return this.isCompatible(type1.returnType, type2.returnType);
        }

        return true;
      default:
        return false;
    }
  }

  getType(id: string): ConcreteType | null {
    const root = this.find(id);
    return this.typeInfo.get(root) || null;
  }

  getAllGroups(): Map<string, string[]> {
    const groups = new Map<string, string[]>();

    for (const id of this.parent.keys()) {
      const root = this.find(id);
      if (!groups.has(root)) {
        groups.set(root, []);
      }
      groups.get(root)!.push(id);
    }

    return groups;
  }
}

// 색상 출력을 위한 ANSI 코드
const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
};

function colorLog(color: keyof typeof colors, message: string) {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

async function processTypeCheck() {
  colorLog("cyan", "🚀 === TIP Type Checking 시작 ===\n");

  // 1. tip_code.txt 파일 읽기
  const inputFile = "tip_code.txt";
  if (!fs.existsSync(inputFile)) {
    colorLog("red", `❌ 오류: ${inputFile} 파일이 존재하지 않습니다.`);
    return;
  }

  const tipCode = fs.readFileSync(inputFile, "utf-8").trim();
  if (!tipCode) {
    colorLog("red", `❌ 오류: ${inputFile} 파일이 비어있습니다.`);
    return;
  }

  colorLog("green", `✅ TIP 코드 읽기 완료 (${inputFile})`);
  colorLog("blue", "--- TIP 코드 내용 ---");
  console.log(tipCode);
  console.log("");

  // 2. TIP 코드 파싱 (AST 생성)
  colorLog("yellow", "🔍 1단계: TIP 코드 파싱 및 AST 생성...");
  const parser = new TIPParser();
  const parseResult = parser.parse(tipCode);

  if (!parseResult.success) {
    colorLog("red", `❌ 파싱 실패: ${parseResult.error}`);
    return;
  }

  colorLog("green", "✅ AST 생성 완료");
  const ast = parseResult.ast!;

  // 3. ANF CFG 생성
  colorLog("yellow", "\n🔄 2단계: ANF CFG 생성...");
  const anfConverter = new TIPANFConverter();
  const anfCfgs = anfConverter.convertProgram(ast);

  colorLog("green", `✅ ANF CFG 생성 완료 (${anfCfgs.size}개 함수)`);

  // 4. Type Constraint 수집
  colorLog("yellow", "\n🔍 3단계: Type Constraint 수집...");

  const constraints = collectTypeConstraints(ast);

  colorLog(
    "green",
    `✅ Type Constraint 수집 완료 (${constraints.length}개 제약)`
  );

  // 5. Type Constraint 출력
  colorLog("blue", "\n📋 수집된 Type Constraints:");
  printDetailedConstraints(constraints);

  // 6. Unification 실행
  colorLog("yellow", "\n🔗 6단계: Unification 실행...");
  const { unionFind, errors } = performUnification(constraints);

  if (errors.length > 0) {
    colorLog("red", `❌ Unification 중 ${errors.length}개의 타입 오류 발견`);
  } else {
    colorLog("green", "✅ Unification 완료 - 타입 오류 없음");
  }

  // 7. Unification 실행 결과 출력
  colorLog("blue", "\n📊 7단계: Unification 결과 출력...");
  printUnificationResults(unionFind, constraints);

  // 8. 타입 오류 여부 출력
  colorLog("magenta", "\n🔍 8단계: 타입 오류 분석...");
  printTypeErrors(errors);

  colorLog("cyan", "\n✨ Type Checking 처리 완료!");
}

// Type Constraint 상세 출력 함수
function printDetailedConstraints(constraints: TypeConstraint[]) {
  constraints.forEach((constraint, index) => {
    colorLog(
      "yellow",
      `\n  ${index + 1}. ${constraint.originAST.type} 제약 조건:`
    );

    // Origin AST 정보
    colorLog("magenta", `     원본 AST: ${constraint.originAST.type}`);

    // Left side 출력
    colorLog("cyan", "     Left side:");
    constraint.left.forEach((leftItem, leftIndex) => {
      if ("expression" in leftItem) {
        console.log(
          `       [${leftIndex}] Expression: ${formatExpression(
            leftItem.expression
          )}`
        );
      } else if ("type" in leftItem) {
        console.log(`       [${leftIndex}] Type: ${formatType(leftItem)}`);
      } else {
        console.log(
          `       [${leftIndex}] ${JSON.stringify(leftItem, null, 2)}`
        );
      }
    });

    // Right side 출력
    colorLog("green", "     Right side:");
    constraint.right.forEach((rightItem, rightIndex) => {
      if ("expression" in rightItem) {
        console.log(
          `       [${rightIndex}] Expression: ${formatExpression(
            rightItem.expression
          )}`
        );
      } else if ("type" in rightItem) {
        console.log(`       [${rightIndex}] Type: ${formatType(rightItem)}`);
      } else {
        console.log(
          `       [${rightIndex}] ${JSON.stringify(rightItem, null, 2)}`
        );
      }
    });
  });
}

// Expression을 간결하게 포맷팅하는 함수
function formatExpression(expr: any): string {
  if (!expr) return "null";

  switch (expr.type) {
    case "NumberLiteral":
      return `Number(${expr.value})`;
    case "Variable":
      return `Var(${expr.name})`;
    case "BinaryExpression":
      return `Binary(${formatExpression(expr.left)} ${
        expr.operator
      } ${formatExpression(expr.right)})`;
    case "AssignmentStatement":
      return `Assignment(${expr.variable} = ${formatExpression(
        expr.expression
      )})`;
    case "InputExpression":
      return "Input()";
    case "AllocExpression":
      return `Alloc(${formatExpression(expr.expression)})`;
    case "AddressExpression":
      return `Address(&${expr.variable})`;
    case "DereferenceExpression":
      return `Deref(*${formatExpression(expr.expression)})`;
    case "NullLiteral":
      return "null";
    default:
      return `${expr.type}(...)`;
  }
}

// Type을 포맷팅하는 함수
function formatType(type: any): string {
  if (!type) return "unknown";

  if (type.type === "int") {
    return "int";
  } else if (type.type === "pointer") {
    return `pointer(${type.pointsTo ? formatType(type.pointsTo) : "?"})`;
  } else if (type.type === "function") {
    const params =
      type.parameters?.map((p: any) => formatType(p)).join(", ") || "";
    const returnType = type.returnType ? formatType(type.returnType) : "?";
    return `function(${params}) -> ${returnType}`;
  } else if (type.expression) {
    return `CustomType(${formatExpression(type.expression)})`;
  } else {
    return JSON.stringify(type);
  }
}

// 함수 시작 시 Symbol Table 구축
function buildSymbolTable(func: FunctionDeclaration) {
  const symbolTable = new Map<string, Variable>();

  // 매개변수 등록
  for (const param of func.parameters) {
    const paramVar: Variable = {
      type: "Variable",
      name: param,
      // location 등 추가 정보
    };
    symbolTable.set(param, paramVar);
  }

  // 지역변수 등록
  if (func.localVariables) {
    for (const localVar of func.localVariables) {
      const localVarNode: Variable = {
        type: "Variable",
        name: localVar,
      };
      symbolTable.set(localVar, localVarNode);
    }
  }

  return symbolTable;
}

const addExpressionConstraint = (
  expression: Expression,
  symbolTable: Map<string, Variable>
) => {
  switch (expression.type) {
    case "NumberLiteral":
      const numberConstraint: NumberType = {
        originAST: expression,
        left: [{ expression: expression }],
        right: [{ type: "int" }],
      };
      constraints.push(numberConstraint);
      break;
    case "BinaryExpression":
      addExpressionConstraint(expression.left, symbolTable);
      addExpressionConstraint(expression.right, symbolTable);
      if (expression.operator === "==") {
        const equalConstraint: EqualType = {
          originAST: expression,
          left: [{ expression: expression.left }, { expression: expression }],
          right: [{ expression: expression.right }, { type: "int" }],
        };
        constraints.push(equalConstraint);
      } else {
        const binaryConstraint: BinaryType = {
          originAST: expression,
          left: [
            { expression: expression.left },
            { expression: expression.right },
            { expression },
          ],
          right: [{ type: "int" }, { type: "int" }, { type: "int" }],
        };
        constraints.push(binaryConstraint);
      }
      break;
    case "InputExpression":
      const inputConstraint: InputType = {
        originAST: expression,
        left: [{ expression: expression }],
        right: [{ type: "int" }],
      };
      constraints.push(inputConstraint);
      break;
    case "AllocExpression":
      addExpressionConstraint(expression.expression, symbolTable);
      const allocConstraint: AllocType = {
        originAST: expression,
        left: [{ expression: expression }],
        right: [
          {
            type: "pointer",
            pointsTo: { expression: expression.expression },
          },
        ],
      };
      constraints.push(allocConstraint);
      break;
    case "AddressExpression":
      const addressConstraint: AddressType = {
        originAST: expression,
        left: [{ expression: expression }],
        right: [
          {
            type: "pointer",
            pointsTo: {
              expression: symbolTable.get(expression.variable)!,
            },
          },
        ],
      };
      constraints.push(addressConstraint);
      break;
    case "DereferenceExpression":
      addExpressionConstraint(expression.expression, symbolTable);
      const dereferenceConstraint: DereferenceType = {
        originAST: expression,
        left: [{ expression: expression }],
        right: [
          {
            type: "pointer",
            pointsTo: {
              expression: {
                type: "DereferenceExpression",
                expression: expression.expression,
              },
            },
          },
        ],
      };
      constraints.push(dereferenceConstraint);
      break;
    // To do: Null 새로운 타입으로 구현
    case "NullLiteral":
      const nullConstraint: NullType = {
        originAST: expression,
        left: [{ type: "pointer", pointsTo: { expression: expression } }],
        right: [],
      };
      constraints.push(nullConstraint);
      break;
    case "Variable":
      // 변수 참조는 Symbol Table에서 찾아서 타입 제약 조건 생성
      // 별도의 제약 조건은 생성하지 않고, 참조만 확인
      break;
    case "FunctionCall":
      // 함수 호출의 인자들에 대한 제약 조건 수집
      expression.arguments.forEach((arg) => {
        addExpressionConstraint(arg, symbolTable);
      });
      addExpressionConstraint(expression.callee, symbolTable);
      // 함수 호출 자체에 대한 타입 제약 조건은 별도로 구현 필요
      break;
    case "UnaryExpression":
      addExpressionConstraint(expression.operand, symbolTable);
      if (expression.operator === "*") {
        // 역참조: operand는 포인터여야 함 - UnaryExpression을 위한 별도 제약 조건 필요
        // 현재 DereferenceType은 DereferenceExpression 전용이므로 여기서는 주석 처리
        // TODO: UnaryExpression용 타입 제약 조건 추가 필요
      } else if (expression.operator === "&") {
        // 주소 연산: UnaryExpression을 위한 별도 제약 조건 필요
        // 현재 AddressType은 AddressExpression 전용이므로 여기서는 주석 처리
        // TODO: UnaryExpression용 타입 제약 조건 추가 필요
      }
      break;
    case "ObjectLiteral":
      // 객체 리터럴의 속성들에 대한 제약 조건 수집
      expression.properties.forEach((prop) => {
        addExpressionConstraint(prop.value, symbolTable);
      });
      break;
    case "PropertyAccess":
      // 속성 접근의 객체에 대한 제약 조건 수집
      addExpressionConstraint(expression.object, symbolTable);
      break;
  }
};

// Statement들을 재귀적으로 처리하는 함수
function processStatements(
  statements: Statement[],
  symbolTable: Map<string, Variable>
) {
  for (const stmt of statements) {
    processStatement(stmt, symbolTable);
  }
}

// 개별 Statement를 처리하는 함수
function processStatement(stmt: Statement, symbolTable: Map<string, Variable>) {
  switch (stmt.type) {
    case "AssignmentStatement":
      addExpressionConstraint(stmt.expression, symbolTable);
      const assignmentConstraint: AssignmentType = {
        originAST: stmt,
        left: [
          {
            expression: symbolTable.get(stmt.variable) || {
              type: "Variable",
              name: stmt.variable,
            },
          },
        ],
        right: [{ expression: stmt.expression }],
      };
      constraints.push(assignmentConstraint);
      break;
    case "OutputStatement":
      addExpressionConstraint(stmt.expression, symbolTable);
      const outputConstraint: OutputType = {
        originAST: stmt,
        left: [{ expression: stmt.expression }],
        right: [{ type: "int" }],
      };
      constraints.push(outputConstraint);
      break;
    case "IfStatement":
      addExpressionConstraint(stmt.condition, symbolTable);
      if (stmt.elseStatement) {
        const ifElseConstraint: IfElseType = {
          originAST: stmt,
          left: [{ expression: stmt.condition }],
          right: [{ type: "int" }],
        };
        constraints.push(ifElseConstraint);
        // 재귀적으로 then과 else 블록 처리
        processStatements(stmt.thenStatement, symbolTable);
        processStatements(stmt.elseStatement, symbolTable);
      } else {
        const ifConstraint: IfType = {
          originAST: stmt,
          left: [{ expression: stmt.condition }],
          right: [{ type: "int" }],
        };
        constraints.push(ifConstraint);
        // 재귀적으로 then 블록 처리
        processStatements(stmt.thenStatement, symbolTable);
      }
      break;
    case "WhileStatement":
      addExpressionConstraint(stmt.condition, symbolTable);
      const whileConstraint: WhileType = {
        originAST: stmt,
        left: [{ expression: stmt.condition }],
        right: [{ type: "int" }],
      };
      constraints.push(whileConstraint);
      // 재귀적으로 while 바디 처리
      processStatements(stmt.body, symbolTable);
      break;
    case "PointerAssignmentStatement":
      addExpressionConstraint(stmt.pointer, symbolTable);
      addExpressionConstraint(stmt.value, symbolTable);
      const pointerAssignmentConstraint: PointerAssignmentType = {
        originAST: stmt,
        left: [{ expression: stmt.pointer }],
        right: [{ type: "pointer", pointsTo: { expression: stmt.value } }],
      };
      constraints.push(pointerAssignmentConstraint);
      break;
    case "DirectPropertyAssignmentStatement":
      addExpressionConstraint(stmt.value, symbolTable);
      // DirectPropertyAssignmentStatementType 구현 필요
      break;
    case "PropertyAssignmentStatement":
      addExpressionConstraint(stmt.object, symbolTable);
      addExpressionConstraint(stmt.value, symbolTable);
      // PropertyAssignmentStatementType 구현 필요
      break;
    case "ReturnStatement":
      addExpressionConstraint(stmt.expression, symbolTable);
      // Return statement 타입 제약 조건은 함수 차원에서 처리
      break;
  }
}

// AST를 순회하면서 Type Constraint 수집
function collectTypeConstraints(ast: Program): TypeConstraint[] {
  for (const func of ast.functions) {
    // FunctionDeclarationType
    const symbolTable = buildSymbolTable(func);
    addExpressionConstraint(func.returnExpression, symbolTable);
    const functionConstraint: FunctionDeclarationType = {
      originAST: func,
      left: [{ expression: { type: "Variable", name: func.name } }],
      right: [
        {
          type: "function",
          parameters: func.parameters.map((param) => ({
            expression: symbolTable.get(param)!,
          })) as [{ expression: Variable }],
          returnType: { expression: func.returnExpression },
        },
      ],
    };
    constraints.push(functionConstraint);

    // 함수 바디의 Statement들을 재귀적으로 처리
    processStatements(func.body, symbolTable);
  }

  return constraints;
}

// Expression이나 Type에서 고유 ID 생성
function getTypeId(item: any): string {
  if (item.expression) {
    return `expr_${JSON.stringify(item.expression).replace(/\s/g, "")}`;
  } else if (item.type) {
    return `type_${JSON.stringify(item).replace(/\s/g, "")}`;
  }
  return `unknown_${Math.random().toString(36).substr(2, 9)}`;
}

// Type을 ConcreteType으로 변환
function toConcreteType(item: any): ConcreteType | null {
  if (item.type === "int") {
    return { type: "int" };
  } else if (item.type === "pointer") {
    const pointsTo = item.pointsTo ? toConcreteType(item.pointsTo) : undefined;
    return {
      type: "pointer",
      pointsTo: pointsTo || undefined,
    };
  } else if (item.type === "function") {
    const returnType = item.returnType
      ? toConcreteType(item.returnType)
      : undefined;
    return {
      type: "function",
      parameters:
        item.parameters
          ?.map((p: any) => toConcreteType(p))
          .filter((t: any) => t !== null) || [],
      returnType: returnType || undefined,
    };
  }
  return null;
}

// Unification 실행
function performUnification(constraints: TypeConstraint[]): {
  unionFind: UnionFind;
  errors: string[];
} {
  const unionFind = new UnionFind();
  const errors: string[] = [];

  // 1. 모든 타입 변수와 concrete type들을 Union-Find에 등록
  for (const constraint of constraints) {
    // Left side 등록
    for (const leftItem of constraint.left) {
      const id = getTypeId(leftItem);
      const concreteType = toConcreteType(leftItem);
      unionFind.makeSet(id, concreteType);
    }

    // Right side 등록
    for (const rightItem of constraint.right) {
      const id = getTypeId(rightItem);
      const concreteType = toConcreteType(rightItem);
      unionFind.makeSet(id, concreteType);
    }
  }

  // 2. Type constraint에 따라 unification 수행
  for (const constraint of constraints) {
    const leftIds = constraint.left.map((item) => getTypeId(item));
    const rightIds = constraint.right.map((item) => getTypeId(item));

    // Left와 Right의 각 쌍을 unify
    const maxLength = Math.max(leftIds.length, rightIds.length);

    for (let i = 0; i < maxLength; i++) {
      const leftId = leftIds[i % leftIds.length];
      const rightId = rightIds[i % rightIds.length];

      if (leftId && rightId) {
        const success = unionFind.union(leftId, rightId);
        if (!success) {
          errors.push(
            `타입 충돌: ${constraint.originAST.type}에서 타입 불일치 (${leftId} ≠ ${rightId})`
          );
        }
      }
    }

    // 특별한 경우들 처리
    if (constraint.originAST.type === "BinaryExpression") {
      const binaryExpr = constraint.originAST as any;

      if (binaryExpr.operator === "==" && leftIds.length >= 2) {
        // == 연산자: e1과 e2가 같은 타입이어야 함
        const success = unionFind.union(leftIds[0], leftIds[1]);
        if (!success) {
          errors.push(
            `타입 충돌: 등등 비교에서 피연산자 타입 불일치 (${leftIds[0]} ≠ ${leftIds[1]})`
          );
        }
      } else if (leftIds.length >= 3) {
        // 산술/비교 연산자: e1, e2, 결과 모두 같은 타입
        const success1 = unionFind.union(leftIds[0], leftIds[1]); // e1 ↔ e2
        const success2 = unionFind.union(leftIds[0], leftIds[2]); // e1 ↔ (e1 op e2)

        if (!success1) {
          errors.push(
            `타입 충돌: 이진 연산에서 피연산자 타입 불일치 (${leftIds[0]} ≠ ${leftIds[1]})`
          );
        }
        if (!success2) {
          errors.push(
            `타입 충돌: 이진 연산에서 결과 타입 불일치 (${leftIds[0]} ≠ ${leftIds[2]})`
          );
        }
      }
    }
  }

  return { unionFind, errors };
}

// Unification 결과 출력
function printUnificationResults(
  unionFind: UnionFind,
  constraints: TypeConstraint[]
) {
  const groups = unionFind.getAllGroups();

  colorLog("cyan", "   🏷️  Equivalence Classes (동등한 타입들):");
  let classIndex = 1;

  for (const [representative, members] of groups) {
    const concreteType = unionFind.getType(representative);
    const typeStr = concreteType
      ? formatConcreteType(concreteType, unionFind)
      : "추론된 타입";

    colorLog("blue", `     클래스 ${classIndex}: ${typeStr}`);
    members.forEach((member, idx) => {
      const displayName = member.replace(/^(expr_|type_)/, "").substring(0, 50);
      console.log(`       ${idx === 0 ? "⭐" : " "}  ${displayName}`);
    });
    console.log("");
    classIndex++;
  }

  colorLog("green", "   📋 각 Expression의 최종 타입:");
  const processedExpressions = new Set<string>();

  for (const constraint of constraints) {
    for (const leftItem of constraint.left) {
      if (
        "expression" in leftItem &&
        leftItem.expression &&
        !processedExpressions.has(JSON.stringify(leftItem.expression))
      ) {
        const id = getTypeId(leftItem);
        const finalType = unionFind.getType(id);
        const exprStr = formatExpression(leftItem.expression);
        const typeStr = finalType
          ? formatConcreteType(finalType, unionFind)
          : "추론 중...";

        console.log(`     ${exprStr} : ${typeStr}`);
        processedExpressions.add(JSON.stringify(leftItem.expression));
      }
    }
  }
}

// ConcreteType 포맷팅 (Union-Find를 활용한 개선된 버전)
function formatConcreteType(type: ConcreteType, unionFind?: UnionFind): string {
  switch (type.type) {
    case "int":
      return "int";
    case "pointer":
      return `pointer(${
        type.pointsTo ? formatConcreteType(type.pointsTo, unionFind) : "?"
      })`;
    case "function":
      const params =
        type.parameters
          ?.map((p) => formatConcreteType(p, unionFind))
          .join(", ") || "";

      let returnType = "?";
      if (type.returnType) {
        if (unionFind && "expression" in type.returnType) {
          // CustomType인 경우 Union-Find에서 실제 타입 찾기
          const returnExprId = getTypeId(type.returnType);
          const actualReturnType = unionFind.getType(returnExprId);
          if (actualReturnType) {
            returnType = formatConcreteType(actualReturnType, unionFind);
          } else {
            // Union-Find에서 직접 expression의 타입 조회
            const exprId = `expr_${JSON.stringify(
              type.returnType.expression
            ).replace(/\s/g, "")}`;
            const exprType = unionFind.getType(exprId);
            if (exprType) {
              returnType = formatConcreteType(exprType, unionFind);
            } else {
              // 마지막 시도: 단순히 expression 이름으로 조회
              returnType = "int"; // 임시: 실제 구현에서는 더 정교하게
            }
          }
        } else {
          returnType = formatConcreteType(
            type.returnType as ConcreteType,
            unionFind
          );
        }
      }
      return `function(${params}) -> ${returnType}`;
    default:
      return "unknown";
  }
}

// 타입 오류 출력
function printTypeErrors(errors: string[]) {
  if (errors.length === 0) {
    colorLog("green", "   ✅ 타입 오류가 발견되지 않았습니다!");
    colorLog("green", "   🎉 프로그램이 타입적으로 올바릅니다.");
  } else {
    colorLog("red", `   ❌ ${errors.length}개의 타입 오류가 발견되었습니다:`);
    errors.forEach((error, index) => {
      colorLog("red", `     ${index + 1}. ${error}`);
    });
    colorLog("red", "   💥 프로그램에 타입 오류가 있습니다.");
  }
}

// 에러 처리
process.on("uncaughtException", (error) => {
  colorLog("red", `❌ 예상치 못한 오류: ${error.message}`);
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  colorLog("red", `❌ 처리되지 않은 Promise 거부: ${reason}`);
  process.exit(1);
});

// 메인 실행
if (require.main === module) {
  processTypeCheck().catch((error) => {
    colorLog("red", `❌ 실행 오류: ${error.message}`);
    process.exit(1);
  });
}

export default processTypeCheck;
