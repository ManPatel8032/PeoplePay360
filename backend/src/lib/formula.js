/**
 * Expression evaluator for salary-rule formulas.
 *
 * Salary rules are configuration, and configuration must not be code. The
 * previous evaluator compiled every formula with `new Function`, which handed
 * anyone able to write a rule the whole Node runtime on the API process —
 * `process`, `require`, the database pool, the JWT secret. This parses the same
 * arithmetic subset by hand, so a formula can reach nothing except the values
 * it is handed and the short list of Math helpers below.
 *
 * Supported: numbers, context variables, RULE.<code> / CAT.<category> lookups,
 * Math.<fn>(...), unary - + !, * / %, + -, comparisons, && || and ?:.
 * Everything else — assignment, indexing, strings, any other identifier — is a
 * syntax error, reported the same way a bad formula always was.
 */

const MATH_FNS = {
  min: Math.min, max: Math.max, round: Math.round, abs: Math.abs,
  floor: Math.floor, ceil: Math.ceil, pow: Math.pow, sqrt: Math.sqrt,
  sign: Math.sign, trunc: Math.trunc,
};
const MATH_CONSTS = { PI: Math.PI, E: Math.E };

// Binary operators, highest precedence first. Unlisted operators do not exist.
const BINARY = {
  '*': 14, '/': 14, '%': 14,
  '+': 13, '-': 13,
  '<': 11, '<=': 11, '>': 11, '>=': 11,
  '==': 10, '!=': 10, '===': 10, '!==': 10,
  '&&': 5,
  '||': 4,
};

const PUNCT = ['===', '!==', '==', '!=', '<=', '>=', '&&', '||',
  '<', '>', '+', '-', '*', '/', '%', '(', ')', ',', '.', '?', ':', '!'];

function tokenize(src) {
  const out = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') { i++; continue; }

    if (ch >= '0' && ch <= '9') {
      let j = i;
      while (j < src.length && src[j] >= '0' && src[j] <= '9') j++;
      if (src[j] === '.') { j++; while (j < src.length && src[j] >= '0' && src[j] <= '9') j++; }
      out.push({ type: 'num', value: Number(src.slice(i, j)) });
      i = j;
      continue;
    }

    if (/[A-Za-z_]/.test(ch)) {
      let j = i;
      while (j < src.length && /[A-Za-z0-9_]/.test(src[j])) j++;
      out.push({ type: 'name', value: src.slice(i, j) });
      i = j;
      continue;
    }

    const punct = PUNCT.find((p) => src.startsWith(p, i));
    if (!punct) throw new SyntaxError(`Unexpected character '${ch}'`);
    out.push({ type: 'punct', value: punct });
    i += punct.length;
  }
  out.push({ type: 'end', value: null });
  return out;
}

function parse(src) {
  const tokens = tokenize(src);
  let pos = 0;

  const peek = () => tokens[pos];
  const at = (value) => tokens[pos].type === 'punct' && tokens[pos].value === value;
  const eat = (value) => {
    if (!at(value)) throw new SyntaxError(`Expected '${value}'`);
    pos++;
  };

  function parsePrimary() {
    const tok = peek();

    if (at('(')) {
      pos++;
      const node = parseExpression(0);
      eat(')');
      return node;
    }
    if (at('-') || at('+') || at('!')) {
      const op = tok.value;
      pos++;
      return { kind: 'unary', op, arg: parseUnaryOperand() };
    }
    if (tok.type === 'num') { pos++; return { kind: 'num', value: tok.value }; }
    if (tok.type === 'name') {
      pos++;
      let node = { kind: 'var', name: tok.value };
      while (at('.')) {
        pos++;
        const prop = peek();
        if (prop.type !== 'name') throw new SyntaxError('Expected a property name after "."');
        pos++;
        node = { kind: 'member', object: node, property: prop.value };
      }
      if (at('(')) {
        pos++;
        const args = [];
        if (!at(')')) {
          args.push(parseExpression(0));
          while (at(',')) { pos++; args.push(parseExpression(0)); }
        }
        eat(')');
        node = { kind: 'call', callee: node, args };
      }
      return node;
    }
    throw new SyntaxError('Unexpected end of formula');
  }

  // Unary binds tighter than any binary operator but looser than member access.
  function parseUnaryOperand() {
    return parseExpression(15);
  }

  function parseExpression(minPrecedence) {
    let left = parsePrimary();

    for (;;) {
      const tok = peek();
      if (tok.type !== 'punct') break;

      if (tok.value === '?' && minPrecedence <= 3) {
        pos++;
        const then = parseExpression(0);
        eat(':');
        const otherwise = parseExpression(3);
        left = { kind: 'ternary', test: left, then, otherwise };
        continue;
      }

      const precedence = BINARY[tok.value];
      if (precedence === undefined || precedence < minPrecedence) break;
      pos++;
      const right = parseExpression(precedence + 1);
      left = { kind: 'binary', op: tok.value, left, right };
    }

    return left;
  }

  const ast = parseExpression(0);
  if (peek().type !== 'end') throw new SyntaxError(`Unexpected '${peek().value}' in formula`);
  return ast;
}

