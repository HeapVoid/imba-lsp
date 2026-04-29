const PREC = {
  ASSIGN: 1,
  TERNARY: 2,
  OR: 3,
  AND: 4,
  COMPARE: 5,
  SHIFT: 6,
  ADD: 7,
  MULTIPLY: 8,
  UNARY: 9,
  CALL: 10,
  MEMBER: 11,
};

const commaSep = (rule) => optional(seq(rule, repeat(seq(",", rule)), optional(",")));
const commaSep1 = (rule) => seq(rule, repeat(seq(",", rule)), optional(","));

module.exports = grammar({
  name: "imba",

  extras: ($) => [/[ \t\f]/, $.line_comment, $.block_comment],

  externals: ($) => [$._newline, $._indent, $._dedent],

  supertypes: ($) => [$._statement, $._expression],

  conflicts: ($) => [
    [$.block, $._tag_body],
    [$.css_inline_rule, $.css_inline_rule_with_block],
  ],

  word: ($) => $.identifier,

  rules: {
    source_file: ($) => repeat(choice($._newline, $.line_comment, $.block_comment, $._statement)),

    block: ($) =>
      seq(
        $._newline,
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
        $.if_statement,
        $.for_statement,
        $.while_statement,
        $.try_statement,
        $.return_statement,
        $.assignment,
        $.decorator,
        $.inline_elif_clause,
        $.inline_else_clause,
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
        $.namespace_import,
        seq("type", choice($.identifier, $.named_imports)),
      ),

    namespace_import: ($) => seq("*", "as", $.identifier),

    named_imports: ($) => seq("{", commaSep($.import_specifier), "}"),

    import_specifier: ($) =>
      seq($.identifier, optional(seq(choice("as", ":"), $.identifier))),

    variable_declaration: ($) =>
      seq(
        optional($.export_modifier),
        choice("let", "const", "var"),
        field("name", $._binding_pattern),
        optional($.type_annotation),
        optional(seq("=", field("value", choice($._expression, $.object_block)))),
      ),

    field_declaration: ($) =>
      choice(
        seq(
          "prop",
          field("name", choice($.identifier, $.private_identifier)),
          optional($.type_annotation),
          optional(seq("=", field("value", $._expression))),
        ),
        seq(
          field("name", choice($.identifier, $.private_identifier)),
          $.type_annotation,
          optional(seq("=", field("value", $._expression))),
        ),
      ),

    function_declaration: ($) =>
      prec.right(
        seq(
          optional($.export_modifier),
          "def",
          field("name", choice($.identifier, $.private_identifier)),
          optional($._parameters),
          optional(choice($.block, seq("do", $._expression))),
        ),
      ),

    accessor_declaration: ($) =>
      prec.right(
        seq(
          optional($.export_modifier),
          choice("get", "set"),
          field("name", choice($.identifier, $.private_identifier)),
          optional($._parameters),
          optional($.block),
        ),
      ),

    _parameters: ($) => prec.right(commaSep1($.parameter)),

    parameter: ($) =>
      seq(
        field("name", choice($.identifier, $.private_identifier)),
        optional($.type_annotation),
        optional(seq("=", field("default", $._expression))),
      ),

    type_annotation: ($) => seq("\\", field("type", $._type_expression)),

    _type_expression: ($) =>
      prec.right(seq($.identifier, repeat(seq(".", $.identifier)), repeat("[]"))),

    _binding_pattern: ($) =>
      choice($.identifier, $.private_identifier, $.array_pattern, $.object_pattern),

    array_pattern: ($) => seq("[", commaSep(choice($.identifier, $.private_identifier, $.rest_pattern)), "]"),

    object_pattern: ($) => seq("{", commaSep(choice($.identifier, $.private_identifier, $.rest_pattern)), "}"),

    rest_pattern: ($) => seq("...", choice($.identifier, $.private_identifier)),

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

    css_inline_rule_with_block: ($) =>
      seq(field("content", $.css_inline_content), $.css_block),

    css_inline_rule: ($) =>
      field("content", $.css_inline_content),

    css_declaration: ($) =>
      seq(
        field("property", $.style_property_name),
        ":",
        field("value", $.css_value),
      ),

    if_statement: ($) =>
      prec.right(
        choice(
        seq(
          "if",
          field("condition", $._expression),
          field("consequence", $.block),
          repeat($.elif_clause),
          optional($.else_clause),
        ),
        seq(
          "if",
          field("condition", $._expression),
          "then",
          field("consequence", $._inline_statement),
        ),
        ),
      ),

    elif_clause: ($) => seq("elif", field("condition", $._expression), field("body", $.block)),

    else_clause: ($) => seq("else", field("body", choice($.if_statement, $.block, $._inline_statement))),

    inline_elif_clause: ($) =>
      seq("elif", field("condition", $._expression), "then", field("body", $._inline_statement)),

    inline_else_clause: ($) =>
      seq("else", optional("then"), field("body", $._inline_statement)),

    _inline_statement: ($) =>
      choice($.return_statement, $.assignment, $.expression_statement),

    for_statement: ($) =>
      seq(
        "for",
        optional("own"),
        field("left", commaSep1($.identifier)),
        choice("in", "of"),
        field("right", $._expression),
        optional(seq("when", field("condition", $._expression))),
        field("body", $.block),
      ),

    while_statement: ($) =>
      seq(choice("while", "until"), field("condition", $._expression), field("body", $.block)),

    try_statement: ($) =>
      prec.right(1, choice(
        seq(
          "try",
          field("body", $.block),
          optional(seq("catch", optional($.identifier), field("handler", $.block))),
          optional(seq("finally", field("finalizer", $.block))),
        ),
        seq(
          "try",
          field("body", $._inline_statement),
          optional(seq($._newline, "catch", $.identifier, field("handler", choice($.block, $.catch_inline_handler)))),
          optional(seq($._newline, "finally", field("finalizer", $.block))),
          optional($._newline),
        ),
      )),

    catch_inline_handler: ($) =>
      prec(2, choice($.return_statement, $.assignment, $.call_expression)),

    return_statement: ($) =>
      prec.right(
        seq(
          choice("return", "break", "continue", "throw"),
          optional(
            choice(
              seq(choice("if", "unless"), field("condition", $._expression)),
              $.object_block,
              seq($._expression, optional($.postfix_condition)),
            ),
          ),
        ),
      ),

    assignment: ($) =>
      prec.right(
        PREC.ASSIGN,
        seq(
          field("left", choice($.identifier, $.private_identifier, $.member_expression, $.subscript_expression)),
          field("operator", choice("=", "+=", "-=", "*=", "/=", "?=", "||=", "&&=", "=?")),
          field("right", choice($._expression, $.object_block)),
        ),
      ),

    expression_statement: ($) => prec.right(seq($._expression, optional($.postfix_condition))),

    postfix_condition: ($) => seq(choice("if", "unless"), field("condition", $._expression)),

    _expression: ($) =>
      choice(
        $.ternary_expression,
        $.binary_expression,
        $.unary_expression,
        $.update_expression,
        $.new_expression,
        $.trailing_do_expression,
        $.do_expression,
        $.call_expression,
        $.subscript_expression,
        $.member_expression,
        $._primary_expression,
      ),

    _primary_expression: ($) =>
      choice(
        $.identifier,
        $.private_identifier,
        $.placeholder,
        $.regex,
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

    array: ($) =>
      choice(
        seq("[", commaSep($._array_element), "]"),
        seq(
          "[",
          $._newline,
          $._indent,
          repeat(choice($._newline, seq($._array_element, optional(",")))),
          $._dedent,
          "]",
        ),
      ),

    _array_element: ($) => choice($._expression, $.spread_element),

    object: ($) =>
      choice(
        seq("{", commaSep($.object_entry), "}"),
        seq(
          "{",
          $._newline,
          $._indent,
          repeat(choice($._newline, seq($.object_entry, optional(",")))),
          $._dedent,
          "}",
        ),
      ),

    object_entry: ($) =>
      choice($.pair, $.shorthand_property, $.spread_element),

    pair: ($) => seq(field("key", choice($.identifier, $.string)), ":", field("value", $._expression)),

    shorthand_property: ($) => $.identifier,

    spread_element: ($) => seq("...", $._expression),

    object_block: ($) =>
      seq(
        $._newline,
        repeat($._newline),
        $._indent,
        repeat(choice($._newline, $.line_comment, $.block_comment, $.object_block_entry, $._statement)),
        $._dedent,
      ),

    object_block_entry: ($) =>
      seq(field("key", choice($.identifier, $.string)), ":", field("value", $._expression)),

    decorator: ($) => prec.right(seq("@", field("name", $.identifier), optional($.arguments))),

    do_expression: ($) =>
      prec.right(
        seq(
          "do",
          optional($.do_parameters),
          optional(choice($.block, $.assignment, $._expression)),
        ),
      ),

    trailing_do_expression: ($) =>
      prec.right(
        PREC.CALL,
        seq(
          field("function", $._expression),
          "do",
          optional($.do_parameters),
          optional(choice($.block, $.assignment, $._expression)),
        ),
      ),

    do_parameters: ($) => seq("(", commaSep($.do_parameter), ")"),

    do_parameter: ($) =>
      prec(
        1,
        seq(
          field("name", choice($.identifier, $.private_identifier)),
          optional($.type_annotation),
          optional(seq("=", field("default", $._expression))),
        ),
      ),

    new_expression: ($) =>
      prec.right(
        PREC.UNARY,
        seq(
          "new",
          field("constructor", $._expression),
          optional(choice($.arguments, "!")),
        ),
      ),

    member_expression: ($) =>
      prec.left(
        PREC.MEMBER,
        seq(
          field("object", $._expression),
          field("operator", choice(".", "..")),
          field("property", choice($.identifier, $.private_identifier)),
        ),
      ),

    subscript_expression: ($) =>
      prec.left(
        PREC.MEMBER,
        seq(
          field("object", $._expression),
          "[",
          optional(field("index", $._expression)),
          "]",
        ),
      ),

    ternary_expression: ($) =>
      prec.right(
        PREC.TERNARY,
        seq(
          field("condition", $._expression),
          "?",
          field("consequence", $._expression),
          ":",
          field("alternative", $._expression),
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
        $.object,
        $.do_expression,
        $.tag_element,
      ),

    unary_expression: ($) =>
      prec(
        PREC.UNARY,
        seq(field("operator", choice("!", "not", "-", "+", "await", "typeof", "void", "delete")), field("argument", $._expression)),
      ),

    update_expression: ($) =>
      prec(PREC.UNARY, seq(field("argument", $._assignable_expression), field("operator", choice("++", "--")))),

    _assignable_expression: ($) =>
      prec(1, choice($.identifier, $.private_identifier, $.member_expression, $.subscript_expression)),

    binary_expression: ($) =>
      choice(
        ...[
          [PREC.OR, choice("or", "||", "??")],
          [PREC.AND, choice("and", "&&")],
          [PREC.COMPARE, choice("is", "isnt", "isa", "instanceof", "==", "!=", "===", "!==", $.less_than, "<=", ">", ">=")],
          [PREC.SHIFT, choice($.shift_left, ">>", ">>>")],
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
          choice(field("name", $.tag_name_open), $.tag_class_open, $.tag_id_open, $.tag_reference_open),
          repeat(choice($.tag_class_binding, $.tag_class, $.tag_id, $.tag_reference, $.tag_attribute, $.event_attribute, $.inline_style)),
          ">",
          optional($._tag_body),
        ),
      ),

    _tag_body: ($) => choice(prec(2, $.block), $._expression, $._newline),

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
        $.attribute_unary_expression,
        $.attribute_subscript_expression,
        $.identifier,
        $.private_identifier,
        $.number,
        $.string,
        $.template_string,
        $.boolean,
        $.nil,
        $.attribute_call_expression,
        $.attribute_member_expression,
        $.do_expression,
        $.attribute_parenthesized_expression,
        $.array,
        $.object,
      ),

    attribute_unary_expression: ($) =>
      prec(
        PREC.UNARY,
        seq(
          field("operator", choice("!", "not", "-", "+")),
          field(
            "argument",
            choice(
              $.identifier,
              $.private_identifier,
              $.number,
              $.attribute_member_expression,
              $.attribute_subscript_expression,
            ),
          ),
        ),
      ),

    attribute_parenthesized_expression: ($) =>
      seq("(", choice($._expression, $.assignment), ")"),

    attribute_member_expression: ($) =>
      seq(
        choice($.identifier, $.private_identifier),
        repeat1(seq(choice(".", ".."), choice($.identifier, $.private_identifier))),
      ),

    attribute_call_expression: ($) =>
      seq(
        field("function", choice($.identifier, $.private_identifier, $.attribute_member_expression)),
        field("arguments", $.arguments),
      ),

    attribute_subscript_expression: ($) =>
      prec(
        PREC.MEMBER,
        seq(
          choice($.identifier, $.private_identifier, $.attribute_member_expression),
          repeat1(seq(token.immediate("["), field("index", choice($.identifier, $.number, $.string, $.attribute_member_expression)), "]")),
        ),
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

    identifier: () =>
      token(prec(0, /[$A-Za-z_][A-Za-z0-9_$]*(?:-[A-Za-z0-9_$]+)*(?:[?!])?/)),

    private_identifier: () =>
      token(prec(2, /#[A-Za-z_][A-Za-z0-9_$]*(?:-[A-Za-z0-9_$]+)*(?:[?!])?/)),

    placeholder: () => token("&"),

    less_than: () => token(prec(-1, "<")),

    shift_left: () => token(prec(4, "<<")),

    tag_name: () => token(prec(1, /[A-Za-z][A-Za-z0-9]*(?:-[A-Za-z0-9]+)*/)),

    tag_name_open: () => token(prec(3, seq("<", /[A-Za-z][A-Za-z0-9]*(?:-[A-Za-z0-9]+)*/))),

    tag_class_open: () => token(prec(3, seq("<.", /[A-Za-z_][A-Za-z0-9_-]*/))),

    tag_id_open: () => token(prec(3, seq("<#", /[A-Za-z_][A-Za-z0-9_-]*/))),

    tag_reference_open: () => token(prec(3, seq("<$", /[A-Za-z_][A-Za-z0-9_-]*/))),

    tag_class: () => token(seq(".", /[A-Za-z_][A-Za-z0-9_-]*/)),

    tag_id: () => token(seq("#", /[A-Za-z_][A-Za-z0-9_-]*/)),

    tag_reference: () => token(seq("$", /[A-Za-z_][A-Za-z0-9_-]*/)),

    attribute_name: () => token(/[A-Za-z_:][A-Za-z0-9_:-]*(?:[?!])?/),

    event_name: () =>
      token(seq(/[A-Za-z_:][A-Za-z0-9_:-]*/, repeat(seq(".", /[A-Za-z_][A-Za-z0-9_-]*/)))),

    style_content: () => token(/[^\]\n]+/),

    style_property_name: () =>
      token(choice(/\$[A-Za-z0-9_-]+/, /--[A-Za-z0-9_-]+/, /[A-Za-z_-][A-Za-z0-9_-]*(?:@[A-Za-z0-9_-]+)?/)),

    css_at_keyword: () => token(seq("@", /[A-Za-z_-][A-Za-z0-9_-]*/)),

    css_at_value: () => token(prec(1, /[^\n]+/)),

    css_comment: () => token(prec(3, /#[ \t][^\n]*/)),

    css_selector: ($) => choice($.css_complex_selector, $.css_custom_selector, $.css_class_selector, $.css_element_selector),

    css_complex_selector: () =>
      token(prec(1, choice(/[.&:#%][^\n]*,[^\n]*/, /[.&:#%A-Za-z_][^\n:]*[ \t]+[^\n:]*/))),

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
  },
});
