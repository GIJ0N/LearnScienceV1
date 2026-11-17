"""rich_content_v1: analizador y evaluador seguro de expresiones para el bloque «Explora la relación».

Sin eval, sin exec, sin acceso a globales: tokenizador + descenso recursivo sobre una gramática cerrada.
Debe coincidir con `exploreParse` / `exploreEval` de app.js (los tests comparan ambos con los mismos casos).

Gramática (sin multiplicación implícita):
    expr   := term (('+'|'-') term)*
    term   := unary (('*'|'/') unary)*
    unary  := ('-'|'+') unary | power
    power  := atom ('^' unary)?          (asociativa a la derecha; -x^2 = -(x^2))
    atom   := número | variable | función '(' expr (',' expr)* ')' | '(' expr ')'
Funciones permitidas: sqrt exp ln log10 sin cos tan abs min max.
"""
import json
import math
import re

EXPR_MAX_LEN = 200
EXPR_MAX_NODES = 120
EXPR_MAX_DEPTH = 24
NAME_RE = re.compile(r'[A-Za-z][A-Za-z0-9_]{0,15}')
NUMBER_RE = re.compile(r'(?:[0-9]+(?:\.[0-9]+)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?')
IDENT_RE = re.compile(r'[A-Za-z][A-Za-z0-9_]*')
FUNCS = {'sqrt': (1, 1), 'exp': (1, 1), 'ln': (1, 1), 'log10': (1, 1), 'sin': (1, 1), 'cos': (1, 1), 'tan': (1, 1), 'abs': (1, 1), 'min': (2, 4), 'max': (2, 4)}
RESERVED_NAMES = frozenset(set(FUNCS) | {'constructor', 'prototype', 'proto', 'tostring', 'valueof', 'hasownproperty', 'window', 'document', 'globalthis', 'self', 'this', 'eval', 'function', 'process', 'require', 'import', 'return', 'new', 'class', 'var', 'let', 'const'})
MAX_VARIABLES = 4
GRID_POINTS = 5
SAMPLES = 61
JUMP_RATIO = 0.6
GRID_TOLERANCE = 1e-6
STORED_MAX_BYTES = 4000


class ExprError(ValueError):
    pass


def _tokens(text):
    if not isinstance(text, str) or not text.strip() or len(text) > EXPR_MAX_LEN:
        raise ExprError('La expresión está vacía o es demasiado larga.')
    out = []
    i = 0
    while i < len(text):
        c = text[i]
        if c in ' \t':
            i += 1
            continue
        m = NUMBER_RE.match(text, i)
        if m:
            out.append(('num', float(m.group(0))))
            i = m.end()
            continue
        m = IDENT_RE.match(text, i)
        if m:
            out.append(('id', m.group(0)))
            i = m.end()
            continue
        if c in '+-*/^(),':
            out.append((c, c))
            i += 1
            continue
        raise ExprError(f'Carácter no permitido en la expresión: {c!r}.')
    return out


def parse(text, names):
    """Devuelve un AST (tuplas) o lanza ExprError. `names` son las variables declaradas."""
    declared = set(names)
    tokens = _tokens(text)
    state = {'pos': 0, 'nodes': 0}
    used = set()

    def peek():
        return tokens[state['pos']][0] if state['pos'] < len(tokens) else None

    def take(kind=None):
        if state['pos'] >= len(tokens) or (kind is not None and tokens[state['pos']][0] != kind):
            raise ExprError('La expresión está incompleta o mal formada.')
        tok = tokens[state['pos']]
        state['pos'] += 1
        return tok

    def bump():
        state['nodes'] += 1
        if state['nodes'] > EXPR_MAX_NODES:
            raise ExprError('La expresión es demasiado compleja.')

    def expr(depth):
        if depth > EXPR_MAX_DEPTH:
            raise ExprError('La expresión está demasiado anidada.')
        node = term(depth)
        while peek() in ('+', '-'):
            op = take()[0]
            bump()
            node = ('bin', op, node, term(depth))
        return node

    def term(depth):
        node = unary(depth)
        while peek() in ('*', '/'):
            op = take()[0]
            bump()
            node = ('bin', op, node, unary(depth))
        return node

    def unary(depth):
        if depth > EXPR_MAX_DEPTH:
            raise ExprError('La expresión está demasiado anidada.')
        if peek() in ('-', '+'):
            op = take()[0]
            bump()
            inner = unary(depth + 1)
            return ('neg', inner) if op == '-' else inner
        return power(depth)

    def power(depth):
        base = atom(depth)
        if peek() == '^':
            take()
            bump()
            return ('bin', '^', base, unary(depth + 1))
        return base

    def atom(depth):
        bump()
        kind = peek()
        if kind == 'num':
            return ('num', take()[1])
        if kind == 'id':
            name = take()[1]
            if peek() == '(':
                if name not in FUNCS:
                    raise ExprError(f'Función no permitida: {name}.')
                take()
                args = [expr(depth + 1)]
                while peek() == ',':
                    take()
                    args.append(expr(depth + 1))
                take(')')
                low, high = FUNCS[name]
                if not low <= len(args) <= high:
                    raise ExprError(f'La función {name} recibe de {low} a {high} argumentos.')
                return ('call', name, tuple(args))
            if name not in declared:
                raise ExprError(f'Identificador no declarado: {name}.')
            used.add(name)
            return ('var', name)
        if kind == '(':
            take()
            inner = expr(depth + 1)
            take(')')
            return inner
        raise ExprError('La expresión está incompleta o mal formada.')

    tree = expr(0)
    if state['pos'] != len(tokens):
        raise ExprError('La expresión tiene símbolos sobrantes.')
    return tree, used


