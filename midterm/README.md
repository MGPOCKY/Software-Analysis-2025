# TIP 언어 파서

TIP (Tiny Imperative Programming) 언어를 위한 파서 구현입니다.

## 파일 구조

- `parser.ts` - 메인 파서 클래스 (프로그램 코드를 AST로 변환)
- `tip-anf-converter.ts` - TIP AST를 ANF(Administrative Normal Form) CFG로 변환
- `tip-cfg-converter.ts` - TIP AST를 기본 CFG로 변환
  - ANF는 모든 중간 계산 결과를 임시 변수에 저장하는 형태로 변환
  - CFG는 프로그램의 제어 흐름을 그래프로 표현
  - 두 변환기 모두 Graphviz DOT 형식의 시각화 파일 생성
- `types.ts` - AST 노드 타입 정의
- `grammar.ohm` - Ohm.js 문법 정의
- `tip_code.txt` - TIP 프로그램 코드

## 설치 및 실행

```bash
# 의존성 설치
npm install

# 파서 실행
# tip_code.txt 파일 수정
# AST, CFG, ANF (A Normal Form) 변환
npm run tip-all

# output 폴더 확인
```
