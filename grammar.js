// This is intentionally a shallow editor grammar for Zed.
//
// The native Imba compiler/parser is the semantic source of truth. Keep this
// grammar limited to stable editor structure: comments, literals, declarations,
// indentation blocks, tags, and Imba CSS blocks. Do not grow this into a second
// full Imba parser.

module.exports = grammar({
  name: "imba",

  extras: ($) => [/[ \t\f]/, $.line_comment, $.block_comment],

  externals: ($) => [$._newline, $._block_newline, $._indent, $._dedent],

  supertypes: ($) => [$._statement],

  word: ($) => $.identifier,

  rules: {
    source_file: ($) => repeat(choice($._newline, $.line_comment, $.block_comment, $._statement)),

    block: ($) =>
      seq(
        $._block_newline,
        repeat($._newline),
        $._indent,
        repeat(choice($._newline, $.line_comment, $.block_comment, $._statement)),
        $._dedent,
      ),

    _statement: ($) =>
      choice(
        $.import_statement,
        $.function_declaration,
        $.accessor_declaration,
        $.class_declaration,
        $.tag_declaration,
        $.css_statement,
        $.variable_declaration,
        $.field_declaration,
        $.assignment,
        $.tag_element,
        $.line_block_statement,
        $.expression_statement,
      ),

    export_modifier: () => seq("export", optional("default")),

    import_statement: ($) => prec.right(seq("import", optional($._line_content))),

    variable_declaration: ($) =>
      prec.right(
        seq(
          optional($.export_modifier),
          choice("let", "const", "var"),
          field("name", choice($.identifier, $.private_identifier)),
          optional($._line_content),
        ),
      ),

    field_declaration: ($) =>
      prec.right(
        seq(
          choice("prop", "attr"),
          field("name", choice($.identifier, $.private_identifier)),
          optional($._line_content),
        ),
      ),

    function_declaration: ($) =>
      prec.right(
        2,
        seq(
          optional($.export_modifier),
          "def",
          field("name", choice($.identifier, $.private_identifier)),
          optional($._line_content),
          $.block,
        ),
      ),

    accessor_declaration: ($) =>
      prec.right(
        2,
        seq(
          optional($.export_modifier),
          choice("get", "set"),
          field("name", choice($.identifier, $.private_identifier)),
          optional($._line_content),
          $.block,
        ),
      ),

    class_declaration: ($) =>
      prec.right(
        2,
        seq(
          optional($.export_modifier),
          "class",
          field("name", $.identifier),
          optional($._line_content),
          $.block,
        ),
      ),

    tag_declaration: ($) =>
      prec.right(
        2,
        seq(
          optional($.export_modifier),
          "tag",
          field("name", $.identifier),
          optional($._line_content),
          $.block,
        ),
      ),

    assignment: ($) =>
      prec.right(
        seq(
          field("left", choice($.identifier, $.private_identifier, $.member_path)),
          field("operator", $.assignment_operator),
          optional($._line_content),
        ),
      ),

    line_block_statement: ($) => prec.right(seq($._line_content, "do", $.block)),

    expression_statement: ($) => prec(-1, $._line_content),

    _line_content: ($) =>
      repeat1(
        choice(
          $.string,
          $.template_string,
          $.regex,
          $.number,
          $.boolean,
          $.nil,
          $.keyword,
          $.member_path,
          $.private_identifier,
          $.identifier,
          $.operator,
          "(",
          ")",
          "[",
          "]",
          "{",
          "}",
          ",",
          ":",
          $.line_fragment,
        ),
      ),

    member_path: ($) =>
      prec.left(
        seq(
          field("object", choice($.identifier, $.private_identifier)),
          repeat1(seq(field("operator", $.member_operator), field("property", choice($.identifier, $.private_identifier)))),
        ),
      ),

    css_statement: ($) =>
      prec.right(
        seq(
          optional("global"),
          "css",
          optional(choice("self", $.css_selector)),
          optional(choice($.css_block, repeat1($.css_declaration))),
        ),
      ),

    css_block: ($) =>
      seq(
        $._block_newline,
        repeat($._newline),
        $._indent,
        repeat(choice($._newline, $.css_comment, $.line_comment, $.block_comment, $.css_at_rule, $.css_rule, $.css_inline_rule_with_block, $.css_inline_rule, $.css_declaration)),
        $._dedent,
      ),

    css_at_rule: ($) =>
      prec.right(
        seq(
          field("name", $.css_at_keyword),
          optional(field("value", $.css_at_value)),
          optional($.css_block),
        ),
      ),

    css_rule: ($) => seq(field("selector", $.css_selector), $.css_block),

    css_inline_rule_with_block: ($) => seq(field("content", $.css_inline_content), $.css_block),

    css_inline_rule: ($) => field("content", $.css_inline_content),

    css_declaration: ($) =>
      seq(
        field("property", $.style_property_name),
        ":",
        field("value", $.css_value),
      ),

    tag_element: ($) =>
      prec.right(
        seq(
          choice(field("name", $.tag_name_open), $.tag_class_open, $.tag_id_open, $.tag_reference_open),
          repeat(choice($.tag_class_binding, $.tag_class, $.tag_id, $.tag_reference, $.tag_attribute, $.event_attribute, $.inline_style)),
          optional($.tag_close),
          optional(choice($.block, $.tag_text)),
        ),
      ),

    tag_attribute: ($) =>
      seq(field("name", $.attribute_name), optional(seq("=", field("value", $.attribute_value)))),

    tag_class_binding: ($) =>
      prec(1, seq(field("name", $.tag_class), "=", field("value", $.attribute_value))),

    event_attribute: ($) =>
      seq(
        "@",
        field("name", $.event_name),
        optional(seq("=", field("value", $.attribute_value))),
      ),

    attribute_value: ($) =>
      choice(
        $.string,
        $.template_string,
        $.number,
        $.boolean,
        $.nil,
        $.member_path,
        $.private_identifier,
        $.identifier,
        $.bare_attribute_value,
      ),

    inline_style: ($) => seq("[", optional($.style_content), "]"),

    line_comment: () => token(prec(-1, /#[^\n]*/)),

    block_comment: () =>
      token(seq("###", repeat(choice(/[^#]/, /#[^#]/, /##[^#]/)), "###")),

    string: ($) =>
      choice(
        seq('"', repeat(choice($.escape_sequence, token.immediate(/[^"\\\n]+/))), '"'),
        seq("'", repeat(choice($.escape_sequence, token.immediate(/[^'\\\n]+/))), "'"),
      ),

    template_string: ($) => seq("`", repeat(choice($.escape_sequence, token.immediate(/[^`\\]+/))), "`"),

    escape_sequence: () => token.immediate(seq("\\", /./)),

    regex: () =>
      token(
        prec(
          1,
          seq(
            "/",
            repeat1(choice(/\\[^\n]/, /\[(?:\\[^\n]|[^\]\\\n])*\]/, /[^/\\\[\n]+/)),
            "/",
            optional(/[A-Za-z]+/),
          ),
        ),
      ),

    number: () =>
      token(
        choice(
          /0x[0-9a-fA-F]+/,
          /0b[01]+/,
          /0o[0-7]+/,
          /\.[0-9]+(?:[eE][+-]?[0-9]+)?/,
          /[0-9]+(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/,
        ),
      ),

    boolean: () => choice("true", "false", "yes", "no"),

    nil: () => choice("null", "nil", "undefined"),

    keyword: () =>
      token(
        prec(
          2,
          choice(
            "as",
            "async",
            "await",
            "break",
            "catch",
            "continue",
            "elif",
            "else",
            "extends",
            "finally",
            "for",
            "from",
            "if",
            "in",
            "isa",
            "new",
            "of",
            "own",
            "return",
            "super",
            "then",
            "throw",
            "try",
            "unless",
            "until",
            "when",
            "while",
          ),
        ),
      ),

    identifier: () =>
      token(prec(0, /[$A-Za-z_][A-Za-z0-9_$]*(?:-[A-Za-z0-9_$]+)*(?:[?!])?/)),

    private_identifier: () =>
      token(prec(2, /#[A-Za-z_][A-Za-z0-9_$]*(?:-[A-Za-z0-9_$]+)*(?:[?!])?/)),

    line_fragment: () => token(prec(-10, /[^\s#"'`]+/)),

    tag_text: () => token(prec(-1, /[^>\n][^\n]*/)),

    tag_name_open: () => token(prec(3, seq("<", /[A-Za-z][A-Za-z0-9]*(?:-[A-Za-z0-9]+)*/))),

    tag_class_open: () => token(prec(3, seq("<.", /[A-Za-z_][A-Za-z0-9_-]*/))),

    tag_id_open: () => token(prec(3, seq("<#", /[A-Za-z_][A-Za-z0-9_-]*/))),

    tag_reference_open: () => token(prec(3, seq("<$", /[A-Za-z_][A-Za-z0-9_-]*/))),

    tag_close: () => token(prec(5, ">")),

    tag_class: () => token(seq(".", /[A-Za-z_][A-Za-z0-9_-]*/)),

    tag_id: () => token(seq("#", /[A-Za-z_][A-Za-z0-9_-]*/)),

    tag_reference: () => token(seq("$", /[A-Za-z_][A-Za-z0-9_-]*/)),

    attribute_name: () => token(prec(4, /[A-Za-z_:][A-Za-z0-9_:-]*(?:[?!])?/)),

    event_name: () =>
      token(prec(4, seq(/[A-Za-z_:][A-Za-z0-9_:-]*/, repeat(seq(".", /[A-Za-z_][A-Za-z0-9_-]*/))))),

    bare_attribute_value: () => token(/[^\s\]>\n]+/),

    style_content: () => token(/[^\]\n]+/),

    style_property_name: () =>
      token(choice(/\$[A-Za-z0-9_-]+/, /--[A-Za-z0-9_-]+/, /[A-Za-z_-][A-Za-z0-9_-]*(?:@[A-Za-z0-9_-]+)?/)),

    css_at_keyword: () => token(seq("@", /[A-Za-z_-][A-Za-z0-9_-]*/)),

    css_at_value: () => token(prec(1, /[^\n]+/)),

    css_comment: () => token(prec(3, /#[ \t][^\n]*/)),

    css_selector: ($) => choice($.css_complex_selector, $.css_custom_selector, $.css_class_selector, $.css_element_selector),

    css_complex_selector: () =>
      token(
        prec(
          1,
          choice(
            /[.&:#%>][^\n]*(?:[ \t]+|>>>|[>+~]|,)[^\n]*/,
            /[A-Za-z_][A-Za-z0-9_-]*(?:[.#][^\s\n:]*)?(?:[ \t]+|>>>|[>+~]|,)[^\n]*/,
          ),
        ),
      ),

    css_custom_selector: () =>
      token(prec(-1, /[A-Za-z][A-Za-z0-9_-]*(?:[.#][^\s\n:]*)?(?:@[A-Za-z0-9_-]+(?:\([^\n)]*\))?)?/)),

    css_class_selector: () => token(prec(1, /[.&:#%][^\s\n]+/)),

    css_element_selector: () =>
      token(
        prec(
          1,
          /(?:html|body|main|section|article|aside|header|footer|nav|div|span|a|button|input|textarea|select|option|label|form|fieldset|legend|ul|li|table|thead|tbody|tr|th|td|h[1-6]|svg|path|circle|rect|line|polyline|polygon|img|canvas|video|audio|iframe|slot)(?:[.#][^\s\n]*)?/,
        ),
      ),

    css_inline_content: () =>
      token(prec(2, /[^\n]+[ \t]+[$A-Za-z_-][A-Za-z0-9_$-]*(?:@[A-Za-z0-9_-]+)?:[^\n]+/)),

    css_value: () => token(/[^\n]+/),

    assignment_operator: () => choice("=", "+=", "-=", "*=", "/=", "?=", "||=", "&&=", "=?"),

    member_operator: () => choice(".", ".."),

    operator: () =>
      token(
        choice(
          "===",
          "!==",
          "==",
          "!=",
          "<=",
          ">=",
          "<<",
          ">>",
          ">>>",
          "&&",
          "||",
          "??",
          "++",
          "--",
          "!",
          "+",
          "-",
          "*",
          "/",
          "%",
        ),
      ),

  },
});