def _odd_integer(x):
    return math.isfinite(x) and x == math.floor(x) and abs(x) < 2 ** 53 and int(x) % 2 == 1


def _pow(a, b):
    """Math.pow de JavaScript: mismos casos límite (0 con exponente negativo, |base| = 1 con exponente infinito, NaN)."""
    if b != b:
        return math.nan
    if b == 0:
        return 1.0
    if a != a:
        return math.nan
    if math.isinf(b):
        if abs(a) == 1:
            return math.nan
        return (math.inf if b > 0 else 0.0) if abs(a) > 1 else (0.0 if b > 0 else math.inf)
    if a == 0:
        neg = math.copysign(1.0, a) < 0 and _odd_integer(b)
        if b < 0:
            return -math.inf if neg else math.inf
        return -0.0 if neg else 0.0
    try:
        return math.pow(a, b)
    except OverflowError:
        return -math.inf if a < 0 and _odd_integer(b) else math.inf
    except ValueError:
        return math.nan


def _fn(name, args):
    if any(a != a for a in args):
        return math.nan
    try:
        if name == 'sqrt':
            return math.sqrt(args[0])
        if name == 'exp':
            return math.exp(args[0])
        if name == 'ln':
            return math.log(args[0])
        if name == 'log10':
            return math.log10(args[0])
        if name == 'sin':
            return math.sin(args[0])
        if name == 'cos':
            return math.cos(args[0])
        if name == 'tan':
            return math.tan(args[0])
        if name == 'abs':
            return abs(args[0])
        if name == 'min':
            return min(args)
        if name == 'max':
            return max(args)
    except OverflowError:
        return math.inf
    except ValueError:
        return -math.inf if name in ('ln', 'log10') and args[0] == 0 else math.nan
    raise ExprError('Función no permitida.')


def evaluate(tree, env):
    """Evalúa el AST con un diccionario de valores. Un resultado no finito se devuelve tal cual (inf/nan)."""
    kind = tree[0]
    if kind == 'num':
        return tree[1]
    if kind == 'var':
        return float(env[tree[1]])
    if kind == 'neg':
        return -evaluate(tree[1], env)
    if kind == 'call':
        return _fn(tree[1], [evaluate(a, env) for a in tree[2]])
    op = tree[1]
    a = evaluate(tree[2], env)
    b = evaluate(tree[3], env)
    if op == '+':
        return a + b
    if op == '-':
        return a - b
    if op == '*':
        try:
            return a * b
        except OverflowError:
            return math.inf
    if op == '/':
        if b == 0:
            return math.nan if (a == 0 or a != a) else math.copysign(math.inf, a) * (math.copysign(1.0, b))
        return a / b
    if op == '^':
        return _pow(a, b)
    raise ExprError('Operador no permitido.')


def _finite_number(value):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return False
    try:
        return math.isfinite(float(value))
    except OverflowError:  # un entero JSON enorme: inválido, no un error 500
        return False


