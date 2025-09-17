import {
  ConcreteType,
  ConcretePointerType,
  ConcreteFunctionType,
  ConcreteTypeVariable,
  ConcreteRecursiveType,
  ConcreteRecordType,
} from "./types";

/**
 * Union-Find 자료구조를 이용한 타입 통합 클래스
 * 타입 변수들 간의 동등성을 관리하고 타입 충돌을 검출합니다.
 */
export class UnionFind {
  private parent: Map<string, string> = new Map();
  private rank: Map<string, number> = new Map();
  public typeInfo: Map<string, ConcreteType | null> = new Map();

  /**
   * 새로운 타입 변수 집합을 생성합니다.
   * @param id 타입 변수 ID
   * @param concreteType 구체적인 타입 (없으면 null)
   */
  makeSet(id: string, concreteType?: ConcreteType | null): void {
    this.parent.set(id, id);
    this.rank.set(id, 0);
    this.typeInfo.set(id, concreteType || null);
  }

  /**
   * 타입 변수의 대표 원소를 찾습니다 (Path compression 적용).
   * @param id 타입 변수 ID
   * @returns 대표 원소 ID
   */
  find(id: string): string {
    if (!this.parent.has(id)) {
      this.makeSet(id);
    }

    const parentId = this.parent.get(id)!;
    if (parentId !== id) {
      // Path compression으로 성능 최적화
      this.parent.set(id, this.find(parentId));
      return this.parent.get(id)!;
    }
    return id;
  }

  /**
   * 두 타입 변수를 통합합니다.
   * @param id1 첫 번째 타입 변수 ID
   * @param id2 두 번째 타입 변수 ID
   * @returns 통합 성공 시 true, 타입 충돌 시 false
   */
  union(id1: string, id2: string): boolean {
    const root1 = this.find(id1);
    const root2 = this.find(id2);

    if (root1 === root2) return true;

    // 타입 호환성 검사
    const type1 = this.typeInfo.get(root1);
    const type2 = this.typeInfo.get(root2);

    if (type1 && type2) {
      // 타입 변수는 모든 타입과 호환 가능 (type inference)
      if (type1.type === "typevar" || type2.type === "typevar") {
        if (type1.type === "typevar" && type2.type !== "typevar") {
          this.typeInfo.set(root1, type2);
        } else if (type2.type === "typevar" && type1.type !== "typevar") {
          this.typeInfo.set(root2, type1);
        }
      } else if (!this.isCompatible(type1, type2)) {
        return false; // 타입 충돌
      } else {
        // 호환 가능한 경우 더 구체적인 타입을 선택
        if (type1.type === "recursive" && type2.type === "function") {
          this.typeInfo.set(root1, type1); // recursive type 유지
        } else if (type2.type === "recursive" && type1.type === "function") {
          this.typeInfo.set(root2, type2); // recursive type 유지
        }
      }
    }

    // Union by rank로 트리 높이 최적화
    const rank1 = this.rank.get(root1)!;
    const rank2 = this.rank.get(root2)!;

    // 더 구체적인 타입(concrete type) 우선 선택
    const selectBetterType = (
      t1: ConcreteType | null | undefined,
      t2: ConcreteType | null | undefined
    ): ConcreteType | null => {
      if (!t1) return t2 || null;
      if (!t2) return t1 || null;
      // concrete type이 type variable보다 우선
      if (t1.type === "typevar" && t2.type !== "typevar") return t2;
      if (t2.type === "typevar" && t1.type !== "typevar") return t1;
      return t1; // 둘 다 같은 종류면 첫 번째 선택
    };

    if (rank1 < rank2) {
      this.parent.set(root1, root2);
      this.typeInfo.set(root2, selectBetterType(type2, type1));
    } else if (rank1 > rank2) {
      this.parent.set(root2, root1);
      this.typeInfo.set(root1, selectBetterType(type1, type2));
    } else {
      this.parent.set(root2, root1);
      this.rank.set(root1, rank1 + 1);
      this.typeInfo.set(root1, selectBetterType(type1, type2));
    }

    return true;
  }

