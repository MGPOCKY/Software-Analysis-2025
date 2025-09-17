import TIPParser from "./parser";
import { TIPANFConverter } from "./tip-anf-converter";
import { Program, TypeConstraint } from "./types";
import { UnionFind } from "./union-find";
import { ConstraintCollector } from "./constraint-collector";
import { TypeValidator } from "./type-validator";
import { toConcreteType, getTypeId } from "./type-utils";
import {
  colorLog,
  printDetailedConstraints,
  printUnificationResults,
  printTypeErrors,
} from "./output-formatter";
import * as fs from "fs";

/**
 * TIP Type Checker
 * TIP 언어의 타입 검사를 수행하는 메인 클래스
 */
class TipTypeChecker {
  private constraintCollector: ConstraintCollector;
  private typeValidator: TypeValidator;

  constructor() {
    this.constraintCollector = new ConstraintCollector();
    this.typeValidator = new TypeValidator();
  }

  /**
   * 타입 검사를 수행합니다.
   */
  async processTypeCheck(): Promise<void> {
    colorLog("cyan", "🚀 === TIP Type Checking 시작 ===\n");

    try {
      // 1. TIP 코드 읽기
      const tipCode = this.readTipCode();
      if (!tipCode) return;

      // 2. AST 생성
      const ast = this.parseCode(tipCode);
      if (!ast) return;

      // 3. ANF CFG 생성 (현재는 출력만)
      this.generateAnfCfg(ast);

      // 4. Type Constraint 수집
      const constraints = this.collectConstraints(ast);

      // 5. Type Constraint 출력
      this.printConstraints(constraints);

      // 6. Unification 실행
      const { unionFind, errors } = this.performUnification(constraints);

      // 7. 타입 검증
      const validationErrors = this.validateTypes(constraints, unionFind);
      errors.push(...validationErrors);

      // 8. 결과 출력
      this.printResults(unionFind, constraints, errors);

      colorLog("cyan", "\n✨ Type Checking 처리 완료!");
    } catch (error: any) {
      colorLog("red", `❌ 타입 검사 중 오류 발생: ${error.message}`);
    }
  }

  /**
   * TIP 코드를 파일에서 읽어옵니다.
   */
  private readTipCode(): string | null {
    const inputFile = "tip_code.txt";

    if (!fs.existsSync(inputFile)) {
      colorLog("red", `❌ 오류: ${inputFile} 파일이 존재하지 않습니다.`);
      return null;
    }

    const tipCode = fs.readFileSync(inputFile, "utf-8").trim();
    if (!tipCode) {
      colorLog("red", `❌ 오류: ${inputFile} 파일이 비어있습니다.`);
      return null;
    }

    colorLog("green", `✅ TIP 코드 읽기 완료 (${inputFile})`);
    colorLog("blue", "--- TIP 코드 내용 ---");
    console.log(tipCode);
    console.log("");

    return tipCode;
  }

  /**
   * TIP 코드를 파싱하여 AST를 생성합니다.
   */
  private parseCode(tipCode: string): Program | null {
    colorLog("yellow", "🔍 1단계: TIP 코드 파싱 및 AST 생성...");

    const parser = new TIPParser();
    const parseResult = parser.parse(tipCode);

    if (!parseResult.success) {
      colorLog("red", `❌ 파싱 실패: ${parseResult.error}`);
      return null;
    }

    colorLog("green", "✅ AST 생성 완료");
    return parseResult.ast!;
  }

  /**
   * ANF CFG를 생성합니다 (현재는 출력만).
   */
  private generateAnfCfg(ast: Program): void {
    colorLog("yellow", "\n🔄 2단계: ANF CFG 생성...");

    const anfConverter = new TIPANFConverter();
    const anfCfgs = anfConverter.convertProgram(ast);

    colorLog("green", `✅ ANF CFG 생성 완료 (${anfCfgs.size}개 함수)`);
  }