def _text(value, limit):
    if not isinstance(value, str):
        return ''
    return clip_rich(value.strip(), limit)


RICH_NEAR = 240
_SIGNAL_RE = re.compile(r'\\[A-Za-z]|[\^_=<>{}]|[\w)\]}]\s*[+\-*/]\s*[\w(\[\\{]')
_VAR_RE = re.compile(r'\s*[^\W\d_]\s*')


def has_math_signal(src):
    """Señal matemática real de una fórmula en línea (igual que `richSignal` de app.js)."""
    return bool(_SIGNAL_RE.search(src)) or bool(_VAR_RE.fullmatch(src))


def clip_rich(value, n):
    """Recorte para CONTENIDO generado que se muestra al aprendiz. Igual que `str.strip()[:n]` salvo que el corte
    caiga dentro de una fórmula que `richParts` pintaría: abierta a <= 240 caracteres del corte, con delimitador
    válido y señal matemática. Entonces corta antes de ella. Nunca devuelve vacío si el texto no lo era.
    No usar en texto del aprendiz, claves, referencias, huellas, citas ni JSON de memoria."""
    text = str(value or '').strip()
    if len(text) <= n:
        return text
    head = text[:n]
    if '$' not in head:
        return head
    open_at = None
    open_delim = None
    i = 0
    while i < len(head):
        c = head[i]
        if c == '\\':
            i += 2
            continue
        if c == '$':
            delim = '$$' if head[i:i + 2] == '$$' else '$'
            if open_at is None:
                open_at, open_delim = i, delim
            elif delim == open_delim:
                open_at = None
            i += len(delim)
            continue
        i += 1
    if open_at is None or n - open_at > RICH_NEAR:
        return head
    tail = head[open_at + len(open_delim):]
    if open_delim == '$' and (not tail or tail[0].isspace()):
        return head
    if not has_math_signal(tail):
        return head
    cut = head[:open_at].rstrip()
    return cut if cut else head


def _grid(variable):
    lo, hi = variable['min'], variable['max']
    return [lo + (hi - lo) * k / (GRID_POINTS - 1) for k in range(GRID_POINTS)]


def _canon(x):
    """Enteros sin `.0`, como los serializa JavaScript (mismo tamaño y mismo JSON en ambos lados)."""
    return int(x) if float(x).is_integer() and abs(x) < 1e15 else x


def stored_size(block):
    """Tamaño que se guarda: bytes UTF-8 del JSON compacto (idéntico a TextEncoder(JSON.stringify(...)) en app.js)."""
    return len(json.dumps(block, ensure_ascii=False, separators=(',', ':')).encode('utf-8'))


