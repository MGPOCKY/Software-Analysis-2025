#!/bin/bash

# 조용한 모드 테스트 러너 (적당한 상세 출력)
# 색상 정의
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
NC='\033[0m'

echo -e "${BLUE}🚀 TIP Type Checker - Detailed Mode${NC}"
echo "=============================================="

cd "$(dirname "$0")"

# TypeScript 컴파일
echo -e "${YELLOW}⚡ TypeScript 컴파일 중...${NC}"
npx tsc --project tsconfig.json --outDir dist > /dev/null 2>&1
if [ $? -ne 0 ]; then
    echo -e "${RED}❌ 컴파일 실패${NC}"
    exit 1
fi
echo -e "${GREEN}✅ 컴파일 완료${NC}"

# grammar.ohm 파일을 dist 폴더에 복사
cp grammar.ohm dist/ 2>/dev/null

# 카운터 및 배열
TOTAL=0
PASS=0
FAIL=0
FAILED_TESTS=()
CURRENT_CATEGORY=""

# 진행 표시 함수
show_progress() {
    local current=$1
    local total=$2
    local width=50
    local percent=$((current * 100 / total))
    local filled=$((current * width / total))

    printf "\r["
    for ((i=0; i<filled; i++)); do printf "#"; done
    for ((i=filled; i<width; i++)); do printf "."; done
    printf "] %d%% (%d/%d)" $percent $current $total
}

# 테스트 실행 함수 (상세 모드)
test_file() {
    local file="$1"
    local expect="$2"

    cp "test/$file" tip_code.txt 2>/dev/null
    
    # 실행 시간 측정
    local start_time=$(date +%s.%N)
    local output=$(timeout 5s node dist/tip-type-check.js 2>&1)
    local result=$?
    local end_time=$(date +%s.%N)
    local duration=$(echo "$end_time - $start_time" | bc -l 2>/dev/null || echo "0.0")
    
    TOTAL=$((TOTAL + 1))
    
    # 현재 진행 상황 표시 (파일명 줄임)
    local short_name=$(echo "$file" | sed 's/\.txt$//')
    printf "%-35s" "$short_name"

    if [ "$expect" = "pass" ]; then
        if echo "$output" | grep -q "✅ 타입 오류가 발견되지 않았습니다" && [ $result -eq 0 ]; then
            PASS=$((PASS + 1))
            printf "${GREEN}PASS${NC} (%.2fs)\n" "$duration"
        else
            FAIL=$((FAIL + 1))
            FAILED_TESTS+=("$file:$expect:$output")
            printf "${RED}FAIL${NC} (%.2fs)\n" "$duration"
        fi
    else
        if echo "$output" | grep -q "❌.*타입 오류가 발견되었습니다" && [ $result -eq 0 ]; then
            PASS=$((PASS + 1))
            printf "${GREEN}PASS${NC} (%.2fs)\n" "$duration"
        else
            FAIL=$((FAIL + 1))
            FAILED_TESTS+=("$file:$expect:$output")
            printf "${RED}FAIL${NC} (%.2fs)\n" "$duration"
        fi
    fi
}

# 전체 시작 시간 기록
START_TIME=$(date +%s.%N)

echo -e "\n${YELLOW}📋 Valid Tests (타입 오류가 없어야 함)${NC}"
echo "----------------------------------------------"

# test*.txt 파일들 (성공해야 함)
CURRENT_CATEGORY="valid"
for file in test/test*.txt; do
    [ -f "$file" ] && test_file "$(basename "$file")" "pass"
done

echo -e "\n${YELLOW}📋 Error Tests (타입 오류가 있어야 함)${NC}"
echo "----------------------------------------------"

# error*.txt 파일들 (실패해야 함)
CURRENT_CATEGORY="error"
for file in test/error*.txt; do
    [ -f "$file" ] && test_file "$(basename "$file")" "error"
done

# 전체 종료 시간 계산
END_TIME=$(date +%s.%N)
TOTAL_DURATION=$(echo "$END_TIME - $START_TIME" | bc -l 2>/dev/null || echo "0.0")

echo # 새 줄

# 상세 결과 출력
echo -e "\n${BLUE}=============================================="
echo -e "🏁 테스트 결과 요약${NC}"
echo "=============================================="
echo -e "전체 테스트: ${TOTAL}개"
echo -e "${GREEN}통과: ${PASS}개${NC}"
echo -e "${RED}실패: ${FAIL}개${NC}"
printf "총 실행 시간: ${CYAN}%.2f초${NC}\n" "$TOTAL_DURATION"
printf "평균 테스트 시간: ${CYAN}%.2f초${NC}\n" $(echo "$TOTAL_DURATION / $TOTAL" | bc -l 2>/dev/null || echo "0.0")

# 실패한 테스트 상세 정보
if [ ${#FAILED_TESTS[@]} -gt 0 ]; then
    echo -e "\n${RED}💥 실패한 테스트 상세 정보:${NC}"
    echo "=============================================="
    
    for failed_test in "${FAILED_TESTS[@]}"; do
        IFS=':' read -r filename expected_result output <<< "$failed_test"
        echo -e "\n${MAGENTA}📄 $filename${NC}"
        echo -e "예상 결과: ${YELLOW}$expected_result${NC}"
        
        # 실패 이유 분석
        if [ "$expected_result" = "pass" ]; then
            echo -e "실제 결과: ${RED}타입 오류 발견 (오류가 없어야 함)${NC}"
        else
            echo -e "실제 결과: ${RED}타입 오류 없음 (오류가 있어야 함)${NC}"
        fi
        
        # 타입 체커 출력 중 오류 메시지만 표시
        if echo "$output" | grep -q "❌"; then
            echo -e "${CYAN}오류 내용:${NC}"
            echo "$output" | grep -A 3 "❌" | head -5
        fi
        echo "--------------------"
    done
fi

echo "=============================================="

if [ $FAIL -eq 0 ]; then
    echo -e "${GREEN}🎉 모든 테스트가 통과했습니다!${NC}"
    exit 0
else
    echo -e "${RED}💥 ${FAIL}개의 테스트가 실패했습니다.${NC}"
    exit 1
fi
