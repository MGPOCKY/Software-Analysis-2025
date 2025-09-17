#!/bin/bash

# 색상 정의
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🚀 TIP Type Checker 전체 테스트 시작${NC}"
echo "=============================================="

# 테스트 결과 추적
TOTAL_TESTS=0
PASSED_TESTS=0
FAILED_TESTS=0

# test 폴더로 이동
cd test

echo -e "\n${YELLOW}📋 1단계: test*.txt 파일들 (타입 오류가 없어야 함)${NC}"
echo "----------------------------------------------"

for file in test*.txt; do
    if [ -f "$file" ]; then
        TOTAL_TESTS=$((TOTAL_TESTS + 1))
        echo -n "Testing $file... "

        # tip_code.txt에 파일 내용 복사
        cp "$file" ../tip_code.txt

        # 타입 체커 실행 (stderr를 stdout으로 리다이렉트하여 에러도 캡처)
        cd ..
        OUTPUT=$(ts-node tip-type-check.ts 2>&1)
        EXIT_CODE=$?
        cd test

        # 타입 오류가 없어야 함 (✅ 타입 오류가 발견되지 않았습니다!)
        if echo "$OUTPUT" | grep -q "✅ 타입 오류가 발견되지 않았습니다!" && [ $EXIT_CODE -eq 0 ]; then
            echo -e "${GREEN}PASS${NC}"
            PASSED_TESTS=$((PASSED_TESTS + 1))
        else
            echo -e "${RED}FAIL${NC}"
            echo "  Expected: No type errors"
            echo "  Got: Type errors or execution failed"
            FAILED_TESTS=$((FAILED_TESTS + 1))
        fi
    fi
done

echo -e "\n${YELLOW}📋 2단계: error*.txt 파일들 (타입 오류가 있어야 함)${NC}"
echo "----------------------------------------------"

for file in error*.txt; do
    if [ -f "$file" ]; then
        TOTAL_TESTS=$((TOTAL_TESTS + 1))
        echo -n "Testing $file... "

        # tip_code.txt에 파일 내용 복사
        cp "$file" ../tip_code.txt

        # 타입 체커 실행
        cd ..
        OUTPUT=$(ts-node tip-type-check.ts 2>&1)
        EXIT_CODE=$?
        cd test

        # 타입 오류가 있어야 함 (❌ N개의 타입 오류가 발견되었습니다)
        if echo "$OUTPUT" | grep -q "❌.*타입 오류가 발견되었습니다" && [ $EXIT_CODE -eq 0 ]; then
            echo -e "${GREEN}PASS${NC}"
            PASSED_TESTS=$((PASSED_TESTS + 1))
        else
            echo -e "${RED}FAIL${NC}"
            echo "  Expected: Type errors"
            echo "  Got: No type errors or execution failed"
            FAILED_TESTS=$((FAILED_TESTS + 1))
        fi
    fi
done

# 결과 요약
echo -e "\n${BLUE}=============================================="
echo -e "🏁 테스트 결과 요약${NC}"
echo "=============================================="
echo -e "전체 테스트: ${TOTAL_TESTS}개"
echo -e "${GREEN}통과: ${PASSED_TESTS}개${NC}"
echo -e "${RED}실패: ${FAILED_TESTS}개${NC}"
echo "=============================================="

if [ $FAILED_TESTS -eq 0 ]; then
    echo -e "${GREEN}🎉 모든 테스트가 통과했습니다!${NC}"
    exit 0
else
    echo -e "${RED}💥 ${FAILED_TESTS}개의 테스트가 실패했습니다.${NC}"
    exit 1
fi
