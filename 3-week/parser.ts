import * as ohm from "ohm-js";
import * as fs from "fs";
import * as path from "path";
import {
  Program,
  FunctionDeclaration,
  Statement,
  Expression,
  AssignmentStatement,
  OutputStatement,
  IfStatement,
  WhileStatement,
  PointerAssignmentStatement,
  PropertyAssignmentStatement,
  DirectPropertyAssignmentStatement,
  ReturnStatement,
  NumberLiteral,
  Variable,
  BinaryExpression,
  UnaryExpression,
  FunctionCall,
  AllocExpression,
  AddressExpression,
  DereferenceExpression,
  NullLiteral,
  ObjectLiteral,
  PropertyAccess,
  InputExpression,
  PropertyDefinition,
  ParseResult,
  ParseOptions,
} from "./types";

export class TIPParser {
  private grammar: ohm.Grammar;
  private semantics!: ohm.Semantics; // definite assignment assertion

  constructor() {
    // 문법 파일 로드
    const grammarSource = fs.readFileSync(
      path.join(__dirname, "grammar.ohm"),
      "utf-8"
    );
    this.grammar = ohm.grammar(grammarSource);
    this.setupSemantics();
  }

  private setupSemantics() {
    this.semantics = this.grammar.createSemantics();

    this.semantics.addOperation("toAST", {
      // 프로그램
      Program(functions) {
        return {
          type: "Program",
          functions: functions.toAST(),
        } as Program;
      },

      // 함수 선언
      Function(
        name,
        _lparen,
        params,
        _rparen,
        _lbrace,
        varDecl,
        statements,
        _return,
        returnExpr,
        _semi,
        _rbrace
      ) {
        const paramList = params.numChildren > 0 ? params.toAST() : [];
        const localVars = varDecl.numChildren > 0 ? varDecl.toAST() : undefined;
        const stmtList = statements.toAST();
        const bodyStmts = stmtList;

        return {
          type: "FunctionDeclaration",
          name: name.sourceString,
          parameters: paramList,
          localVariables: localVars,
          body: bodyStmts,
          returnExpression: returnExpr.toAST(),
        } as FunctionDeclaration;
      },

      // 매개변수 목록
      Params(first, _commas, rest) {
        return [
          first.sourceString,
          ...rest.children.map((p: any) => p.sourceString),
        ];
      },

      // 변수 선언
      VarDecl(_var, first, _commas, rest, _semi) {
        return [
          first.sourceString,
          ...rest.children.map((v: any) => v.sourceString),
        ];
      },

      // 구문들
      Statement(stmt) {
        return stmt.toAST();
      },

      AssignmentStmt(variable, _eq, expr, _semi) {
        return {
          type: "AssignmentStatement",
          variable: variable.sourceString,
          expression: expr.toAST(),
        } as AssignmentStatement;
      },

      OutputStmt(_output, expr, _semi) {
        return {
          type: "OutputStatement",
          expression: expr.toAST(),
        } as OutputStatement;
      },

      IfStmt(_if, _lparen, condition, _rparen, thenBlock, elseClause) {
        const elseStatement =
          elseClause.numChildren > 0 ? elseClause.toAST() : undefined;
        return {
          type: "IfStatement",
          condition: condition.toAST(),
          thenStatement: thenBlock.toAST(),
          elseStatement,
        } as IfStatement;
      },

      ElseClause(_else, elseBlock) {
        return elseBlock.toAST();
      },

      WhileStmt(_while, _lparen, condition, _rparen, body) {
        return {
          type: "WhileStatement",
          condition: condition.toAST(),
          body: body.toAST(),
        } as WhileStatement;
      },

      Block(_lbrace, statements, _rbrace) {
        return statements.toAST();
      },

      BlockStatement(stmt) {
        return stmt.toAST();
      },

      PointerAssignStmt(_star, pointer, _eq, value, _semi) {
        return {
          type: "PointerAssignmentStatement",
          pointer: pointer.toAST(),
          value: value.toAST(),
        } as PointerAssignmentStatement;
      },

      PropertyAssignStmt(
        _lparen,
        _star,
        object,
        _rparen,
        _dot,
        property,
        _eq,
        value,
        _semi
      ) {
        return {
          type: "PropertyAssignmentStatement",
          object: object.toAST(),
          property: property.sourceString,
          value: value.toAST(),
        } as PropertyAssignmentStatement;
      },

      DirectPropertyAssignStmt(object, _dot, property, _eq, value, _semi) {
        return {
          type: "DirectPropertyAssignmentStatement",
          object: object.sourceString,
          property: property.sourceString,
          value: value.toAST(),
        } as DirectPropertyAssignmentStatement;
      },

      ReturnStmt(_return, expr, _semi) {
        return {
          type: "ReturnStatement",
          expression: expr.toAST(),
        };
      },

      // 표현식들
      ComparisonExpr_greater(left, _op, right) {
        return {
          type: "BinaryExpression",
          operator: ">",
          left: left.toAST(),
          right: right.toAST(),
        } as BinaryExpression;
      },

      ComparisonExpr_equal(left, _op, right) {
        return {
          type: "BinaryExpression",
          operator: "==",
          left: left.toAST(),
          right: right.toAST(),
        } as BinaryExpression;
      },

      ArithExpr_add(left, _op, right) {
        return {
          type: "BinaryExpression",
          operator: "+",
          left: left.toAST(),
          right: right.toAST(),
        } as BinaryExpression;
      },

      ArithExpr_sub(left, _op, right) {
        return {
          type: "BinaryExpression",
          operator: "-",
          left: left.toAST(),
          right: right.toAST(),
        } as BinaryExpression;
      },

      MulExpr_mul(left, _op, right) {
        return {
          type: "BinaryExpression",
          operator: "*",
          left: left.toAST(),
          right: right.toAST(),
        } as BinaryExpression;
      },

      MulExpr_div(left, _op, right) {
        return {
          type: "BinaryExpression",
          operator: "/",
          left: left.toAST(),
          right: right.toAST(),
        } as BinaryExpression;
      },

      UnaryExpr_deref(_star, expr) {
        return {
          type: "DereferenceExpression",
          expression: expr.toAST(),
        } as DereferenceExpression;
      },

      UnaryExpr_address(_amp, variable) {
        return {
          type: "AddressExpression",
          variable: variable.sourceString,
        } as AddressExpression;
      },

      PrimaryExpr_alloc(_alloc, expr) {
        return {
          type: "AllocExpression",
          expression: expr.toAST(),
        } as AllocExpression;
      },

      PrimaryExpr_null(_null) {
        return {
          type: "NullLiteral",
        } as NullLiteral;
      },

      PrimaryExpr_input(_input) {
        return {
          type: "InputExpression",
        } as InputExpression;
      },

      PrimaryExpr_paren(_lparen, expr, _rparen) {
        return expr.toAST();
      },

      PrimaryExpr_number(num) {
        return num.toAST();
      },

      PrimaryExpr_identifier(id) {
        return id.toAST();
      },

      FunctionCallOrAccess_call(callee, _lparen, args, _rparen) {
        const argList = args.numChildren > 0 ? args.toAST() : [];
        return {
          type: "FunctionCall",
          callee: callee.toAST(),
          arguments: argList,
        } as FunctionCall;
      },

      FunctionCallOrAccess_access(object, _dot, property) {
        return {
          type: "PropertyAccess",
          object: object.toAST(),
          property: property.sourceString,
        } as PropertyAccess;
      },

      FunctionCallOrAccess_base(id) {
        return {
          type: "Variable",
          name: id.sourceString,
        } as Variable;
      },

      Args(first, _commas, rest) {
        return [first.toAST(), ...rest.children.map((arg: any) => arg.toAST())];
      },

      ObjectLiteral(_lbrace, properties, _rbrace) {
        const propList = properties.numChildren > 0 ? properties.toAST() : [];
        return {
          type: "ObjectLiteral",
          properties: propList,
        } as ObjectLiteral;
      },

      Properties(first, _commas, rest) {
        return [
          first.toAST(),
          ...rest.children.map((prop: any) => prop.toAST()),
        ];
      },

      Property(key, _colon, value) {
        return {
          key: key.sourceString,
          value: value.toAST(),
        } as PropertyDefinition;
      },

      // 기본 타입들
      number(_digits) {
        return {
          type: "NumberLiteral",
          value: parseInt(this.sourceString, 10),
        } as NumberLiteral;
      },

      identifier(_letter, _rest) {
        return {
          type: "Variable",
          name: this.sourceString,
        } as Variable;
      },

      // 기본 처리
      _terminal() {
        return this.sourceString;
      },

      _iter(...children) {
        return children.map((child) => child.toAST());
      },
    });
  }

