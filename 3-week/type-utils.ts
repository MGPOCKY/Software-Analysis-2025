import {
  ConcreteType,
  ConcreteIntType,
  ConcretePointerType,
  ConcreteFunctionType,
  ConcreteTypeVariable,
  ConcreteRecursiveType,
  ConcreteRecordType,
  ConcreteRecordField,
} from "./types";
import { UnionFind } from "./union-find";

/**
 * Expression이나 Type에서 고유 ID를 생성합니다.
 * @param item 타입 아이템
 * @param contextId 컨텍스트 ID (선택적)
 * @returns 고유 ID 문자열
 */
export function getTypeId(item: any, contextId?: string): string {
  if (item.expression) {
    let baseId = `expr_${JSON.stringify(item.expression).replace(/\s/g, "")}`;

    // NullLiteral의 경우 _nullId를 우선 사용
    if (item.expression.type === "NullLiteral") {
      if (item.expression._nullId) {
        baseId = `expr_null_${item.expression._nullId}`;
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

/**
 * Type을 ConcreteType으로 변환합니다.
 * @param item 변환할 타입 아이템
 * @returns ConcreteType 또는 null
 */
export function toConcreteType(item: any): ConcreteType | null | undefined {
  if (item.type === "int") {
    return { type: "int" } as ConcreteIntType;
  } else if (item.type === "pointer") {
    let pointsTo: ConcreteType | undefined = undefined;

    if (item.pointsTo) {
      if (item.pointsTo.expression) {
        // CustomType: { expression: ... } 형태인 경우 그대로 유지
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
    // Type variable (α, β, γ, ... 등)
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
  } else if (item.type === "recursive") {
    // Recursive type 처리
    let body: ConcreteType | undefined = undefined;

    if (item.body) {
      if (item.body.expression) {
        // CustomType: { expression: ... } 형태인 경우 그대로 유지
        body = item.body as ConcreteType;
      } else {
        // 일반 ConcreteType인 경우
        body = toConcreteType(item.body) || undefined;
      }
    }

    return {
      type: "recursive",
      variable: item.variable,
      body: body,
    } as ConcreteRecursiveType;
  } else if (item.type === "record") {
    // Record type 처리
    const fields: ConcreteRecordField[] = [];

    if (item.fields && Array.isArray(item.fields)) {
      for (const field of item.fields) {
        let fieldType: ConcreteType | undefined = undefined;

        if (field.fieldType) {
          if (field.fieldType.expression) {
            // CustomType: { expression: ... } 형태인 경우 그대로 유지
            fieldType = field.fieldType as ConcreteType;
          } else {
            // 일반 ConcreteType인 경우
            fieldType = toConcreteType(field.fieldType) || undefined;
          }
        }

        if (fieldType) {
          fields.push({
            name: field.name,
            fieldType: fieldType,
          });
        }
      }
    }

    return {
      type: "record",
      fields: fields,
    } as ConcreteRecordType;
  }
  return null;
}

/**
 * ConcreteType을 문자열로 포맷팅합니다.
 * @param type 포맷팅할 타입
 * @param unionFind Union-Find 인스턴스 (선택적)
 * @param depth 재귀 깊이 (무한 재귀 방지용)
 * @returns 포맷팅된 타입 문자열
 */
export function formatConcreteType(
  type: ConcreteType,
  unionFind?: UnionFind,
  depth: number = 0
): string {
  // 무한 재귀 방지
  if (depth > 3) {
    return "...";
  }

  switch (type.type) {
    case "int":
      return "int";

    case "pointer":
      const ptrType = type as ConcretePointerType;
      if (!ptrType.pointsTo) {
        return "pointer(?)";
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
      return varType.name;

    case "recursive":
      const recType = type as ConcreteRecursiveType;
      const bodyStr = formatConcreteType(recType.body, unionFind, depth + 1);
      return `μ${recType.variable}.${bodyStr}`;

    case "record":
      const recordType = type as ConcreteRecordType;
      const fieldStrs = recordType.fields
        .map((field) => {
          let fieldTypeStr = "unknown";

          // 필드 타입이 expression을 포함하는 경우 Union-Find에서 실제 타입 조회
          if (unionFind && field.fieldType && "expression" in field.fieldType) {
            const fieldExpr = (field.fieldType as any).expression;
            const fieldTypeId = getTypeId({ expression: fieldExpr });
            const actualFieldType = unionFind.getType(fieldTypeId);

            if (actualFieldType) {
              fieldTypeStr = formatConcreteType(
                actualFieldType,
                unionFind,
                depth + 1
              );
            }
          } else {
            // 일반적인 경우
            fieldTypeStr = formatConcreteType(
              field.fieldType,
              unionFind,
              depth + 1
            );
          }

          return `${field.name}: ${fieldTypeStr}`;
        })
        .join(", ");
      return `{${fieldStrs}}`;

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

/**
 * Expression에서 타입을 추론합니다.
 * @param expr 추론할 표현식
 * @param unionFind Union-Find 인스턴스
 * @returns 추론된 타입 문자열
 */
export function inferReturnTypeFromExpression(
  expr: any,
  unionFind?: UnionFind
): string {
  if (!expr || !unionFind) return "?";

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

  // 3. Expression 타입별 세부 조회
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
      return "int";

    case "BinaryExpression":
      return "int"; // 이진 연산 결과는 항상 int

    case "FunctionCall":
      // 함수 호출 결과는 호출된 함수의 반환 타입
      const calleeId = getTypeId({ expression: expr.callee });
      const calleeConcreteType = unionFind.getType(calleeId);
      if (calleeConcreteType && calleeConcreteType.type === "function") {
        const funcType = calleeConcreteType as ConcreteFunctionType;
        if (funcType.returnType) {
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
        const innerType = ptrType.slice(8, -1);
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

/**
 * Expression을 간결하게 포맷팅합니다.
 * @param expr 포맷팅할 표현식
 * @returns 포맷팅된 문자열
 */
export function formatExpression(expr: any): string {
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
    case "FunctionCall":
      return "FunctionCall(...)";
    default:
      return `${expr.type}(...)`;
  }
}

/**
 * Type을 간결하게 포맷팅합니다.
 * @param type 포맷팅할 타입
 * @returns 포맷팅된 문자열
 */
export function formatType(type: any): string {
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
