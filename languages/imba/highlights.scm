[
  "attr"
  "class"
  "const"
  "css"
  "def"
  "default"
  "do"
  "export"
  "get"
  "global"
  "import"
  "let"
  "prop"
  "set"
  "tag"
  "var"
] @keyword

(keyword) @keyword

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

(member_path
  property: (identifier) @property)

(private_identifier) @variable.special
"self" @variable.special

(tag_element
  name: (tag_name_open) @punctuation.bracket)

(tag_class_open) @punctuation.bracket
(tag_id_open) @punctuation.bracket
(tag_reference_open) @punctuation.bracket
(tag_close) @punctuation.bracket
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

(inline_style) @embedded
(style_content) @embedded

(css_selector) @selector
(css_complex_selector) @selector
(css_custom_selector) @selector
(css_class_selector) @selector
(css_element_selector) @selector
(css_inline_content) @string.special
(css_inline_rule_with_block
  content: (css_inline_content) @string.special)
(css_at_keyword) @keyword
(css_at_value) @string.special
(style_property_name) @property
(css_value) @string.special

(assignment_operator) @operator
(member_operator) @operator
(operator) @operator

[
  "("
  ")"
  "["
  "]"
  "{"
  "}"
] @punctuation.bracket

[
  ","
  ":"
] @punctuation.delimiter