def validate_explore(raw):
    """Contrato local estricto de un bloque `explore`. Devuelve una copia limpia o lanza ValueError (en español)."""
    if not isinstance(raw, dict):
        raise ValueError('El bloque de exploración es inválido.')
    title = _text(raw.get('title'), 80)
    expression = raw.get('expression')
    prompt_before = _text(raw.get('prompt_before'), 300)
    takeaway = _text(raw.get('takeaway'), 300)
    if not title or not prompt_before or not takeaway:
        raise ValueError('El bloque requiere título, pregunta previa y conclusión.')
    if not isinstance(expression, str) or not expression.strip():
        raise ValueError('El bloque requiere una expresión.')
    expression = expression.strip()
    output = raw.get('output')
    if not isinstance(output, dict):
        raise ValueError('Falta la salida (etiqueta y unidad).')
    out_label = _text(output.get('label'), 60)
    out_unit = _text(output.get('unit'), 16)
    if not out_label:
        raise ValueError('La salida requiere etiqueta.')
    variables = raw.get('variables')
    if not isinstance(variables, list) or not 1 <= len(variables) <= MAX_VARIABLES:
        raise ValueError(f'Debe haber de 1 a {MAX_VARIABLES} variables.')
    clean = []
    seen = set()
    for item in variables:
        if not isinstance(item, dict):
            raise ValueError('Variable inválida.')
        name = item.get('name')
        if not isinstance(name, str) or not NAME_RE.fullmatch(name) or name.lower() in RESERVED_NAMES:
            raise ValueError('El nombre de una variable no es válido o está reservado.')
        if name in seen:
            raise ValueError('Los nombres de variable deben ser únicos.')
        seen.add(name)
        label = _text(item.get('label'), 60)
        unit = _text(item.get('unit'), 16)
        if not label:
            raise ValueError('Cada variable requiere etiqueta.')
        nums = {key: item.get(key) for key in ('min', 'max', 'step', 'value')}
        if not all(_finite_number(v) for v in nums.values()):
            raise ValueError('Los rangos de las variables deben ser números finitos.')
        lo, hi, step, value = (float(nums[k]) for k in ('min', 'max', 'step', 'value'))
        if not (lo < value < hi):
            raise ValueError('Cada variable debe cumplir min < valor < max.')
        if max(abs(lo), abs(hi)) > 1e9:
            raise ValueError('El rango de una variable es demasiado grande.')
        if not 0 < step <= (hi - lo) or (hi - lo) / step > 1000:
            raise ValueError('El paso de una variable es inválido.')
        cells = (hi - lo) / step
        if abs(cells - math.floor(cells + 0.5)) > GRID_TOLERANCE:
            raise ValueError('El paso de la variable ' + name + ' no divide su rango.')
        offset = (value - lo) / step
        if abs(offset - math.floor(offset + 0.5)) > GRID_TOLERANCE:
            raise ValueError('El valor inicial de la variable ' + name + ' no cae en la malla de su paso.')
        clean.append({'name': name, 'label': label, 'unit': unit, 'min': lo, 'max': hi, 'step': step, 'value': value})
    try:
        tree, used = parse(expression, [v['name'] for v in clean])
    except ExprError as exc:
        raise ValueError('Expresión inválida: ' + str(exc))
    unused = [v['name'] for v in clean if v['name'] not in used]
    if unused:
        raise ValueError('Variables declaradas pero no usadas en la expresión: ' + ', '.join(unused) + '.')
    base = {v['name']: v['value'] for v in clean}
    if not math.isfinite(evaluate(tree, base)):
        raise ValueError('La expresión no es finita en los valores iniciales.')
    grids = [_grid(v) for v in clean]
    outputs = []
    stack = [{}]
    for v, points in zip(clean, grids):
        stack = [{**partial, v['name']: p} for partial in stack for p in points]
    for point in stack:
        y = evaluate(tree, point)
        if not math.isfinite(y):
            raise ValueError('La salida no es finita en todo el dominio de las variables.')
        outputs.append(y)
    spread = max(outputs) - min(outputs)
    scale = max(1.0, max(abs(y) for y in outputs))
    if spread <= 1e-9 * scale:
        raise ValueError('La salida no varía al mover las variables.')
    for v in clean:
        ys = [evaluate(tree, {**base, v['name']: v['min'] + (v['max'] - v['min']) * k / (SAMPLES - 1)}) for k in range(SAMPLES)]
        if not all(math.isfinite(y) for y in ys):
            raise ValueError('La salida no es finita al recorrer la variable ' + v['name'] + '.')
        spread = max(ys) - min(ys)
        if spread <= 1e-9 * max(1.0, max(abs(y) for y in ys)):
            raise ValueError('La variable ' + v['name'] + ' no cambia la salida.')
        if max(abs(ys[k + 1] - ys[k]) for k in range(SAMPLES - 1)) > JUMP_RATIO * spread:
            raise ValueError('La salida de la variable ' + v['name'] + ' tiene una discontinuidad.')
    block = {'title': title, 'expression': expression, 'variables': [{k: _canon(v[k]) if k in ('min', 'max', 'step', 'value') else v[k] for k in ('name', 'label', 'unit', 'min', 'max', 'step', 'value')} for v in clean],
             'output': {'label': out_label, 'unit': out_unit}, 'prompt_before': prompt_before, 'takeaway': takeaway}
    if stored_size(block) > STORED_MAX_BYTES:
        raise ValueError('El bloque es demasiado grande.')
    return block


def explore_material(block):
    """Texto plano del bloque para la auditoría de contenido."""
    variables = '; '.join(f"{v['name']} = {v['label']} ({v['unit'] or 'sin unidad'}) de {v['min']:g} a {v['max']:g}, inicial {v['value']:g}" for v in block['variables'])
    return (f"Relación: {block['output']['label']} ({block['output']['unit'] or 'sin unidad'}) = {block['expression']}. Variables: {variables}. "
            f"Pregunta previa: {block['prompt_before']} Conclusión: {block['takeaway']}")
