# Change Log

All notable changes to the "Dough" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

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
