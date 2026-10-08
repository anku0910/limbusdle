"""JS object-literal parser.

The Limbusdeck bundle embeds its identity database as a JS object literal
(unquoted keys, `!0` booleans, single-quoted strings), so it cannot be handed to
`json.loads`. This module turns that literal into Python objects.
"""

from __future__ import annotations

import re

_ESCAPES = {
    "n": "\n",
    "t": "\t",
    "r": "\r",
    "b": "\b",
    "f": "\f",
    "v": "\v",
    "0": "\0",
}


class JSLiteralError(ValueError):
    pass


class JSLiteralParser:
    def __init__(self, text: str, pos: int = 0):
        self.s = text
        self.i = pos

    # -- helpers ---------------------------------------------------------
    def error(self, msg: str) -> JSLiteralError:
        return JSLiteralError(f"{msg} at offset {self.i}: {self.s[self.i:self.i + 40]!r}")

    def skip_ws(self) -> None:
        s, n = self.s, len(self.s)
        while self.i < n:
            c = s[self.i]
            if c in " \t\r\n":
                self.i += 1
            elif c == "/" and self.i + 1 < n and s[self.i + 1] == "/":
                j = s.find("\n", self.i)
                self.i = n if j < 0 else j + 1
            elif c == "/" and self.i + 1 < n and s[self.i + 1] == "*":
                j = s.find("*/", self.i + 2)
                self.i = n if j < 0 else j + 2
            else:
                return

    def read_string(self, quote: str) -> str:
        s, n = self.s, len(self.s)
        self.i += 1  # opening quote
        out: list[str] = []
        while True:
            if self.i >= n:
                raise self.error("unterminated string")
            c = s[self.i]
            if c == quote:
                self.i += 1
                return "".join(out)
            if c != "\\":
                out.append(c)
                self.i += 1
                continue
            self.i += 1
            if self.i >= n:
                raise self.error("unterminated escape")
            e = s[self.i]
            self.i += 1
            if e == "u":
                if self.i >= n:
                    raise self.error("truncated \\u")
                if s[self.i] == "{":
                    end = s.find("}", self.i)
                    if end < 0:
                        raise self.error("unterminated \\u{}")
                    out.append(chr(int(s[self.i + 1:end], 16)))
                    self.i = end + 1
                else:
                    out.append(chr(int(s[self.i:self.i + 4], 16)))
                    self.i += 4
            elif e == "x":
                out.append(chr(int(s[self.i:self.i + 2], 16)))
                self.i += 2
            elif e in _ESCAPES:
                out.append(_ESCAPES[e])
            elif e == "\n":
                pass  # line continuation
            else:
                out.append(e)

    def read_bare(self) -> str:
        s, n = self.s, len(self.s)
        start = self.i
        while self.i < n and (s[self.i].isalnum() or s[self.i] in "_$."):
            self.i += 1
        return s[start:self.i]

    def read_number(self) -> int | float:
        s, n = self.s, len(self.s)
        start = self.i
        if self.i < n and s[self.i] in "+-":
            self.i += 1
        while self.i < n and (s[self.i].isdigit() or s[self.i] in ".eExXaAbBcCdDfFoOn_" + "+-"):
            if s[self.i] in "+-" and s[self.i - 1] not in "eE":
                break
            self.i += 1
        raw = s[start:self.i].replace("_", "")
        try:
            return int(raw, 0) if not any(ch in raw for ch in ".eE") else float(raw)
        except ValueError:
            raise self.error(f"bad number {raw!r}") from None

    # -- grammar ---------------------------------------------------------
    def parse_value(self):
        self.skip_ws()
        if self.i >= len(self.s):
            raise self.error("unexpected end")
        c = self.s[self.i]

        if c in "\"'":
            return self.read_string(c)
        if c == "[":
            return self.parse_array()
        if c == "{":
            return self.parse_object()
        if c == "!":
            # minifiers emit `!0` / `!1` / `!true` for true / false
            self.i += 1
            operand = self.parse_value()
            if isinstance(operand, (int, float)) and not isinstance(operand, bool):
                return not operand
            if operand is None:
                return True
            return not operand
        if c == "-" and self.i + 1 < len(self.s) and self.s[self.i + 1] == "0":
            self.i += 1
            v = self.parse_value()
            return not v
        if c.isdigit() or c in "+-.":
            return self.read_number()

        word = self.read_bare()
        if word == "true":
            return True
        if word == "false":
            return False
        if word in ("null", "undefined", "void"):
            return None
        if word == "NaN":
            return float("nan")
        if word == "Infinity":
            return float("inf")
        if not word:
            raise self.error("unexpected character")
        return word

    def parse_array(self) -> list:
        self.i += 1
        out: list = []
        while True:
            self.skip_ws()
            if self.i >= len(self.s):
                raise self.error("unterminated array")
            if self.s[self.i] == "]":
                self.i += 1
                return out
            out.append(self.parse_value())
            self.skip_ws()
            if self.i < len(self.s) and self.s[self.i] == ",":
                self.i += 1

    def parse_object(self) -> dict:
        self.i += 1
        out: dict = {}
        while True:
            self.skip_ws()
            if self.i >= len(self.s):
                raise self.error("unterminated object")
            if self.s[self.i] == "}":
                self.i += 1
                return out
            c = self.s[self.i]
            if c in "\"'":
                key = self.read_string(c)
            else:
                key = self.read_bare()
            self.skip_ws()
            if self.i >= len(self.s) or self.s[self.i] != ":":
                raise self.error(f"expected ':' after key {key!r}")
            self.i += 1
            out[key] = self.parse_value()
            self.skip_ws()
            if self.i < len(self.s) and self.s[self.i] == ",":
                self.i += 1


