import TIPParser from "./parser";
import { TIPCFGConverter } from "./tip-cfg-converter";
import { TIPICFGConverter } from "./tip-icfg-converter";
import { runIntervalAnalysisFromFile } from "./interval-analysis";
import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";

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

function checkGraphvizInstalled(): boolean {
  try {
    execSync("dot -V", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

async function processAllTIP() {
  colorLog("cyan", "🚀 === TIP 통합 처리 시작 ===\n");

  // 출력 폴더 생성
  const outputDir = "output";
  const cfgDir = path.join(outputDir, "cfg");
  const icfgDir = path.join(outputDir, "icfg");

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
    colorLog("blue", `📁 출력 폴더 생성: ${outputDir}/`);
  }
  if (!fs.existsSync(cfgDir)) {
    fs.mkdirSync(cfgDir, { recursive: true });
    colorLog("blue", `📁 CFG 폴더 생성: ${cfgDir}/`);
  }
  if (!fs.existsSync(icfgDir)) {
    fs.mkdirSync(icfgDir, { recursive: true });
    colorLog("blue", `📁 ICFG 폴더 생성: ${icfgDir}/`);
  }

  // 1. tip_code.txt 파일 읽기
  const inputFile = "tip_code.txt";
  if (!fs.existsSync(inputFile)) {
    colorLog("red", `❌ 오류: ${inputFile} 파일이 존재하지 않습니다.`);
    colorLog(
      "yellow",
      "💡 tip_code.txt 파일을 생성하고 TIP 코드를 입력해주세요."
    );
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

  // AST를 JSON 파일로 저장
  const astJson = JSON.stringify(parseResult.ast, null, 2);
  const astFile = path.join(outputDir, "ast.json");
  fs.writeFileSync(astFile, astJson);
  colorLog("blue", `📄 AST 저장: ${astFile}`);

  // 3. CFG 생성
  colorLog("yellow", "\n🔄 2단계: CFG 생성...");
  const cfgConverter = new TIPCFGConverter();
  const cfgs = cfgConverter.convertProgram(parseResult.ast!);

  colorLog("green", `✅ CFG 생성 완료 (${cfgs.size}개 함수)`);

  // CFG DOT 파일들 생성
  const cfgFiles: string[] = [];
  for (const [funcName, cfg] of cfgs.entries()) {
    const dotContent = cfg.toDot(funcName);
    const dotFileName = path.join(cfgDir, `${funcName}.dot`);
    fs.writeFileSync(dotFileName, dotContent);
    cfgFiles.push(dotFileName);
    colorLog("blue", `📄 CFG DOT 파일: ${dotFileName}`);
  }

  // 4. ICFG 생성 (단일 그래프)
  colorLog("yellow", "\n🔄 3단계: ICFG 생성...");
  const icfgConverter = new TIPICFGConverter();
  const unifiedICFG = icfgConverter.convertProgramUnified(parseResult.ast!);
  colorLog("green", `✅ ICFG 생성 완료 (단일 그래프)`);

  // ICFG 단일 DOT 파일 생성
  const icfgFiles: string[] = [];
  const icfgCombinedFile = path.join(icfgDir, `main.dot`);
  fs.writeFileSync(icfgCombinedFile, unifiedICFG.toDot("ICFG"));
  icfgFiles.push(icfgCombinedFile);
  colorLog("blue", `📄 ICFG DOT 파일: ${icfgCombinedFile}`);

  // 4.5 Interval Analysis (Monotone Framework, widening/narrowing 미적용)
  colorLog("yellow", "\n🧮 3.5단계: Interval Analysis...");
  try {
    const intervalsPath = runIntervalAnalysisFromFile(inputFile, outputDir);
    colorLog("green", `✅ Interval 결과 저장: ${intervalsPath}`);
  } catch (e) {
    colorLog(
      "red",
      `❌ Interval 분석 실패: ${e instanceof Error ? e.message : String(e)}`
    );
  }

  // 5. Graphviz 설치 확인 및 PDF 변환
  colorLog("yellow", "\n🖼️  4단계: PDF 변환...");

  if (!checkGraphvizInstalled()) {
    colorLog("red", "❌ Graphviz가 설치되지 않았습니다.");
    colorLog("yellow", "💡 설치 방법:");
    colorLog("yellow", "   macOS: brew install graphviz");
    colorLog("yellow", "   Ubuntu: sudo apt-get install graphviz");
    colorLog("yellow", "   Windows: https://graphviz.org/download/");
    colorLog(
      "blue",
      "\n📄 DOT 파일들이 생성되었습니다. Graphviz 설치 후 다음 명령어로 PDF 변환 가능:"
    );
    [...cfgFiles, ...icfgFiles].forEach((file) => {
      const pdfFile = file.replace(".dot", ".pdf");
      colorLog("blue", `   dot -Tpdf ${file} -o ${pdfFile}`);
    });
    return;
  }

  colorLog("green", "✅ Graphviz 설치 확인됨");

  // CFG/ICFG PDF 변환
  colorLog("blue", "🔄 CFG PDF 변환 중...");
  for (const dotFile of [...cfgFiles, ...icfgFiles]) {
    try {
      const pdfFile = dotFile.replace(".dot", ".pdf");
      execSync(`dot -Tpdf "${dotFile}" -o "${pdfFile}"`, { stdio: "ignore" });
      colorLog("green", `✅ ${pdfFile} 생성 완료`);
    } catch (error) {
      colorLog("red", `❌ ${dotFile} PDF 변환 실패: ${error}`);
    }
  }

  // 6. 결과 요약
  colorLog("cyan", "\n🎉 === 처리 완료 ===");
  colorLog("green", `생성된 파일들:`);

  colorLog("blue", "\n📊 AST:");
  colorLog("blue", `  - ${astFile}`);

  colorLog("blue", "\n📈 CFG (cfg/ 폴더):");
  cfgFiles.forEach((file) => {
    colorLog("blue", `  - ${file}`);
    const pdfFile = file.replace(".dot", ".pdf");
    if (fs.existsSync(pdfFile)) {
      colorLog("blue", `  - ${pdfFile}`);
    }
  });

  colorLog("blue", "\n📉 ICFG (icfg/ 폴더):");
  icfgFiles.forEach((file) => {
    colorLog("blue", `  - ${file}`);
    const pdfFile = file.replace(".dot", ".pdf");
    if (fs.existsSync(pdfFile)) {
      colorLog("blue", `  - ${pdfFile}`);
    }
  });

  colorLog("cyan", "\n✨ 모든 처리가 완료되었습니다!");
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
  processAllTIP().catch((error) => {
    colorLog("red", `❌ 실행 오류: ${error.message}`);
    process.exit(1);
  });
}

export default processAllTIP;