/** Parsed formulas are reused across every payslip in a run. */
const cache = new Map();

function astFor(formula) {
  if (!cache.has(formula)) {
    if (cache.size > 500) cache.clear();
    cache.set(formula, parse(formula));
  }
  return cache.get(formula);
}

function evaluate(node, ctx) {
  switch (node.kind) {
    case 'num':
      return node.value;

    case 'var': {
      if (node.name === 'Math') return { __math: true };
      if (!Object.prototype.hasOwnProperty.call(ctx, node.name)) {
        throw new ReferenceError(`Unknown variable '${node.name}'`);
      }
      return ctx[node.name];
    }

    case 'member': {
      const object = evaluate(node.object, ctx);
      if (object && object.__math) {
        if (Object.prototype.hasOwnProperty.call(MATH_FNS, node.property)) {
          return { __mathFn: node.property };
        }
        if (Object.prototype.hasOwnProperty.call(MATH_CONSTS, node.property)) {
          return MATH_CONSTS[node.property];
        }
        throw new ReferenceError(`Math.${node.property} is not available in formulas`);
      }
      if (object === null || typeof object !== 'object') {
        throw new TypeError(`Cannot read '${node.property}' — not a lookup table`);
      }
      // RULE.<code> / CAT.<category>: a rule that has not run yet counts as 0,
      // exactly as it did before, so sequence mistakes stay survivable.
      const value = Object.prototype.hasOwnProperty.call(object, node.property)
        ? object[node.property]
        : 0;
      return typeof value === 'number' ? value : 0;
    }

    case 'call': {
      const callee = evaluate(node.callee, ctx);
      if (!callee || !callee.__mathFn) throw new TypeError('Only Math functions can be called');
      return MATH_FNS[callee.__mathFn](...node.args.map((a) => evaluate(a, ctx)));
    }

    case 'unary': {
      const v = evaluate(node.arg, ctx);
      if (node.op === '-') return -v;
      if (node.op === '+') return +v;
      return !v;
    }

    case 'binary': {
      if (node.op === '&&') return evaluate(node.left, ctx) && evaluate(node.right, ctx);
      if (node.op === '||') return evaluate(node.left, ctx) || evaluate(node.right, ctx);
      const a = evaluate(node.left, ctx);
      const b = evaluate(node.right, ctx);
      switch (node.op) {
        case '+': return a + b;
        case '-': return a - b;
        case '*': return a * b;
        case '/': return a / b;
        case '%': return a % b;
        case '<': return a < b;
        case '<=': return a <= b;
        case '>': return a > b;
        case '>=': return a >= b;
        case '==': case '===': return a === b;
        case '!=': case '!==': return a !== b;
        default: throw new SyntaxError(`Unsupported operator '${node.op}'`);
      }
    }

    case 'ternary':
      return evaluate(node.test, ctx) ? evaluate(node.then, ctx) : evaluate(node.otherwise, ctx);

    default:
      throw new SyntaxError('Unsupported expression');
  }
}

/** Evaluate one formula. Returns a finite number, or 0 when the result is not one. */
export function evaluateFormula(formula, ctx) {
  if (!formula) return 0;
  const out = evaluate(astFor(formula), ctx);
  return Number.isFinite(out) ? out : 0;
}

/** Parse without evaluating, so a rule can be checked when it is saved. */
export function validateFormula(formula) {
  if (!formula) return null;
  try {
    astFor(formula);
    return null;
  } catch (err) {
    return err.message;
  }
}
