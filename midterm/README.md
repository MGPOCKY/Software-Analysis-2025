# TIP 언어 파서 · CFG/ICFG · Interval Analysis

TIP (Tiny Imperative Programming) 언어를 파싱하여 AST를 생성하고, CFG/ICFG를 구성한 뒤 Interval Analysis(Widening/Narrowing 포함)를 수행합니다. 결과는 Graphviz DOT(및 선택적 PDF)와 JSON으로 출력됩니다.

## 구현 내용

- [x] Flow-sensitive 분석
- [x] Interval analysis
- [x] Widening
- [x] Narrowing
- [x] Control-sensitive analysis
- [x] Inter-procedural analysis
- [-] Context-sensitive analysis (k-callsite sensitivity w/ parameterized k)

## 파일 구조

- `parser.ts` - TIP 파서 (Ohm.js 기반), 소스 → AST(`Program`)
- `tip-cfg-converter.ts` - 함수별 CFG 생성기 (DOT 내보내기 지원)
- `tip-icfg-converter.ts` - 프로그램 단일 ICFG 생성기 (함수 간 call/return 엣지 포함)
- `interval-analysis.ts` - ICFG 기반 Interval Analysis
  - threshold 기반 widen/normalize, 후속 narrowing 단계 포함
  - 분기 조건(`>`, `==`)에 대한 보수적 정제 지원
- `tip-all-in-one.ts` - 통합 실행 스크립트
  - AST 생성 및 저장: `output/ast.json`
  - CFG DOT(+PDF) 생성: `output/cfg/*.dot(.pdf)`
  - ICFG DOT(+PDF) 생성: `output/icfg/main.dot(.pdf)`
  - Interval 결과: `output/intervals.json`, `output/intervals_trace.json`
- `grammar.ohm` - TIP 문법 정의
- `types.ts` - AST 타입 정의
- `tip_code.txt` - 실행 입력 TIP 코드
- `test/` - 예제/평가용 입력 (`1. widening_narrowing.txt`, `2. control_sensitive.txt`, `3. interprocedural.txt`)

## 요구 사항

- Node.js (권장: v18+)
- `npm install`로 의존성 설치
- Graphviz(선택) 설치 시 DOT → PDF 자동 변환
  - macOS: `brew install graphviz`
  - Ubuntu: `sudo apt-get install graphviz`
  - Windows: `https://graphviz.org/download/`

## 실행 방법 (통합)

```bash
# 의존성 설치
npm install

# 입력 코드 편집
# - 분석할 TIP 코드를 midterm/tip_code.txt에 작성

# 통합 실행 (AST → CFG/ICFG → Interval → DOT/PDF 변환까지)
npm run tip-all

# 생성물은 midterm/output/ 아래에 저장됩니다.
```

Graphviz 미설치 시 DOT 파일만 생성되며, 다음과 같이 수동 변환할 수 있습니다.

```bash
dot -Tpdf output/cfg/<func>.dot -o output/cfg/<func>.pdf
dot -Tpdf output/icfg/main.dot -o output/icfg/main.pdf
```

## 출력물 요약

- `output/ast.json`: 파싱된 AST
- `output/cfg/`: 함수별 CFG DOT(+PDF)
- `output/icfg/main.dot(.pdf)`: 단일 ICFG
- `output/intervals.json`: 노드별 추정 구간 환경(Top/±inf 포함)
- `output/intervals_trace.json`: 고정점 수렴 과정(와이덴/내로잉) 추적 로그

## 참고

- `package.json`의 권장 스크립트: `tip-all`
  - 기타 과거 스크립트(`parser`, `cfg`, `normal`, `all`)는 현재 통합 흐름과 무관합니다.
