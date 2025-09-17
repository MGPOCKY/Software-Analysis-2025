// TIP 언어의 AST 노드 타입 정의

export interface ASTNode {
  type: string;
  location?: {
    line: number;
    column: number;
  };
}

// 프로그램: 함수들의 배열
export interface Program extends ASTNode {
  type: "Program";
  functions: FunctionDeclaration[];
}

// 함수 선언
export interface FunctionDeclaration extends ASTNode {
  type: "FunctionDeclaration";
  name: string;
  parameters: string[];
  localVariables?: string[]; // var x, ..., x; (optional)
  body: Statement;
  returnExpression: Expression;
}

// 구문들 (Statement)
export type Statement =
  | AssignmentStatement
  | OutputStatement
  | SequenceStatement
  | IfStatement
  | WhileStatement
  | PointerAssignmentStatement
  | PropertyAssignmentStatement
  | DirectPropertyAssignmentStatement
  | ReturnStatement;

export interface AssignmentStatement extends ASTNode {
  type: "AssignmentStatement";
  variable: string;
  expression: Expression;
}

export interface OutputStatement extends ASTNode {
  type: "OutputStatement";
  expression: Expression;
}

export interface SequenceStatement extends ASTNode {
  type: "SequenceStatement";
  statements: Statement[];
}

export interface IfStatement extends ASTNode {
  type: "IfStatement";
  condition: Expression;
  thenStatement: Statement;
  elseStatement?: Statement; // optional
}

export interface WhileStatement extends ASTNode {
  type: "WhileStatement";
  condition: Expression;
  body: Statement;
}

export interface PointerAssignmentStatement extends ASTNode {
  type: "PointerAssignmentStatement";
  pointer: Expression;
  value: Expression;
}

export interface PropertyAssignmentStatement extends ASTNode {
  type: "PropertyAssignmentStatement";
  object: Expression;
  property: string;
  value: Expression;
}

export interface DirectPropertyAssignmentStatement extends ASTNode {
  type: "DirectPropertyAssignmentStatement";
  object: string;
  property: string;
  value: Expression;
}

export interface ReturnStatement extends ASTNode {
  type: "ReturnStatement";
  expression: Expression;
}

// 표현식들 (Expression)
export type Expression =
  | NumberLiteral
  | Variable
  | BinaryExpression
  | UnaryExpression
  | FunctionCall
  | AllocExpression
  | AddressExpression
  | DereferenceExpression
  | NullLiteral
  | ObjectLiteral
  | PropertyAccess
  | InputExpression;

export interface NumberLiteral extends ASTNode {
  type: "NumberLiteral";
  value: number;
}

export interface Variable extends ASTNode {
  type: "Variable";
  name: string;
}

export interface BinaryExpression extends ASTNode {
  type: "BinaryExpression";
  operator: "+" | "-" | "*" | "/" | ">" | "==";
  left: Expression;
  right: Expression;
}

export interface UnaryExpression extends ASTNode {
  type: "UnaryExpression";
  operator: "*" | "&";
  operand: Expression;
}

export interface FunctionCall extends ASTNode {
  type: "FunctionCall";
  callee: Expression;
  arguments: Expression[];
}

export interface AllocExpression extends ASTNode {
  type: "AllocExpression";
  expression: Expression;
}

export interface AddressExpression extends ASTNode {
  type: "AddressExpression";
  variable: string;
}

export interface DereferenceExpression extends ASTNode {
  type: "DereferenceExpression";
  expression: Expression;
}

export interface NullLiteral extends ASTNode {
  type: "NullLiteral";
}

export interface ObjectLiteral extends ASTNode {
  type: "ObjectLiteral";
  properties: PropertyDefinition[];
}

export interface PropertyDefinition {
  key: string;
  value: Expression;
}

export interface PropertyAccess extends ASTNode {
  type: "PropertyAccess";
  object: Expression;
  property: string;
}

export interface InputExpression extends ASTNode {
  type: "InputExpression";
}

// 파서 옵션
export interface ParseOptions {
  includeLocation?: boolean;
}

// 파서 결과
export interface ParseResult {
  success: boolean;
  ast?: Program;
  error?: string;
  errorLocation?: {
    line: number;
    column: number;
  };
}
