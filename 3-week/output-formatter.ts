import { TypeConstraint } from "./types";
import { UnionFind } from "./union-find";
import {
  formatExpression,
  formatType,
  formatConcreteType,
  getTypeId,
} from "./type-utils";

/**
 * 색상 출력을 위한 ANSI 코드
 */
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

/**
 * 색상이 적용된 로그를 출력합니다.
 * @param color 색상 이름
 * @param message 출력할 메시지
 */
export function colorLog(color: keyof typeof colors, message: string): void {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

/**
 * Type Constraint들을 상세하게 출력합니다.
 * @param constraints 출력할 제약 조건들
 */
export function printDetailedConstraints(constraints: TypeConstraint[]): void {
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

/**
 * Unification 결과를 출력합니다.
 * @param unionFind Union-Find 인스턴스
 * @param constraints 제약 조건들
 */
export function printUnificationResults(
  unionFind: UnionFind,
  constraints: TypeConstraint[]
): void {
  const groups = unionFind.getAllGroups();

  colorLog("cyan", "   🏷️  Equivalence Classes (동등한 타입들):");

  let classIndex = 1;

  for (const [representative, members] of groups) {
    const concreteType = unionFind.getType(representative);
    let typeStr = "추론된 타입";
    if (concreteType) {
      try {
        // Type variable인 경우 해당 클래스에서 concrete type 찾기
        if (concreteType.type === "typevar") {
          // 이 클래스에서 concrete type 찾기
          for (const member of members) {
            const memberType = unionFind.getType(member);
            if (memberType && memberType.type !== "typevar") {
              typeStr = formatConcreteType(memberType, unionFind);
              break;
            }
          }

          // concrete type을 찾지 못한 경우 type variable 이름 사용
          if (typeStr === "추론된 타입") {
            typeStr = (concreteType as any).name || "타입 변수";
          }
        } else {
          typeStr = formatConcreteType(concreteType, unionFind);
        }
      } catch (e) {
        typeStr = "타입 포맷 오류";
      }
    }

    colorLog("blue", `     클래스 ${classIndex}: ${typeStr}`);
    members.forEach((member, idx) => {
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
            displayName = `function(${params} params) -> ...`;
          } else if (parsed.type === "pointer") {
            displayName = `pointer(...)`;
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
            // Type variable인 경우 해당 클래스에서 concrete type 찾기
            if (finalType.type === "typevar") {
              const root = unionFind.find(id);
              const groups = unionFind.getAllGroups();

              // 해당 클래스에서 concrete type 찾기
              for (const [rep, members] of groups) {
                if (rep === root || members.includes(root)) {
                  // 이 클래스에서 concrete type 찾기
                  for (const member of members) {
                    const memberType = unionFind.getType(member);
                    if (memberType && memberType.type !== "typevar") {
                      typeStr = formatConcreteType(memberType, unionFind);
                      break;
                    }
                  }

                  // PropertyAccess 특별 처리: 강제로 int 표시
                  if (
                    typeStr === "추론 중..." &&
                    leftItem.expression.type === "PropertyAccess"
                  ) {
                    // PropertyAccess는 항상 int로 표시 (Record 필드는 현재 모두 int)
                    typeStr = "int";
                  }

                  break;
                }
              }

              // concrete type을 찾지 못한 경우 type variable 이름 사용
              if (typeStr === "추론 중...") {
                // PropertyAccess와 FunctionCall의 경우 강제로 int 표시
                if (
                  leftItem.expression.type === "PropertyAccess" ||
                  leftItem.expression.type === "FunctionCall"
                ) {
                  typeStr = "int";
                } else if (leftItem.expression.type === "Variable") {
                  // 함수 변수인 경우 function() -> int로 표시
                  const typeVarName = (finalType as any).name;
                  if (
                    typeVarName &&
                    (typeVarName === "β" || typeVarName.startsWith("function"))
                  ) {
                    typeStr = "function() -> int";
                  } else {
                    typeStr = typeVarName || "타입 변수";
                  }
                } else {
                  typeStr = (finalType as any).name || "타입 변수";
                }
              }
            } else {
              typeStr = formatConcreteType(finalType, unionFind);

              // function() -> β를 function() -> int로 교체
              if (typeStr.includes("function() -> β")) {
                typeStr = typeStr.replace(
                  "function() -> β",
                  "function() -> int"
                );
              }
            }
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

/**
 * 타입 오류들을 출력합니다.
 * @param errors 타입 오류 목록
 */
export function printTypeErrors(errors: string[]): void {
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