  parse(source: string, options: ParseOptions = {}): ParseResult {
    try {
      const matchResult = this.grammar.match(source);

      if (matchResult.failed()) {
        const error = matchResult.message;
        const errorInfo = matchResult.getInterval();

        return {
          success: false,
          error: `Parse error: ${error}`,
          errorLocation: {
            line: errorInfo.startIdx, // Ohm.js는 인덱스만 제공하므로 실제 라인/컬럼 계산 필요
            column: 0,
          },
        };
      }

      const ast = this.semantics(matchResult).toAST() as Program;

      return {
        success: true,
        ast,
      };
    } catch (error) {
      return {
        success: false,
        error: `Unexpected error: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }
  }

  // 편의 함수: 파일에서 파싱
  parseFile(filePath: string, options: ParseOptions = {}): ParseResult {
    try {
      const source = fs.readFileSync(filePath, "utf-8");
      return this.parse(source, options);
    } catch (error) {
      return {
        success: false,
        error: `Failed to read file: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }
  }
}

// 메인 실행 부분
if (require.main === module) {
  const parser = new TIPParser();

  // 테스트 코드
  const testCode = `
  main() {
    var x, y;
    x = 5;
    y = x + 10;
    output y;
    return x;
  }

  add(a, b) {
    return a + b;
  }
  `;

  console.log("=== TIP Parser 테스트 ===");
  const result = parser.parse(testCode);

  if (result.success) {
    console.log("파싱 성공!");
    console.log(JSON.stringify(result.ast, null, 2));
  } else {
    console.error("파싱 실패:", result.error);
    if (result.errorLocation) {
      console.error("에러 위치:", result.errorLocation);
    }
  }
}

export default TIPParser;
