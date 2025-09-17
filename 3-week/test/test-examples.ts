import TIPParser from "../parser";

// TIP 언어 테스트 예제들
const examples = {
  // 기본 함수
  basic: `
    main() {
      return 42;
    }
  `,

  // 변수와 연산
  variables: `
    calc(x, y) {
      var result;
      result = x * y + 10;
      return result;
    }
  `,

  // 조건문
  conditional: `
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

  // 반복문 (n > i로 조건 변경)
  loop: `
    factorial(n) {
      var result, i;
      result = 1;
      i = 1;
      while (n > i) {
        result = result * i;
        i = i + 1;
      }
      return result;
    }
  `,

  // 포인터 연산
  pointers: `
    swap(x, y) {
      var temp;
      temp = *x;
      *x = *y;
      *y = temp;
      return 0;
    }
  `,

  // 객체 접근
  objects: `
    getPoint() {
      var p;
      p = {x: 10, y: 20};
      return p.x + p.y;
    }
  `,

  // 복합 예제
  complex: `
    main() {
      var x, y, p;
      x = 5;
      y = 10;
      p = alloc {x: x, y: y};
      (*p).x = 15;
      output p.x;
      return p.x + p.y;
    }

    helper(n) {
      if (n == 0) {
        return 1;
      }
      return n * helper(n - 1);
    }
  `,
};

// 모든 예제 테스트
function testAllExamples() {
  const parser = new TIPParser();

  console.log("=== TIP Parser 종합 테스트 ===\n");

  for (const [name, code] of Object.entries(examples)) {
    console.log(`--- ${name.toUpperCase()} 테스트 ---`);
    const result = parser.parse(code.trim());

    if (result.success) {
      console.log("✓ 파싱 성공");
      console.log(`함수 개수: ${result.ast?.functions.length}`);
      result.ast?.functions.forEach((func) => {
        console.log(`- ${func.name}(${func.parameters.join(", ")})`);
      });
    } else {
      console.log("✗ 파싱 실패:", result.error);
    }
    console.log("");
  }
}

if (require.main === module) {
  testAllExamples();
}
