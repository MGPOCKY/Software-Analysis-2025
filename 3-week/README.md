# TIP 언어 타입 체커

TIP (Tiny Imperative Programming) 언어를 위한 파서 및 타입 체커 구현입니다.

## 주요 기능

- **구문 분석**: TIP 언어 코드를 AST(Abstract Syntax Tree)로 변환
- **제어 흐름 분석**: CFG(Control Flow Graph) 및 ANF(Administrative Normal Form) 생성
- **타입 검사**: 제약 기반 타입 추론 및 타입 오류 검출
- **시각화**: Graphviz를 이용한 CFG 및 ANF 그래프 생성

## 파일 구조

### 핵심 컴포넌트

- `parser.ts` - TIP 언어 파서 (Ohm.js 기반)
- `types.ts` - AST 노드 및 타입 정의
- `grammar.ohm` - TIP 언어 문법 정의

### 제어 흐름 분석

- `tip-cfg-converter.ts` - AST를 기본 CFG로 변환
- `tip-anf-converter.ts` - AST를 ANF CFG로 변환
  - ANF: 모든 중간 계산 결과를 임시 변수에 저장하는 정규화된 형태
  - CFG: 프로그램의 제어 흐름을 그래프로 표현

### 타입 검사 시스템

- `tip-type-check.ts` - 메인 타입 체커 클래스
- `constraint-collector.ts` - AST 순회하며 타입 제약 조건 수집
- `type-validator.ts` - Union-Find 결과 기반 타입 오류 검출
- `union-find.ts` - 타입 통합을 위한 Union-Find 자료구조
- `type-utils.ts` - 타입 관련 유틸리티 함수들
- `output-formatter.ts` - 타입 검사 결과 포맷팅 및 출력

### 통합 실행 및 테스트

- `tip-all-in-one.ts` - 파싱, CFG/ANF 변환 통합 실행
- `run_tests_detailed.sh` - 자동화된 테스트 스크립트
- `test/` - 테스트 케이스 모음 (50개 파일)
  - `test01_*.txt` ~ `test25_*.txt`: 정상 케이스
  - `error01_*.txt` ~ `error25_*.txt`: 오류 케이스

## 지원하는 TIP 언어 기능

- **기본 타입**: 정수(`int`), 포인터(`*int`), 함수, 레코드
- **연산**: 산술 연산, 비교 연산, 포인터 연산
- **제어 구조**: `if-else`, `while` 루프
- **함수**: 함수 정의, 호출, 재귀
- **포인터**: 할당(`alloc`), 역참조(`*`), 주소 연산(`&`)
- **레코드**: 구조체 정의 및 필드 접근
- **입출력**: `input`, `output` 문

## 설치 및 실행

```bash
# 의존성 설치
npm install

# 전체 파이프라인 실행 (파싱 + CFG/ANF 변환)
npm run tip-all

# 타입 검사만 실행
npm run tip-type-check

# 전체 테스트 실행 (50개 테스트 케이스)
npm run tip-type-test

# 개별 실행
npm run parser    # 파싱만
npm run cfg      # CFG 변환만
npm run normal   # ANF 변환만
```

## 출력 파일

실행 후 `output/` 폴더에 다음 파일들이 생성됩니다:

- `ast.json` - 생성된 AST
- `cfg/` - 기본 CFG 그래프 파일들 (.dot, .pdf)
- `anf/` - ANF CFG 그래프 파일들 (.dot, .pdf)

## 타입 검사 예시

```tip
// tip_code.txt
main() {
  var x, y, z;
  x = input;
  y = alloc null;
  *y = x + 1;
  z = *y;
  output z;
  return 0;
}
```

타입 검사 결과:

- 변수 타입 추론
- 포인터 안전성 검증
- 함수 호출 타입 일치성 확인
- 상세한 오류 메시지 제공

## 테스트 케이스

- **정상 케이스 (25개)**: 기본 연산, 포인터, 함수, 레코드 등
- **오류 케이스 (25개)**: 타입 불일치, 포인터 오류, 함수 호출 오류 등

각 테스트는 자동으로 실행되며 성공/실패 여부와 상세한 오류 메시지를 제공합니다.
