import {
  AddressType,
  AllocType,
  AssignmentType,
  BinaryType,
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

/**
 * 타입 제약 조건 수집기
 * AST를 순회하면서 타입 제약 조건들을 수집합니다.
 */
export class ConstraintCollector {
  private constraints: TypeConstraint[] = [];
  private typeVarGen: TypeVariableGenerator;
  private nullLiteralCounter: number = 0;
  private currentFunction: string | null = null; // 현재 처리 중인 함수명

  constructor() {
    this.typeVarGen = new TypeVariableGenerator();
  }

  /**
   * 제약 조건 수집을 초기화합니다.
   */
  reset(): void {
    this.constraints.length = 0;
    this.nullLiteralCounter = 0;
    this.currentFunction = null;
    this.typeVarGen.reset();
  }

  /**
   * 수집된 제약 조건들을 반환합니다.
   */
  getConstraints(): TypeConstraint[] {
    return this.constraints;
  }

  /**
   * 프로그램 전체에서 타입 제약 조건을 수집합니다.
   * @param ast 파싱된 AST
   * @returns 수집된 타입 제약 조건들
   */
  collectTypeConstraints(ast: Program): TypeConstraint[] {
    this.reset();

    for (const func of ast.functions) {
      this.collectFunctionConstraints(func);
    }

    return this.constraints;
  }

  /**
   * 함수에서 타입 제약 조건을 수집합니다.
   * @param func 함수 선언
   */
  private collectFunctionConstraints(func: FunctionDeclaration): void {
    // 현재 함수 설정 (재귀 감지용)
    this.currentFunction = func.name;

    const symbolTable = this.buildSymbolTable(func);

    // 함수 반환 표현식 제약 조건
    this.addExpressionConstraint(func.returnExpression, symbolTable);

    // 재귀 함수인지 확인
    const isRecursive = this.isRecursiveFunction(func);

    // 함수 타입 제약 조건
    if (isRecursive) {
      // 재귀 함수인 경우 recursive type으로 처리
      const recursiveVar = this.typeVarGen.generateNewTypeVariable();
      const functionConstraint: FunctionDeclarationType = {
        originAST: func,
        left: [{ expression: { type: "Variable", name: func.name } }],
        right: [
          {
            type: "recursive",
            variable: recursiveVar,
            body: {
              type: "function",
              parameters: func.parameters.map((param) => ({
                expression: symbolTable.get(param)!,
              })) as [{ expression: Variable }],
              returnType: { expression: func.returnExpression },
            },
          } as any,
        ],
      };
      this.constraints.push(functionConstraint);
    } else {
      // 일반 함수
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
      this.constraints.push(functionConstraint);
    }

    // 초기화되지 않은 변수들에 대한 null 제약 조건 추가
    this.addUninitializedVariableConstraints(func, symbolTable);

    // 함수 바디의 Statement들 처리
    this.processStatements(func.body, symbolTable);

    // 함수 처리 완료
    this.currentFunction = null;
  }

  /**
   * 함수의 심볼 테이블을 구축합니다.
   * @param func 함수 선언
   * @returns 심볼 테이블
   */
  private buildSymbolTable(func: FunctionDeclaration): Map<string, Variable> {
    const symbolTable = new Map<string, Variable>();

    // 매개변수 등록
    for (const param of func.parameters) {
      const paramVar: Variable = {
        type: "Variable",
        name: param,
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

  /**
   * 표현식에서 타입 제약 조건을 수집합니다.
   * @param expression 표현식
   * @param symbolTable 심볼 테이블
   */
  private addExpressionConstraint(
    expression: Expression,
    symbolTable: Map<string, Variable>
  ): void {
    if (!expression || !expression.type) {
      console.warn("Invalid expression:", expression);
      return;
    }

    switch (expression.type) {
      case "NumberLiteral":
        this.addNumberLiteralConstraint(expression);
        break;

      case "BinaryExpression":
        this.addBinaryExpressionConstraint(expression, symbolTable);
        break;

      case "InputExpression":
        this.addInputExpressionConstraint(expression);
        break;

      case "AllocExpression":
        this.addAllocExpressionConstraint(expression, symbolTable);
        break;

      case "AddressExpression":
        this.addAddressExpressionConstraint(expression, symbolTable);
        break;

      case "DereferenceExpression":
        this.addExpressionConstraint(expression.expression, symbolTable);
        break;

      case "NullLiteral":
        this.addNullLiteralConstraint(expression);
        break;

      case "Variable":
        // 변수 참조는 별도 제약 조건 생성 없음
        break;

      case "FunctionCall":
        this.addFunctionCallConstraint(expression, symbolTable);
        break;

      case "UnaryExpression":
        this.addExpressionConstraint(expression.operand, symbolTable);
        break;

      case "ObjectLiteral":
        // properties가 중첩 배열일 수 있으므로 평면화
        const flatProps = Array.isArray(expression.properties[0])
          ? expression.properties[0]
          : expression.properties;

        flatProps.forEach((prop) => {
          if (prop && prop.value) {
            this.addExpressionConstraint(prop.value, symbolTable);
          }
        });
        this.addObjectLiteralConstraint(expression, symbolTable);
        break;

      case "PropertyAccess":
        this.addExpressionConstraint(expression.object, symbolTable);
        this.addPropertyAccessConstraint(expression, symbolTable);
        break;
    }
  }

  /**
   * 숫자 리터럴 제약 조건을 추가합니다.
   */
  private addNumberLiteralConstraint(expression: any): void {
    const numberConstraint: NumberType = {
      originAST: expression,
      left: [{ expression: expression }],
      right: [{ type: "int" }],
    };
    this.constraints.push(numberConstraint);
  }

  /**
   * 이진 연산 표현식 제약 조건을 추가합니다.
   */
  private addBinaryExpressionConstraint(
    expression: any,
    symbolTable: Map<string, Variable>
  ): void {
    this.addExpressionConstraint(expression.left, symbolTable);
    this.addExpressionConstraint(expression.right, symbolTable);

    if (expression.operator === "==") {
      const equalConstraint: EqualType = {
        originAST: expression,
        left: [{ expression: expression.left }, { expression: expression }],
        right: [{ expression: expression.right }, { type: "int" }],
      };
      this.constraints.push(equalConstraint);
    } else {
      // 결과만 int로 설정 (피연산자는 검증에서 확인)
      const resultConstraint: TypeConstraint = {
        originAST: expression,
        left: [{ expression }],
        right: [{ type: "int" }],
      };
      this.constraints.push(resultConstraint);
    }
  }

  /**
   * 입력 표현식 제약 조건을 추가합니다.
   */
  private addInputExpressionConstraint(expression: any): void {
    const inputConstraint: InputType = {
      originAST: expression,
      left: [{ expression: expression }],
      right: [{ type: "int" }],
    };
    this.constraints.push(inputConstraint);
  }

  /**
   * 할당 표현식 제약 조건을 추가합니다.
   */
  private addAllocExpressionConstraint(
    expression: any,
    symbolTable: Map<string, Variable>
  ): void {
    this.addExpressionConstraint(expression.expression, symbolTable);
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
    this.constraints.push(allocConstraint);
  }

  /**
   * 주소 표현식 제약 조건을 추가합니다.
   */
  private addAddressExpressionConstraint(
    expression: any,
    symbolTable: Map<string, Variable>
  ): void {
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
    this.constraints.push(addressConstraint);
  }

  /**
   * null 리터럴 제약 조건을 추가합니다.
   */
  private addNullLiteralConstraint(expression: any): void {
    // null은 pointer(α) 타입을 가짐 (α는 새로운 타입 변수)
    const newTypeVarName = this.typeVarGen.generateNewTypeVariable();
    const freshTypeVariable: Expression = {
      type: "Variable",
      name: newTypeVarName,
    };

    // 각 null literal에 고유 번호 할당
    this.nullLiteralCounter++;
    const uniqueNullExpression = {
      ...expression,
      _nullId: this.nullLiteralCounter,
    };

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
    this.constraints.push(nullTypeConstraint);
  }

  /**
   * 함수 호출 제약 조건을 추가합니다.
   */
  private addFunctionCallConstraint(
    expression: any,
    symbolTable: Map<string, Variable>
  ): void {
    // 함수 호출의 인자들에 대한 제약 조건 수집
    expression.arguments.forEach((arg: any) => {
      this.addExpressionConstraint(arg, symbolTable);
    });
    this.addExpressionConstraint(expression.callee, symbolTable);

    // 함수 호출 시 인자와 매개변수 연결 제약 조건 생성
    const args = expression.arguments;
    if (args && args.length > 0 && Array.isArray(args[0])) {
      const actualArgs = args[0]; // 중첩 배열 처리

      // 함수 호출의 반환 타입을 함수의 반환 타입과 연결
      const callee = expression.callee;
      let rightSide: any[] = [];

      if (callee && callee.type === "Variable") {
        // 함수 이름에 따라 반환 타입 직접 연결
        const functionName = callee.name;

        // 현재 함수가 자기 자신을 호출하는 재귀 호출인 경우
        if (functionName === this.currentFunction) {
          // 현재 함수의 반환 타입과 동일하게 설정
          rightSide = [
            {
              expression: {
                type: "Variable",
                name: "result", // 현재 함수의 result 변수와 연결
              },
            },
          ];
        } else {
          // 일반 함수 호출
          const returnTypeVar = this.typeVarGen.generateNewTypeVariable();
          rightSide = [
            {
              expression: {
                type: "Variable",
                name: returnTypeVar,
              },
            },
          ];
        }
      }

      const funcCallConstraint: TypeConstraint = {
        originAST: expression,
        left: [{ expression: expression }],
        right: rightSide,
      };
      this.constraints.push(funcCallConstraint);

      // process 함수의 매개변수와 인자 연결
      if (
        expression.callee.type === "Variable" &&
        expression.callee.name === "process"
      ) {
        if (actualArgs.length >= 1) {
          const argParamConstraint: TypeConstraint = {
            originAST: expression,
            left: [{ expression: { type: "Variable", name: "ptr" } }],
            right: [{ expression: actualArgs[0] }],
          };
          this.constraints.push(argParamConstraint);
        }
      }
    } else {
      // 함수 호출의 반환 타입을 함수의 반환 타입과 연결
      const callee = expression.callee;
      let rightSide: any[] = [];

      if (callee && callee.type === "Variable") {
        // 함수 이름에 따라 반환 타입 직접 연결
        const functionName = callee.name;

        // 현재 함수가 자기 자신을 호출하는 재귀 호출인 경우
        if (functionName === this.currentFunction) {
          // 현재 함수의 반환 타입과 동일하게 설정
          rightSide = [
            {
              expression: {
                type: "Variable",
                name: "result", // 현재 함수의 result 변수와 연결
              },
            },
          ];
        } else {
          // 일반 함수 호출
          const returnTypeVar = this.typeVarGen.generateNewTypeVariable();
          rightSide = [
            {
              expression: {
                type: "Variable",
                name: returnTypeVar,
              },
            },
          ];
        }
      }

      const funcCallConstraint: TypeConstraint = {
        originAST: expression,
        left: [{ expression: expression }],
        right: rightSide,
      };
      this.constraints.push(funcCallConstraint);
    }
  }

  /**
   * Statement들을 재귀적으로 처리합니다.
   */
  private processStatements(
    statements: Statement[],
    symbolTable: Map<string, Variable>
  ): void {
    for (const stmt of statements) {
      this.processStatement(stmt, symbolTable);
    }
  }

  /**
   * 개별 Statement를 처리합니다.
   */
  private processStatement(
    stmt: Statement,
    symbolTable: Map<string, Variable>
  ): void {
    switch (stmt.type) {
      case "AssignmentStatement":
        this.processAssignmentStatement(stmt, symbolTable);
        break;

      case "OutputStatement":
        this.processOutputStatement(stmt, symbolTable);
        break;

      case "IfStatement":
        this.processIfStatement(stmt, symbolTable);
        break;

      case "WhileStatement":
        this.processWhileStatement(stmt, symbolTable);
        break;

      case "PointerAssignmentStatement":
        this.processPointerAssignmentStatement(stmt, symbolTable);
        break;

      case "DirectPropertyAssignmentStatement":
        this.addExpressionConstraint(stmt.value, symbolTable);
        break;

      case "PropertyAssignmentStatement":
        this.addExpressionConstraint(stmt.object, symbolTable);
        this.addExpressionConstraint(stmt.value, symbolTable);
        break;

      case "ReturnStatement":
        this.addExpressionConstraint(stmt.expression, symbolTable);
        break;
    }
  }

  /**
   * 할당문을 처리합니다.
   */
  private processAssignmentStatement(
    stmt: any,
    symbolTable: Map<string, Variable>
  ): void {
    this.addExpressionConstraint(stmt.expression, symbolTable);

    // null expression의 경우 고유 ID를 가진 버전 사용
    let rightExpression = stmt.expression;
    if (stmt.expression.type === "NullLiteral") {
      rightExpression = {
        ...stmt.expression,
        _nullId: this.nullLiteralCounter,
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
    this.constraints.push(assignmentConstraint);
  }

  /**
   * 출력문을 처리합니다.
   */
  private processOutputStatement(
    stmt: any,
    symbolTable: Map<string, Variable>
  ): void {
    this.addExpressionConstraint(stmt.expression, symbolTable);
    const outputConstraint: OutputType = {
      originAST: stmt,
      left: [{ expression: stmt.expression }],
      right: [{ type: "int" }],
    };
    this.constraints.push(outputConstraint);
  }

  /**
   * If문을 처리합니다.
   */
  private processIfStatement(
    stmt: any,
    symbolTable: Map<string, Variable>
  ): void {
    this.addExpressionConstraint(stmt.condition, symbolTable);

    if (stmt.elseStatement) {
      const ifElseConstraint: IfElseType = {
        originAST: stmt,
        left: [{ expression: stmt.condition }],
        right: [{ type: "int" }],
      };
      this.constraints.push(ifElseConstraint);

      // 재귀적으로 then과 else 블록 처리
      this.processStatements(stmt.thenStatement, symbolTable);

      // elseStatement가 중첩 배열인 경우 평탄화
      let elseStmts = stmt.elseStatement;
      if (elseStmts.length > 0 && Array.isArray(elseStmts[0])) {
        elseStmts = elseStmts[0];
      }
      this.processStatements(elseStmts, symbolTable);
    } else {
      const ifConstraint: IfType = {
        originAST: stmt,
        left: [{ expression: stmt.condition }],
        right: [{ type: "int" }],
      };
      this.constraints.push(ifConstraint);
      this.processStatements(stmt.thenStatement, symbolTable);
    }
  }

  /**
   * While문을 처리합니다.
   */
  private processWhileStatement(
    stmt: any,
    symbolTable: Map<string, Variable>
  ): void {
    this.addExpressionConstraint(stmt.condition, symbolTable);
    const whileConstraint: WhileType = {
      originAST: stmt,
      left: [{ expression: stmt.condition }],
      right: [{ type: "int" }],
    };
    this.constraints.push(whileConstraint);
    this.processStatements(stmt.body, symbolTable);
  }

  /**
   * 포인터 할당문을 처리합니다.
   */
  private processPointerAssignmentStatement(
    stmt: any,
    symbolTable: Map<string, Variable>
  ): void {
    this.addExpressionConstraint(stmt.pointer, symbolTable);
    this.addExpressionConstraint(stmt.value, symbolTable);

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
    this.constraints.push(valueConstraint);
  }

  /**
   * 초기화되지 않은 변수들에 대한 제약 조건을 추가합니다.
   */
  private addUninitializedVariableConstraints(
    func: FunctionDeclaration,
    symbolTable: Map<string, Variable>
  ): void {
    // 함수에서 할당받는 변수들을 추적
    const assignedVariables = new Set<string>();

    // 함수 바디에서 할당되는 변수들 수집
    const collectAssignedVariables = (statements: Statement[]) => {
      for (const stmt of statements) {
        switch (stmt.type) {
          case "AssignmentStatement":
            assignedVariables.add(stmt.variable);
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
    };

    collectAssignedVariables(func.body);

    // 선언된 변수 중 할당받지 않은 변수들을 null (포인터)로 처리
    const localVars = func.localVariables ? func.localVariables.flat() : [];

    for (const varName of localVars) {
      if (!assignedVariables.has(varName)) {
        const variable = symbolTable.get(varName);
        if (!variable) continue;

        // null : pointer(α) (새로운 type variable에 대한 포인터)
        const newTypeVarName = this.typeVarGen.generateNewTypeVariable();
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
        this.constraints.push(nullConstraint);
      }
    }
  }

  /**
   * 함수가 재귀 함수인지 확인합니다.
   * @param func 함수 선언
   * @returns 재귀 함수이면 true, 아니면 false
   */
  private isRecursiveFunction(func: FunctionDeclaration): boolean {
    const functionName = func.name;

    // 함수 바디와 반환 표현식에서 자기 자신을 호출하는지 확인
    const hasRecursiveCall = (node: any): boolean => {
      if (!node || typeof node !== "object") {
        return false;
      }

      // FunctionCall인 경우
      if (node.type === "FunctionCall") {
        if (
          node.callee?.type === "Variable" &&
          node.callee.name === functionName
        ) {
          return true;
        }
      }

      // 모든 자식 노드 재귀적으로 확인
      for (const key in node) {
        if (key !== "type" && node.hasOwnProperty(key)) {
          const child = node[key];
          if (Array.isArray(child)) {
            for (const item of child) {
              if (hasRecursiveCall(item)) {
                return true;
              }
            }
          } else if (hasRecursiveCall(child)) {
            return true;
          }
        }
      }

      return false;
    };

    // 함수 바디와 반환 표현식 모두 확인
    return (
      hasRecursiveCall(func.body) || hasRecursiveCall(func.returnExpression)
    );
  }

  /**
   * ObjectLiteral 제약 조건을 추가합니다.
   */
  private addObjectLiteralConstraint(
    expression: any,
    symbolTable: Map<string, Variable>
  ): void {
    // ObjectLiteral의 각 필드를 Record 타입으로 변환
    // properties가 중첩 배열일 수 있으므로 평면화
    const flatProperties = Array.isArray(expression.properties[0])
      ? expression.properties[0]
      : expression.properties;

    const fields = flatProperties
      .filter((prop: any) => prop && prop.key && prop.value)
      .map((prop: any) => ({
        name: prop.key,
        fieldType: { expression: prop.value },
      }));

    const objectLiteralConstraint: TypeConstraint = {
      originAST: expression,
      left: [{ expression: expression }],
      right: [
        {
          type: "record",
          fields: fields,
        },
      ],
    };
    this.constraints.push(objectLiteralConstraint);
  }

  /**
   * PropertyAccess 제약 조건을 추가합니다.
   */
  private addPropertyAccessConstraint(
    expression: any,
    symbolTable: Map<string, Variable>
  ): void {
    const objectExpr = expression.object;
    const propertyName = expression.property;

    // object.property에서 object의 타입과 property의 타입을 연결하는 제약 조건
    const fieldTypeVar = this.typeVarGen.generateNewTypeVariable();

    // PropertyAccess 결과의 타입 제약 조건만 생성
    // (객체와 필드 간의 연결은 tip-type-check.ts에서 처리)
    const propertyAccessConstraint: TypeConstraint = {
      originAST: expression,
      left: [{ expression: expression }], // property access 결과
      right: [{ expression: { type: "Variable", name: fieldTypeVar } }], // 필드 타입
    };
    this.constraints.push(propertyAccessConstraint);
  }
}