  /**
   * 두 타입이 호환 가능한지 검사합니다.
   * @param type1 첫 번째 타입
   * @param type2 두 번째 타입
   * @returns 호환 가능하면 true
   */
  private isCompatible(type1: ConcreteType, type2: ConcreteType): boolean {
    // pointer와 int는 절대 호환되지 않음 (엄격한 타입 검사)
    if (
      (type1.type === "pointer" && type2.type === "int") ||
      (type1.type === "int" && type2.type === "pointer")
    ) {
      return false;
    }

    // recursive type과 function type 간 호환성 검사
    if (type1.type === "recursive" && type2.type === "function") {
      const recType = type1 as ConcreteRecursiveType;
      if (recType.body && recType.body.type === "function") {
        return this.isCompatible(recType.body, type2);
      }
    }
    if (type2.type === "recursive" && type1.type === "function") {
      const recType = type2 as ConcreteRecursiveType;
      if (recType.body && recType.body.type === "function") {
        return this.isCompatible(type1, recType.body);
      }
    }

    if (type1.type !== type2.type) return false;

    switch (type1.type) {
      case "int":
        return true;

      case "pointer":
        const ptrType1 = type1 as ConcretePointerType;
        const ptrType2 = type2 as ConcretePointerType;
        if (!ptrType1.pointsTo || !ptrType2.pointsTo) return true;

        // 타입 변수가 포함된 경우 항상 호환 (null 할당 허용)
        const hasTypeVar1 = this.hasTypeVariable(ptrType1.pointsTo);
        const hasTypeVar2 = this.hasTypeVariable(ptrType2.pointsTo);
        if (hasTypeVar1 || hasTypeVar2) {
          return true;
        }

        return this.isCompatible(ptrType1.pointsTo, ptrType2.pointsTo);

      case "function":
        const funcType1 = type1 as ConcreteFunctionType;
        const funcType2 = type2 as ConcreteFunctionType;

        if (funcType1.parameters.length !== funcType2.parameters.length)
          return false;

        // 매개변수 타입들 검사
        for (let i = 0; i < funcType1.parameters.length; i++) {
          if (
            !this.isCompatible(funcType1.parameters[i], funcType2.parameters[i])
          ) {
            return false;
          }
        }

        // 반환 타입 검사
        if (funcType1.returnType && funcType2.returnType) {
          return this.isCompatible(funcType1.returnType, funcType2.returnType);
        }

        return true;

      case "typevar":
        // 서로 다른 타입 변수들은 항상 통합 가능
        return true;

      case "recursive":
        const recType1 = type1 as ConcreteRecursiveType;
        const recType2 = type2 as ConcreteRecursiveType;
        return (
          recType1.variable === recType2.variable &&
          this.isCompatible(recType1.body, recType2.body)
        );

      case "record":
        const recordType1 = type1 as ConcreteRecordType;
        const recordType2 = type2 as ConcreteRecordType;

        // Record 타입의 구조적 호환성 검사
        // type1이 type2의 모든 필드를 포함하거나, type2가 type1의 모든 필드를 포함해야 함

        const isSubset = (
          smaller: ConcreteRecordType,
          larger: ConcreteRecordType
        ): boolean => {
          for (const field1 of smaller.fields) {
            const field2 = larger.fields.find((f) => f.name === field1.name);
            if (!field2) {
              return false; // 필드가 없음
            }
            if (!this.isCompatible(field1.fieldType, field2.fieldType)) {
              return false; // 필드 타입이 호환되지 않음
            }
          }
          return true;
        };

        // 구조적 서브타이핑: 한쪽이 다른 쪽의 부분집합이면 호환
        return (
          isSubset(recordType1, recordType2) ||
          isSubset(recordType2, recordType1)
        );

      default:
        return false;
    }
  }

  /**
   * 타입에 타입 변수가 포함되어 있는지 확인합니다.
   * @param type 검사할 타입
   * @returns 타입 변수가 포함되어 있으면 true
   */
  private hasTypeVariable(type: ConcreteType): boolean {
    if (type.type === "typevar") return true;

    if (type.type === "pointer") {
      const ptrType = type as ConcretePointerType;
      return ptrType.pointsTo ? this.hasTypeVariable(ptrType.pointsTo) : false;
    }

    if (type.type === "function") {
      const funcType = type as ConcreteFunctionType;
      if (funcType.parameters.some((p) => this.hasTypeVariable(p))) return true;
      return funcType.returnType
        ? this.hasTypeVariable(funcType.returnType)
        : false;
    }

    if (type.type === "record") {
      const recordType = type as ConcreteRecordType;
      return recordType.fields.some((field) =>
        this.hasTypeVariable(field.fieldType)
      );
    }

    // CustomType의 경우 expression을 확인
    if (
      (type as any).expression &&
      (type as any).expression.type === "Variable"
    ) {
      const varName = (type as any).expression.name;
      return /^[α-ω](\d+)?$/.test(varName); // 그리스 문자로 시작하는 타입 변수
    }

    return false;
  }

  /**
   * 타입 변수의 최종 타입을 조회합니다.
   * @param id 타입 변수 ID
   * @returns 최종 타입 (없으면 null)
   */
  getType(id: string): ConcreteType | null {
    const root = this.find(id);
    return this.typeInfo.get(root) || null;
  }

  /**
   * 모든 동등성 클래스를 조회합니다.
   * @returns 대표 원소별로 그룹화된 타입 변수들
   */
  getAllGroups(): Map<string, string[]> {
    const groups = new Map<string, string[]>();

    for (const id of this.parent.keys()) {
      const root = this.find(id);
      if (!groups.has(root)) {
        groups.set(root, []);
      }
      groups.get(root)!.push(id);
    }

    return groups;
  }

  /**
   * 특정 표현식과 연결된 타입을 조회합니다.
   * @param targetExpr 대상 표현식
   * @returns 연결된 타입 (없으면 null)
   */
  findConnectedTypes(targetExpr: any): ConcreteType | null {
    const targetId = `expr_${JSON.stringify(targetExpr).replace(/\s/g, "")}`;
    const root = this.find(targetId);

    const allGroups = this.getAllGroups();
    for (const [representative, members] of allGroups) {
      if (this.find(targetId) === representative) {
        for (const memberId of members) {
          const memberType = this.typeInfo.get(memberId);
          if (memberType) {
            return memberType;
          }
        }
      }
    }

    return null;
  }

  /**
   * 표현식 이름 패턴으로 타입을 검색합니다.
   * @param exprName 표현식 이름
   * @returns 매칭되는 타입 (없으면 null)
   */
  findTypeByPattern(exprName: string): ConcreteType | null {
    for (const [id, type] of this.typeInfo) {
      if (type && id.includes(exprName)) {
        return type;
      }
    }
    return null;
  }
}
