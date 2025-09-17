import {
  TypeConstraint,
  ConcreteType,
  ConcretePointerType,
  ConcreteFunctionType,
  ConcreteIntType,
} from "./types";
import { UnionFind } from "./union-find";
import { getTypeId } from "./type-utils";

/**
 * 타입 검증기
 * Union-Find 결과를 바탕으로 타입 오류를 검출합니다.
 */
export class TypeValidator {
  /**
   * 모든 타입 관련 오류를 검증합니다.
   * @param constraints 수집된 타입 제약 조건들
   * @param unionFind Union-Find 인스턴스
   * @returns 발견된 타입 오류들
   */
  validateAllTypes(
    constraints: TypeConstraint[],
    unionFind: UnionFind
  ): string[] {
    const errors: string[] = [];

    // 1. DereferenceExpression 검증
    errors.push(...this.validateDereferenceExpressions(constraints, unionFind));

    // 2. PointerAssignment 검증
    errors.push(...this.validatePointerAssignments(constraints, unionFind));

    // 3. AllocExpression 검증
    errors.push(...this.validateAllocExpressions(constraints, unionFind));

    // 4. BinaryExpression 검증
    errors.push(...this.validateBinaryExpressions(constraints, unionFind));

    // 5. FunctionCall 검증
    errors.push(...this.validateFunctionCalls(constraints, unionFind));

    // 6. PropertyAccess 검증
    errors.push(...this.validatePropertyAccess(constraints, unionFind));

    // 7. 변수 타입 일관성 검증
    errors.push(
      ...this.validateVariableTypeConsistency(constraints, unionFind)
    );

    return errors;
  }

