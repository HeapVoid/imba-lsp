[
  "and"
  "await"
  "break"
  "catch"
  "class"
  "const"
  "continue"
  "css"
  "def"
  "default"
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
  "isa"
  "is"
  "isnt"
  "let"
  "nil"
  "not"
  "of"
  "or"
  "return"
  "set"
  "tag"
  "throw"
  "try"
  "until"
  "var"
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
  "null"
  "undefined"
] @constant.builtin

(line_comment) @comment
(block_comment) @comment

(string) @string
(template_string) @string.special
(escape_sequence) @string.escape
(number) @number

(function_declaration
  name: (_) @function)

(accessor_declaration
  name: (_) @function)

(class_declaration
  name: (identifier) @type)

(tag_declaration
  name: (identifier) @tag)

(parameter
  name: (_) @variable.parameter)

(private_identifier) @variable.special
(identifier) @variable

(tag_element
  name: (tag_name) @tag)

(tag_class) @attribute
(tag_id) @attribute
(tag_reference) @variable.special

(tag_attribute
  name: (attribute_name) @attribute)

(event_attribute
  "@" @keyword
  name: (event_name) @function)

(inline_style) @embedded
(style_content) @embedded

(css_selector) @tag
(css_at_keyword) @keyword
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
