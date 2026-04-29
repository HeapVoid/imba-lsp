const PREC = {
  ASSIGN: 1,
  OR: 2,
  AND: 3,
  COMPARE: 4,
  ADD: 5,
  MULTIPLY: 6,
  UNARY: 7,
  CALL: 8,
  MEMBER: 9,
};

const commaSep = (rule) => optional(seq(rule, repeat(seq(",", rule)), optional(",")));
const commaSep1 = (rule) => seq(rule, repeat(seq(",", rule)), optional(","));

module.exports = grammar({
  name: "imba",

  extras: ($) => [/[ \t\f]/, $.line_comment, $.block_comment],

  externals: ($) => [$._newline, $._indent, $._dedent],

  supertypes: ($) => [$._statement, $._expression],

  word: ($) => $.identifier,

  rules: {
    source_file: ($) => repeat(choice($._newline, $._statement)),

    block: ($) =>
      seq(
        $._newline,
        $._indent,
        repeat(choice($._newline, $._statement)),
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
        $.if_statement,
        $.for_statement,
        $.while_statement,
        $.try_statement,
        $.return_statement,
        $.assignment,
        prec(2, $.tag_element),
        $.expression_statement,
      ),

    export_modifier: () => seq("export", optional("default")),

    import_statement: ($) =>
      seq(
        "import",
        choice(
          $.string,
          seq(optional($.import_clause), "from", $.string),
        ),
      ),

    import_clause: ($) =>
      choice(
        $.identifier,
        $.named_imports,
        seq($.identifier, ",", $.named_imports),
        seq("type", choice($.identifier, $.named_imports)),
      ),

    named_imports: ($) => seq("{", commaSep($.import_specifier), "}"),

    import_specifier: ($) =>
      seq($.identifier, optional(seq(choice("as", ":"), $.identifier))),

    variable_declaration: ($) =>
      seq(
        optional($.export_modifier),
        choice("let", "const", "var"),
        field("name", choice($.identifier, $.private_identifier)),
        optional(seq("=", field("value", $._expression))),
      ),

    function_declaration: ($) =>
      prec.right(
        seq(
          optional($.export_modifier),
          "def",
          field("name", choice($.identifier, $.private_identifier)),
          repeat($.parameter),
          optional(choice($.block, seq("do", $._expression))),
        ),
      ),

    accessor_declaration: ($) =>
      prec.right(
        seq(
          optional($.export_modifier),
          choice("get", "set"),
          field("name", choice($.identifier, $.private_identifier)),
          repeat($.parameter),
          optional($.block),
        ),
      ),

    parameter: ($) =>
      seq(
        field("name", choice($.identifier, $.private_identifier)),
        optional(seq("=", field("default", $._expression))),
      ),

    class_declaration: ($) =>
      prec.right(
        seq(
          optional($.export_modifier),
          "class",
          field("name", $.identifier),
          optional($.extends_clause),
          optional($.block),
        ),
      ),

    tag_declaration: ($) =>
      prec.right(
        seq(
          optional($.export_modifier),
          "tag",
          field("name", $.identifier),
          optional($.extends_clause),
          optional($.block),
        ),
      ),

    extends_clause: ($) => seq(choice("extends", "<"), field("superclass", $.identifier)),

    css_statement: ($) =>
      seq(
        optional("global"),
        "css",
        optional(choice("self", $.css_selector)),
        choice($.css_block, repeat1($.css_declaration)),
      ),

    css_block: ($) =>
      seq(
        $._newline,
        $._indent,
        repeat(choice($._newline, $.css_at_rule, $.css_rule, $.css_declaration)),
        $._dedent,
      ),

    css_at_rule: ($) =>
      prec.right(
        seq(
          field("name", $.css_at_keyword),
          optional(field("value", $.css_value)),
          optional($.css_block),
        ),
      ),

    css_rule: ($) => seq(field("selector", $.css_selector), $.css_block),

    css_declaration: ($) =>
      seq(
        field("property", $.style_property_name),
        ":",
        field("value", $.css_value),
      ),

    if_statement: ($) =>
      seq(
        "if",
        field("condition", $._expression),
        field("consequence", $.block),
        repeat($.elif_clause),
        optional($.else_clause),
      ),

    elif_clause: ($) => seq("elif", field("condition", $._expression), field("body", $.block)),

    else_clause: ($) => seq("else", field("body", $.block)),

    for_statement: ($) =>
      seq(
        "for",
        field("left", commaSep1($.identifier)),
        choice("in", "of"),
        field("right", $._expression),
        optional(seq("when", field("condition", $._expression))),
        field("body", $.block),
      ),

    while_statement: ($) =>
      seq(choice("while", "until"), field("condition", $._expression), field("body", $.block)),

    try_statement: ($) =>
      seq(
        "try",
        field("body", $.block),
        optional(seq("catch", optional($.identifier), field("handler", $.block))),
        optional(seq("finally", field("finalizer", $.block))),
      ),

    return_statement: ($) =>
      prec.right(seq(choice("return", "break", "continue", "throw"), optional($._expression))),

    assignment: ($) =>
      prec.right(
        PREC.ASSIGN,
        seq(
          field("left", choice($.identifier, $.private_identifier, $.member_expression)),
          field("operator", choice("=", "+=", "-=", "*=", "/=", "?=", "||=", "&&=", "=?")),
          field("right", $._expression),
        ),
      ),

    expression_statement: ($) => $._expression,

    _expression: ($) =>
      choice(
        $.binary_expression,
        $.unary_expression,
        $.call_expression,
        $.member_expression,
        $._primary_expression,
      ),

    _primary_expression: ($) =>
      choice(
        $.identifier,
        $.private_identifier,
        $.number,
        $.string,
        $.template_string,
        $.boolean,
        $.nil,
        $.array,
        $.object,
        $.parenthesized_expression,
        $.tag_element,
      ),

    parenthesized_expression: ($) => seq("(", $._expression, ")"),

    array: ($) => seq("[", commaSep($._expression), "]"),

    object: ($) => seq("{", commaSep(choice($.pair, $._expression)), "}"),

    pair: ($) => seq(field("key", choice($.identifier, $.string)), ":", field("value", $._expression)),

    member_expression: ($) =>
      prec.left(
        PREC.MEMBER,
        seq(
          field("object", $._expression),
          field("operator", choice(".", "..")),
          field("property", choice($.identifier, $.private_identifier)),
        ),
      ),

    call_expression: ($) =>
      choice(
        prec.left(PREC.CALL + 1, seq(field("function", $._expression), field("arguments", $.arguments))),
        prec.left(PREC.CALL + 1, seq(field("function", choice($.identifier, $.member_expression)), "!")),
        prec.left(PREC.CALL, seq(field("function", choice($.identifier, $.member_expression)), field("arguments", $.bare_arguments))),
      ),

    arguments: ($) => seq("(", commaSep($._expression), ")"),

    bare_arguments: ($) => prec.right(seq($._bare_argument, repeat(seq(",", $._bare_argument)))),

    _bare_argument: ($) =>
      choice(
        $.identifier,
        $.private_identifier,
        $.number,
        $.string,
        $.template_string,
        $.boolean,
        $.nil,
        $.array,
        $.object,
        $.tag_element,
      ),

    unary_expression: ($) =>
      prec(
        PREC.UNARY,
        seq(field("operator", choice("!", "not", "-", "+", "await")), field("argument", $._expression)),
      ),

    binary_expression: ($) =>
      choice(
        ...[
          [PREC.OR, choice("or", "||", "??")],
          [PREC.AND, choice("and", "&&")],
          [PREC.COMPARE, choice("is", "isnt", "isa", "==", "!=", "===", "!==", "<", "<=", ">", ">=")],
          [PREC.ADD, choice("+", "-")],
          [PREC.MULTIPLY, choice("*", "/", "%")],
        ].map(([precedence, operator]) =>
          prec.left(
            precedence,
            seq(field("left", $._expression), field("operator", operator), field("right", $._expression)),
          ),
        ),
      ),

    tag_element: ($) =>
      prec.right(
        1,
        seq(
          "<",
          optional(field("name", $.tag_name)),
          repeat(choice($.tag_class, $.tag_id, $.tag_reference, $.tag_attribute, $.event_attribute, $.inline_style)),
          ">",
          optional(choice($.block, $._expression)),
        ),
      ),

    tag_attribute: ($) =>
      seq(field("name", $.attribute_name), optional(seq("=", field("value", $.attribute_value)))),

    event_attribute: ($) =>
      seq(
        "@",
        field("name", $.event_name),
        optional(seq("=", field("value", $.attribute_value))),
      ),

    attribute_value: ($) =>
      choice(
        $.identifier,
        $.private_identifier,
        $.number,
        $.string,
        $.template_string,
        $.boolean,
        $.nil,
        $.attribute_member_expression,
        $.parenthesized_expression,
        $.array,
        $.object,
      ),

    attribute_member_expression: ($) =>
      seq(
        choice($.identifier, $.private_identifier),
        repeat1(seq(choice(".", ".."), choice($.identifier, $.private_identifier))),
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

    number: () =>
      token(
        choice(
          /0x[0-9a-fA-F]+/,
          /0b[01]+/,
          /0o[0-7]+/,
          /[0-9]+(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/,
        ),
      ),

    boolean: () => choice("true", "false", "yes", "no"),

    nil: () => choice("null", "nil", "undefined"),

    identifier: () =>
      token(prec(-1, /[$A-Za-z_][A-Za-z0-9_$]*(?:-[A-Za-z0-9_$]+)*(?:[?!])?/)),

    private_identifier: () =>
      token(prec(2, /#[A-Za-z_][A-Za-z0-9_$]*(?:-[A-Za-z0-9_$]+)*(?:[?!])?/)),

    tag_name: () => token(prec(1, /[A-Za-z][A-Za-z0-9]*(?:-[A-Za-z0-9]+)*/)),

    tag_class: () => token(seq(".", /[A-Za-z_][A-Za-z0-9_-]*/)),

    tag_id: () => token(seq("#", /[A-Za-z_][A-Za-z0-9_-]*/)),

    tag_reference: () => token(seq("$", /[A-Za-z_][A-Za-z0-9_-]*/)),

    attribute_name: () => token(/[A-Za-z_:][A-Za-z0-9_:-]*(?:[?!])?/),

    event_name: () =>
      token(seq(/[A-Za-z_:][A-Za-z0-9_:-]*/, repeat(seq(".", /[A-Za-z_][A-Za-z0-9_-]*/)))),

    style_content: () => token(/[^\]\n]+/),

    style_property_name: () =>
      token(choice(/--[A-Za-z0-9_-]+/, /[A-Za-z_-][A-Za-z0-9_-]*(?:@[A-Za-z0-9_-]+)?/)),

    css_at_keyword: () => token(seq("@", /[A-Za-z_-][A-Za-z0-9_-]*/)),

    css_selector: () => token(/[.&:#%A-Za-z_][^:\n]*/),

    css_value: () => token(/[^\n]+/),
  },
});