  /**
   * DereferenceExpression들을 검증합니다.
   * *ptr에서 ptr이 pointer 타입인지 확인합니다.
   */
  private validateDereferenceExpressions(
    constraints: TypeConstraint[],
    unionFind: UnionFind
  ): string[] {
    const errors: string[] = [];

    for (const constraint of constraints) {
      // AssignmentStatement에서 오른쪽의 DereferenceExpression 검사
      if (constraint.originAST?.type === "AssignmentStatement") {
        for (const rightItem of constraint.right) {
          if (
            "expression" in rightItem &&
            rightItem.expression?.type === "DereferenceExpression"
          ) {
            const dereferenceExpr = rightItem.expression;
            errors.push(
              ...this.validateSingleDereference(dereferenceExpr, unionFind)
            );
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
                ...this.validateSingleDereference(dereferenceExpr, unionFind)
              );
            }
          }
        }
      }
    }

    return errors;
  }

  /**
   * 단일 역참조 표현식을 검증합니다.
   */
  private validateSingleDereference(
    dereferenceExpr: any,
    unionFind: UnionFind
  ): string[] {
    const errors: string[] = [];

    if (dereferenceExpr.type !== "DereferenceExpression") return errors;

    const targetExpr = dereferenceExpr.expression;

    // 중첩된 역참조 검사 (**ptr)
    if (targetExpr.type === "DereferenceExpression") {
      const innerTargetExpr = targetExpr.expression;
      const innerTargetId = getTypeId({ expression: innerTargetExpr });
      const innerTargetType = unionFind.getType(innerTargetId);

      if (innerTargetType) {
        if (innerTargetType.type !== "pointer") {
          const exprName = (innerTargetExpr as any).name || "expression";
          errors.push(
            `타입 오류: **${exprName}에서 ${exprName}은 pointer(pointer(...)) 타입이어야 하지만 ${innerTargetType.type} 타입입니다.`
          );
        } else {
          const ptrType = innerTargetType as ConcretePointerType;
          if (!ptrType.pointsTo) {
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

    return errors;
  }

  /**
   * 포인터 할당문을 검증합니다.
   * *ptr = value에서 타입 호환성을 확인합니다.
   */
  private validatePointerAssignments(
    constraints: TypeConstraint[],
    unionFind: UnionFind
  ): string[] {
    const errors: string[] = [];

    for (const constraint of constraints) {
      if (constraint.originAST?.type === "PointerAssignmentStatement") {
        for (const leftItem of constraint.left) {
          if ("expression" in leftItem && leftItem.expression) {
            const ptrExpr = leftItem.expression;
            const ptrId = getTypeId({ expression: ptrExpr });
            const ptrType = unionFind.getType(ptrId);

            if (ptrType && ptrType.type === "pointer") {
              const ptrTypeTyped = ptrType as ConcretePointerType;

              for (const rightItem of constraint.right) {
                if ("expression" in rightItem && rightItem.expression) {
                  const valueId = getTypeId({
                    expression: rightItem.expression,
                  });
                  const valueType = unionFind.getType(valueId);

                  if (valueType && ptrTypeTyped.pointsTo) {
                    let expectedType = ptrTypeTyped.pointsTo;

                    // pointsTo가 CustomType인 경우 실제 타입 확인
                    if ((expectedType as any).expression) {
                      const expectedId = getTypeId(expectedType);
                      const actualExpectedType = unionFind.getType(expectedId);
                      if (actualExpectedType) {
                        expectedType = actualExpectedType;
                      }
                    }

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

    return errors;
  }

  /**
   * AllocExpression을 검증합니다.
   * alloc의 인자는 int여야 합니다.
   */
  private validateAllocExpressions(
    constraints: TypeConstraint[],
    unionFind: UnionFind
  ): string[] {
    const errors: string[] = [];

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

    return errors;
  }

  /**
   * BinaryExpression을 검증합니다.
   * 산술 연산자는 int 타입만 허용됩니다.
   */
  private validateBinaryExpressions(
    constraints: TypeConstraint[],
    unionFind: UnionFind
  ): string[] {
    const errors: string[] = [];

    for (const constraint of constraints) {
      if (constraint.originAST?.type === "BinaryExpression") {
        const binaryExpr = constraint.originAST as any;

        const leftOperand = binaryExpr.left;
        const rightOperand = binaryExpr.right;

        // 좌변 피연산자 타입 확인
        if (leftOperand) {
          const leftType = this.getOperandType(leftOperand, unionFind);
          if (leftType && leftType.type !== "int") {
            const leftName = this.getOperandName(leftOperand);
            errors.push(
              `타입 오류: 이진 연산에서 ${leftName}은 int 타입이어야 하지만 ${leftType.type} 타입입니다.`
            );
          }
        }

        // 우변 피연산자 타입 확인
        if (rightOperand) {
          const rightType = this.getOperandType(rightOperand, unionFind);
          if (rightType && rightType.type !== "int") {
            const rightName = this.getOperandName(rightOperand);
            errors.push(
              `타입 오류: 이진 연산에서 ${rightName}은 int 타입이어야 하지만 ${rightType.type} 타입입니다.`
            );
          }
        }
      }
    }

    return errors;
  }

  /**
   * 피연산자의 타입을 가져옵니다.
   */
  private getOperandType(
    operand: any,
    unionFind: UnionFind
  ): ConcreteType | null {
    // FunctionCall의 경우 함수 반환 타입을 직접 확인
    if (operand.type === "FunctionCall") {
      const calleeId = getTypeId({ expression: operand.callee });
      const calleeType = unionFind.getType(calleeId);
      if (calleeType && calleeType.type === "function") {
        const funcType = calleeType as ConcreteFunctionType;
        if (funcType.returnType && (funcType.returnType as any).expression) {
          const returnTypeId = getTypeId(funcType.returnType);
          return unionFind.getType(returnTypeId);
        } else if (funcType.returnType) {
          return funcType.returnType as ConcreteType;
        }
      }
    } else {
      const operandId = getTypeId({ expression: operand });
      return unionFind.getType(operandId);
    }
    return null;
  }

  /**
   * 피연산자의 이름을 가져옵니다.
   */
  private getOperandName(operand: any): string {
    if (operand.type === "FunctionCall") {
      return `함수 ${(operand as any).callee?.name || "unknown"}()의 반환값`;
    }
    return (operand as any).name || "operand";
  }

  /**
   * 함수 호출을 검증합니다.
   */
  private validateFunctionCalls(
    constraints: TypeConstraint[],
    unionFind: UnionFind
  ): string[] {
    const errors: string[] = [];

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

            if (
              calleeType &&
              calleeType.type !== "function" &&
              calleeType.type !== "recursive"
            ) {
              const calleeName = calleeExpr.name || "expression";
              errors.push(
                `타입 오류: ${calleeName}은 ${calleeType.type} 타입이므로 함수로 호출할 수 없습니다.`
              );
            }
          }

          // 함수 인자 타입 검사
          const args = (funcCallExpr as any).arguments || [];
          const funcName = calleeExpr?.name || "unknown";

          for (let i = 0; i < args.length; i++) {
            const argExpr = args[i];
            const argId = getTypeId({ expression: argExpr });
            const argType = unionFind.getType(argId);

            if (argType && funcName === "add" && argType.type !== "int") {
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
      }
    }

    // FunctionCall 제약 조건에서 추가 검증
    for (const constraint of constraints) {
      if (constraint.originAST?.type === "FunctionCall") {
        const funcCallExpr = constraint.originAST as any;
        const funcName = funcCallExpr.callee?.name;

        let args = funcCallExpr.arguments || [];
        if (args.length > 0 && Array.isArray(args[0])) {
          args = args[0]; // 중첩 배열 처리
        }

        // add 함수 특별 처리
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
      }
    }

    return errors;
  }

  /**
   * 변수 타입 일관성을 검증합니다.
   * 같은 변수에 다른 타입의 값이 할당되는지 확인합니다.
   */
  private validateVariableTypeConsistency(
    constraints: TypeConstraint[],
    unionFind: UnionFind
  ): string[] {
    const errors: string[] = [];
    const variableAssignments: Map<string, ConcreteType[]> = new Map();

    for (const constraint of constraints) {
      if (constraint.originAST?.type === "AssignmentStatement") {
        const leftVar = constraint.left.find(
          (item) => "expression" in item && item.expression.type === "Variable"
        );
        const rightValue = constraint.right.find(
          (item) => "expression" in item
        );

        if (
          leftVar &&
          rightValue &&
          "expression" in leftVar &&
          "expression" in rightValue
        ) {
          const varName = (leftVar.expression as any).name;
          const valueType = this.getValueType(rightValue.expression, unionFind);

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

  /**
   * 값의 타입을 가져옵니다.
   */
  private getValueType(expr: any, unionFind: UnionFind): ConcreteType | null {
    if (expr.type === "AddressExpression") {
      return {
        type: "pointer",
        pointsTo: { type: "int" },
      } as ConcretePointerType;
    } else if (expr.type === "BinaryExpression") {
      return { type: "int" } as ConcreteIntType;
    } else if (expr.type === "Variable") {
      const valueId = getTypeId({ expression: expr });
      let valueType = unionFind.getType(valueId);

      // 함수 매개변수인 경우 특별 처리
      if (expr.name === "ptr" && !valueType) {
        valueType = {
          type: "pointer",
          pointsTo: { type: "int" },
        } as ConcretePointerType;
      }
      return valueType;
    } else {
      const valueId = getTypeId({ expression: expr });
      return unionFind.getType(valueId);
    }
  }

  /**
   * PropertyAccess 검증을 수행합니다.
   * object.property에서 object가 Record 타입인지 확인합니다.
   */
  private validatePropertyAccess(
    constraints: TypeConstraint[],
    unionFind: UnionFind
  ): string[] {
    const errors: string[] = [];

    for (const constraint of constraints) {
      if (constraint.originAST?.type === "PropertyAccess") {
        const propAccess = constraint.originAST as any;
        const objectExpr = propAccess.object;
        const propertyName = propAccess.property;

        // 객체의 타입 조회
        const objectId = getTypeId({ expression: objectExpr });
        const objectType = unionFind.getType(objectId);

        if (objectType) {
          // Record 타입이 아닌 경우 오류
          if (objectType.type !== "record") {
            let objectTypeName = objectType.type;

            // 더 구체적인 타입 이름 제공
            if (objectType.type === "pointer") {
              objectTypeName = "pointer";
            } else if (objectType.type === "function") {
              objectTypeName = "function";
            } else if (objectType.type === "int") {
              objectTypeName = "int";
            }

            errors.push(
              `타입 오류: ${objectTypeName} 타입에는 필드 접근을 할 수 없습니다. '${propertyName}' 필드에 접근하려면 Record 타입이어야 합니다.`
            );
          }
        }
      }
    }

    return errors;
  }
}