  /**
   * 타입 제약 조건을 수집합니다.
   */
  private collectConstraints(ast: Program): TypeConstraint[] {
    colorLog("yellow", "\n🔍 3단계: Type Constraint 수집...");

    try {
      const constraints = this.constraintCollector.collectTypeConstraints(ast);

      colorLog(
        "green",
        `✅ Type Constraint 수집 완료 (${constraints.length}개 제약)`
      );
      return constraints;
    } catch (error: any) {
      console.error("Constraint 수집 중 오류:", error);
      console.error("Stack trace:", error.stack);
      throw error;
    }
  }

  /**
   * 수집된 제약 조건들을 출력합니다.
   */
  private printConstraints(constraints: TypeConstraint[]): void {
    colorLog("blue", "\n📋 수집된 Type Constraints:");
    printDetailedConstraints(constraints);
  }

  /**
   * Unification을 수행합니다.
   */
  private performUnification(constraints: TypeConstraint[]): {
    unionFind: UnionFind;
    errors: string[];
  } {
    colorLog("yellow", "\n🔗 6단계: Unification 실행...");

    const unionFind = new UnionFind();
    const errors: string[] = [];

    // 1. 모든 타입 변수와 concrete type들을 Union-Find에 등록
    this.registerTypesInUnionFind(constraints, unionFind);

    // 2. Type constraint에 따라 unification 수행
    this.unifyConstraints(constraints, unionFind, errors);

    // 3. 함수 호출과 함수 반환 타입 연결
    this.linkFunctionCallsToReturnTypes(constraints, unionFind, errors);

    // 4. 함수 매개변수와 인수 간의 타입 연결
    this.linkFunctionParametersToArguments(constraints, unionFind, errors);

    // 5. PropertyAccess와 ObjectLiteral 필드 타입 연결
    this.linkPropertyAccessToFieldTypes(constraints, unionFind, errors);

    // 6. 남은 type variable들 해결
    this.resolveRemainingTypeVariables(constraints, unionFind, errors);

    if (errors.length > 0) {
      colorLog("red", `❌ Unification 중 ${errors.length}개의 타입 오류 발견`);
    } else {
      colorLog("green", "✅ Unification 완료 - 타입 오류 없음");
    }

    return { unionFind, errors };
  }

  /**
   * Union-Find에 타입들을 등록합니다.
   */
  private registerTypesInUnionFind(
    constraints: TypeConstraint[],
    unionFind: UnionFind
  ): void {
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
  }

  /**
   * 제약 조건에 따라 타입들을 통합합니다.
   */
  private unifyConstraints(
    constraints: TypeConstraint[],
    unionFind: UnionFind,
    errors: string[]
  ): void {
    for (let i = 0; i < constraints.length; i++) {
      const constraint = constraints[i];
      const contextId = `constraint_${i}`;

      // AssignmentStatement의 경우 contextId 없이 처리
      const isAssignment = constraint.originAST?.type === "AssignmentStatement";
      const leftIds = constraint.left.map((item) =>
        getTypeId(item, isAssignment ? undefined : contextId)
      );
      const rightIds = constraint.right.map((item) =>
        getTypeId(item, isAssignment ? undefined : contextId)
      );

      // Left와 Right의 각 쌍을 unify
      this.unifyConstraintPairs(
        constraint,
        leftIds,
        rightIds,
        unionFind,
        errors
      );

      // BinaryExpression 특별 처리
      this.handleBinaryExpressionConstraints(
        constraint,
        leftIds,
        unionFind,
        errors
      );
    }
  }

  /**
   * 제약 조건의 각 쌍을 통합합니다.
   */
  private unifyConstraintPairs(
    constraint: TypeConstraint,
    leftIds: string[],
    rightIds: string[],
    unionFind: UnionFind,
    errors: string[]
  ): void {
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
  }

