# Change Log

All notable changes to the "Dough" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [1.0.0]

- Aligned the runtime, MSI, and VS Code extension packaging for the 1.0.0 release.
- Added a WiX-based MSI build path so Windows installs can provision `PATH` and `DOE_PLUGIN_PATH`.
- Promoted the built-in 2D module and plugin surface from `lib2d` to `Dough-2d`, with compatibility shims for older imports.

## [0.9.1]

- Expanded IntelliSense with explanatory docs for keywords, built-ins, types, and user-defined symbols.
- Added context-aware completion for local module imports, `plugin:` imports, and dotted field access on configs/dicts.
- Improved hover details so functions, configs, variables, dictionaries, and `new type name` values explain themselves.
- Tightened import UX to better match the runtime's `lib/`, `libs/`, `library/`, `libraries/`, and plugin folder conventions.

## [0.9.0]

- Added a cleaner 0.9 release path with self-contained runtime publishing and a release build script.
- Added runtime `--help`, `--version`, `--runtime-info`, and `--check` commands.
- Improved standalone wrappers to prefer published builds and Release DLLs before Debug fallbacks.
- Updated syntax/editor packaging to match modern `conf`, `map`, import, and plugin workflows.

## [0.8.2]

- Expanded inline diagnostics and warnings for Dough editing.
- Improved syntax scope coverage for declarations, calls, keywords, and deprecated forms.
- Added language file icon mapping to `assets/favicon_fileimg.png`.

## [0.7.3-alpha-1.BUGFIX]

- Added expanded parser + editor diagnostics for new README syntax forms.
- Added `yeild value >> *Point as alias` dispatch syntax.
- Added `as(...)` and `each(... in ...) do:` loop support.

## [0.7.3]

- Marketplace-ready packaging updates (`--no-dependencies` publish/package path).
- Added explicit local scripts for check/package/publish.
- Excluded local `.vsix` artifacts from packaged extension contents.

## [0.7.2]

- Improved syntax diagnostics:
  - undefined point references
  - `return` outside function detection
  - assignment-in-condition warnings (`if (x = 1)`)
  - stronger `case/default` shape warnings
- Added debugger integration improvements for standalone use.

## [0.1.2]

- Added direct syntax diagnostics and uncalled-point warnings.
- Expanded syntax support highlighting (`dict`, `locked`, `conf`, point forms, operators).
- Switched Marketplace publisher to `aidanace3`.
- Added Marketplace publish automation workflow.

## [0.0.7]

- Initial release
