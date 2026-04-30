[
  "and"
  "as"
  "await"
  "break"
  "catch"
  "class"
  "const"
  "continue"
  "css"
  "delete"
  "def"
  "default"
  "do"
  "elif"
  "else"
  "export"
  "extends"
  "finally"
  "for"
  "from"
  "get"
  "global"
  "if"
  "import"
  "in"
  "instanceof"
  "isa"
  "is"
  "isnt"
  "let"
  "new"
  "not"
  "of"
  "or"
  "own"
  "prop"
  "return"
  "set"
  "tag"
  "then"
  "throw"
  "typeof"
  "try"
  "until"
  "unless"
  "var"
  "void"
  "when"
  "while"
] @keyword

[
  "true"
  "false"
  "yes"
  "no"
] @boolean

[
  "nil"
  "null"
  "undefined"
] @constant.builtin

(line_comment) @comment
(block_comment) @comment
(css_comment) @comment

(string) @string
(template_string) @string.special
(escape_sequence) @string.escape
(regex) @string.regex
(number) @number

(identifier) @variable

(function_declaration
  name: (_) @function)

(accessor_declaration
  name: (_) @function)

(call_expression
  function: (identifier) @function.call)

(call_expression
  function: (member_expression
    property: (identifier) @function.method))

(class_declaration
  name: (identifier) @type)

(tag_declaration
  name: (identifier) @tag)

(variable_declaration
  name: (_) @variable)

(field_declaration
  name: (_) @property)

(assignment
  left: (identifier) @variable)

(member_expression
  property: (identifier) @property)

(pair
  key: (_) @property)

(object_block_entry
  key: (_) @property)

(shorthand_property) @property

(parameter
  name: (_) @variable.parameter)

(do_parameter
  name: (_) @variable.parameter)

(type_annotation
  type: (_) @type)

(private_identifier) @variable.special
"self" @variable.special

(tag_element
  name: (tag_name_open) @tag)

(tag_class_open) @attribute
(tag_id_open) @attribute
(tag_reference_open) @variable.special
(tag_class_binding
  name: (tag_class) @attribute)
(tag_class) @attribute
(tag_id) @attribute
(tag_reference) @variable.special

(tag_attribute
  name: (attribute_name) @attribute)

(tag_class_binding
  name: (tag_class) @attribute)

(event_attribute
  "@" @keyword
  name: (event_name) @function)

(decorator
  "@" @keyword
  name: (identifier) @attribute)

(inline_style) @embedded
(style_content) @embedded

(css_selector) @tag
(css_complex_selector) @tag
(css_custom_selector) @tag
(css_class_selector) @tag
(css_element_selector) @tag
(css_inline_content) @string.special
(css_inline_rule_with_block
  content: (css_inline_content) @string.special)
(css_at_keyword) @keyword
(css_at_value) @string.special
(style_property_name) @property
(css_value) @string.special

[
  "="
  "+="
  "-="
  "*="
  "/="
  "?="
  "||="
  "&&="
  "=?"
  "++"
  "--"
  "+"
  "-"
  "*"
  "/"
  "%"
  "=="
  "!="
  "==="
  "!=="
  "<"
  "<="
  ">"
  ">="
  "!"
  "."
  ".."
] @operator

(less_than) @operator
(shift_left) @operator

[
  "("
  ")"
  "["
  "]"
  "{"
  "}"
  "<"
  ">"
] @punctuation.bracket

[
  ","
  ":"
] @punctuation.delimiter
