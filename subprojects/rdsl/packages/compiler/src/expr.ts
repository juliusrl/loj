/**
 * ReactDSL Expression Parser
 *
 * Parses the constrained rule language used in visibleIf/enabledIf/allowIf/enforce.
 * This is intentionally NOT JavaScript — it's a tiny, safe expression language.
 *
 * Supported:
 *   - Literals: "admin", 42, true, false
 *   - Identifiers: currentUser.role, record.status
 *   - Comparisons: ==, !=, >, <, >=, <=
 *   - Logical: &&, ||, not
 *   - Membership: in
 *   - Built-in calls: hasRole(), isOwner(), isEmpty(), isNotEmpty(), count()
 *
 * NOT supported (by design):
 *   - Loops, mutation, closures, imports, arbitrary function calls
 */

import type { ExprNode, BinaryOp, BuiltinFn } from './ir.js';

const BUILTINS: Set<string> = new Set(['hasRole', 'isOwner', 'isEmpty', 'isNotEmpty', 'count']);

// ─── Tokenizer ───────────────────────────────────────────────────

type TokenType =
  | 'string' | 'number' | 'boolean' | 'identifier'
  | 'dot' | 'lparen' | 'rparen' | 'comma'
  | 'plus' | 'minus' | 'star' | 'slash'
  | 'eq' | 'neq' | 'gt' | 'lt' | 'gte' | 'lte'
  | 'and' | 'or' | 'not' | 'in'
  | 'eof';

interface Token {
  type: TokenType;
  value: string;
  pos: number;
}

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < input.length) {
    // Skip whitespace
    if (/\s/.test(input[i])) { i++; continue; }

    // Two-char operators
    if (i + 1 < input.length) {
      const two = input.substring(i, i + 2);
      if (two === '==') { tokens.push({ type: 'eq', value: '==', pos: i }); i += 2; continue; }
      if (two === '!=') { tokens.push({ type: 'neq', value: '!=', pos: i }); i += 2; continue; }
      if (two === '>=') { tokens.push({ type: 'gte', value: '>=', pos: i }); i += 2; continue; }
      if (two === '<=') { tokens.push({ type: 'lte', value: '<=', pos: i }); i += 2; continue; }
      if (two === '&&') { tokens.push({ type: 'and', value: '&&', pos: i }); i += 2; continue; }
      if (two === '||') { tokens.push({ type: 'or', value: '||', pos: i }); i += 2; continue; }
    }

    // Single-char operators
    if (input[i] === '>') { tokens.push({ type: 'gt', value: '>', pos: i }); i++; continue; }
    if (input[i] === '<') { tokens.push({ type: 'lt', value: '<', pos: i }); i++; continue; }
    if (input[i] === '+') { tokens.push({ type: 'plus', value: '+', pos: i }); i++; continue; }
    if (input[i] === '-') { tokens.push({ type: 'minus', value: '-', pos: i }); i++; continue; }
    if (input[i] === '*') { tokens.push({ type: 'star', value: '*', pos: i }); i++; continue; }
    if (input[i] === '/') { tokens.push({ type: 'slash', value: '/', pos: i }); i++; continue; }
    if (input[i] === '(') { tokens.push({ type: 'lparen', value: '(', pos: i }); i++; continue; }
    if (input[i] === ')') { tokens.push({ type: 'rparen', value: ')', pos: i }); i++; continue; }
    if (input[i] === '.') { tokens.push({ type: 'dot', value: '.', pos: i }); i++; continue; }
    if (input[i] === ',') { tokens.push({ type: 'comma', value: ',', pos: i }); i++; continue; }

    // String literals
    if (input[i] === '"' || input[i] === "'") {
      const quote = input[i];
      let str = '';
      i++;
      while (i < input.length && input[i] !== quote) {
        if (input[i] === '\\' && i + 1 < input.length) {
          str += input[i + 1];
          i += 2;
        } else {
          str += input[i];
          i++;
        }
      }
      if (i < input.length) i++; // skip closing quote
      tokens.push({ type: 'string', value: str, pos: i });
      continue;
    }

    // Numbers
    if (/\d/.test(input[i])) {
      let num = '';
      while (i < input.length && /[\d.]/.test(input[i])) {
        num += input[i];
        i++;
      }
      tokens.push({ type: 'number', value: num, pos: i });
      continue;
    }

    // Identifiers / keywords
    if (/[a-zA-Z_]/.test(input[i])) {
      let id = '';
      while (i < input.length && /[a-zA-Z0-9_]/.test(input[i])) {
        id += input[i];
        i++;
      }
      if (id === 'true' || id === 'false') {
        tokens.push({ type: 'boolean', value: id, pos: i });
      } else if (id === 'not') {
        tokens.push({ type: 'not', value: id, pos: i });
      } else if (id === 'in') {
        tokens.push({ type: 'in', value: id, pos: i });
      } else if (id === 'and') {
        tokens.push({ type: 'and', value: '&&', pos: i });
      } else if (id === 'or') {
        tokens.push({ type: 'or', value: '||', pos: i });
      } else {
        tokens.push({ type: 'identifier', value: id, pos: i });
      }
      continue;
    }

    // Unknown character
    throw new ExprParseError(`Unexpected character '${input[i]}' at position ${i}`, i);
  }

  tokens.push({ type: 'eof', value: '', pos: i });
  return tokens;
}

