# Dough Language VS Code Extension

This extension provides syntax highlighting and editor behavior for Dough files.

## Supported file extensions
- `.doe`
- `.dough`

## Included features
- Keyword highlighting (`if`, `elif`, `else`, `ifcase`, `case`, `default`, `def`, `awaitval`, etc.)
- Type highlighting (`NoPoly`, `Const`, `Int`, `Flt`, `Str`, `String`, `Arr`, `Dict`, `Locked`)
- Builtin highlighting (`Print`, `Input`, `readln`, `Max`, `Min`, `exit`, `conf`)
- Operator highlighting (`>>`, `<<`, `::`, `==`, `=>`, `<=`, `>=`, `**`, `%%`, `*|`, `!|`, `!&`, `&&`, `..`)
- Point syntax highlighting (`(*Point:)`, `*Point`)
- Dough comment syntax (`//` and `/(` ... `)\`)
- Language brackets and auto-closing pairs

## Run in development host
1. Open this `Dough` folder in VS Code.
2. Press `F5`.
3. In the new Extension Development Host window, open a `.doe` file.
4. Use command palette:
   - `Dough: Run Current File`
   - `Dough: Debug Current File`

## Run and Debug (F5) in normal VS Code
Use a launch configuration like this:

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Dough: Debug Current File",
      "type": "dough",
      "request": "launch",
      "program": "${file}"
    }
  ]
}
```

## Install From Marketplace (Recommended)
1. From terminal:
   - `code --install-extension aidanace3.dough-language`
2. Or in VS Code Extensions, search for:
   - `aidanace3.dough-language`

## Package and install manually (fallback)
1. Install vsce:
   - `npm install -g @vscode/vsce`
2. Package this extension from the `Dough` folder:
   - `vsce package`
3. In VS Code:
   - `Ctrl+Shift+P` -> `Extensions: Install from VSIX...`
   - choose the generated `.vsix` file.