  /**
   * BinaryExpression의 특별한 제약 조건을 처리합니다.
   */
  private handleBinaryExpressionConstraints(
    constraint: TypeConstraint,
    leftIds: string[],
    unionFind: UnionFind,
    errors: string[]
  ): void {
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
        const success1 = unionFind.union(leftIds[0], leftIds[1]);
        const success2 = unionFind.union(leftIds[0], leftIds[2]);

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

  /**
   * 함수 호출과 함수의 반환 타입을 연결합니다.
   */
  private linkFunctionCallsToReturnTypes(
    constraints: TypeConstraint[],
    unionFind: UnionFind,
    errors: string[]
  ): void {
    // 함수 선언들의 반환 타입 수집
    const functionReturnTypes = new Map<string, string>();

    for (const constraint of constraints) {
      if (constraint.originAST?.type === "FunctionDeclaration") {
        const funcDecl = constraint.originAST as any;
        const funcName = funcDecl.name;

        // 함수의 반환 타입 ID 찾기
        for (const rightItem of constraint.right) {
          const item = rightItem as any;
          if (item.type === "function" || item.type === "recursive") {
            let returnTypeExpr;
            if (item.type === "recursive") {
              // Recursive type의 body에서 반환 타입 추출
              const body = item.body;
              if (body && body.returnType) {
                returnTypeExpr = body.returnType.expression;
              }
            } else {
              // 일반 함수의 반환 타입
              returnTypeExpr = item.returnType?.expression;
            }

            if (returnTypeExpr) {
              const returnTypeId = getTypeId({ expression: returnTypeExpr });
              functionReturnTypes.set(funcName, returnTypeId);
            }
          }
        }
      }
    }

    // 함수 호출들과 해당 함수의 반환 타입 연결
    for (const constraint of constraints) {
      if (constraint.originAST?.type === "FunctionCall") {
        const funcCall = constraint.originAST as any;
        const callee = funcCall.callee;

        if (callee?.type === "Variable") {
          const functionName = callee.name;
          const returnTypeId = functionReturnTypes.get(functionName);

          if (returnTypeId) {
            // 함수 호출 결과의 타입 ID
            const funcCallId = getTypeId({ expression: funcCall });

            // 함수 호출 결과와 함수의 반환 타입 연결
            const success = unionFind.union(funcCallId, returnTypeId);
            if (!success) {
              errors.push(
                `타입 충돌: 함수 호출 ${functionName}의 반환 타입 불일치`
              );
            }

            // 추가: 함수의 실제 return statement expression과도 연결
            for (const funcConstraint of constraints) {
              if (funcConstraint.originAST?.type === "FunctionDeclaration") {
                const funcDecl = funcConstraint.originAST as any;
                if (funcDecl.name === functionName) {
                  const returnExpr =
                    funcDecl.body?.returnExpression ||
                    funcDecl.returnExpression;
                  if (returnExpr) {
                    const returnExprId = getTypeId({ expression: returnExpr });
                    unionFind.union(funcCallId, returnExprId);
                  }
                  break;
                }
              }
            }
          }
        }
      }
    }
  }

  /**
   * PropertyAccess와 ObjectLiteral 필드 타입을 연결합니다.
   */
  private linkPropertyAccessToFieldTypes(
    constraints: TypeConstraint[],
    unionFind: UnionFind,
    errors: string[]
  ): void {
    // ObjectLiteral들의 필드 타입 정보 수집
    const objectLiteralFields = new Map<string, Map<string, string>>();

    for (const constraint of constraints) {
      if (constraint.originAST?.type === "ObjectLiteral") {
        const objLiteral = constraint.originAST as any;
        const objId = getTypeId({ expression: objLiteral });

        // ObjectLiteral의 필드 정보 추출
        const fieldMap = new Map<string, string>();

        // properties 평면화
        const flatProperties = Array.isArray(objLiteral.properties[0])
          ? objLiteral.properties[0]
          : objLiteral.properties;

        for (const prop of flatProperties) {
          if (prop && prop.key && prop.value) {
            const fieldValueId = getTypeId({ expression: prop.value });
            fieldMap.set(prop.key, fieldValueId);
          }
        }

        objectLiteralFields.set(objId, fieldMap);
      }
    }

    // PropertyAccess들과 해당 객체의 필드 타입 연결
    for (const constraint of constraints) {
      if (constraint.originAST?.type === "PropertyAccess") {
        const propAccess = constraint.originAST as any;
        const objectExpr = propAccess.object;
        const propertyName = propAccess.property;

        // PropertyAccess 결과의 타입 ID
        const propAccessId = getTypeId({ expression: propAccess });

        // 객체의 타입 ID (변수인 경우)
        if (objectExpr.type === "Variable") {
          // Assignment를 통해 연결된 ObjectLiteral 찾기
          for (const assignConstraint of constraints) {
            if (assignConstraint.originAST?.type === "AssignmentStatement") {
              const assignment = assignConstraint.originAST as any;
              // 변수와 ObjectLiteral 간의 할당 찾기
              if (
                assignment.variable === objectExpr.name &&
                assignment.expression?.type === "ObjectLiteral"
              ) {
                const objLiteralId = getTypeId({
                  expression: assignment.expression,
                });
                const fieldMap = objectLiteralFields.get(objLiteralId);

                if (fieldMap && fieldMap.has(propertyName)) {
                  const fieldValueId = fieldMap.get(propertyName)!;

                  // PropertyAccess 결과와 필드 값 타입 연결
                  const success = unionFind.union(propAccessId, fieldValueId);
                  if (!success) {
                    errors.push(
                      `타입 충돌: PropertyAccess ${propertyName}의 타입 불일치`
                    );
                  }
                } else if (fieldMap) {
                  // 필드가 존재하지 않는 경우 오류 발생
                  const availableFields = Array.from(fieldMap.keys()).join(
                    ", "
                  );
                  errors.push(
                    `타입 오류: Record에 '${propertyName}' 필드가 존재하지 않습니다. 사용 가능한 필드: {${availableFields}}`
                  );
                }
              }
            }
          }

          // Union-Find를 통해 연결된 ObjectLiteral도 확인
          const objectVarId = getTypeId({ expression: objectExpr });
          const objectRoot = unionFind.find(objectVarId);

          // 같은 그룹의 모든 멤버에서 ObjectLiteral 찾기
          const groups = unionFind.getAllGroups();
          for (const [rep, members] of groups) {
            if (rep === objectRoot || members.includes(objectRoot)) {
              // 이 그룹에서 ObjectLiteral 찾기
              for (const member of members) {
                // ObjectLiteral ID는 "expr_" 접두사를 가지므로 그것들 중에서 찾기
                if (member.includes('"type":"ObjectLiteral"')) {
                  const fieldMap = objectLiteralFields.get(member);
                  if (fieldMap && fieldMap.has(propertyName)) {
                    const fieldValueId = fieldMap.get(propertyName)!;

                    // PropertyAccess 결과와 필드 값 타입 연결
                    const success = unionFind.union(propAccessId, fieldValueId);
                    if (!success) {
                      errors.push(
                        `타입 충돌: PropertyAccess ${propertyName}의 타입 불일치 (Union-Find 연결)`
                      );
                    } else {
                      // PropertyAccess에 직접 필드 타입 설정
                      const fieldType = unionFind.getType(fieldValueId);
                      if (fieldType) {
                        unionFind.makeSet(propAccessId, fieldType);
                      } else {
                        // NumberLiteral인 경우 직접 int로 설정
                        unionFind.makeSet(propAccessId, { type: "int" });

                        // PropertyAccess constraint의 right side type variable도 같이 설정
                        for (const constraint of constraints) {
                          if (constraint.originAST === propAccess) {
                            for (const rightItem of constraint.right) {
                              if (
                                "expression" in rightItem &&
                                rightItem.expression?.type === "Variable"
                              ) {
                                const rightId = getTypeId(rightItem);
                                unionFind.makeSet(rightId, { type: "int" });
                              }
                            }
                          }
                        }
                      }
                    }
                    break;
                  }
                }
              }
              break;
            }
          }
        }
      }
    }
  }

  /**
   * 함수 매개변수와 인수 간의 타입을 연결합니다.
   */
  private linkFunctionParametersToArguments(
    constraints: TypeConstraint[],
    unionFind: UnionFind,
    errors: string[]
  ): void {
    // 함수 호출에서 매개변수와 인수 연결
    for (const constraint of constraints) {
      if (constraint.originAST?.type === "FunctionCall") {
        const funcCall = constraint.originAST as any;
        const callee = funcCall.callee;

        if (callee?.type === "Variable") {
          const functionName = callee.name;

          // 함수 호출의 인수들
          let args = funcCall.arguments;
          if (Array.isArray(args[0])) {
            args = args[0]; // 중첩 배열 평면화
          }

          // 해당 함수의 선언을 찾기
          for (const funcConstraint of constraints) {
            if (funcConstraint.originAST?.type === "FunctionDeclaration") {
              const funcDecl = funcConstraint.originAST as any;

              if (funcDecl.name === functionName) {
                const parameters = funcDecl.parameters || [];

                // 매개변수와 인수 연결
                for (
                  let i = 0;
                  i < Math.min(parameters.length, args.length);
                  i++
                ) {
                  const paramName = parameters[i];
                  const argument = args[i];

                  if (paramName && argument) {
                    const paramId = getTypeId({
                      expression: { type: "Variable", name: paramName },
                    });
                    const argId = getTypeId({ expression: argument });

                    // 매개변수와 인수의 타입 연결
                    const success = unionFind.union(paramId, argId);
                    if (!success) {
                      errors.push(
                        `타입 충돌: 함수 ${functionName}의 매개변수 ${paramName}와 인수 타입 불일치`
                      );
                    }
                  }
                }
                break;
              }
            }
          }
        }
      }
    }
  }

  /**
   * 남은 type variable들을 해결합니다.
   */
  private resolveRemainingTypeVariables(
    constraints: TypeConstraint[],
    unionFind: UnionFind,
    errors: string[]
  ): void {
    // PropertyAccess type variable들을 실제 필드 타입으로 해결
    for (const constraint of constraints) {
      if (constraint.originAST?.type === "PropertyAccess") {
        const propAccess = constraint.originAST as any;
        const objectExpr = propAccess.object;
        const propertyName = propAccess.property;

        if (objectExpr.type === "Variable") {
          const objectVarId = getTypeId({ expression: objectExpr });
          const objectType = unionFind.getType(objectVarId);

          // object가 Record 타입인 경우 해당 필드 타입으로 PropertyAccess 설정
          if (objectType && objectType.type === "record") {
            const recordType = objectType as any;
            const field = recordType.fields?.find(
              (f: any) => f.name === propertyName
            );

            if (field && field.fieldType) {
              let fieldType = null;

              // 필드 타입이 expression인 경우 (NumberLiteral 등)
              if (field.fieldType.expression?.type === "NumberLiteral") {
                fieldType = { type: "int" };
              } else if (field.fieldType.type) {
                fieldType = field.fieldType;
              }

              if (fieldType) {
                // PropertyAccess를 해당 필드 타입으로 설정
                const propAccessId = getTypeId({ expression: propAccess });
                unionFind.makeSet(propAccessId, fieldType);

                // PropertyAccess constraint의 right side type variable도 같이 설정
                for (const rightItem of constraint.right) {
                  if (
                    "expression" in rightItem &&
                    rightItem.expression?.type === "Variable"
                  ) {
                    const rightId = getTypeId(rightItem);
                    unionFind.makeSet(rightId, fieldType);
                  }
                }
              }
            }
          }
        }
      }
    }
  }

  /**
   * 타입 검증을 수행합니다.
   */
  private validateTypes(
    constraints: TypeConstraint[],
    unionFind: UnionFind
  ): string[] {
    return this.typeValidator.validateAllTypes(constraints, unionFind);
  }

  /**
   * 최종 결과를 출력합니다.
   */
  private printResults(
    unionFind: UnionFind,
    constraints: TypeConstraint[],
    errors: string[]
  ): void {
    // Unification 결과 출력
    colorLog("blue", "\n📊 7단계: Unification 결과 출력...");
    printUnificationResults(unionFind, constraints);

    // 타입 오류 출력
    colorLog("magenta", "\n🔍 8단계: 타입 오류 분석...");
    printTypeErrors(errors);
  }
}

/**
 * 메인 실행 함수
 */
async function processTypeCheck(): Promise<void> {
  const typeChecker = new TipTypeChecker();
  await typeChecker.processTypeCheck();
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
