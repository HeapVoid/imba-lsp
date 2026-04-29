use zed_extension_api as zed;

struct ImbaExtension;

impl zed::Extension for ImbaExtension {}

zed::register_extension!(ImbaExtension);

