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
          right: [{ expression: expression }, { type: "int" }],
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
