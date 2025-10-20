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
  SequenceStatement,
  IfStatement,
  WhileStatement,
  ReturnStatement,
  AssertStatement,
  NumberLiteral,
  Variable,
  BinaryExpression,
  FunctionCall,
  InputExpression,
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
        returnStmt,
        _rbrace
      ) {
        const paramList = params.numChildren > 0 ? params.toAST() : [];
        const localVars = varDecl.numChildren > 0 ? varDecl.toAST() : undefined;
        const stmtList = statements.toAST();
        const bodyStmt =
          stmtList.length > 0
            ? stmtList.length === 1
              ? stmtList[0]
              : ({
                  type: "SequenceStatement",
                  statements: stmtList,
                } as SequenceStatement)
            : ({
                type: "SequenceStatement",
                statements: [],
              } as SequenceStatement);

        return {
          type: "FunctionDeclaration",
          name: name.sourceString,
          parameters: paramList,
          localVariables: localVars,
          body: bodyStmt,
          returnExpression: returnStmt.toAST(),
        } as FunctionDeclaration;
      },
      ReturnStmt(_return, expr, _semi) {
        // ReturnStmt는 최종 리턴 식만 반환(Statement 노드가 아님)
        return expr.toAST();
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

      CallStmt(id, _lparen, args, _rparen, _semi) {
        if (id.sourceString === "assert") {
          return {
            type: "AssertStatement",
            condition: args.children[0].toAST()[0],
          } as AssertStatement;
        } else {
          const argList = args.numChildren > 0 ? args.toAST() : [];
          return {
            type: "CallStatement",
            expression: {
              type: "FunctionCall",
              callee: {
                type: "Variable",
                name: id.sourceString,
              },
              arguments: argList,
            },
          };
        }
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
        const stmts = statements.toAST();
        if (stmts.length === 0) {
          return {
            type: "SequenceStatement",
            statements: [],
          } as SequenceStatement;
        } else if (stmts.length === 1) {
          return stmts[0];
        } else {
          return {
            type: "SequenceStatement",
            statements: stmts,
          } as SequenceStatement;
        }
      },

      BlockStatement(stmt) {
        return stmt.toAST();
      },

      // 함수 내부 조기 return은 문법상 제거됨

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

      FunctionCallOrAccess_base(id) {
        return {
          type: "Variable",
          name: id.sourceString,
        } as Variable;
      },

      // CallStmt 에서 받은 형태는 FunctionCallOrAccess '(' Args? ')' ';' 이므로
      // CallStmt에서 이미 expr.toAST()가 함수 호출로 온다고 가정

      Args(first, _commas, rest) {
        return [first.toAST(), ...rest.children.map((arg: any) => arg.toAST())];
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

export default TIPParser;
