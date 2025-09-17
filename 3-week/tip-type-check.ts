import TIPParser from "./parser";
import { TIPANFConverter } from "./tip-anf-converter";
import { Program, TypeConstraint } from "./types";
import * as fs from "fs";

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
  constraints.forEach((constraint, index) => {
    colorLog("blue", `  ${index + 1}. ${constraint.originAST.type}`);
  });

  colorLog("cyan", "\n✨ Type Checking 처리 완료!");
}

// AST를 순회하면서 Type Constraint 수집
function collectTypeConstraints(ast: Program): TypeConstraint[] {
  const constraints: TypeConstraint[] = [];

  // TODO: AST 순회하면서 Type Constraint 수집하는 코드
  // 여기서 구현할 예정
  for (const func of ast.functions) {
    // FunctionDeclarationType
    for (const stmt of func.body) {
      // StatementType
      switch (stmt.type) {
        case "AssignmentStatement":
          // AssignmentStatementType
          break;
        case "OutputStatement":
          // OutputStatementType
          break;
        // To do: 레코드 타입 추가 시 구현
        case "DirectPropertyAssignmentStatement":
          // DirectPropertyAssignmentStatementType
          break;
        case "IfStatement":
          // IfStatementType
          break;
        case "WhileStatement":
          // WhileStatementType
          break;
        case "PointerAssignmentStatement":
          // PointerAssignmentStatementType
          break;
      }
    }
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