def parse(text: str, pos: int = 0):
    return JSLiteralParser(text, pos).parse_value()


_EXPORT_RE_CACHE: dict[str, re.Pattern] = {}


def resolve_export(text: str, export: str, validate=None):
    """Find a turbopack `e.s(["NAME",0,<value>])` export and return its value.

    The value is either an inline literal (`[{...}]` / `{...}`) or a bare
    identifier referring to a `let <ident> = ...` earlier in the same chunk. Since
    minified chunks reuse short identifiers across many modules, candidates are
    tried nearest-first and the first one satisfying `validate` wins.
    """
    if export not in _EXPORT_RE_CACHE:
        _EXPORT_RE_CACHE[export] = re.compile(
            r'"' + re.escape(export) + r'"\s*,\s*0\s*,\s*(\{|\[|([A-Za-z_$][\w$]*)\s*[,)])'
        )
    m = _EXPORT_RE_CACHE[export].search(text)
    if not m:
        return None
    if m.group(1) in "{[":
        value = parse(text[m.start(1):], 0)
        return value if validate is None or validate(value) else None

    ident = m.group(2)
    if not ident:
        return None
    assign = re.compile(r'(?:^|[;,({=\s])' + re.escape(ident) + r'\s*=\s*(\{|\[)')
    for hit in reversed(list(assign.finditer(text, 0, m.start()))):
        try:
            value = parse(text[hit.start(1):], 0)
        except JSLiteralError:
            continue
        if validate is None or validate(value):
            return value
    return None



def find_balanced(text: str, open_idx: int, opener: str = "[", closer: str = "]") -> int:
    """Return the index just past the `closer` matching `text[open_idx]`."""
    depth = 0
    i = open_idx
    n = len(text)
    while i < n:
        c = text[i]
        if c in "\"'":
            q = c
            i += 1
            while i < n and text[i] != q:
                i += 2 if text[i] == "\\" else 1
            i += 1
            continue
        if c == "`":
            i += 1
            while i < n and text[i] != "`":
                i += 2 if text[i] == "\\" else 1
            i += 1
            continue
        if c in opener:
            depth += 1
        elif c in closer:
            depth -= 1
            if depth == 0:
                return i + 1
        i += 1
    raise JSLiteralError(f"unbalanced {opener!r} starting at {open_idx}")
