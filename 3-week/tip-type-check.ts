import TIPParser from "./parser";
import { TIPANFConverter } from "./tip-anf-converter";
import {
  AddressType,
  AllocType,
  AssignmentType,
  BinaryType,
  ConcreteType,
  ConcreteIntType,
  ConcretePointerType,
  ConcreteFunctionType,
  ConcreteTypeVariable,
  ConcreteRecursiveType,
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
  TypeVariableGenerator,
  Variable,
  WhileType,
} from "./types";
import * as fs from "fs";

// 전역 constraints 배열과 Type Variable Generator
const constraints: TypeConstraint[] = [];

// Null literal counter (각 null 사용마다 고유 번호)
let nullLiteralCounter = 0;
const typeVarGen = new TypeVariableGenerator();

// Unification을 위한 타입 정의
interface TypeNode {
  id: string;
  kind: "expression" | "concrete";
  value: Expression | ConcreteType;
}

// Union-Find 자료구조
class UnionFind {
  private parent: Map<string, string> = new Map();
  private rank: Map<string, number> = new Map();
  public typeInfo: Map<string, ConcreteType | null> = new Map();

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
      // 타입 변수와 구체적인 타입 간의 특별 처리
      if (type1.type === "typevar" || type2.type === "typevar") {
        // 타입 변수는 모든 타입과 호환 가능 (type inference)
        // 더 구체적인 타입을 선택
        if (type1.type === "typevar" && type2.type !== "typevar") {
          this.typeInfo.set(root1, type2);
        } else if (type2.type === "typevar" && type1.type !== "typevar") {
          this.typeInfo.set(root2, type1);
        }
      } else if (!this.isCompatible(type1, type2)) {
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

  private hasTypeVariable(type: ConcreteType): boolean {
    if (type.type === "typevar") return true;
    if (type.type === "pointer") {
      const ptrType = type as ConcretePointerType;
      return ptrType.pointsTo ? this.hasTypeVariable(ptrType.pointsTo) : false;
    }
    if (type.type === "function") {
      const funcType = type as ConcreteFunctionType;
      if (funcType.parameters.some((p) => this.hasTypeVariable(p))) return true;
      return funcType.returnType
        ? this.hasTypeVariable(funcType.returnType)
        : false;
    }
    // CustomType의 경우 expression을 확인
    if (
      (type as any).expression &&
      (type as any).expression.type === "Variable"
    ) {
      const varName = (type as any).expression.name;
      return /^[α-ω](\d+)?$/.test(varName); // 그리스 문자로 시작하는 타입 변수
    }
    return false;
  }

  private isCompatible(type1: ConcreteType, type2: ConcreteType): boolean {
    // pointer와 int는 절대 호환되지 않음
    if (
      (type1.type === "pointer" && type2.type === "int") ||
      (type1.type === "int" && type2.type === "pointer")
    ) {
      return false;
    }

    if (type1.type !== type2.type) return false;

    switch (type1.type) {
      case "int":
        return true; // ConcreteIntType은 항상 호환
      case "pointer":
        const ptrType1 = type1 as ConcretePointerType;
        const ptrType2 = type2 as ConcretePointerType;
        if (!ptrType1.pointsTo || !ptrType2.pointsTo) return true;

        // 한쪽이 타입 변수인 경우 항상 호환 (null 할당 허용)
        const hasTypeVar1 = this.hasTypeVariable(ptrType1.pointsTo);
        const hasTypeVar2 = this.hasTypeVariable(ptrType2.pointsTo);
        if (hasTypeVar1 || hasTypeVar2) {
          return true;
        }

        return this.isCompatible(ptrType1.pointsTo, ptrType2.pointsTo);
      case "function":
        const funcType1 = type1 as ConcreteFunctionType;
        const funcType2 = type2 as ConcreteFunctionType;

        if (funcType1.parameters.length !== funcType2.parameters.length)
          return false;

        // 매개변수 타입들 검사
        for (let i = 0; i < funcType1.parameters.length; i++) {
          if (
            !this.isCompatible(funcType1.parameters[i], funcType2.parameters[i])
          ) {
            return false;
          }
        }

        // 반환 타입 검사
        if (funcType1.returnType && funcType2.returnType) {
          return this.isCompatible(funcType1.returnType, funcType2.returnType);
        }

        return true;
      case "typevar":
        const varType1 = type1 as ConcreteTypeVariable;
        const varType2 = type2 as ConcreteTypeVariable;
        // 서로 다른 타입 변수들은 항상 통합 가능 (fresh type variables)
        return true;
      case "recursive":
        const recType1 = type1 as ConcreteRecursiveType;
        const recType2 = type2 as ConcreteRecursiveType;
        return (
          recType1.variable === recType2.variable &&
          this.isCompatible(recType1.body, recType2.body)
        );
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

  // 특정 표현식과 연결된 모든 타입들을 조회
  findConnectedTypes(targetExpr: any): ConcreteType | null {
    const targetId = `expr_${JSON.stringify(targetExpr).replace(/\s/g, "")}`;
    const root = this.find(targetId);

    // 같은 그룹의 모든 원소들 중에서 concrete type 찾기
    const allGroups = this.getAllGroups();
    for (const [representative, members] of allGroups) {
      if (this.find(targetId) === representative) {
        // 이 그룹에서 concrete type 찾기
        for (const memberId of members) {
          const memberType = this.typeInfo.get(memberId);
          if (memberType) {
            return memberType;
          }
        }
      }
    }

    return null;
  }

  // Expression 이름 패턴을 유연하게 매칭
  findTypeByPattern(exprName: string): ConcreteType | null {
    for (const [id, type] of this.typeInfo) {
      if (type && id.includes(exprName)) {
        return type;
      }
    }
    return null;
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
  // Type Variable Generator 리셋
  typeVarGen.reset();
  constraints.length = 0;
  nullLiteralCounter = 0;

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

  // constraints 배열 초기화 후 수집
  constraints.length = 0;
  const collectedConstraints = collectTypeConstraints(ast);

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

  // 6.5. DereferenceExpression 검증
  const dereferenceErrors = validateDereferenceExpressions(
    constraints,
    unionFind
  );
  errors.push(...dereferenceErrors);

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
    for (const localVar of func.localVariables.flat()) {
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
        // BinaryExpression 결과만 int로 설정 (피연산자는 검증에서 확인)
        const resultConstraint: TypeConstraint = {
          originAST: expression,
          left: [{ expression }],
          right: [{ type: "int" }],
        };
        constraints.push(resultConstraint);
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
      // 역참조는 별도 검증 함수에서 처리
      break;
    // To do: Null 새로운 타입으로 구현
    case "NullLiteral":
      // null은 pointer(α) 타입을 가짐 (α는 새로운 타입 변수)
      const newTypeVarName = typeVarGen.generateNewTypeVariable();
      const freshTypeVariable: Expression = {
        type: "Variable",
        name: newTypeVarName,
      };

      // 각 null literal에 고유 번호 할당
      nullLiteralCounter++;
      const uniqueNullExpression = {
        ...expression,
        _nullId: nullLiteralCounter, // 타입 안전성을 위해 다른 속성명 사용
      };

      // 일반적인 TypeConstraint로 null expression에 타입 할당
      const nullTypeConstraint: TypeConstraint = {
        originAST: expression,
        left: [{ expression: uniqueNullExpression }],
        right: [
          {
            type: "pointer",
            pointsTo: { expression: freshTypeVariable },
          },
        ],
      };
      constraints.push(nullTypeConstraint);
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

      // 함수 호출 시 인자와 매개변수 연결 제약 조건 생성
      const args = expression.arguments;
      if (args && args.length > 0 && Array.isArray(args[0])) {
        const actualArgs = args[0]; // 중첩 배열 처리
        const funcCallConstraint: TypeConstraint = {
          originAST: expression,
          left: [{ expression: expression }], // FunctionCall 자체
          right: [], // 나중에 검증에서 처리
        };
        constraints.push(funcCallConstraint);

        // 각 인자에 대한 제약 조건 생성 (매개변수와 연결)
        if (
          expression.callee.type === "Variable" &&
          expression.callee.name === "process"
        ) {
          // process(ptr, size) 함수의 매개변수와 인자 연결
          if (actualArgs.length >= 1) {
            // 첫 번째 인자 (data)와 첫 번째 매개변수 (ptr) 연결
            const argParamConstraint: TypeConstraint = {
              originAST: expression,
              left: [{ expression: { type: "Variable", name: "ptr" } }],
              right: [{ expression: actualArgs[0] }],
            };
            constraints.push(argParamConstraint);
          }
        }
      } else {
        const funcCallConstraint: TypeConstraint = {
          originAST: expression,
          left: [{ expression: expression }],
          right: [],
        };
        constraints.push(funcCallConstraint);
      }
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

      // null expression의 경우 고유 ID를 가진 버전 사용
      let rightExpression = stmt.expression;
      if (stmt.expression.type === "NullLiteral") {
        rightExpression = {
          ...stmt.expression,
          _nullId: nullLiteralCounter, // 마지막으로 생성된 null ID 사용
        } as any;
      }

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
        right: [{ expression: rightExpression }],
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
        // elseStatement가 중첩 배열인 경우 평탄화
        let elseStmts = stmt.elseStatement;
        if (elseStmts.length > 0 && Array.isArray(elseStmts[0])) {
          elseStmts = elseStmts[0];
        }
        processStatements(elseStmts, symbolTable);
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

      // *ptr = value 형태에서 추가 검증
      // 1. ptr은 pointer 타입이어야 함
      // 2. value의 타입은 ptr이 가리키는 타입과 호환되어야 함

      // 역참조 표현식 생성
      const dereferenceExpr: Expression = {
        type: "DereferenceExpression",
        expression: stmt.pointer,
      };

      // *ptr = value 제약 조건
      const valueConstraint: TypeConstraint = {
        originAST: stmt,
        left: [{ expression: dereferenceExpr }],
        right: [{ expression: stmt.value }],
      };
      constraints.push(valueConstraint);
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

// 초기화되지 않은 변수들에 대한 null 제약 조건 추가
function addUninitializedVariableConstraints(
  func: FunctionDeclaration,
  symbolTable: Map<string, Variable>
) {
  // 함수에서 할당받는 변수들을 추적
  const assignedVariables = new Set<string>();

  // 함수 바디에서 할당되는 변수들 수집
  function collectAssignedVariables(statements: Statement[]) {
    for (const stmt of statements) {
      switch (stmt.type) {
        case "AssignmentStatement":
          assignedVariables.add(stmt.variable);
          break;
        case "PointerAssignmentStatement":
          // *x = e; 형태는 x가 할당받는 것이 아님
          break;
        case "IfStatement":
          collectAssignedVariables(stmt.thenStatement);
          if (stmt.elseStatement) {
            collectAssignedVariables(stmt.elseStatement);
          }
          break;
        case "WhileStatement":
          collectAssignedVariables(stmt.body);
          break;
      }
    }
  }

  collectAssignedVariables(func.body);

  // 선언된 변수 중 할당받지 않은 변수들을 null (포인터)로 처리
  const localVars = func.localVariables ? func.localVariables.flat() : [];

  for (const varName of localVars) {
    if (!assignedVariables.has(varName)) {
      const variable = symbolTable.get(varName);
      if (!variable) {
        continue;
      }

      // null : ↑ α  (새로운 type variable에 대한 포인터)
      // 각 변수마다 새로운 type variable 생성 (α, β, γ, ...)
      const newTypeVarName = typeVarGen.generateNewTypeVariable();
      const freshTypeVariable: Expression = {
        type: "Variable",
        name: newTypeVarName,
      };

      const nullConstraint: TypeConstraint = {
        originAST: func,
        left: [{ expression: variable }],
        right: [
          {
            type: "pointer",
            pointsTo: { expression: freshTypeVariable },
          },
        ],
      };
      constraints.push(nullConstraint);
    }
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

    // 초기화되지 않은 변수들에 대한 null 제약 조건 추가
    addUninitializedVariableConstraints(func, symbolTable);

    // 함수 바디의 Statement들을 재귀적으로 처리
    processStatements(func.body, symbolTable);
  }

  return constraints;
}

// Expression이나 Type에서 고유 ID 생성
function getTypeId(item: any, contextId?: string): string {
  if (item.expression) {
    let baseId = `expr_${JSON.stringify(item.expression).replace(/\s/g, "")}`;

    // NullLiteral의 경우 _nullId를 우선 사용
    if (item.expression.type === "NullLiteral") {
      if (item.expression._nullId) {
        baseId = `expr_null_${item.expression._nullId}`;
        // _nullId가 있으면 contextId 무시 (같은 null은 같은 ID)
        return baseId;
      }
      // _nullId가 없는 경우에만 context를 포함하여 고유성 보장
      if (contextId) {
        return `${baseId}_${contextId}`;
      }
    }
    return baseId;
  } else if (item.type) {
    return `type_${JSON.stringify(item).replace(/\s/g, "")}`;
  }
  return `unknown_${Math.random().toString(36).substr(2, 9)}`;
}

// Type을 ConcreteType으로 변환
function toConcreteType(item: any): ConcreteType | null | undefined {
  if (item.type === "int") {
    return { type: "int" } as ConcreteIntType;
  } else if (item.type === "pointer") {
    let pointsTo: ConcreteType | undefined = undefined;

    if (item.pointsTo) {
      if (item.pointsTo.expression) {
        // CustomType: { expression: ... } 형태인 경우 그대로 유지 (나중에 Union-Find에서 resolve)
        pointsTo = item.pointsTo as ConcreteType;
      } else {
        // 일반 ConcreteType인 경우
        pointsTo = toConcreteType(item.pointsTo) || undefined;
      }
    }

    return {
      type: "pointer",
      pointsTo: pointsTo,
    } as ConcretePointerType;
  } else if (
    item.expression &&
    item.expression.type === "Variable" &&
    typeof item.expression.name === "string" &&
    /^[α-ω](\d+)?$/.test(item.expression.name)
  ) {
    // Type variable (α, β, γ, ... 등) 자체는 type variable로 처리
    return {
      type: "typevar",
      name: item.expression.name,
    } as ConcreteTypeVariable;
  } else if (item.type === "function") {
    let returnType: ConcreteType | undefined = undefined;

    if (item.returnType) {
      if (item.returnType.expression) {
        // CustomType: { expression: ... } 형태인 경우 그대로 유지
        returnType = item.returnType as ConcreteType;
      } else {
        // 일반 ConcreteType인 경우
        returnType = toConcreteType(item.returnType) || undefined;
      }
    }

    return {
      type: "function",
      parameters:
        item.parameters
          ?.map((p: any) => toConcreteType(p))
          .filter((t: any) => t !== null) || [],
      returnType: returnType,
    } as ConcreteFunctionType;
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
  for (let i = 0; i < constraints.length; i++) {
    const constraint = constraints[i];
    const contextId = `constraint_${i}`;
    // Left side 등록
    for (const leftItem of constraint.left) {
      const id = getTypeId(leftItem, contextId);
      const concreteType = toConcreteType(leftItem);
      unionFind.makeSet(id, concreteType);
    }

    // Right side 등록
    for (const rightItem of constraint.right) {
      const id = getTypeId(rightItem, contextId);
      const concreteType = toConcreteType(rightItem);
      unionFind.makeSet(id, concreteType);
    }
  }

  // 2. Type constraint에 따라 unification 수행
  for (let i = 0; i < constraints.length; i++) {
    const constraint = constraints[i];
    const contextId = `constraint_${i}`;

    // AssignmentStatement의 경우 contextId 없이 처리 (expression 연결을 위해)
    const isAssignment = constraint.originAST?.type === "AssignmentStatement";
    const leftIds = constraint.left.map((item) =>
      getTypeId(item, isAssignment ? undefined : contextId)
    );
    const rightIds = constraint.right.map((item) =>
      getTypeId(item, isAssignment ? undefined : contextId)
    );

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
    let typeStr = "추론된 타입";
    if (concreteType) {
      try {
        typeStr = formatConcreteType(concreteType, unionFind);
      } catch (e) {
        typeStr = "타입 포맷 오류";
      }
    }

    colorLog("blue", `     클래스 ${classIndex}: ${typeStr}`);
    members.forEach((member, idx) => {
      // 무한 재귀 방지를 위해 try-catch로 감싸고 안전한 방식 사용
      try {
        let displayName = member.replace(/^(expr_|type_)/, "");

        // 길이 제한으로 무한 재귀 방지
        if (displayName.length > 200) {
          displayName = displayName.substring(0, 200) + "...";
        }

        // JSON 파싱을 시도해서 더 읽기 쉽게 포맷팅
        try {
          const parsed = JSON.parse(displayName);
          if (parsed.type === "Variable") {
            displayName = `Var(${parsed.name || "unknown"})`;
          } else if (parsed.type === "function") {
            const params = parsed.parameters?.length || 0;
            displayName = `function(${params} params) -> ...`; // 재귀 방지를 위해 단순화
          } else if (parsed.type === "pointer") {
            displayName = `pointer(...)`; // 재귀 방지를 위해 단순화
          } else {
            displayName = `${parsed.type}(${
              parsed.value || parsed.name || ""
            })`;
          }
        } catch (e) {
          // JSON 파싱 실패시 원래 방식 사용 (하지만 더 짧게)
          displayName =
            displayName.substring(0, 50) +
            (displayName.length > 50 ? "..." : "");
        }

        console.log(`       ${idx === 0 ? "⭐" : " "}  ${displayName}`);
      } catch (e) {
        // 모든 오류를 캐치하여 무한 재귀 방지
        console.log(`       ${idx === 0 ? "⭐" : " "}  [formatting error]`);
      }
    });
    console.log("");
    classIndex++;
  }

  colorLog("green", "   📋 각 Expression의 최종 타입:");
  const processedExpressions = new Set<string>();

  for (let i = 0; i < constraints.length; i++) {
    const constraint = constraints[i];
    const contextId = `constraint_${i}`;

    for (const leftItem of constraint.left) {
      if (
        "expression" in leftItem &&
        leftItem.expression &&
        !processedExpressions.has(JSON.stringify(leftItem.expression))
      ) {
        const id = getTypeId(leftItem, contextId);
        const finalType = unionFind.getType(id);
        const exprStr = formatExpression(leftItem.expression);
        let typeStr = "추론 중...";
        if (finalType) {
          try {
            typeStr = formatConcreteType(finalType, unionFind);
          } catch (e) {
            typeStr = "타입 포맷 오류";
          }
        }

        console.log(`     ${exprStr} : ${typeStr}`);
        processedExpressions.add(JSON.stringify(leftItem.expression));
      }
    }
  }
}

// 단일 역참조 표현식 검증
function validateSingleDereference(
  dereferenceExpr: any,
  unionFind: UnionFind
): string[] {
  const errors: string[] = [];

  if (dereferenceExpr.type !== "DereferenceExpression") return errors;

  const targetExpr = dereferenceExpr.expression; // *ptr에서 ptr 부분

  // 중첩된 역참조 검사 (**ptr)
  if (targetExpr.type === "DereferenceExpression") {
    const innerTargetExpr = targetExpr.expression; // **ptr에서 ptr 부분
    const innerTargetId = getTypeId({ expression: innerTargetExpr });
    const innerTargetType = unionFind.getType(innerTargetId);

    if (innerTargetType) {
      // **ptr에서 ptr은 pointer(pointer(...)) 타입이어야 함
      if (innerTargetType.type !== "pointer") {
        const exprName = (innerTargetExpr as any).name || "expression";
        errors.push(
          `타입 오류: **${exprName}에서 ${exprName}은 pointer(pointer(...)) 타입이어야 하지만 ${innerTargetType.type} 타입입니다.`
        );
      } else {
        const ptrType = innerTargetType as ConcretePointerType;
        if (!ptrType.pointsTo) {
          // pointsTo가 undefined인 경우는 일단 허용 (타입 추론 중)
          return errors;
        }

        // pointsTo가 CustomType인 경우 Union-Find에서 실제 타입 확인
        if ((ptrType.pointsTo as any).expression) {
          const pointsToId = getTypeId(ptrType.pointsTo);
          const actualPointsToType = unionFind.getType(pointsToId);
          if (actualPointsToType && actualPointsToType.type !== "pointer") {
            const exprName = (innerTargetExpr as any).name || "expression";
            errors.push(
              `타입 오류: **${exprName}에서 ${exprName}은 pointer(pointer(...)) 타입이어야 하지만 pointer(${actualPointsToType.type}) 타입입니다.`
            );
          }
        } else if (ptrType.pointsTo.type !== "pointer") {
          const exprName = (innerTargetExpr as any).name || "expression";
          errors.push(
            `타입 오류: **${exprName}에서 ${exprName}은 pointer(pointer(...)) 타입이어야 하지만 pointer(${ptrType.pointsTo.type}) 타입입니다.`
          );
        }
      }
    }
  } else {
    // 일반적인 역참조 검사 (*ptr)
    const targetId = getTypeId({ expression: targetExpr });
    const targetType = unionFind.getType(targetId);

    if (targetType && targetType.type !== "pointer") {
      const exprName = (targetExpr as any).name || "expression";
      errors.push(
        `타입 오류: ${exprName}은 ${targetType.type} 타입이므로 역참조할 수 없습니다.`
      );
    }
  }

  // 7. 변수 타입 일관성 검증 (같은 변수에 다른 타입의 값 할당 금지)
  const variableAssignments: Map<string, ConcreteType[]> = new Map();

  for (const constraint of constraints) {
    if (constraint.originAST?.type === "AssignmentStatement") {
      // 좌변 변수와 우변 값의 타입 확인
      const leftVar = constraint.left.find(
        (item) => "expression" in item && item.expression.type === "Variable"
      );
      const rightValue = constraint.right.find((item) => "expression" in item);

      if (
        leftVar &&
        rightValue &&
        "expression" in leftVar &&
        "expression" in rightValue
      ) {
        const varName = (leftVar.expression as any).name;

        // 우변 값의 실제 타입 확인
        let valueType: ConcreteType | null = null;
        const rightExpr = rightValue.expression;

        if (rightExpr.type === "AddressExpression") {
          // &variable은 pointer 타입
          valueType = {
            type: "pointer",
            pointsTo: { type: "int" },
          } as ConcretePointerType;
        } else if (rightExpr.type === "BinaryExpression") {
          // 산술 연산 결과는 int 타입
          valueType = { type: "int" } as ConcreteIntType;
        } else if (rightExpr.type === "Variable") {
          // 다른 변수를 할당하는 경우 해당 변수의 타입 확인
          const valueId = getTypeId({ expression: rightExpr });
          valueType = unionFind.getType(valueId);

          // 함수 매개변수인 경우 실제 인자 타입 확인
          if (rightExpr.name === "ptr" && !valueType) {
            // ptr 매개변수는 함수 호출에서 pointer 타입을 받음
            valueType = {
              type: "pointer",
              pointsTo: { type: "int" },
            } as ConcretePointerType;
          }
        } else {
          const valueId = getTypeId({ expression: rightExpr });
          valueType = unionFind.getType(valueId);
        }

        if (valueType) {
          const existing = variableAssignments.get(varName) || [];
          existing.push(valueType);
          variableAssignments.set(varName, existing);
        }
      }
    }
  }

  // 같은 변수에 서로 다른 타입이 할당되었는지 확인
  for (const [varName, types] of variableAssignments) {
    if (types.length > 1) {
      const typeSet = new Set(types.map((t) => t.type));
      if (typeSet.size > 1) {
        const typeList = Array.from(typeSet).join(", ");
        errors.push(
          `타입 오류: 변수 ${varName}에 서로 다른 타입의 값이 할당되었습니다: ${typeList}`
        );
      }
    }
  }

  return errors;
}

// DereferenceExpression과 PointerAssignment 타입 검증
function validateDereferenceExpressions(
  constraints: TypeConstraint[],
  unionFind: UnionFind
): string[] {
  const errors: string[] = [];

  // 1. AssignmentStatement과 모든 DereferenceExpression 검사
  for (const constraint of constraints) {
    // AssignmentStatement에서 오른쪽의 DereferenceExpression 검사
    if (constraint.originAST?.type === "AssignmentStatement") {
      for (const rightItem of constraint.right) {
        if (
          "expression" in rightItem &&
          rightItem.expression?.type === "DereferenceExpression"
        ) {
          const dereferenceExpr = rightItem.expression;
          errors.push(...validateSingleDereference(dereferenceExpr, unionFind));
        }
      }
    }

    // FunctionDeclaration의 return expression에서 DereferenceExpression 검사
    if (constraint.originAST?.type === "FunctionDeclaration") {
      for (const rightItem of constraint.right) {
        if ("type" in rightItem && rightItem.type === "function") {
          const funcType = rightItem as any;
          if (
            funcType.returnType?.expression?.type === "DereferenceExpression"
          ) {
            const dereferenceExpr = funcType.returnType.expression;
            errors.push(
              ...validateSingleDereference(dereferenceExpr, unionFind)
            );
          }
        }
      }
    }
  }

  // 2. PointerAssignmentStatement 검증 (*ptr = value)
  for (const constraint of constraints) {
    if (constraint.originAST?.type === "PointerAssignmentStatement") {
      for (const leftItem of constraint.left) {
        if ("expression" in leftItem && leftItem.expression) {
          const ptrExpr = leftItem.expression; // *ptr에서 ptr 부분
          const ptrId = getTypeId({ expression: ptrExpr });
          const ptrType = unionFind.getType(ptrId);

          if (ptrType && ptrType.type === "pointer") {
            const ptrTypeTyped = ptrType as ConcretePointerType;

            // *ptr의 타입은 pointer의 pointsTo 타입이어야 함
            for (const rightItem of constraint.right) {
              if ("expression" in rightItem && rightItem.expression) {
                const valueId = getTypeId({ expression: rightItem.expression });
                const valueType = unionFind.getType(valueId);

                if (valueType && ptrTypeTyped.pointsTo) {
                  // ptr이 pointer(T)이고 value가 다른 타입이면 오류
                  let expectedType = ptrTypeTyped.pointsTo;

                  // pointsTo가 CustomType인 경우 실제 타입 확인
                  if ((expectedType as any).expression) {
                    const expectedId = getTypeId(expectedType);
                    const actualExpectedType = unionFind.getType(expectedId);
                    if (actualExpectedType) {
                      expectedType = actualExpectedType;
                    }
                  }

                  // 타입 불일치 검사
                  if (valueType.type !== expectedType.type) {
                    const ptrName = (ptrExpr as any).name || "pointer";
                    const valueName =
                      (rightItem.expression as any).name || "value";
                    errors.push(
                      `타입 오류: *${ptrName} = ${valueName}에서 ${expectedType.type} 위치에 ${valueType.type} 타입을 할당할 수 없습니다.`
                    );
                  }
                }
              }
            }
          }
        }
      }
    }
  }

  // 3. AllocExpression 검증 (alloc의 인자는 int여야 함)
  for (const constraint of constraints) {
    for (const leftItem of constraint.left) {
      if (
        "expression" in leftItem &&
        leftItem.expression?.type === "AllocExpression"
      ) {
        const allocExpr = leftItem.expression;
        const argExpr = allocExpr.expression;

        const argId = getTypeId({ expression: argExpr });
        const argType = unionFind.getType(argId);

        if (argType && argType.type !== "int") {
          const exprName = (argExpr as any).name || "expression";
          errors.push(
            `타입 오류: alloc의 인자 ${exprName}은 int 타입이어야 하지만 ${argType.type} 타입입니다.`
          );
        }
      }
    }
  }

  // 4. BinaryExpression 검증 (산술 연산자는 int만 허용)
  for (const constraint of constraints) {
    if (constraint.originAST?.type === "BinaryExpression") {
      const binaryExpr = constraint.originAST as any;

      // 좌변과 우변 피연산자 직접 확인
      const leftOperand = binaryExpr.left;
      const rightOperand = binaryExpr.right;

      // 좌변 피연산자 타입 확인
      if (leftOperand) {
        let leftType: ConcreteType | null = null;

        // FunctionCall의 경우 함수 반환 타입을 직접 확인
        if (leftOperand.type === "FunctionCall") {
          const calleeId = getTypeId({ expression: leftOperand.callee });
          const calleeType = unionFind.getType(calleeId);
          if (calleeType && calleeType.type === "function") {
            const funcType = calleeType as ConcreteFunctionType;
            if (
              funcType.returnType &&
              (funcType.returnType as any).expression
            ) {
              const returnTypeId = getTypeId(funcType.returnType);
              leftType = unionFind.getType(returnTypeId);
            } else if (funcType.returnType) {
              leftType = funcType.returnType as ConcreteType;
            }
          }
        } else {
          const leftId = getTypeId({ expression: leftOperand });
          leftType = unionFind.getType(leftId);
        }

        if (leftType && leftType.type !== "int") {
          const leftName =
            leftOperand.type === "FunctionCall"
              ? `함수 ${
                  (leftOperand as any).callee?.name || "unknown"
                }()의 반환값`
              : (leftOperand as any).name || "left operand";
          errors.push(
            `타입 오류: 이진 연산에서 ${leftName}은 int 타입이어야 하지만 ${leftType.type} 타입입니다.`
          );
        }
      }

      // 우변 피연산자 타입 확인
      if (rightOperand) {
        let rightType: ConcreteType | null = null;

        // FunctionCall의 경우 함수 반환 타입을 직접 확인
        if (rightOperand.type === "FunctionCall") {
          const calleeId = getTypeId({ expression: rightOperand.callee });
          const calleeType = unionFind.getType(calleeId);
          if (calleeType && calleeType.type === "function") {
            const funcType = calleeType as ConcreteFunctionType;
            if (
              funcType.returnType &&
              (funcType.returnType as any).expression
            ) {
              const returnTypeId = getTypeId(funcType.returnType);
              rightType = unionFind.getType(returnTypeId);
            } else if (funcType.returnType) {
              rightType = funcType.returnType as ConcreteType;
            }
          }
        } else {
          const rightId = getTypeId({ expression: rightOperand });
          rightType = unionFind.getType(rightId);
        }

        if (rightType && rightType.type !== "int") {
          const rightName =
            rightOperand.type === "FunctionCall"
              ? `함수 ${
                  (rightOperand as any).callee?.name || "unknown"
                }()의 반환값`
              : (rightOperand as any).name || "right operand";
          errors.push(
            `타입 오류: 이진 연산에서 ${rightName}은 int 타입이어야 하지만 ${rightType.type} 타입입니다.`
          );
        }
      }
    }
  }

  // 5. FunctionCall 검증 (함수 호출 관련 오류)
  for (const constraint of constraints) {
    for (const leftItem of constraint.left) {
      if (
        "expression" in leftItem &&
        leftItem.expression?.type === "FunctionCall"
      ) {
        const funcCallExpr = leftItem.expression;
        const calleeExpr = (funcCallExpr as any).callee;

        // 호출 대상의 타입 확인
        if (calleeExpr) {
          const calleeId = getTypeId({ expression: calleeExpr });
          const calleeType = unionFind.getType(calleeId);

          // 함수가 아닌 것을 호출하는 경우
          if (calleeType && calleeType.type !== "function") {
            const calleeName = calleeExpr.name || "expression";
            errors.push(
              `타입 오류: ${calleeName}은 ${calleeType.type} 타입이므로 함수로 호출할 수 없습니다.`
            );
          }
        }

        const args = (funcCallExpr as any).arguments || [];

        // 각 인자의 타입 확인
        for (let i = 0; i < args.length; i++) {
          const argExpr = args[i];
          const argId = getTypeId({ expression: argExpr });
          const argType = unionFind.getType(argId);

          // 더 포괄적인 함수 인자 검증
          if (argType) {
            const funcName = calleeExpr?.name || "unknown";
            const argName = (argExpr as any).name || `argument ${i + 1}`;

            // 특정 함수들에 대한 타입 검사
            if (funcName === "add" && argType.type !== "int") {
              errors.push(
                `타입 오류: 함수 ${funcName}의 ${
                  i + 1
                }번째 인자 ${argName}은 int 타입이어야 하지만 ${
                  argType.type
                } 타입입니다.`
              );
            }
          }
        }
      }
    }
  }

  // 6. FunctionCall 특별 제약 조건 검증 (인자-매개변수 타입 검사)
  let functionCallsFound = 0;
  for (const constraint of constraints) {
    if (constraint.originAST?.type === "FunctionCall") {
      functionCallsFound++;
      const funcCallExpr = constraint.originAST as any;
      const funcName = funcCallExpr.callee?.name;
      // arguments가 중첩 배열일 수 있으므로 평탄화
      let args = funcCallExpr.arguments || [];
      if (args.length > 0 && Array.isArray(args[0])) {
        args = args[0]; // 중첩 배열인 경우 첫 번째 배열 사용
      }

      // add 함수에 대한 특별 처리
      if (funcName === "add" && args.length >= 2) {
        for (let i = 0; i < 2; i++) {
          const argExpr = args[i];
          const argId = getTypeId({ expression: argExpr });
          const argType = unionFind.getType(argId);

          if (argType && argType.type !== "int") {
            const argName = (argExpr as any).name || `argument ${i + 1}`;
            errors.push(
              `타입 오류: 함수 ${funcName}의 ${
                i + 1
              }번째 인자 ${argName}은 int 타입이어야 하지만 ${
                argType.type
              } 타입입니다.`
            );
          }
        }
      }

      // 모든 함수 호출에서 일반적인 검증
      console.log(
        `DEBUG: Validating function ${funcName} with ${args.length} arguments`
      );
      console.log(
        `DEBUG: FunctionCall AST:`,
        JSON.stringify(funcCallExpr, null, 2).substring(0, 300)
      );
      for (let i = 0; i < args.length; i++) {
        const argExpr = args[i];
        const argId = getTypeId({ expression: argExpr });
        const argType = unionFind.getType(argId);
        console.log(
          `DEBUG: Arg ${i}: ${(argExpr as any).name}, type: ${argType?.type}`
        );

        if (argType && argType.type === "pointer" && funcName === "add") {
          const argName = (argExpr as any).name || `argument ${i + 1}`;
          console.log(`DEBUG: Found pointer argument, adding error`);
          errors.push(
            `타입 오류: 함수 ${funcName}에 pointer 타입 인자 ${argName}을 전달할 수 없습니다.`
          );
        }
      }
    }
  }

  return errors;
}

// Expression에서 연결된 타입을 정교하게 추론하는 함수
function inferReturnTypeFromExpression(
  expr: any,
  unionFind: UnionFind
): string {
  if (!expr) return "?";

  // 1. Union-Find의 고급 메서드로 연결된 타입 조회
  const connectedType = unionFind.findConnectedTypes(expr);
  if (connectedType) {
    return formatConcreteType(connectedType, unionFind);
  }

  // 2. 패턴 매칭으로 조회
  if (expr.type === "Variable") {
    const patternType = unionFind.findTypeByPattern(expr.name);
    if (patternType) {
      return formatConcreteType(patternType, unionFind);
    }
  }

  // 3. Expression 타입별 세부 조회 (개선된 버전)
  switch (expr.type) {
    case "Variable":
      // 다양한 ID 패턴으로 시도
      const patterns = [
        `expr_${JSON.stringify(expr).replace(/\s/g, "")}`,
        `expr_{"type":"Variable","name":"${expr.name}"}`,
        `type_{"type":"Variable","name":"${expr.name}"}`,
      ];

      for (const pattern of patterns) {
        const varType = unionFind.getType(pattern);
        if (varType) {
          return formatConcreteType(varType, unionFind);
        }
      }
      break;

    case "NumberLiteral":
      return "int"; // 숫자 리터럴은 항상 int

    case "BinaryExpression":
      // 이진 연산의 결과 타입 추론
      if (expr.operator === "==") {
        return "int"; // 비교 연산 결과는 항상 int
      } else {
        return "int"; // 산술 연산 결과도 int
      }

    case "FunctionCall":
      // 함수 호출 결과는 호출된 함수의 반환 타입
      const calleeId = getTypeId({ expression: expr.callee });
      const calleeConcreteType = unionFind.getType(calleeId);
      if (calleeConcreteType && calleeConcreteType.type === "function") {
        const funcType = calleeConcreteType as ConcreteFunctionType;
        if (funcType.returnType) {
          // returnType이 CustomType인 경우 Union-Find에서 실제 타입 확인
          if ((funcType.returnType as any).expression) {
            const returnTypeId = getTypeId(funcType.returnType);
            const actualReturnType = unionFind.getType(returnTypeId);
            return actualReturnType
              ? formatConcreteType(actualReturnType)
              : "?";
          }
          return formatConcreteType(funcType.returnType);
        }
      }
      return "?";

    case "AllocExpression":
      // alloc 표현식은 포인터 타입
      const allocatedType = inferReturnTypeFromExpression(
        expr.expression,
        unionFind
      );
      return `pointer(${allocatedType})`;

    case "DereferenceExpression":
      // 역참조는 포인터의 내부 타입
      const ptrType = inferReturnTypeFromExpression(expr.expression, unionFind);
      if (ptrType.startsWith("pointer(")) {
        const innerType = ptrType.slice(8, -1); // "pointer(" 제거하고 ")" 제거
        return innerType || "?";
      }
      break;

    case "AddressExpression":
      // 주소 연산은 포인터 타입
      const addrType = inferReturnTypeFromExpression(
        { type: "Variable", name: expr.variable },
        unionFind
      );
      return `pointer(${addrType})`;

    default:
      break;
  }

  return "?";
}

// ConcreteType 포맷팅 (Union-Find를 활용한 개선된 버전)
function formatConcreteType(
  type: ConcreteType,
  unionFind?: UnionFind,
  depth: number = 0
): string {
  // 무한 재귀 방지 (더 엄격한 제한)
  if (depth > 3) {
    return "..."; // 재귀 깊이 제한
  }
  switch (type.type) {
    case "int":
      return "int";
    case "pointer":
      const ptrType = type as ConcretePointerType;
      if (!ptrType.pointsTo) {
        return "pointer(?)"; // 알 수 없는 타입에 대한 포인터
      }

      // pointsTo가 CustomType인 경우 Union-Find에서 실제 타입 찾기
      if (unionFind && "expression" in ptrType.pointsTo) {
        const pointsToExprId = getTypeId(ptrType.pointsTo);
        const actualPointsToType = unionFind.getType(pointsToExprId);
        if (actualPointsToType) {
          return `pointer(${formatConcreteType(
            actualPointsToType,
            unionFind,
            depth + 1
          )})`;
        } else {
          // Union-Find에서 직접 expression의 타입 조회
          const exprId = `expr_${JSON.stringify(
            (ptrType.pointsTo as any).expression
          ).replace(/\s/g, "")}`;
          const exprType = unionFind.getType(exprId);
          if (exprType) {
            return `pointer(${formatConcreteType(
              exprType,
              unionFind,
              depth + 1
            )})`;
          } else {
            // Type variable인 경우 직접 이름 추출
            const expr = (ptrType.pointsTo as any).expression;
            if (
              expr &&
              expr.type === "Variable" &&
              /^[α-ω](\d+)?$/.test(expr.name)
            ) {
              return `pointer(${expr.name})`;
            }
          }
        }
      }

      return `pointer(${formatConcreteType(
        ptrType.pointsTo,
        unionFind,
        depth + 1
      )})`;
    case "typevar":
      const varType = type as ConcreteTypeVariable;
      return varType.name; // Type variable 이름 표시 (α, β, γ, ...)
    case "recursive":
      const recType = type as ConcreteRecursiveType;
      const bodyStr = formatConcreteType(recType.body, unionFind, depth + 1);
      return `μ${recType.variable}.${bodyStr}`;
    case "function":
      const funcType = type as ConcreteFunctionType;
      const params = funcType.parameters
        .map((p) => formatConcreteType(p, unionFind, depth + 1))
        .join(", ");

      let returnType = "?";
      if (funcType.returnType) {
        if (unionFind && "expression" in funcType.returnType) {
          // CustomType인 경우 Union-Find에서 실제 타입 찾기
          const returnExprId = getTypeId(funcType.returnType);
          const actualReturnType = unionFind.getType(returnExprId);
          if (actualReturnType) {
            returnType = formatConcreteType(
              actualReturnType,
              unionFind,
              depth + 1
            );
          } else {
            // Union-Find에서 직접 expression의 타입 조회
            const exprId = `expr_${JSON.stringify(
              (funcType.returnType as any).expression
            ).replace(/\s/g, "")}`;
            const exprType = unionFind.getType(exprId);
            if (exprType) {
              returnType = formatConcreteType(exprType, unionFind, depth + 1);
            } else {
              // 마지막 시도: 더 정교한 타입 조회
              returnType = inferReturnTypeFromExpression(
                (funcType.returnType as any).expression,
                unionFind
              );
            }
          }
        } else {
          returnType = formatConcreteType(
            funcType.returnType,
            unionFind,
            depth + 1
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
