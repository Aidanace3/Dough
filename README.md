# Dough Language VS Code Extension

VS Code support for Dough / Doe source files.

Current extension version: `1.0.0`

Marketplace identifier: `aidanace3.dough-language`

## Features

- syntax highlighting for `.doe` and `.dough`
- diagnostics for common syntax and point mistakes
- IntelliSense for keywords, functions, configs, dictionaries, and imports
- debugger/run commands for the Dough runtime
- import completion for local modules and `plugin:` assemblies

## Install

### From Marketplace

```powershell
code --install-extension aidanace3.dough-language
```

### From source

```powershell
npm ci
npx @vscode/vsce package --no-dependencies
```

Then install the generated `.vsix` in VS Code.

## Run and debug

The extension contributes:

- `Dough: Run Current File`
- `Dough: Debug Current File`

Minimal `launch.json`:

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

## Development

Open this `Dough` folder in VS Code and press `F5` to launch an Extension Development Host.

## Notes

- The runtime repo lives at `https://github.com/Aidanace3/Doe-Language`
- The extension repo lives at `https://github.com/Aidanace3/Dough`