// ─── Parser ──────────────────────────────────────────────────────

export class ExprParseError extends Error {
  constructor(message: string, public pos?: number) {
    super(message);
    this.name = 'ExprParseError';
  }
}

class ExprParser {
  private tokens: Token[];
  private pos: number = 0;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  private peek(): Token {
    return this.tokens[this.pos];
  }

  private advance(): Token {
    const token = this.tokens[this.pos];
    this.pos++;
    return token;
  }

  private expect(type: TokenType): Token {
    const token = this.peek();
    if (token.type !== type) {
      throw new ExprParseError(
        `Expected ${type}, got ${token.type} ('${token.value}') at position ${token.pos}`,
        token.pos
      );
    }
    return this.advance();
  }

  parse(): ExprNode {
    const expr = this.parseOr();
    if (this.peek().type !== 'eof') {
      throw new ExprParseError(
        `Unexpected token '${this.peek().value}' at position ${this.peek().pos}`,
        this.peek().pos
      );
    }
    return expr;
  }

  private parseOr(): ExprNode {
    let left = this.parseAnd();
    while (this.peek().type === 'or') {
      this.advance();
      const right = this.parseAnd();
      left = { type: 'binary', op: '||', left, right };
    }
    return left;
  }

  private parseAnd(): ExprNode {
    let left = this.parseNot();
    while (this.peek().type === 'and') {
      this.advance();
      const right = this.parseNot();
      left = { type: 'binary', op: '&&', left, right };
    }
    return left;
  }

  private parseNot(): ExprNode {
    if (this.peek().type === 'not') {
      this.advance();
      const operand = this.parseNot();
      return { type: 'unary', op: 'not', operand };
    }
    return this.parseComparison();
  }

  private parseComparison(): ExprNode {
    let left = this.parseAdditive();

    const compOps: Set<TokenType> = new Set(['eq', 'neq', 'gt', 'lt', 'gte', 'lte']);
    if (compOps.has(this.peek().type)) {
      const opToken = this.advance();
      const opMap: Record<string, BinaryOp> = {
        eq: '==', neq: '!=', gt: '>', lt: '<', gte: '>=', lte: '<=',
      };
      const right = this.parseAdditive();
      left = { type: 'binary', op: opMap[opToken.type], left, right };
    }

    // Handle 'in' operator
    if (this.peek().type === 'in') {
      this.advance();
      this.expect('lparen');
      const list: ExprNode[] = [];
      if (this.peek().type !== 'rparen') {
        list.push(this.parseAdditive());
        while (this.peek().type === 'comma') {
          this.advance();
          list.push(this.parseAdditive());
        }
      }
      this.expect('rparen');
      left = { type: 'in', value: left, list };
    }

    return left;
  }

  private parseAdditive(): ExprNode {
    let left = this.parseMultiplicative();
    while (this.peek().type === 'plus' || this.peek().type === 'minus') {
      const opToken = this.advance();
      const right = this.parseMultiplicative();
      left = {
        type: 'binary',
        op: opToken.type === 'plus' ? '+' : '-',
        left,
        right,
      };
    }
    return left;
  }

  private parseMultiplicative(): ExprNode {
    let left = this.parsePrimary();
    while (this.peek().type === 'star' || this.peek().type === 'slash') {
      const opToken = this.advance();
      const right = this.parsePrimary();
      left = {
        type: 'binary',
        op: opToken.type === 'star' ? '*' : '/',
        left,
        right,
      };
    }
    return left;
  }

  private parsePrimary(): ExprNode {
    const token = this.peek();

    // String literal
    if (token.type === 'string') {
      this.advance();
      return { type: 'literal', value: token.value };
    }

    // Number literal
    if (token.type === 'number') {
      this.advance();
      return { type: 'literal', value: Number(token.value) };
    }

    // Boolean literal
    if (token.type === 'boolean') {
      this.advance();
      return { type: 'literal', value: token.value === 'true' };
    }

    // Parenthesized expression
    if (token.type === 'lparen') {
      this.advance();
      const expr = this.parseOr();
      this.expect('rparen');
      return expr;
    }

    // Identifier — could be:
    //   - dotted path: currentUser.role
    //   - builtin function call: hasRole(currentUser, "admin")
    if (token.type === 'identifier') {
      this.advance();

      // Check for function call
      if (BUILTINS.has(token.value) && this.peek().type === 'lparen') {
        this.advance(); // skip lparen
        const args: ExprNode[] = [];
        if (this.peek().type !== 'rparen') {
          args.push(this.parseOr());
          while (this.peek().type === 'comma') {
            this.advance();
            args.push(this.parseOr());
          }
        }
        this.expect('rparen');
        return { type: 'call', fn: token.value as BuiltinFn, args };
      }

      // Build dotted path
      const path = [token.value];
      while (this.peek().type === 'dot') {
        this.advance();
        const next = this.expect('identifier');
        path.push(next.value);
      }

      if (path.length === 1) {
        return { type: 'identifier', path };
      }
      return { type: 'identifier', path };
    }

    throw new ExprParseError(
      `Unexpected token '${token.value}' at position ${token.pos}`,
      token.pos
    );
  }
}

// ─── Public API ──────────────────────────────────────────────────

export function parseExpr(input: string): ExprNode {
  const tokens = tokenize(input);
  const parser = new ExprParser(tokens);
  return parser.parse();
}
