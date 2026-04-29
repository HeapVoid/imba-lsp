#include "tree_sitter/parser.h"

#include <stdbool.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

enum TokenType {
  NEWLINE,
  INDENT,
  DEDENT,
};

#define MAX_INDENTS 128

typedef struct {
  uint32_t indents[MAX_INDENTS];
  uint32_t indent_length;
  uint32_t pending_indents;
  uint32_t pending_dedents;
} Scanner;

static void advance(TSLexer *lexer, bool skip) {
  lexer->advance(lexer, skip);
}

static uint32_t current_indent(Scanner *scanner) {
  if (scanner->indent_length == 0) {
    return 0;
  }

  return scanner->indents[scanner->indent_length - 1];
}

static void push_indent(Scanner *scanner, uint32_t indent) {
  if (scanner->indent_length < MAX_INDENTS) {
    scanner->indents[scanner->indent_length++] = indent;
  }
}

static void queue_dedents_to(Scanner *scanner, uint32_t indent) {
  while (scanner->indent_length > 1 && current_indent(scanner) > indent) {
    scanner->indent_length--;
    scanner->pending_dedents++;
  }
}

void *tree_sitter_imba_external_scanner_create(void) {
  Scanner *scanner = calloc(1, sizeof(Scanner));
  scanner->indents[0] = 0;
  scanner->indent_length = 1;
  return scanner;
}

void tree_sitter_imba_external_scanner_destroy(void *payload) {
  free(payload);
}

unsigned tree_sitter_imba_external_scanner_serialize(void *payload, char *buffer) {
  Scanner *scanner = payload;
  uint32_t size = 0;

  memcpy(buffer + size, &scanner->indent_length, sizeof(uint32_t));
  size += sizeof(uint32_t);

  memcpy(buffer + size, &scanner->pending_indents, sizeof(uint32_t));
  size += sizeof(uint32_t);

  memcpy(buffer + size, &scanner->pending_dedents, sizeof(uint32_t));
  size += sizeof(uint32_t);

  uint32_t bytes = scanner->indent_length * sizeof(uint32_t);
  memcpy(buffer + size, scanner->indents, bytes);
  size += bytes;

  return size;
}

void tree_sitter_imba_external_scanner_deserialize(void *payload, const char *buffer, unsigned length) {
  Scanner *scanner = payload;

  scanner->indent_length = 1;
  scanner->indents[0] = 0;
  scanner->pending_indents = 0;
  scanner->pending_dedents = 0;

  if (length < sizeof(uint32_t) * 3) {
    return;
  }

  uint32_t size = 0;

  memcpy(&scanner->indent_length, buffer + size, sizeof(uint32_t));
  size += sizeof(uint32_t);

  memcpy(&scanner->pending_indents, buffer + size, sizeof(uint32_t));
  size += sizeof(uint32_t);

  memcpy(&scanner->pending_dedents, buffer + size, sizeof(uint32_t));
  size += sizeof(uint32_t);

  if (scanner->indent_length == 0 || scanner->indent_length > MAX_INDENTS) {
    scanner->indent_length = 1;
    scanner->indents[0] = 0;
    return;
  }

  uint32_t bytes = scanner->indent_length * sizeof(uint32_t);
  if (size + bytes <= length) {
    memcpy(scanner->indents, buffer + size, bytes);
  }
}

bool tree_sitter_imba_external_scanner_scan(void *payload, TSLexer *lexer, const bool *valid_symbols) {
  Scanner *scanner = payload;

  if (scanner->pending_indents > 0 && valid_symbols[INDENT]) {
    scanner->pending_indents--;
    lexer->result_symbol = INDENT;
    return true;
  }

  if (scanner->pending_dedents > 0 && valid_symbols[DEDENT]) {
    scanner->pending_dedents--;
    lexer->result_symbol = DEDENT;
    return true;
  }

  if (lexer->eof(lexer)) {
    if (valid_symbols[DEDENT] && scanner->indent_length > 1) {
      scanner->indent_length--;
      lexer->result_symbol = DEDENT;
      return true;
    }

    return false;
  }

  if (valid_symbols[NEWLINE] && (lexer->lookahead == '\n' || lexer->lookahead == '\r')) {
    if (lexer->lookahead == '\r') {
      advance(lexer, false);
      if (lexer->lookahead == '\n') {
        advance(lexer, false);
      }
    } else {
      advance(lexer, false);
    }

    uint32_t indent = 0;
    while (lexer->lookahead == ' ' || lexer->lookahead == '\t' || lexer->lookahead == '\f') {
      if (lexer->lookahead == '\t') {
        indent += 4;
      } else if (lexer->lookahead == ' ') {
        indent++;
      }

      advance(lexer, true);
    }

    bool structural_line =
      lexer->lookahead != '\n' &&
      lexer->lookahead != '\r' &&
      lexer->lookahead != '#' &&
      !lexer->eof(lexer);

    if (structural_line) {
      uint32_t previous = current_indent(scanner);

      if (indent > previous) {
        push_indent(scanner, indent);
        scanner->pending_indents++;
      } else if (indent < previous) {
        queue_dedents_to(scanner, indent);
      }
    }

    lexer->result_symbol = NEWLINE;
    return true;
  }

  return false;
}

