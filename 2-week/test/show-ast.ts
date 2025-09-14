import TIPParser from "../parser";

// 특정 코드의 AST를 자세히 보여주는 함수
function showAST(name: string, code: string) {
  const parser = new TIPParser();
  console.log(`\n=== ${name} ===`);
  console.log("소스 코드:");
  console.log(code.trim());
  console.log("\nAST:");

  const result = parser.parse(code.trim());
  if (result.success) {
    console.log(JSON.stringify(result.ast, null, 2));
  } else {
    console.error("파싱 실패:", result.error);
  }
  console.log("\n" + "=".repeat(50));
}

// 다양한 예제들의 AST 보기
const examples = [
  {
    name: "기본 함수",
    code: `
      main() {
        return 42;
      }
    `,
  },
  {
    name: "변수와 연산",
    code: `
      calc(x, y) {
        var result;
        result = x * y + 10;
        return result;
      }
    `,
  },
  {
    name: "조건문",
    code: `
      max(a, b) {
        var result;
        if (a > b) {
          result = a;
        } else {
          result = b;
        }
        return result;
      }
    `,
  },
  {
    name: "객체와 속성",
    code: `
      getPoint() {
        var p;
        p = {x: 10, y: 20};
        return p.x + p.y;
      }
    `,
  },
  {
    name: "포인터 연산",
    code: `
      swap(x, y) {
        var temp;
        temp = *x;
        *x = *y;
        *y = temp;
        return 0;
      }
    `,
  },
];

// 명령줄 인자가 있으면 특정 예제만 실행
if (process.argv.length > 2) {
  const index = parseInt(process.argv[2], 10);
  if (index >= 0 && index < examples.length) {
    showAST(examples[index].name, examples[index].code);
  } else {
    console.log("사용법: npx ts-node show-ast.ts [0-4]");
    console.log("예제 목록:");
    examples.forEach((example, i) => {
      console.log(`  ${i}: ${example.name}`);
    });
  }
} else {
  // 모든 예제 실행
  examples.forEach((example) => {
    showAST(example.name, example.code);
  });
}
